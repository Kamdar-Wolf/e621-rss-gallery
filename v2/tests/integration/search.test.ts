import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {connectPool} from "../../apps/api/src/db.js";
import {buildApp} from "../../apps/api/src/server.js";

const pool=connectPool(process.env.DATABASE_URL!);
const token=process.env.READER_API_TOKEN!;
const app=buildApp(pool,token);
const auth={authorization:"Bearer "+token};
const feedId=randomUUID(),owner="00000000-0000-4000-8000-000000000001";
const keyword="rareunittestdragon";

test("search uses indexed text across stored entries and supports stable pagination",async()=>{
  await pool.query(
    "INSERT INTO feeds(id,canonical_url,title,next_poll_at) VALUES($1,$2,$3,NOW())",
    [feedId,"https://example.org/feed-"+feedId+".xml","Search test"]);
  await pool.query(
    "INSERT INTO subscriptions(id,user_id,feed_id) VALUES($1,$2,$3)",
    [randomUUID(),owner,feedId]);
  for(const [i,title] of ["Alpha story","Beta story"].entries()){
    await pool.query(
      "INSERT INTO entries(id,feed_id,source_guid,source_url,title,summary,media_type,published_at) "+
      "VALUES($1,$2,$3,$4,$5,$6,'article',$7)",
      [randomUUID(),feedId,"search-"+i,"https://example.org/story/"+i,
       title,"A story about "+keyword+" and RSS feeds",
       new Date(Date.UTC(2026,10,13,15,0,i))]
    );
  }
  assert.equal((await app.inject({method:"GET",url:"/v1/search?q="+keyword})).statusCode,401);
  const first=await app.inject({method:"GET",url:"/v1/search?q="+keyword+"&limit=1&feedId="+feedId,headers:auth});
  assert.equal(first.statusCode,200,first.body);
  assert.equal(first.json().items.length,1);
  assert.ok(first.json().nextCursor);
  const secondCursor=first.json().nextCursor;
  const params=new URLSearchParams({q:keyword,limit:"1",feedId,
    before:secondCursor.before,beforeId:secondCursor.beforeId});
  const second=await app.inject({method:"GET",url:"/v1/search?"+params,headers:auth});
  assert.equal(second.statusCode,200,second.body);
  assert.equal(second.json().items.length,1);
  assert.notEqual(first.json().items[0].id,second.json().items[0].id);
  const none=await app.inject({method:"GET",url:"/v1/search?q=notinthetest12345&feedId="+feedId,headers:auth});
  assert.equal(none.statusCode,200);
  assert.equal(none.json().items.length,0);
  const bad=await app.inject({method:"GET",url:"/v1/search?q=a",headers:auth});
  assert.equal(bad.statusCode,400);
});
test("cleanup search fixture",async()=>{
  try{await pool.query("DELETE FROM feeds WHERE id=$1",[feedId]);}
  finally{await app.close();await pool.end();}
});
