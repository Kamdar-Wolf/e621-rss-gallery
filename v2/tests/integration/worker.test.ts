import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {connectPool} from "../../apps/api/src/db.js";
import {pollFeed,type DueFeed,type FetchFunction} from "../../apps/worker/src/poller.js";

const owner="00000000-0000-4000-8000-000000000001";
const payload='<rss version="2.0"><channel><title>Remote Test Feed</title>'+
'<item><guid>post-123</guid><title>First photo</title>'+
'<link>https://example.org/posts/123</link>'+
'<description>&lt;img src="https://example.org/preview/123.jpg"/&gt;</description>'+
'<pubDate>Fri, 13 Nov 2026 12:00:00 GMT</pubDate></item>'+
'</channel></rss>';

test("worker stores, reuses entry ID, preserves user state and handles 304/403",async()=>{
  const pool=connectPool(process.env.DATABASE_URL!);
  const feedId=randomUUID();
  try{
    await pool.query(
      "INSERT INTO feeds(id,canonical_url,title,next_poll_at) VALUES($1,$2,$3,NOW())",
      [feedId,"https://example.org/test-"+feedId+".xml","Test feed"]
    );
    await pool.query(
      "INSERT INTO subscriptions(id,user_id,feed_id) VALUES($1,$2,$3)",
      [randomUUID(),owner,feedId]
    );
    const target:DueFeed={id:feedId,canonical_url:"https://example.org/feed.xml",
      etag:null,last_modified:null,failure_count:0};
    const fake:FetchFunction=async()=>({
      status:200,url:target.canonical_url,body:Buffer.from(payload),
      headers:{"content-type":"application/rss+xml",etag:'"v1"'}
    });
    const created=await pollFeed(pool,target,fake);
    assert.equal(created.status,"updated",created.error);
    assert.equal(created.items,1);
    const items=await pool.query<{id:string;title:string}>(
      "SELECT id,title FROM entries WHERE feed_id=$1",[feedId]
    );
    assert.equal(items.rows.length,1);
    const entryId=items.rows[0].id;
    const media=await pool.query<{source_url:string}>("SELECT source_url FROM entry_media WHERE entry_id=$1",[entryId]);
    assert.equal(media.rows[0].source_url,"https://example.org/preview/123.jpg");
    await pool.query(
      "INSERT INTO entry_states(user_id,entry_id,read_at) VALUES($1,$2,NOW())",
      [owner,entryId]
    );
    const again=await pollFeed(pool,target,fake);
    assert.equal(again.status,"updated",again.error);
    const stable=await pool.query(
      "SELECT id FROM entries WHERE feed_id=$1",[feedId]
    );
    assert.equal(stable.rows.length,1);
    assert.equal(stable.rows[0].id,entryId);
    const marked=await pool.query(
      "SELECT read_at FROM entry_states WHERE user_id=$1 AND entry_id=$2",[owner,entryId]
    );
    assert.ok(marked.rows[0].read_at);
    const notModified=await pollFeed(pool,target,async()=>({
      status:304,url:target.canonical_url,body:Buffer.alloc(0),headers:{}
    }));
    assert.equal(notModified.status,"not-modified");
    const denied=await pollFeed(pool,target,async()=>({
      status:403,url:target.canonical_url,body:Buffer.from("Access denied"),headers:{}
    }));
    assert.equal(denied.status,"failed");
    const status=await pool.query(
      "SELECT last_http_status,last_error,failure_count FROM feeds WHERE id=$1",[feedId]
    );
    assert.equal(status.rows[0].last_http_status,403);
    assert.equal(status.rows[0].failure_count,1);
    assert.match(status.rows[0].last_error,/403/);
  }finally{
    await pool.query("DELETE FROM feeds WHERE id=$1",[feedId]).catch(()=>{});
    await pool.end();
  }
});
