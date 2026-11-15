import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {connectPool} from "../../apps/api/src/db.js";
import {buildApp} from "../../apps/api/src/server.js";
import {parseOpml} from "../../apps/worker/src/opml.js";

const pool=connectPool(process.env.DATABASE_URL!);
const token=process.env.READER_API_TOKEN!;
const app=buildApp(pool,token);
const headers={authorization:"Bearer "+token};
const id=randomUUID();
const folder="OPML-test-"+id;
const urls=[
  "https://example.org/one-"+id+".xml?key=a&count=1",
  "https://example.org/two-"+id+".atom"
];
const xml='<?xml version="1.0" encoding="UTF-8"?>'+
  '<opml version="2.0"><head><title>Demo</title></head><body>'+
  '<outline text="'+folder+'">'+
  '<outline title="Comics"><outline type="rss" text="Images" xmlUrl="'+
    urls[0].replaceAll("&","&amp;")+'"/></outline>'+
  '<outline type="rss" text="News" xmlUrl="'+urls[1]+'"/>'+
  '</outline></body></opml>';

test("OPML endpoints require authentication",async()=>{
  assert.equal((await app.inject({method:"GET",url:"/v1/opml/export"})).statusCode,401);
  assert.equal((await app.inject({method:"POST",url:"/v1/opml/import",payload:{opml:xml}})).statusCode,401);
});
test("OPML rejects invalid documents without creating subscriptions",async()=>{
  const invalid=await app.inject({method:"POST",url:"/v1/opml/import",headers,
    payload:{opml:'<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><opml/>'}});
  assert.equal(invalid.statusCode,400,invalid.body);
  assert.equal((await app.inject({method:"POST",url:"/v1/opml/import",headers,
    payload:{opml:"<opml><body/></opml>"}})).statusCode,400);
});
test("OPML import and export preserve 2 feed URLs and nested categories",async()=>{
  const result=await app.inject({method:"POST",url:"/v1/opml/import",headers,payload:{opml:xml}});
  assert.equal(result.statusCode,201,result.body);
  assert.equal(result.json().added,2);
  assert.equal(result.json().total,2);
  const existing=await app.inject({method:"POST",url:"/v1/opml/import",headers,payload:{opml:xml}});
  assert.equal(existing.statusCode,201,existing.body);
  assert.equal(existing.json().added,0);
  assert.equal(existing.json().alreadySubscribed,2);
  const files=await app.inject({method:"GET",url:"/v1/feeds",headers});
  assert.equal(files.statusCode,200);
  const found=files.json().items.filter((f:{url:string})=>urls.includes(f.url));
  assert.equal(found.length,2);
  assert.ok(found.every((f:{folder_name:string|null})=>Boolean(f.folder_name)));
  const folders=await app.inject({method:"GET",url:"/v1/folders",headers});
  assert.equal(folders.statusCode,200);
  assert.ok(folders.json().items.some((f:{name:string})=>f.name===folder));
  const exported=await app.inject({method:"GET",url:"/v1/opml/export",headers});
  assert.equal(exported.statusCode,200);
  const parsed=parseOpml(exported.json().xml);
  const retained=parsed.filter(f=>urls.includes(f.url));
  assert.equal(retained.length,2);
  assert.deepEqual(retained.find(f=>f.url===urls[0])?.folders,[folder,"Comics"]);
  assert.deepEqual(retained.find(f=>f.url===urls[1])?.folders,[folder]);
});
test("cleanup OPML test sources",async()=>{
  try{
    for(const url of urls)await pool.query("DELETE FROM feeds WHERE canonical_url=$1",[url]);
    await pool.query("DELETE FROM folders WHERE user_id=$1 AND name=$2",
      ["00000000-0000-4000-8000-000000000001",folder]);
  }finally{await app.close();await pool.end();}
});
