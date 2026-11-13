import type {Entry,Feed,Stats} from "./api.js";

const DB_NAME="kamdar-reader-offline";
const DB_VERSION=2;
const CACHE_LIMIT=500;
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
        if(req.transaction && event.oldVersion<2)
          req.transaction.objectStore("snapshots").clear();
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
export async function getSnapshot(userId:string):Promise<OfflineSnapshot|null>{
  validUser(userId);
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("snapshots","readonly");
    const req=tx.objectStore("snapshots").get(userId);
    req.onsuccess=()=>resolve(req.result||null);
    req.onerror=()=>reject(req.error);
  });
}
/** Plaintext article storage is disabled until the user explicitly opts in. */
export async function getCachePreference(userId:string):Promise<boolean>{
  validUser(userId);
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("prefs","readonly");
    const req=tx.objectStore("prefs").get(userId);
    req.onsuccess=()=>resolve(req.result?.enabled===true);
    req.onerror=()=>reject(req.error);
  });
}
export async function setCachePreference(userId:string,enabled:boolean):Promise<void>{
  validUser(userId);
  const db=await openDB();
  const tx=db.transaction(["prefs","snapshots"],"readwrite");
  const done=finished(tx);
  tx.objectStore("prefs").put({userId,enabled});
  if(!enabled)tx.objectStore("snapshots").delete(userId);
  await done;
}
export async function cacheSnapshot(userId:string,feeds:Feed[],entries:Entry[],stats:Stats):Promise<void>{
  validUser(userId);
  if(!(await getCachePreference(userId)))return;
  const db=await openDB();
  const tx=db.transaction("snapshots","readwrite");
  const end=finished(tx);
  const store=tx.objectStore("snapshots");
  const read=store.get(userId);
  read.onsuccess=()=>{
    const previous=read.result as OfflineSnapshot|undefined;
    const merged=new Map<string,Entry>();
    for(const entry of previous?.entries||[])merged.set(entry.id,entry);
    for(const entry of entries)merged.set(entry.id,entry);
    const retained=[...merged.values()].sort((a,b)=>timestamp(b)-timestamp(a)).slice(0,CACHE_LIMIT);
    store.put({userId,feeds,entries:retained,stats,savedAt:Date.now()} satisfies OfflineSnapshot);
  };
  await end;
}
export async function getChanges(userId:string):Promise<QueuedChange[]>{
  validUser(userId);
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("queue","readonly");
    const req=tx.objectStore("queue").index("byUser").getAll(userId);
    req.onsuccess=()=>resolve((req.result as QueuedChange[])
      .sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id)));
    req.onerror=()=>reject(req.error);
  });
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
  const db=await openDB();
  const tx=db.transaction("queue","readwrite");
  const done=finished(tx);
  const store=tx.objectStore("queue");
  const req=store.get(id);
  let quotaExceeded=false;
  req.onsuccess=()=>{
    const previous=req.result as QueuedChange|undefined;
    const baseValue=previous?.baseValue??Boolean(entry[stateColumn(field)]);
    const now=Date.now();
    if(desired===baseValue&&!previous?.inFlight){
      // Cancel only if the preceding change has never been sent.
      if(previous)store.delete(id);
      return;
    }
    const persist=()=>store.put({
      id,userId,entryId:entry.id,field,desired,baseValue,
      expectedRevision:previous?.expectedRevision??Number(entry.revision||0),
      generation:(previous?.generation??0)+1,inFlight:false,
      createdAt:previous?.createdAt??now,updatedAt:now,status:"pending"
    } satisfies QueuedChange);
    if(previous)persist();
    else{
      const count=store.index("byUser").count(userId);
      count.onsuccess=()=>{
        if(count.result>=OP_LIMIT){quotaExceeded=true;tx.abort();}
        else persist();
      };
    }
  };
  try{await done;}
  catch(error){
    if(quotaExceeded)throw Error("Offline fronta má limit "+OP_LIMIT+" změn. Nejprve synchronizuj.");
    throw error;
  }
}
/** Persist in-flight marker before HTTP so a reversal cannot silently disappear. */
async function markSending(op:QueuedChange):Promise<void>{
  const db=await openDB();
  const tx=db.transaction("queue","readwrite");
  const done=finished(tx);
  const store=tx.objectStore("queue");
  const req=store.get(op.id);
  req.onsuccess=()=>{
    const current=req.result as QueuedChange|undefined;
    if(current && current.generation===op.generation)
      store.put({...current,inFlight:true} satisfies QueuedChange);
  };
  await done;
}
async function updateIfCurrent(op:QueuedChange,action:"delete"|"conflict"|"rebase",
  remote?:RemoteState):Promise<boolean>{
  const db=await openDB();
  const tx=db.transaction("queue","readwrite");
  const done=finished(tx);
  let changed=false;
  const store=tx.objectStore("queue");
  const req=store.get(op.id);
  req.onsuccess=()=>{
    const current=req.result as QueuedChange|undefined;
    if(!current)return;
    if(current.generation!==op.generation||current.desired!==op.desired){
      // A later edit arrived while the old request was in flight.
      // Rebase that intent against the server acknowledgement, never discard it.
      if(action==="delete" && remote){
        const serverValue=Boolean(remote[stateColumn(op.field)]);
        if(current.desired===serverValue)store.delete(op.id);
        else store.put({...current,baseValue:serverValue,
          expectedRevision:Number(remote.revision),inFlight:false,
          status:"pending"} satisfies QueuedChange);
      }
      return;
    }
    changed=true;
    if(action==="delete")store.delete(op.id);
    else if(remote){
      store.put({...current,
        expectedRevision:Number(remote.revision),
        baseValue:Boolean(remote[stateColumn(op.field)]),
        remoteRevision:Number(remote.revision),
        remoteValue:Boolean(remote[stateColumn(op.field)]),
        status:action==="conflict"?"conflict":"pending"} satisfies QueuedChange);
    }
  };
  await done;
  return changed;
}
export async function resolveConflict(id:string,choice:"server"|"local"):Promise<void>{
  const db=await openDB();
  const tx=db.transaction("queue","readwrite");
  const done=finished(tx);
  const store=tx.objectStore("queue");
  const req=store.get(id);
  req.onsuccess=()=>{
    const item=req.result as QueuedChange|undefined;
    if(!item||item.status!=="conflict")return;
    if(choice==="server"||item.desired===item.remoteValue){
      store.delete(id);return;
    }
    store.put({...item,status:"pending",baseValue:Boolean(item.remoteValue),
      expectedRevision:Number(item.remoteRevision||0),updatedAt:Date.now(),
      generation:(item.generation??0)+1} satisfies QueuedChange);
  };
  await done;
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
}
