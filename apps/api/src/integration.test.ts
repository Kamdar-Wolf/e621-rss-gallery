import test from "node:test";
import assert from "node:assert/strict";
import {pool} from "./db.js";
import {migrate} from "./migrate.js";
import {createServer} from "./index.js";

test("bootstrap, CSRF, subscriptions, entry states and sync cursor",{
  skip:!process.env.TEST_DATABASE_URL
},async()=>{
  await migrate();
  const app=await createServer();
  try{
    const email="test-"+Date.now()+"@example.com";
    const bootstrap=await app.inject({method:"POST",url:"/api/v1/auth/bootstrap",payload:{
      email,password:"strong-test-password-123!",bootstrapToken:process.env.BOOTSTRAP_TOKEN
    }});
    assert.equal(bootstrap.statusCode,201,bootstrap.body);
    const cookie=bootstrap.cookies.find(c=>c.name==="kr_session")?.value;
    assert.ok(cookie);
    const csrf=(bootstrap.json() as {csrf:string}).csrf;
    const auth={cookie:"kr_session="+cookie,"x-csrf-token":csrf};
    const forbidden=await app.inject({method:"POST",url:"/api/v1/feeds",headers:{cookie:auth.cookie},payload:{url:"https://example.org/feed.xml"}});
    assert.equal(forbidden.statusCode,403,"write must require CSRF");
    const create=await app.inject({method:"POST",url:"/api/v1/feeds",headers:auth,payload:{url:"https://example.org/feed.xml",name:"Test feed"}});
    assert.equal(create.statusCode,201,create.body);
    const id=(create.json() as {id:string}).id;
    const opml=await app.inject({method:"POST",url:"/api/v1/feeds/import",headers:auth,payload:{opml:'<opml version="2.0"><body><outline text="Hry"><outline text="Gaming" type="rss" xmlUrl="https://example.net/rss.xml"/></outline></body></opml>'}});
    assert.equal(opml.statusCode,200,opml.body);
    assert.equal((opml.json() as {imported:number}).imported,1,"OPML channel must be imported");
    const item=await pool.query<{id:string}>(`INSERT INTO entries(feed_id,guid,title,published_at) VALUES($1,'test-guid','Example entry',now()) RETURNING id`,[id]);
    const entryId=item.rows[0]!.id;
    const get=await app.inject({method:"GET",url:"/api/v1/entries",headers:{cookie:auth.cookie}});
    assert.equal(get.statusCode,200,get.body);
    assert.ok((get.json() as {entries:{id:string}[]}).entries.some(e=>e.id===entryId));
    const patch=await app.inject({method:"PATCH",url:"/api/v1/entries/"+entryId+"/state",
      headers:auth,payload:{isRead:true,isStarred:true,expectedRevision:0}});
    assert.equal(patch.statusCode,200,patch.body);
    const sync=await app.inject({method:"GET",url:"/api/v1/sync?after=0",headers:{cookie:auth.cookie}});
    assert.equal(sync.statusCode,200,sync.body);
    const events=(sync.json() as {events:{entry_id:string}[]}).events;
    assert.ok(events.some(e=>e.entry_id===entryId));
    const conflict=await app.inject({method:"PATCH",url:"/api/v1/entries/"+entryId+"/state",headers:auth,
      payload:{isSaved:true,expectedRevision:0}});
    assert.equal(conflict.statusCode,409);
  }finally{await app.close();await pool.end();}
});
