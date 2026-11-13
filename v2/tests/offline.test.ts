import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {cacheSnapshot,getSnapshot,queueChange,getChanges,overlayChanges,
  flushChanges,resolveConflict,clearOfflineUser,type RemoteState} from "../apps/web/src/offline.js";
import type {Entry,Feed,Stats} from "../apps/web/src/api.js";

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
test("offline snapshots remain separate across accounts",async()=>{
  await cacheSnapshot(userA,feeds,[entry],stats);
  await cacheSnapshot(userB,feeds,[other],stats);
  assert.equal((await getSnapshot(userA))?.entries[0].id,entryId);
  assert.equal((await getSnapshot(userB))?.entries[0].id,other.id);
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
test("per-user data are deleted without impacting another account",async()=>{
  await clearOfflineUser(userA);
  assert.equal(await getSnapshot(userA),null);
  assert.equal((await getChanges(userA)).length,0);
  assert.equal((await getSnapshot(userB))?.entries.length,1);
  await clearOfflineUser(userB);
});
