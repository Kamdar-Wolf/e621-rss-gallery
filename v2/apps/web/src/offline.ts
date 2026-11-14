import type {Entry,Feed,Stats} from "./api.js";
import {deleteVault,getVaultSnapshot,isVaultUnlocked,saveVaultSnapshot,
  getEncryptedQueue,mutateEncryptedQueue} from "./offline-vault.js";

const DB_NAME="kamdar-reader-offline";
const DB_VERSION=4;
const OP_LIMIT=1500;

export type OfflineField="read"|"starred"|"saved";
export type OfflineState="pending"|"conflict";
export interface QueuedChange {
  id:string;userId:string;entryId:string;field:OfflineField;
  generation?:number;
  inFlight?:boolean;
  desired:boolean;baseValue:boolean;expectedRevision:number;
  createdAt:number;updatedAt:number;status:OfflineState;
  remoteRevision?:number;remoteValue?:boolean;
}
export interface OfflineSnapshot {
  userId:string;feeds:Feed[];entries:Entry[];stats:Stats;savedAt:number;
}
export interface RemoteState {
  read_at:string|null;starred_at:string|null;saved_at:string|null;
  revision:number;updated_at:string;
}
export type SendResult=
  | {kind:"ok";state:RemoteState}
  | {kind:"conflict";state:RemoteState}
  | {kind:"retry"}
  | {kind:"gone"};
export interface FlushResult {
  applied:number;conflicts:number;remaining:number;blocked:boolean;
}

