import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {buildApp} from "../../apps/api/src/server.js";
import {connectPool} from "../../apps/api/src/db.js";

const pool=connectPool(process.env.DATABASE_URL!);
const app=buildApp(pool,process.env.READER_API_TOKEN!);
const auth={authorization:"Bearer "+process.env.READER_API_TOKEN!};
const owner=process.env.READER_OWNER_ID||"00000000-0000-4000-8000-000000000001";

test("media gallery requires subscription, orders all attachments and uses image-only thumbnails",async()=>{
  const feedId=randomUUID(),entryId=randomUUID();
  const entryUrl="https://example.org/article-"+entryId;
  try{
    const unauth=await app.inject({method:"GET",url:"/v1/entries/"+entryId+"/media"});
    assert.equal(unauth.statusCode,401);
    const invalid=await app.inject({method:"GET",url:"/v1/entries/not-a-uuid/media",headers:auth});
    assert.equal(invalid.statusCode,400);
    await pool.query("INSERT INTO feeds(id,canonical_url,title) VALUES($1,$2,$3)",
      [feedId,"https://example.org/rss-"+feedId+".xml","Gallery test"]);
    await pool.query(
      "INSERT INTO entries(id,feed_id,source_guid,source_url,title,media_type) "+
      "VALUES($1,$2,$3,$4,$5,'video')",
      [entryId,feedId,entryId,entryUrl,"Gallery post"]);
    const hidden=await app.inject({method:"GET",url:"/v1/entries/"+entryId+"/media",headers:auth});
    assert.equal(hidden.statusCode,404);
    await pool.query("INSERT INTO subscriptions(id,user_id,feed_id) VALUES($1,$2,$3)",
      [randomUUID(),owner,feedId]);
    const input=[
      {url:"https://example.org/movie.mp4",kind:"video",mime:"video/mp4",position:0},
      {url:"https://example.org/first.png",kind:"image",mime:"image/png",position:1},
      {url:"https://example.org/second.webp",kind:"image",mime:"image/webp",position:2},
      {url:"javascript:alert(1)",kind:"image",mime:"image/png",position:3}
    ];
    for(const row of input)await pool.query(
      "INSERT INTO entry_media(id,entry_id,source_url,mime_type,kind,position) "+
      "VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(),entryId,row.url,row.mime,row.kind,row.position]);
    const page=await app.inject({method:"GET",url:"/v1/entries/"+entryId+"/media",headers:auth});
    assert.equal(page.statusCode,200,page.body);
    assert.equal(page.json().entryId,entryId);
    assert.deepEqual(page.json().items.map((r:{url:string})=>r.url),
      input.slice(0,3).map(row=>row.url));
    assert.deepEqual(page.json().items.map((r:{position:number})=>r.position),[0,1,2]);
    const list=await app.inject({method:"GET",url:"/v1/entries?feedId="+feedId,headers:auth});
    assert.equal(list.statusCode,200,list.body);
    const current=list.json().items.find((row:{id:string})=>row.id===entryId);
    assert.ok(current);
    assert.equal(current.thumbnail,"https://example.org/first.png");
    assert.equal(current.media_count,4);
  }finally{
    await pool.query("DELETE FROM feeds WHERE id=$1",[feedId]);
    await app.close();await pool.end();
  }
});
