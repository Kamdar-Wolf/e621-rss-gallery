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
const DB_VERSION=3;
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
      if(!req.result.objectStoreNames.contains("media")){
        const media=req.result.createObjectStore("media",{keyPath:"id"});
        media.createIndex("byUser","userId",{unique:false});
        media.createIndex("byEntry",["userId","entryId"],{unique:false});
      }
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
// This store is separate from the article snapshot to avoid re-encrypting
// the entire reader library for one downloaded image. Media is private to
// this browser, never republished to GitHub Pages.
const MAX_MEDIA_BYTES=48*1024*1024;
const MAX_IMAGE_BYTES=5*1024*1024;
const MAX_MEDIA_ITEMS=120;
type MediaRow={
  id:string;userId:string;entryId:string;position:number;
  iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer;
  storedBytes:number;createdAt:number;
};
export type CachedImage={
  id:string;url:string;mimeType:string;position:number;
  bytes:number;blob:Blob;
};
function imageAad(userId:string,entryId:string){
  return encoder.encode("kamdar-image-v1:"+userId+":"+entryId);
}
function validateImageUrl(raw:string){
  if(raw.length>4096)throw Error("Adresa obrázku je příliš dlouhá.");
  const url=new URL(raw);
  if(url.protocol!=="https:"||url.username||url.password)
    throw Error("Offline ukládání podporuje pouze HTTPS obrázky bez přihlašovacích údajů v URL.");
  if(url.hostname==="localhost"||url.hostname.endsWith(".localhost")||
     /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|\[)/.test(url.hostname))
    throw Error("Místní síť není pro stahování médií povolena.");
  return url.href;
}
function imageMime(contentType:string){
  const mime=contentType.split(";")[0].trim().toLowerCase();
  if(!["image/jpeg","image/png","image/webp","image/gif","image/avif"].includes(mime))
    throw Error("Neplatný nebo nepodporovaný formát obrázku.");
  return mime;
}
function isActualImage(data:Uint8Array,mime:string){
  if(mime==="image/jpeg")
    return data.length>=3&&data[0]===255&&data[1]===216&&data[2]===255;
  if(mime==="image/png")
    return data.length>=8&&[137,80,78,71,13,10,26,10].every((x,i)=>data[i]===x);
  if(mime==="image/gif")
    return data.length>=6&&decoder.decode(data.subarray(0,4))==="GIF8";
  if(mime==="image/webp")
    return data.length>=12&&decoder.decode(data.subarray(0,4))==="RIFF"&&
      decoder.decode(data.subarray(8,12))==="WEBP";
  if(mime==="image/avif")
    return data.length>=12&&decoder.decode(data.subarray(4,8))==="ftyp"&&
      ["avif","avis"].includes(decoder.decode(data.subarray(8,12)));
  return false;
}
async function mediaRows(userId:string,entryId?:string):Promise<MediaRow[]>{
  const instance=await db();
  return new Promise((resolve,reject)=>{
    const tx=instance.transaction("media","readonly");
    const req=entryId?
      tx.objectStore("media").index("byEntry").getAll([userId,entryId]):
      tx.objectStore("media").index("byUser").getAll(userId);
    req.onsuccess=()=>resolve(req.result as MediaRow[]);
    req.onerror=()=>reject(req.error||Error("Mediální cache není dostupná."));
  });
}
async function openImage(row:MediaRow,key:CryptoKey):Promise<CachedImage>{
  const clear=new Uint8Array(await crypto.subtle.decrypt({
    name:"AES-GCM",iv:row.iv,additionalData:imageAad(row.userId,row.entryId),tagLength:128
  },key,row.ciphertext));
  if(clear.length<5)throw Error("Poškozená mediální cache.");
  const size=new DataView(clear.buffer,clear.byteOffset,4).getUint32(0);
  if(size>4096||size+4>clear.byteLength)throw Error("Poškozená metadata obrázku.");
  const meta=JSON.parse(decoder.decode(clear.subarray(4,4+size))) as {
    url:string;mimeType:string;bytes:number
  };
  if(!meta||typeof meta.url!=="string"||!meta.mimeType||meta.bytes!==clear.length-4-size)
    throw Error("Poškozená metadata obrázku.");
  const data=clear.slice(4+size);
  if(!isActualImage(data,meta.mimeType))throw Error("Neplatná data uloženého obrázku.");
  return {id:row.id,url:meta.url,mimeType:meta.mimeType,
    position:row.position,bytes:meta.bytes,blob:new Blob([data],{type:meta.mimeType})};
}
export async function cachedImages(userId:string,entryId:string):Promise<CachedImage[]>{
  validateUserId(userId);validateUserId(entryId);
  const key=unlockedKeys.get(userId);
  if(!key)return [];
  const rows=await mediaRows(userId,entryId);
  const images=await Promise.all(rows.map(row=>openImage(row,key)));
  return images.sort((a,b)=>a.position-b.position||a.id.localeCompare(b.id));
}
async function limitedImageFetch(url:string,entryId?:string,mediaId?:string):
  Promise<{mimeType:string;bytes:ArrayBuffer}>{
  // Media IDs are DB-generated, never arbitrary remote URLs passed to a proxy.
  const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const viaServer=Boolean(entryId&&mediaId&&uuid.test(entryId)&&uuid.test(mediaId));
  const route=viaServer?
    "/api/v1/entries/"+entryId+"/media/"+mediaId+"/download":url;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),20_000);
  try{
    const response=await fetch(route,{
      mode:viaServer?"same-origin":"cors",
      credentials:viaServer?"same-origin":"omit",
      referrerPolicy:"no-referrer",
      redirect:viaServer?"error":"follow",cache:"no-store",
      signal:controller.signal});
    if(!response.ok||response.type==="opaque")
      throw Error("Server obrázek nevydal. HTTP "+response.status);
    if(viaServer){
      // A server download must remain same-origin, including in browser redirects.
      if(response.url&&typeof window!=="undefined"&&
        new URL(response.url,window.location.href).origin!==window.location.origin)
        throw Error("Serverové stahování přesměrovalo mimo vlastní doménu.");
    }else validateImageUrl(response.url||url);
    const mimeType=imageMime(response.headers.get("content-type")||"");
    const claimed=Number(response.headers.get("content-length")||"0");
    if(claimed>MAX_IMAGE_BYTES)throw Error("Obrázek přesahuje limit 5 MiB.");
    const reader=response.body?.getReader();
    if(!reader){
      const bytes=await response.arrayBuffer();
      if(bytes.byteLength>MAX_IMAGE_BYTES)throw Error("Obrázek přesahuje limit 5 MiB.");
      if(!isActualImage(new Uint8Array(bytes),mimeType))throw Error("Soubor není validní obrázek.");
      return {bytes,mimeType};
    }
    const chunks:Uint8Array[]=[];
    let total=0;
    for(;;){
      const next=await reader.read();
      if(next.done)break;
      total+=next.value.length;
      if(total>MAX_IMAGE_BYTES){await reader.cancel();throw Error("Obrázek přesahuje limit 5 MiB.");}
      chunks.push(next.value);
    }
    const merged=new Uint8Array(total);
    let offset=0;
    for(const part of chunks){merged.set(part,offset);offset+=part.length;}
    if(!isActualImage(merged,mimeType))throw Error("Soubor není validní obrázek.");
    return {bytes:merged.buffer,mimeType};
  }finally{clearTimeout(timeout);}
}
export async function cacheImage(
  userId:string,entryId:string,url:string,position:number,mediaId?:string
):Promise<{id:string;bytes:number}>{
  validateUserId(userId);validateUserId(entryId);
  const canonical=validateImageUrl(url);
  if(!unlockedKeys.has(userId))throw Error("Nejdříve odemkni offline trezor.");
  const downloaded=await limitedImageFetch(canonical,entryId,mediaId);
  const task=async()=>{
    const key=unlockedKeys.get(userId);
    if(!key)throw Error("Offline trezor byl mezitím zamčen.");
    const existing=await mediaRows(userId);
    const idBytes=await crypto.subtle.digest("SHA-256",
      encoder.encode(userId+"\0"+entryId+"\0"+canonical));
    const id=userId+":"+entryId+":"+Array.from(new Uint8Array(idBytes))
      .map(b=>b.toString(16).padStart(2,"0")).join("");
    const previous=existing.find(row=>row.id===id);
    const previousSize=previous?.storedBytes||0;
    if(existing.length>=MAX_MEDIA_ITEMS&&!previous)
      throw Error("Mediální cache má limit 120 obrázků.");
    const total=existing.reduce((sum,item)=>sum+item.storedBytes,0);
    if(total-previousSize+downloaded.bytes.byteLength>MAX_MEDIA_BYTES)
      throw Error("Mediální cache překročila 48 MiB. Smaž některé uložené obrázky.");
    const meta=encoder.encode(JSON.stringify({
      url:canonical,mimeType:downloaded.mimeType,bytes:downloaded.bytes.byteLength
    }));
    const data=new Uint8Array(downloaded.bytes);
    const plain=new Uint8Array(4+meta.byteLength+data.byteLength);
    new DataView(plain.buffer).setUint32(0,meta.byteLength);
    plain.set(meta,4);plain.set(data,4+meta.byteLength);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ciphertext=await crypto.subtle.encrypt({
      name:"AES-GCM",iv,additionalData:imageAad(userId,entryId),tagLength:128
    },key,plain);
    if(unlockedKeys.get(userId)!==key)throw Error("Offline trezor byl zamčen.");
    const instance=await db();
    const tx=instance.transaction(["vaults","media"],"readwrite");
    const finished=done(tx);
    const record=tx.objectStore("vaults").get(userId);
    record.onsuccess=()=>{
      if(!record.result||unlockedKeys.get(userId)!==key){tx.abort();return;}
      tx.objectStore("media").put({
        id,userId,entryId,position,iv,ciphertext,
        storedBytes:downloaded.bytes.byteLength,createdAt:Date.now()
      } satisfies MediaRow);
    };
    await finished;
    return {id,bytes:downloaded.bytes.byteLength};
  };
  const locks=typeof navigator!=="undefined"?navigator.locks:undefined;
  return locks?locks.request("kr-cache-image-"+userId,task):task();
}
export async function deleteCachedImage(userId:string,id:string):Promise<void>{
  validateUserId(userId);
  if(!unlockedKeys.has(userId))throw Error("Trezor musí být odemčen.");
  if(!id.startsWith(userId+":"))throw Error("Obrázek patří jinému účtu.");
  const instance=await db();
  const tx=instance.transaction("media","readwrite");
  const finished=done(tx);
  tx.objectStore("media").delete(id);
  await finished;
}
export async function deleteVault(userId:string):Promise<void>{
  validateUserId(userId);
  lockVault(userId);
  const instance=await db();
  const tx=instance.transaction(["vaults","queues","media"],"readwrite");
  const finished=done(tx);
  tx.objectStore("vaults").delete(userId);
  tx.objectStore("queues").delete(userId);
  const cursor=tx.objectStore("media").index("byUser").openCursor(userId);
  cursor.onsuccess=()=>{
    const item=cursor.result;
    if(item){item.delete();item.continue();}
  };
  await finished;
}
