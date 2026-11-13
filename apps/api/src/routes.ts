import type { FastifyInstance } from "fastify";
import { pool } from "./db.js";
import { authenticated } from "./auth.js";
import { normalizeFeedUrl } from "./validation.js";
import { XMLParser, XMLValidator } from "fast-xml-parser";

type FeedBody = {url?:unknown;name?:unknown};
type StateInput = {isRead?:unknown;isStarred?:unknown;isSaved?:unknown;note?:unknown;expectedRevision?:unknown};
function uuid(s: unknown): s is string {
  return typeof s==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
function first<T>(x:T|T[]):T{return Array.isArray(x)?x[0]!:x;}
function collectOpml(xml:string): Array<{url:string;name:string}> {
  if(xml.length>1_000_000 || XMLValidator.validate(xml)!==true)throw new Error("Invalid OPML XML");
  const parsed=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",processEntities:false}).parse(xml);
  const found: Array<{url:string;name:string}>=[];
  const walk=(node:unknown,level=0)=>{
    if(level>15||!node||typeof node!=="object")return;
    if(Array.isArray(node)){node.forEach(n=>walk(n,level+1));return;}
    const o=node as Record<string,unknown>;
    if(typeof o["@_xmlUrl"]==="string")found.push({url:o["@_xmlUrl"],name:String(o["@_title"]||o["@_text"]||"RSS")});
    if(o.outline)walk(o.outline,level+1);
  };
  walk(parsed.opml?.body?.outline);
  return found.slice(0,500);
}
export function apiRoutes(app:FastifyInstance) {
  app.get("/api/v1/feeds",async(req,reply)=>{
    const user=await authenticated(req,reply);if(!user)return;
    const res=await pool.query(
      `SELECT f.id,f.url,coalesce(s.title_override,f.title) title,f.status,f.last_error,
       f.last_fetched_at, f.next_fetch_at,
       (SELECT count(*)::int FROM entries e WHERE e.feed_id=f.id) AS item_count
       FROM subscriptions s JOIN feeds f ON f.id=s.feed_id
       WHERE s.user_id=$1 ORDER BY title ASC`,[user.id]);
    return {feeds:res.rows};
  });
  app.get("/api/v1/feeds/export",async(req,reply)=>{
    const user=await authenticated(req,reply);if(!user)return;
    const result=await pool.query<{url:string;title:string}>(
      `SELECT f.url,coalesce(s.title_override,f.title) AS title
       FROM subscriptions s JOIN feeds f ON f.id=s.feed_id WHERE s.user_id=$1 ORDER BY title`,
      [user.id]);
    const esc=(value:string)=>value.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const items=result.rows.map(f=>'<outline type="rss" text="'+esc(f.title)+'" title="'+esc(f.title)+'" xmlUrl="'+esc(f.url)+'"/>').join("\n");
    const xml='<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Kamdar Reader</title></head><body>'+items+'</body></opml>';
    reply.type("application/xml; charset=utf-8");
    reply.header("Content-Disposition",'attachment; filename="kamdar-feeds.opml"');
    return reply.send(xml);
  });
  app.post("/api/v1/feeds",async(req,reply)=>{
    const user=await authenticated(req,reply,true);if(!user)return;
    const body=req.body as FeedBody | null;
    let url:string;
    try{url=normalizeFeedUrl(String(body?.url||""));}catch(e){return reply.code(400).send({error:(e as Error).message});}
    const name=typeof body?.name==="string"?body.name.trim().slice(0,200):"";
    const c=await pool.connect();
    try{
      await c.query("BEGIN");
      const r=await c.query<{id:string}>(
        `INSERT INTO feeds(url,title,next_fetch_at) VALUES($1,$2,now())
        ON CONFLICT(url) DO UPDATE SET url=EXCLUDED.url RETURNING id`,
        [url,name||new URL(url).hostname]);
      const fid=r.rows[0]!.id;
      await c.query(`INSERT INTO subscriptions(user_id,feed_id,title_override) VALUES($1,$2,$3)
        ON CONFLICT(user_id,feed_id) DO UPDATE SET title_override=EXCLUDED.title_override`,[user.id,fid,name||null]);
      await c.query("COMMIT");
      return reply.code(201).send({id:fid,url});
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
  });
  app.post("/api/v1/feeds/import",async(req,reply)=>{
    const user=await authenticated(req,reply,true);if(!user)return;
    const body=req.body as {opml?:unknown}|null;
    if(typeof body?.opml!=="string")return reply.code(400).send({error:"Expected OPML text"});
    let sources;try{sources=collectOpml(body.opml);}catch(e){return reply.code(400).send({error:(e as Error).message});}
    let imported=0,skipped=0;
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      for(const source of sources){
        let url:string;try{url=normalizeFeedUrl(source.url);}catch{skipped++;continue;}
        const feed=await client.query<{id:string}>(
          `INSERT INTO feeds(url,title) VALUES($1,$2)
           ON CONFLICT(url) DO UPDATE SET url=EXCLUDED.url RETURNING id`,
           [url,source.name.slice(0,200)]);
        const f=feed.rows[0]!.id;
        const existing=await client.query(
          `INSERT INTO subscriptions(user_id,feed_id) VALUES($1,$2)
           ON CONFLICT DO NOTHING RETURNING feed_id`,[user.id,f]);
        existing.rowCount?imported++:skipped++;
      }
      await client.query("COMMIT");
      return {imported,skipped,found:sources.length};
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  });
  app.delete<{Params:{id:string}}>("/api/v1/feeds/:id",async(req,reply)=>{
    const user=await authenticated(req,reply,true);if(!user)return;
    if(!uuid(req.params.id))return reply.code(400).send({error:"Invalid ID"});
    const res=await pool.query("DELETE FROM subscriptions WHERE user_id=$1 AND feed_id=$2 RETURNING feed_id",[user.id,req.params.id]);
    return {removed:!!res.rowCount};
  });
  app.get<{Querystring:{feedId?:string;filter?:string;q?:string;cursor?:string;limit?:string;media?:string}}>(
    "/api/v1/entries",async(req,reply)=>{
      const user=await authenticated(req,reply);if(!user)return;
      const {feedId,filter,q,cursor,media}=req.query;
      if(feedId&&!uuid(feedId))return reply.code(400).send({error:"Invalid feedId"});
      const limit=Math.min(100,Math.max(1,Number.parseInt(req.query.limit||"40",10)||40));
      const cond=["s.user_id=$1"];
      const args:unknown[]=[user.id];
      if(feedId){args.push(feedId);cond.push(`e.feed_id=$${args.length}`);}
      if(filter==="unread")cond.push("coalesce(es.is_read,false)=false");
      if(filter==="starred")cond.push("coalesce(es.is_starred,false)=true");
      if(filter==="saved")cond.push("coalesce(es.is_saved,false)=true");
      if(q?.trim()){args.push(q.trim().slice(0,200));cond.push(`to_tsvector('simple',coalesce(e.title,'')||' '||coalesce(e.summary,'')) @@ plainto_tsquery('simple',$${args.length})`);}
      if(media){
        if(!["image","article","audio","video"].includes(media))return reply.code(400).send({error:"Invalid media type"});
        args.push(media);
        cond.push(`e.media_type=$${args.length}`);
      }
      if(cursor){
        let cursorData:{publishedAt:string;id:string};
        try{
          cursorData=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")) as typeof cursorData;
          if(!cursorData||!uuid(cursorData.id)||Number.isNaN(Date.parse(cursorData.publishedAt)))throw Error();
        }catch{return reply.code(400).send({error:"Invalid cursor"});}
        args.push(new Date(cursorData.publishedAt).toISOString(),cursorData.id);
        cond.push(`(e.published_at,e.id)<($${args.length-1}::timestamptz,$${args.length}::uuid)`);
      }
      args.push(limit);
      const result=await pool.query(
        `SELECT e.id,e.feed_id,e.guid,e.title,e.link,e.author,e.summary,e.image_url,e.media_type,
        e.published_at, f.title AS feed_title,
        coalesce(es.is_read,false) AS is_read,coalesce(es.is_starred,false) AS is_starred,
        coalesce(es.is_saved,false) AS is_saved,coalesce(es.note,'') AS note,
        coalesce(es.revision,0) AS revision
        FROM entries e JOIN subscriptions s ON s.feed_id=e.feed_id
        JOIN feeds f ON f.id=e.feed_id
        LEFT JOIN entry_states es ON es.entry_id=e.id AND es.user_id=$1
        WHERE ${cond.join(" AND ")}
        ORDER BY e.published_at DESC,e.id DESC LIMIT $${args.length}`,args);
      const last=result.rows[result.rows.length-1];
      const nextCursor=(last && result.rows.length===limit)
        ?Buffer.from(JSON.stringify({publishedAt:last.published_at,id:last.id}),"utf8").toString("base64url")
        :null;
      return {entries:result.rows,nextCursor};
    });
  app.patch<{Params:{id:string}}>("/api/v1/entries/:id/state",async(req,reply)=>{
    const user=await authenticated(req,reply,true);if(!user)return;
    const entryId=req.params.id;
    if(!uuid(entryId))return reply.code(400).send({error:"Invalid entry ID"});
    const body=req.body as StateInput|null;
    if(!body||typeof body!=="object")return reply.code(400).send({error:"Invalid state"});
    for(const key of ["isRead","isStarred","isSaved"] as const){
      if(body[key]!==undefined&&typeof body[key]!=="boolean")return reply.code(400).send({error:"Invalid "+key});
    }
    if(body.note!==undefined&&(typeof body.note!=="string"||body.note.length>10000))
      return reply.code(400).send({error:"Invalid note"});
    if(body.expectedRevision!==undefined&&(!Number.isSafeInteger(body.expectedRevision)||Number(body.expectedRevision)<0))
      return reply.code(400).send({error:"Invalid revision"});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const access=await client.query(
        `SELECT e.id FROM entries e JOIN subscriptions s ON s.feed_id=e.feed_id
         WHERE e.id=$1 AND s.user_id=$2`,[entryId,user.id]);
      if(!access.rowCount){await client.query("ROLLBACK");return reply.code(404).send({error:"Entry not found"});}
      await client.query(
        "INSERT INTO entry_states(user_id,entry_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[user.id,entryId]);
      const res=await client.query<{is_read:boolean;is_starred:boolean;is_saved:boolean;note:string;revision:number}>(
        `SELECT is_read,is_starred,is_saved,note,revision FROM entry_states
         WHERE user_id=$1 AND entry_id=$2 FOR UPDATE`,[user.id,entryId]);
      const old=res.rows[0]!;
      // New states start at revision 1. For a new item the web client receives revision 0:
      const empty=old.revision===1 && !old.is_read && !old.is_starred && !old.is_saved && !old.note;
      if(body.expectedRevision!==undefined && body.expectedRevision!==old.revision && !(body.expectedRevision===0 && empty)){
        await client.query("ROLLBACK");return reply.code(409).send({error:"State conflict",state:old});
      }
      const next={
        is_read:body.isRead??old.is_read,
        is_starred:body.isStarred??old.is_starred,
        is_saved:body.isSaved??old.is_saved,
        note:body.note??old.note,
      };
      const update=await client.query(
        `UPDATE entry_states SET is_read=$3,is_starred=$4,is_saved=$5,note=$6,
         revision=revision+1,updated_at=now()
         WHERE user_id=$1 AND entry_id=$2 RETURNING is_read,is_starred,is_saved,note,revision,updated_at`,
        [user.id,entryId,next.is_read,next.is_starred,next.is_saved,next.note]);
      const updated=update.rows[0];
      await client.query("INSERT INTO sync_events(user_id,entry_id,state) VALUES($1,$2,$3)",[user.id,entryId,updated]);
      await client.query("COMMIT");
      return {state:updated};
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  });
  app.get<{Querystring:{after?:string}}>("/api/v1/sync",async(req,reply)=>{
    const user=await authenticated(req,reply);if(!user)return;
    const cursor=Number(req.query.after||"0");
    if(!Number.isSafeInteger(cursor)||cursor<0)return reply.code(400).send({error:"Invalid cursor"});
    const r=await pool.query(
      `SELECT id,entry_id,state,created_at FROM sync_events
       WHERE user_id=$1 AND id>$2 ORDER BY id ASC LIMIT 200`,[user.id,cursor]);
    return {events:r.rows,next:r.rows.length?r.rows[r.rows.length-1].id:cursor};
  });
}
