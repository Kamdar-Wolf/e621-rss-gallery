import type {Entry,Feed,Stats} from "./api.js";
import type {QueuedChange} from "./offline.js";

export interface VaultSnapshot {
  userId:string;feeds:Feed[];entries:Entry[];stats:Stats;savedAt:number;
}
export interface VaultProfile {
  userId:string;handle:string;createdAt:number;updatedAt:number;
}
interface VaultRecord extends VaultProfile {
  salt:Uint8Array<ArrayBuffer>;iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer;
}
interface QueueRecord {
  userId:string;iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer;updatedAt:number;
}

const DB_NAME="kamdar-reader-vault-v1";
const DB_VERSION=2;
const PBKDF2_ITERATIONS=350_000;
const MAX_ENTRIES=500;
const encoder=new TextEncoder();
const decoder=new TextDecoder();
const unlockedKeys=new Map<string,CryptoKey>();
const pendingWrites=new Map<string,Promise<void>>();
const pendingQueueWrites=new Map<string,Promise<unknown>>();
let dbPromise:Promise<IDBDatabase>|null=null;

function validateUserId(value:string){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value))
    throw Error("Neplatné ID offline účtu");
}
function validatePassphrase(text:string){
  if(typeof text!=="string"||text.length<12||text.length>256)
    throw Error("Offline heslo musí mít 12–256 znaků.");
}
function blankSnapshot(userId:string):VaultSnapshot{
  return {userId,feeds:[],entries:[],savedAt:Date.now(),
    stats:{subscriptions:0,entries:0,unread:0,starred:0,saved:0}};
}
function done(tx:IDBTransaction):Promise<void>{
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||Error("Databázová operace selhala"));
    tx.onabort=()=>reject(tx.error||Error("Databázová operace byla přerušena"));
  });
}
function db():Promise<IDBDatabase>{
  if(dbPromise)return dbPromise;
  const opened=new Promise<IDBDatabase>((resolve,reject)=>{
    if(typeof indexedDB==="undefined"){reject(Error("Prohlížeč nepodporuje IndexedDB"));return;}
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains("vaults"))
        req.result.createObjectStore("vaults",{keyPath:"userId"});
      if(!req.result.objectStoreNames.contains("queues"))
        req.result.createObjectStore("queues",{keyPath:"userId"});
    };
    req.onsuccess=()=>{
      const instance=req.result;
      instance.onversionchange=()=>{instance.close();dbPromise=null;};
      resolve(instance);
    };
    req.onerror=()=>reject(req.error||Error("Offline trezor nelze otevřít"));
    req.onblocked=()=>reject(Error("Offline databázi blokuje jiná otevřená karta"));
  });
  dbPromise=opened.catch(e=>{dbPromise=null;throw e;});
  return dbPromise;
}
async function getRecord(userId:string):Promise<VaultRecord|null>{
  validateUserId(userId);
  const instance=await db();
  return new Promise((resolve,reject)=>{
    const tx=instance.transaction("vaults","readonly");
    const request=tx.objectStore("vaults").get(userId);
    request.onsuccess=()=>resolve((request.result as VaultRecord|undefined)||null);
    request.onerror=()=>reject(request.error||Error("Trezor nelze přečíst"));
  });
}
async function derive(passphrase:string,salt:Uint8Array<ArrayBuffer>):Promise<CryptoKey>{
  validatePassphrase(passphrase);
  const root=await crypto.subtle.importKey("raw",encoder.encode(passphrase),
    "PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",salt,
    iterations:PBKDF2_ITERATIONS,hash:"SHA-256"},root,
    {name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
function aad(userId:string){return encoder.encode("kamdar-vault-v1:"+userId);}
function queueAad(userId:string){return encoder.encode("kamdar-queue-v1:"+userId);}
async function encrypt(userId:string,content:VaultSnapshot,key:CryptoKey):Promise<{
  iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer;
}>{
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt(
    {name:"AES-GCM",iv,additionalData:aad(userId),tagLength:128},
    key,encoder.encode(JSON.stringify(content)));
  return {iv,ciphertext};
}
async function decrypt(row:VaultRecord,key:CryptoKey):Promise<VaultSnapshot>{
  const plain=await crypto.subtle.decrypt(
    {name:"AES-GCM",iv:row.iv,additionalData:aad(row.userId),tagLength:128},
    key,row.ciphertext);
  const snapshot=JSON.parse(decoder.decode(plain)) as VaultSnapshot;
  if(snapshot.userId!==row.userId||!Array.isArray(snapshot.entries)||
    !Array.isArray(snapshot.feeds)||!snapshot.stats)
    throw Error("Neplatný obsah offline trezoru");
  return snapshot;
}
function profile(row:VaultRecord):VaultProfile{
  return {userId:row.userId,handle:row.handle,
    createdAt:row.createdAt,updatedAt:row.updatedAt};
}
export async function listVaultProfiles():Promise<VaultProfile[]>{
  const instance=await db();
  const records=await new Promise<VaultRecord[]>((resolve,reject)=>{
    const tx=instance.transaction("vaults","readonly");
    const request=tx.objectStore("vaults").getAll();
    request.onsuccess=()=>resolve(request.result as VaultRecord[]);
    request.onerror=()=>reject(request.error||Error("Offline profily nelze načíst"));
  });
  return records.map(profile).sort((a,b)=>a.handle.localeCompare(b.handle,"cs"));
}
export async function vaultExists(userId:string):Promise<boolean>{
  return Boolean(await getRecord(userId));
}
export function isVaultUnlocked(userId:string):boolean{
  return unlockedKeys.has(userId);
}
export function lockVault(userId?:string):void{
  if(userId)unlockedKeys.delete(userId);
  else unlockedKeys.clear();
}
export async function createVault(userId:string,handle:string,passphrase:string):Promise<void>{
  validateUserId(userId);
  if(!handle||handle.length>100)throw Error("Neplatný název profilu");
  validatePassphrase(passphrase);
  if(await getRecord(userId))throw Error("Trezor už existuje. Odemkni ho heslem.");
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const key=await derive(passphrase,salt);
  const sealed=await encrypt(userId,blankSnapshot(userId),key);
  const now=Date.now();
  const record:VaultRecord={userId,handle,salt,...sealed,createdAt:now,updatedAt:now};
  const instance=await db();
  const tx=instance.transaction("vaults","readwrite");
  const finished=done(tx);
  tx.objectStore("vaults").add(record);
  await finished;
  unlockedKeys.set(userId,key);
}
/** Decryption is the only way to authenticate an offline unlock. */
export async function unlockVault(userId:string,passphrase:string):Promise<{
  profile:VaultProfile;snapshot:VaultSnapshot;
}>{
  validatePassphrase(passphrase);
  const row=await getRecord(userId);
  if(!row)throw Error("Pro tento účet neexistuje offline trezor.");
  try{
    const key=await derive(passphrase,row.salt);
    const snapshot=await decrypt(row,key);
    unlockedKeys.set(userId,key);
    return {profile:profile(row),snapshot};
  }catch{
    throw Error("Nesprávné offline heslo nebo poškozený trezor.");
  }
}
/** Returns null while locked, never falls back to plaintext. */
export async function getVaultSnapshot(userId:string):Promise<VaultSnapshot|null>{
  const key=unlockedKeys.get(userId);
  if(!key)return null;
  const row=await getRecord(userId);
  return row?decrypt(row,key):null;
}
/** Merge and encrypt on each write; serialize concurrent writes in this tab. */
export async function saveVaultSnapshot(
  userId:string,feeds:Feed[],entries:Entry[],stats:Stats
):Promise<void>{
  const last=pendingWrites.get(userId)||Promise.resolve();
  const next=last.catch(()=>{}).then(async()=>{
    const key=unlockedKeys.get(userId);
    if(!key)return;
    const row=await getRecord(userId);
    if(!row)return;
    const before=await decrypt(row,key);
    const map=new Map(before.entries.map(item=>[item.id,item]));
    for(const item of entries)map.set(item.id,item);
    const selected=[...map.values()]
      .sort((a,b)=>Date.parse(b.published_at||b.created_at)-
        Date.parse(a.published_at||a.created_at))
      .slice(0,MAX_ENTRIES);
    const snapshot:VaultSnapshot={userId,feeds,entries:selected,stats,savedAt:Date.now()};
    const sealed=await encrypt(userId,snapshot,key);
    if(unlockedKeys.get(userId)!==key)return; // user locked while encryption was running
    const instance=await db();
    const tx=instance.transaction("vaults","readwrite");
    const finished=done(tx);
    // Read under write lock to avoid resurrecting a deleted vault.
    const store=tx.objectStore("vaults");
    const existing=store.get(userId);
    existing.onsuccess=()=>{
      if(existing.result && unlockedKeys.get(userId)===key)
        store.put({...existing.result,...sealed,updatedAt:Date.now()} as VaultRecord);
    };
    await finished;
  });
  pendingWrites.set(userId,next);
  try{await next;}
  finally{if(pendingWrites.get(userId)===next)pendingWrites.delete(userId);}
}
async function queueRecord(userId:string):Promise<QueueRecord|null>{
  const instance=await db();
  return new Promise((resolve,reject)=>{
    const tx=instance.transaction("queues","readonly");
    const request=tx.objectStore("queues").get(userId);
    request.onsuccess=()=>resolve((request.result as QueueRecord|undefined)||null);
    request.onerror=()=>reject(request.error||Error("Šifrovanou frontu nelze načíst."));
  });
}
async function decryptQueue(row:QueueRecord,key:CryptoKey):Promise<QueuedChange[]>{
  const buffer=await crypto.subtle.decrypt({
    name:"AES-GCM",iv:row.iv,additionalData:queueAad(row.userId),tagLength:128
  },key,row.ciphertext);
  const parsed:unknown=JSON.parse(decoder.decode(buffer));
  if(!Array.isArray(parsed)||parsed.length>1500)throw Error("Neplatná zašifrovaná fronta.");
  for(const item of parsed){
    if(!item||typeof item!=="object"||!("userId" in item)||
      item.userId!==row.userId||!("id" in item)||typeof item.id!=="string")
      throw Error("Záznam fronty neodpovídá účtu.");
  }
  return parsed as QueuedChange[];
}
export async function getEncryptedQueue(userId:string):Promise<QueuedChange[]>{
  validateUserId(userId);
  const key=unlockedKeys.get(userId);
  if(!key)return [];
  const row=await queueRecord(userId);
  return row?decryptQueue(row,key):[];
}
/** Serializes read/decrypt/modify/encrypt for this user; cross-tab lock where supported. */
export async function mutateEncryptedQueue<T>(
  userId:string,
  apply:(items:QueuedChange[])=>{items:QueuedChange[];result:T}
):Promise<T>{
  validateUserId(userId);
  const previous=pendingQueueWrites.get(userId)||Promise.resolve();
  const job=previous.catch(()=>{}).then(async()=>{
    const key=unlockedKeys.get(userId);
    if(!key)throw Error("Nejdříve odemkni offline trezor.");
    const perform=async():Promise<T>=>{
      const prior=await queueRecord(userId);
      const current=prior?await decryptQueue(prior,key):[];
      const changed=apply(current);
      if(changed.items.length>1500)throw Error("Offline fronta má limit 1500 změn.");
      if(unlockedKeys.get(userId)!==key)throw Error("Offline trezor byl mezitím zamčen.");
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const ciphertext=await crypto.subtle.encrypt({
        name:"AES-GCM",iv,additionalData:queueAad(userId),tagLength:128
      },key,encoder.encode(JSON.stringify(changed.items)));
      if(unlockedKeys.get(userId)!==key)throw Error("Offline trezor byl mezitím zamčen.");
      const instance=await db();
      const tx=instance.transaction(["queues","vaults"],"readwrite");
      const finished=done(tx);
      const vault=tx.objectStore("vaults").get(userId);
      vault.onsuccess=()=>{
        if(!vault.result || unlockedKeys.get(userId)!==key){
          tx.abort();
          return;
        }
        tx.objectStore("queues").put({userId,iv,ciphertext,updatedAt:Date.now()} satisfies QueueRecord);
      };
      await finished;
      return changed.result;
    };
    const locks=typeof navigator!=="undefined"?navigator.locks:undefined;
    return locks?locks.request("kr-vault-queue-"+userId,perform):perform();
  });
  pendingQueueWrites.set(userId,job);
  try{return await job as T;}
  finally{if(pendingQueueWrites.get(userId)===job)pendingQueueWrites.delete(userId);}
}
export async function deleteVault(userId:string):Promise<void>{
  validateUserId(userId);
  lockVault(userId);
  const instance=await db();
  const tx=instance.transaction(["vaults","queues"],"readwrite");
  const finished=done(tx);
  tx.objectStore("vaults").delete(userId);
  tx.objectStore("queues").delete(userId);
  await finished;
}
