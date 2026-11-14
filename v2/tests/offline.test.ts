import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {webcrypto} from "node:crypto";
if(!globalThis.crypto)Object.defineProperty(globalThis,"crypto",{value:webcrypto});
import {cacheSnapshot,getSnapshot,queueChange,getChanges,overlayChanges,
  flushChanges,resolveConflict,clearOfflineUser,getCachePreference,
  migrateLegacyQueue,legacyChangeCount,type RemoteState,type QueuedChange} from "../apps/web/src/offline.js";
import type {Entry,Feed,Stats} from "../apps/web/src/api.js";
import {createVault,unlockVault,lockVault,listVaultProfiles,isVaultUnlocked,
  vaultExists} from "../apps/web/src/offline-vault.js";

const userA="00000000-0000-4000-8000-000000000001";
const userB="00000000-0000-4000-8000-000000000002";
const entryId="00000000-0000-4000-8000-000000001010";
const stats:Stats={subscriptions:1,entries:1,unread:1,starred:0,saved:0};
const entry:Entry={
  id:entryId,feed_id:"00000000-0000-4000-8000-000000009999",
  source_url:"https://example.org/post",title:"Offline article",author:null,
  summary:"Text works offline",media_type:"article",published_at:"2026-11-13T10:00:00Z",
  created_at:"2026-11-13T10:00:00Z",thumbnail:null,
  read_at:null,starred_at:null,saved_at:null,revision:0,state_updated_at:null
};
const other:Entry={...entry,id:"00000000-0000-4000-8000-000000001011"};
const feeds:Feed[]=[{
  id:entry.feed_id,title:"Demo",display_title:"Demo",url:"https://example.org/rss",
  folder_id:null,folder_name:null,last_success_at:null,last_error:null,next_poll_at:null,
  last_checked_at:null,last_http_status:null,failure_count:0
}];
function remote(revision:number,starred:boolean,saved:boolean):RemoteState{
  return {read_at:null,starred_at:starred?"2026-11-14T00:10:00Z":null,
    saved_at:saved?"2026-11-14T00:10:00Z":null,
    revision,updated_at:"2026-11-14T00:10:00Z"};
}
test("encrypted offline snapshots require explicit opt-in and separate passphrases",async()=>{
  assert.equal(await getCachePreference(userA),false);
  await cacheSnapshot(userA,feeds,[entry],stats);
  assert.equal(await getSnapshot(userA),null);
  await createVault(userA,"Local user A","a-long-test-passphrase-for-user-a");
  await createVault(userB,"Local user B","another-long-test-passphrase-b");
  assert.equal(await getCachePreference(userA),true);
  await cacheSnapshot(userA,feeds,[entry],stats);
  await cacheSnapshot(userB,feeds,[other],stats);
  assert.equal((await getSnapshot(userA))?.entries[0].id,entryId);
  assert.equal((await getSnapshot(userB))?.entries[0].id,other.id);
  assert.equal((await listVaultProfiles()).length,2);
  assert.equal(await vaultExists(userA),true);
  lockVault(userA);
  assert.equal(isVaultUnlocked(userA),false);
  assert.equal(await getSnapshot(userA),null);
  await assert.rejects(unlockVault(userA,"this-is-wrong-passphrase"));
  const unlocked=await unlockVault(userA,"a-long-test-passphrase-for-user-a");
  assert.equal(unlocked.snapshot.entries[0].id,entryId);
  assert.equal(unlocked.profile.userId,userA);
  // No plaintext article metadata in IndexedDB: only ciphertext and crypto params.
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("kamdar-reader-vault-v1");
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  const raw=await new Promise<{ciphertext:ArrayBuffer}>((resolve,reject)=>{
    const request=database.transaction("vaults","readonly")
      .objectStore("vaults").get(userA);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  const encrypted=new Uint8Array(raw.ciphertext);
  assert.ok(encrypted.length>200);
  assert.equal(Buffer.from(encrypted).includes(Buffer.from("Offline article")),false);
  database.close();
});
test("pending changes survive another read and are user scoped",async()=>{
  await queueChange(userA,entry,"starred",true);
  assert.equal((await getChanges(userB)).length,0);
  assert.equal((await getChanges(userA)).length,1);
  assert.ok(overlayChanges([entry],await getChanges(userA))[0].starred_at);
});
test("same field coalesces; reverting cancels pending work",async()=>{
  await queueChange(userA,entry,"starred",false);
  assert.equal((await getChanges(userA)).length,0);
  await queueChange(userA,entry,"starred",true);
  await queueChange(userA,entry,"starred",true);
  assert.equal((await getChanges(userA)).length,1);
});
test("offline queue survives transient failure and flushes on reconnection",async()=>{
  const before=await flushChanges(userA,async()=>({kind:"retry"}));
  assert.equal(before.blocked,true);
  assert.equal(before.remaining,1);
  const done=await flushChanges(userA,async()=>({kind:"ok",state:remote(1,true,false)}));
  assert.equal(done.applied,1);
  assert.equal(done.remaining,0);
});
test("unrelated remote changes rebase once without replacing other fields",async()=>{
  await queueChange(userA,entry,"saved",true);
  const revs:number[]=[];
  const result=await flushChanges(userA,async op=>{
    revs.push(op.expectedRevision);
    if(revs.length===1)return {kind:"conflict",state:remote(5,true,false)};
    return {kind:"ok",state:remote(6,true,true)};
  });
  assert.deepEqual(revs,[0,5]);
  assert.equal(result.remaining,0);
});
test("already-achieved remote state converges without an extra write",async()=>{
  await queueChange(userA,entry,"saved",true);
  const result=await flushChanges(userA,async()=>({
    kind:"conflict",state:remote(7,false,true)
  }));
  assert.equal(result.applied,1);
  assert.equal(result.remaining,0);
});
test("repeated races are surfaced as conflicts, then resolved explicitly",async()=>{
  await queueChange(userA,entry,"saved",true);
  let calls=0;
  const result=await flushChanges(userA,async()=>{
    calls++;
    return {kind:"conflict",state:remote(7+calls,false,false)};
  });
  assert.equal(calls,2);
  assert.equal(result.conflicts,1);
  const queued=(await getChanges(userA))[0];
  assert.equal(queued.status,"conflict");
  await resolveConflict(queued.id,"local");
  assert.equal((await getChanges(userA))[0].status,"pending");
  const resumed=await flushChanges(userA,async op=>{
    assert.equal(op.expectedRevision,9);
    return {kind:"ok",state:remote(10,false,true)};
  });
  assert.equal(resumed.remaining,0);
});
test("reversing a flag during an in-flight request keeps the final user intent",async()=>{
  await queueChange(userA,entry,"read",true);
  const before=(await getChanges(userA))[0];
  assert.equal(before.desired,true);
  const first=await flushChanges(userA,async op=>{
    assert.equal(op.desired,true);
    await queueChange(userA,entry,"read",false);
    return {kind:"ok",state:{...remote(1,false,false),read_at:"2026-11-14T01:00:00Z"}};
  });
  assert.equal(first.remaining,1);
  const pending=(await getChanges(userA))[0];
  assert.equal(pending.desired,false);
  assert.equal(pending.expectedRevision,1);
  const second=await flushChanges(userA,async op=>{
    assert.equal(op.expectedRevision,1);
    assert.equal(op.desired,false);
    return {kind:"ok",state:{...remote(2,false,false),read_at:null}};
  });
  assert.equal(second.remaining,0);
});
test("locking encrypted vault hides articles without destroying unsent status",async()=>{
  await queueChange(userA,entry,"saved",true);
  lockVault(userA);
  assert.equal(await getCachePreference(userA),false);
  assert.equal(await getSnapshot(userA),null);
  assert.equal((await getChanges(userA)).length,0);
  await unlockVault(userA,"a-long-test-passphrase-for-user-a");
  assert.equal((await getChanges(userA)).length,1);
});
test("offline queue is encrypted at rest and survives an unlock cycle",async()=>{
  const before=await getChanges(userA);
  assert.ok(before.length>=1);
  const database=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("kamdar-reader-vault-v1",2);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  const record=await new Promise<{iv:Uint8Array;ciphertext:ArrayBuffer}>((resolve,reject)=>{
    const req=database.transaction("queues","readonly").objectStore("queues").get(userA);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  assert.ok(record);
  assert.equal(record.iv.length,12);
  const bytes=Buffer.from(record.ciphertext);
  assert.ok(bytes.length>35);
  assert.equal(bytes.includes(Buffer.from(entryId)),false);
  assert.equal(bytes.includes(Buffer.from('"desired":true')),false);
  database.close();
  lockVault(userA);
  await assert.rejects(queueChange(userA,entry,"starred",true));
  assert.equal((await getChanges(userA)).length,0);
  await unlockVault(userA,"a-long-test-passphrase-for-user-a");
  assert.equal((await getChanges(userA)).length,before.length);
});
test("legacy plaintext queue is encrypted before it is erased, with idempotent migration",async()=>{
  const legacyId=other.id+":read";
  const oldChange:QueuedChange={
    id:userA+":"+legacyId,userId:userA,entryId:other.id,
    field:"read",desired:true,baseValue:false,expectedRevision:0,
    createdAt:Date.now(),updatedAt:Date.now(),status:"pending"
  };
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("kamdar-reader-offline",4);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction("queue","readwrite");
    tx.objectStore("queue").put(oldChange);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
  assert.equal(await legacyChangeCount(userA),1);
  assert.equal(await migrateLegacyQueue(userA),1);
  assert.equal(await legacyChangeCount(userA),0);
  assert.equal(await migrateLegacyQueue(userA),0);
  assert.ok((await getChanges(userA)).some(change=>change.id===oldChange.id));
});
test("queue content authentication rejects tampering",async()=>{
  await queueChange(userB,other,"saved",true);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open("kamdar-reader-vault-v1",2);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  const record=await new Promise<{userId:string;iv:Uint8Array;ciphertext:ArrayBuffer;updatedAt:number}>((resolve,reject)=>{
    const request=db.transaction("queues","readonly").objectStore("queues").get(userB);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
  const tampered=record.ciphertext.slice(0);
  new Uint8Array(tampered)[0]^=1;
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction("queues","readwrite");
    tx.objectStore("queues").put({...record,ciphertext:tampered});
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
  await assert.rejects(getChanges(userB));
  await new Promise<void>((resolve,reject)=>{
    const tx=db.transaction("queues","readwrite");
    tx.objectStore("queues").put(record);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
  db.close();
  assert.equal((await getChanges(userB)).length,1);
});
test("per-user data are deleted without impacting another account",async()=>{
  await clearOfflineUser(userA);
  assert.equal(await getSnapshot(userA),null);
  assert.equal((await getChanges(userA)).length,0);
  assert.equal((await getSnapshot(userB))?.entries.length,1);
  await clearOfflineUser(userB);
});
