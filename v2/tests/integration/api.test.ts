import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../apps/api/src/server.js";
import { connectPool } from "../../apps/api/src/db.js";

const pool=connectPool(process.env.DATABASE_URL!);
const token=process.env.READER_API_TOKEN!;
const app=buildApp(pool,token);
const auth={authorization:"Bearer "+token};

test("health endpoints return operational status",async()=>{
  const health=await app.inject({method:"GET",url:"/health"});
  assert.equal(health.statusCode,200);
  assert.equal(health.json().status,"ok");
  const ready=await app.inject({method:"GET",url:"/ready"});
  assert.equal(ready.statusCode,200);
  assert.equal(ready.json().ready,true);
});
test("API rejects anonymous and incorrect credentials",async()=>{
  const anonymous=await app.inject({method:"GET",url:"/v1/feeds"});
  assert.equal(anonymous.statusCode,401);
  const invalid=await app.inject({method:"GET",url:"/v1/feeds",headers:{authorization:"Bearer definitely-not-correct"}});
  assert.equal(invalid.statusCode,401);
});
test("authenticated feed is persisted and listed; cannot duplicate subscription",async()=>{
  const url="https://example.com/feed-"+randomUUID()+".xml";
  const add=await app.inject({method:"POST",url:"/v1/feeds",headers:auth,
    payload:{url,title:"Integration source"}});
  assert.equal(add.statusCode,201,add.body);
  assert.equal(add.json().canonical_url,url);
  const again=await app.inject({method:"POST",url:"/v1/feeds",headers:auth,
    payload:{url,title:"Integration source"}});
  assert.equal(again.statusCode,201,again.body);
  const list=await app.inject({method:"GET",url:"/v1/feeds",headers:auth});
  assert.equal(list.statusCode,200,list.body);
  assert.equal(list.json().items.filter((f:{url:string})=>f.url===url).length,1);
  const item=list.json().items.find((f:{url:string})=>f.url===url);
  assert.ok(item.id);
  const refresh=await app.inject({method:"POST",url:"/v1/feeds/"+item.id+"/refresh",headers:auth});
  assert.equal(refresh.statusCode,202,refresh.body);
  const stats=await app.inject({method:"GET",url:"/v1/stats",headers:auth});
  assert.equal(stats.statusCode,200);
  assert.ok(stats.json().subscriptions>=1);
  const del=await app.inject({method:"DELETE",url:"/v1/feeds/"+item.id,headers:auth});
  assert.equal(del.statusCode,204);
  const listAfter=await app.inject({method:"GET",url:"/v1/feeds",headers:auth});
  assert.equal(listAfter.json().items.filter((f:{url:string})=>f.url===url).length,0);
});
test("entry listing obeys limits and accepts an empty result",async()=>{
  const result=await app.inject({method:"GET",url:"/v1/entries?limit=20",headers:auth});
  assert.equal(result.statusCode,200,result.body);
  assert.equal(Array.isArray(result.json().items),true);
  assert.equal((await app.inject({method:"GET",url:"/v1/entries?limit=999",headers:auth})).statusCode,400);
  assert.equal((await app.inject({method:"GET",url:"/v1/entries?before=2026-11-13T12%3A00%3A00Z",headers:auth})).statusCode,400);
});
test("state endpoint returns 404 for missing entry",async()=>{
  const result=await app.inject({method:"PATCH",url:"/v1/entries/"+randomUUID()+"/state",
    headers:auth,payload:{starred:true}});
  assert.equal(result.statusCode,404,result.body);
});
test("cleanup",async()=>{await app.close();await pool.end();});