let dbPromise:Promise<IDBDatabase>|null=null;
function openDB():Promise<IDBDatabase>{
  if(!dbPromise){
    dbPromise=new Promise<IDBDatabase>((resolve,reject)=>{
      if(typeof indexedDB==="undefined"){
        reject(new Error("IndexedDB není v tomto prohlížeči k dispozici"));return;
      }
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=(event:IDBVersionChangeEvent)=>{
        const db=req.result;
        if(!db.objectStoreNames.contains("snapshots"))
          db.createObjectStore("snapshots",{keyPath:"userId"});
        // The old development build cached personal feed URLs without opt-in.
        // Wipe those legacy snapshots during the privacy migration.
        if(req.transaction && event.oldVersion<4){
          // Never retain old plaintext RSS snapshots from v1/v2.
          req.transaction.objectStore("snapshots").clear();
          if(db.objectStoreNames.contains("prefs"))
            req.transaction.objectStore("prefs").clear();
        }
        if(!db.objectStoreNames.contains("prefs"))
          db.createObjectStore("prefs",{keyPath:"userId"});
        if(!db.objectStoreNames.contains("queue")){
          const store=db.createObjectStore("queue",{keyPath:"id"});
          store.createIndex("byUser","userId",{unique:false});
        }
      };
      req.onsuccess=()=>{
        const db=req.result;
        db.onversionchange=()=>{db.close();dbPromise=null;};
        resolve(db);
      };
      req.onerror=()=>reject(req.error||new Error("Nelze otevřít IndexedDB"));
      req.onblocked=()=>reject(new Error("Databázi blokuje jiná otevřená karta"));
    }).catch(error=>{dbPromise=null;throw error;});
  }
  return dbPromise!;
}
function finished(tx:IDBTransaction):Promise<void>{
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error||new Error("Operace IndexedDB selhala"));
    tx.onabort=()=>reject(tx.error||new Error("Operace IndexedDB byla přerušena"));
  });
}
function validUser(userId:string):void{
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId))
    throw new Error("Neplatné ID offline účtu");
}
function opId(userId:string,entryId:string,field:OfflineField):string{
  validUser(userId);
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entryId))
    throw new Error("Neplatné ID položky");
  return userId+":"+entryId+":"+field;
}
function timestamp(entry:Entry):number{
  const t=new Date(entry.published_at||entry.created_at).getTime();
  return Number.isFinite(t)?t:0;
}
/** Snapshot and preference APIs now require an unlocked encrypted vault. */
export async function getSnapshot(userId:string):Promise<OfflineSnapshot|null>{
  validUser(userId);
  return getVaultSnapshot(userId);
}
export async function getCachePreference(userId:string):Promise<boolean>{
  validUser(userId);
  return isVaultUnlocked(userId);
}
export async function cacheSnapshot(
  userId:string,feeds:Feed[],entries:Entry[],stats:Stats
):Promise<void>{
  validUser(userId);
  await saveVaultSnapshot(userId,feeds,entries,stats);
}
/** Legacy v3 queue stays readable only for one-time migration; new changes never write here. */
export async function legacyChangeCount(userId:string):Promise<number>{
  validUser(userId);
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("queue","readonly");
    const req=tx.objectStore("queue").index("byUser").count(userId);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
/** Encrypt all legacy rows first; only then erase the unencrypted originals. */
export async function migrateLegacyQueue(userId:string):Promise<number>{
  validUser(userId);
  if(!isVaultUnlocked(userId))throw Error("Pro převod fronty musí být trezor odemčen.");
  const db=await openDB();
  const prior=await new Promise<QueuedChange[]>((resolve,reject)=>{
    const tx=db.transaction("queue","readonly");
    const req=tx.objectStore("queue").index("byUser").getAll(userId);
    req.onsuccess=()=>resolve(req.result as QueuedChange[]);
    req.onerror=()=>reject(req.error);
  });
  if(!prior.length)return 0;
  await mutateEncryptedQueue(userId,current=>{
    const byId=new Map(prior.map(row=>[row.id,row]));
    // Never replace more recent already-encrypted changes with older plaintext.
    for(const row of current)byId.set(row.id,row);
    return {items:[...byId.values()],result:undefined};
  });
  const tx=db.transaction("queue","readwrite");
  const finishedTx=finished(tx);
  const cursor=tx.objectStore("queue").index("byUser").openCursor(userId);
  cursor.onsuccess=()=>{
    const row=cursor.result;
    if(row){row.delete();row.continue();}
  };
  await finishedTx;
  return prior.length;
}
export async function getChanges(userId:string):Promise<QueuedChange[]>{
  validUser(userId);
  return (await getEncryptedQueue(userId))
    .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
}
function stateColumn(field:OfflineField):"read_at"|"starred_at"|"saved_at"{
  return field==="read"?"read_at":field==="starred"?"starred_at":"saved_at";
}
export function overlayChanges(entries:Entry[],changes:QueuedChange[]):Entry[]{
  const byEntry=new Map<string,QueuedChange[]>();
  for(const op of changes){
    const current=byEntry.get(op.entryId)||[];
    current.push(op);byEntry.set(op.entryId,current);
  }
  return entries.map(entry=>{
    const operations=byEntry.get(entry.id);
    if(!operations?.length)return entry;
    const next={...entry};
    for(const op of operations)
      next[stateColumn(op.field)]=op.desired?new Date(op.updatedAt).toISOString():null;
    return next;
  });
}
export async function queueChange(userId:string,entry:Entry,field:OfflineField,desired:boolean):Promise<void>{
  const id=opId(userId,entry.id,field);
  await mutateEncryptedQueue(userId,items=>{
    const previous=items.find(item=>item.id===id);
    const baseValue=previous?.baseValue??Boolean(entry[stateColumn(field)]);
    if(desired===baseValue&&!previous?.inFlight){
      return {items:items.filter(item=>item.id!==id),result:undefined};
    }
    if(!previous&&items.length>=OP_LIMIT)
      throw Error("Offline fronta má limit "+OP_LIMIT+" změn. Nejprve synchronizuj.");
    const now=Date.now();
    const record:QueuedChange={
      id,userId,entryId:entry.id,field,desired,baseValue,
      expectedRevision:previous?.expectedRevision??Number(entry.revision||0),
      generation:(previous?.generation??0)+1,inFlight:false,
      createdAt:previous?.createdAt??now,updatedAt:now,status:"pending"
    };
    return {items:[...items.filter(item=>item.id!==id),record],result:undefined};
  });
}
/** Persist in-flight marker before HTTP to preserve concurrent edits. */
async function markSending(op:QueuedChange):Promise<void>{
  const userId=op.userId;
  await mutateEncryptedQueue(userId,items=>({
    items:items.map(item=>item.id===op.id&&item.generation===op.generation
      ?{...item,inFlight:true}:item),result:undefined
  }));
}
async function updateIfCurrent(op:QueuedChange,action:"delete"|"conflict"|"rebase",
  remote?:RemoteState):Promise<boolean>{
  return mutateEncryptedQueue(op.userId,items=>{
    const current=items.find(item=>item.id===op.id);
    if(!current)return {items,result:false};
    if(current.generation!==op.generation||current.desired!==op.desired){
      if(action==="delete"&&remote){
        const serverValue=Boolean(remote[stateColumn(op.field)]);
        if(current.desired===serverValue)
          return {items:items.filter(item=>item.id!==op.id),result:false};
        return {items:items.map(item=>item.id===op.id?{
          ...item,baseValue:serverValue,expectedRevision:Number(remote.revision),
          inFlight:false,status:"pending" as const
        }:item),result:false};
      }
      return {items,result:false};
    }
    if(action==="delete")
      return {items:items.filter(item=>item.id!==op.id),result:true};
    if(!remote)return {items,result:false};
    return {items:items.map(item=>item.id===op.id?{
      ...item,expectedRevision:Number(remote.revision),
      baseValue:Boolean(remote[stateColumn(op.field)]),
      remoteRevision:Number(remote.revision),
      remoteValue:Boolean(remote[stateColumn(op.field)]),
      inFlight:false,status:action==="conflict"?"conflict" as const:"pending" as const
    }:item),result:true};
  });
}
export async function resolveConflict(id:string,choice:"server"|"local"):Promise<void>{
  const userId=id.split(":")[0];
  validUser(userId);
  await mutateEncryptedQueue(userId,items=>{
    const current=items.find(item=>item.id===id);
    if(!current||current.status!=="conflict")
      return {items,result:undefined};
    if(choice==="server"||current.desired===current.remoteValue)
      return {items:items.filter(item=>item.id!==id),result:undefined};
    return {items:items.map(item=>item.id===id?{
      ...item,status:"pending" as const,baseValue:Boolean(item.remoteValue),
      expectedRevision:Number(item.remoteRevision||0),updatedAt:Date.now(),
      generation:(item.generation??0)+1,inFlight:false
    }:item),result:undefined};
  });
}
export async function flushChanges(userId:string,
  send:(op:QueuedChange)=>Promise<SendResult>):Promise<FlushResult>{
  const entries=await getChanges(userId);
  let applied=0,conflicts=0,blocked=false;
  for(const op of entries){
    if(op.status==="conflict"){conflicts++;continue;}
    await markSending(op);
    let outcome:SendResult;
    try{outcome=await send(op);}catch{blocked=true;break;}
    if(outcome.kind==="retry"){blocked=true;break;}
    if(outcome.kind==="gone"){
      await updateIfCurrent(op,"conflict",{read_at:null,starred_at:null,saved_at:null,
        revision:op.expectedRevision,updated_at:new Date().toISOString()});
      conflicts++;continue;
    }
    if(outcome.kind==="ok"){
      if(await updateIfCurrent(op,"delete",outcome.state))applied++;
      continue;
    }
    const remote=outcome.state;
    const serverValue=Boolean(remote[stateColumn(op.field)]);
    if(serverValue===op.desired){
      if(await updateIfCurrent(op,"delete",remote))applied++;
      continue;
    }
    if(serverValue!==op.baseValue){
      await updateIfCurrent(op,"conflict",remote);
      conflicts++;continue;
    }
    // A different field changed remotely. Rebase this one-field update once.
    if(!(await updateIfCurrent(op,"rebase",remote)))continue;
    const retry={...op,expectedRevision:Number(remote.revision)};
    let second:SendResult;
    try{second=await send(retry);}catch{blocked=true;break;}
    if(second.kind==="ok"){
      if(await updateIfCurrent(op,"delete",second.state))applied++;
    }else if(second.kind==="conflict"){
      await updateIfCurrent(op,"conflict",second.state);
      conflicts++;
    }else if(second.kind==="gone"){
      await updateIfCurrent(op,"conflict",remote);conflicts++;
    }else{blocked=true;break;}
  }
  return {applied,conflicts,remaining:(await getChanges(userId)).length,blocked};
}
export async function clearOfflineUser(userId:string):Promise<void>{
  validUser(userId);
  const db=await openDB();
  const tx=db.transaction(["snapshots","queue","prefs"],"readwrite");
  const done=finished(tx);
  tx.objectStore("snapshots").delete(userId);
  tx.objectStore("prefs").delete(userId);
  const q=tx.objectStore("queue");
  const cursor=q.index("byUser").openCursor(userId);
  cursor.onsuccess=()=>{
    const row=cursor.result;
    if(row){row.delete();row.continue();}
  };
  await done;
  await deleteVault(userId);
}
