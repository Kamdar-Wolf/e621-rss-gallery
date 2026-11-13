import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { z } from "zod";
import { addFeedSchema, canonicalFeedUrl, cursorSchema, entryStateSchema } from "../../../packages/shared/src/schemas.js";
import { connectPool } from "./db.js";
import { configureAuth } from "./auth.js";
import { importOpml, exportOpml } from "./opml-service.js";
import { parseOpml } from "../../worker/src/opml.js";

export function buildApp(pool: pg.Pool, devToken?: string) {
  const app=Fastify({logger: true, bodyLimit: 256*1024, trustProxy: false});
  configureAuth(app,pool,{
    sessionSecret:process.env.READER_SESSION_SECRET||"",
    origin:process.env.APP_ORIGIN||"http://127.0.0.1:5173",
    allowDevToken:process.env.ALLOW_DEV_TOKEN==="true",
    devToken,
    devOwnerId:process.env.READER_OWNER_ID
  });
  app.get("/health", async () => ({status:"ok",service:"kamdar-reader-api",version:"0.2.0-alpha.1"}));
  app.get("/ready", async (_req,reply) => {
    try { await pool.query("SELECT 1"); return {ready:true}; }
    catch {return reply.code(503).send({ready:false});}
  });

  app.get("/v1/feeds", async (req) => {
    const {rows}=await pool.query(
      `SELECT f.id,f.title,f.canonical_url AS url,f.last_success_at,f.last_error,f.next_poll_at,f.last_checked_at,f.last_http_status,f.failure_count,
              s.folder_id,fd.name AS folder_name,COALESCE(s.title_override,f.title) AS display_title
         FROM subscriptions s JOIN feeds f ON s.feed_id=f.id
         LEFT JOIN folders fd ON fd.id=s.folder_id AND fd.user_id=s.user_id
        WHERE s.user_id=$1 ORDER BY display_title ASC`,[req.readerUserId!]
    );
    return {items:rows};
  });

  app.get("/v1/folders", async (req) => {
    const {rows}=await pool.query(
      "SELECT id,parent_id,name,sort_order FROM folders WHERE user_id=$1 "+
      "ORDER BY sort_order,name,id",[req.readerUserId!]);
    return {items:rows};
  });

  app.post("/v1/opml/import", async (req,reply) => {
    const raw=(req.body as {opml?:unknown}|null)?.opml;
    if(typeof raw!=="string" || !raw.trim() || Buffer.byteLength(raw,"utf8")>200_000)
      return reply.code(400).send({error:"OPML must be a non-empty XML string under 200 kB"});
    try{
      const preview=parseOpml(raw);
      if(!preview.length)
        return reply.code(400).send({error:"OPML contains no valid RSS/Atom subscriptions"});
    }catch{
      return reply.code(400).send({error:"Invalid OPML document"});
    }
    const result=await importOpml(pool,req.readerUserId!,raw);
    return reply.code(201).send(result);
  });

  app.get("/v1/opml/export", async (req) => {
    const xml=await exportOpml(pool,req.readerUserId!);
    return {filename:"kamdar-reader.opml",xml};
  });

  app.post("/v1/feeds", async (req,reply) => {
    const parsed=addFeedSchema.safeParse(req.body);
    if(!parsed.success)return reply.code(400).send({error:"Invalid feed",issues:parsed.error.issues});
    let url:string;
    try{url=canonicalFeedUrl(parsed.data.url);}
    catch{return reply.code(400).send({error:"Invalid URL"});}
    // Enrollment stores the address. Fetchers must independently validate
    // DNS and redirect targets before making any network request.
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const feed=await client.query(
        `INSERT INTO feeds(id,canonical_url,title,next_poll_at)
         VALUES($1,$2,$3,NOW())
         ON CONFLICT(canonical_url) DO UPDATE SET title=feeds.title
         RETURNING id,title,canonical_url`,
        [randomUUID(),url,parsed.data.title || new URL(url).hostname]
      );
      await client.query(
        `INSERT INTO subscriptions(id,user_id,feed_id)
         VALUES($1,$2,$3) ON CONFLICT(user_id,feed_id) DO NOTHING`,
        [randomUUID(),req.readerUserId!,feed.rows[0].id]
      );
      await client.query("COMMIT");
      return reply.code(201).send(feed.rows[0]);
    }catch(e){await client.query("ROLLBACK");throw e;}
    finally{client.release();}
  });

  app.post("/v1/feeds/:id/refresh", async (req,reply) => {
    const id=(req.params as {id:string}).id;
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
      return reply.code(400).send({error:"Invalid feed id"});
    const {rows}=await pool.query(
      `UPDATE feeds SET next_poll_at=NOW() WHERE id=$1
        AND EXISTS(SELECT 1 FROM subscriptions WHERE user_id=$2 AND feed_id=$1)
        RETURNING id,next_poll_at`,[id,req.readerUserId!]);
    if(!rows.length)return reply.code(404).send({error:"Feed not subscribed"});
    return reply.code(202).send({queued:true,feed:rows[0]});
  });

  app.delete("/v1/feeds/:id", async (req,reply) => {
    const id=(req.params as {id:string}).id;
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id))
      return reply.code(400).send({error:"Invalid feed id"});
    const {rowCount}=await pool.query(
      "DELETE FROM subscriptions WHERE user_id=$1 AND feed_id=$2",[req.readerUserId!,id]);
    if(!rowCount)return reply.code(404).send({error:"Feed not subscribed"});
    return reply.code(204).send();
  });

  app.get("/v1/stats", async (req) => {
    const {rows}=await pool.query(
      `SELECT
        (SELECT COUNT(*)::int FROM subscriptions WHERE user_id=$1) AS subscriptions,
        COUNT(*)::int AS entries,
        COUNT(*) FILTER(WHERE es.read_at IS NULL)::int AS unread,
        COUNT(*) FILTER(WHERE es.starred_at IS NOT NULL)::int AS starred,
        COUNT(*) FILTER(WHERE es.saved_at IS NOT NULL)::int AS saved
        FROM entries e
        JOIN subscriptions s ON s.feed_id=e.feed_id AND s.user_id=$1
        LEFT JOIN entry_states es ON es.user_id=$1 AND es.entry_id=e.id`,
      [req.readerUserId!]
    );
    return rows[0];
  });

  const searchSchema=z.object({
    q:z.string().trim().min(2).max(150),
    feedId:z.uuid().optional(),
    limit:z.coerce.number().int().min(1).max(100).default(40),
    before:z.iso.datetime({offset:true}).optional(),
    beforeId:z.uuid().optional()
  }).refine(args=>Boolean(args.before)===Boolean(args.beforeId),
    "Search pagination requires both before and beforeId");

  app.get("/v1/search", async (req,reply) => {
    const parsed=searchSchema.safeParse(req.query);
    if(!parsed.success)return reply.code(400).send({error:"Invalid search query"});
    const {q,feedId,limit,before,beforeId}=parsed.data;
    const {rows}=await pool.query(
      `SELECT e.id,e.feed_id,e.source_url,e.title,e.author,e.summary,e.media_type,e.published_at,e.created_at,
              es.read_at,es.starred_at,es.saved_at,es.revision::int AS revision,es.updated_at AS state_updated_at,
              (SELECT m.source_url FROM entry_media m WHERE m.entry_id=e.id
                ORDER BY m.position ASC LIMIT 1) AS thumbnail
         FROM entries e
         JOIN subscriptions s ON s.feed_id=e.feed_id AND s.user_id=$1
         LEFT JOIN entry_states es ON es.entry_id=e.id AND es.user_id=$1
        WHERE ($2::uuid IS NULL OR e.feed_id=$2::uuid)
          AND to_tsvector('simple',COALESCE(e.title,'')||' '||COALESCE(e.summary,''))
              @@ websearch_to_tsquery('simple',$3::text)
          AND ($4::timestamptz IS NULL OR
            (COALESCE(e.published_at,e.created_at),e.id)<($4::timestamptz,$5::uuid))
        ORDER BY COALESCE(e.published_at,e.created_at) DESC,e.id DESC
        LIMIT $6`,
       [req.readerUserId!,feedId||null,q,before||null,beforeId||null,limit]);
    const last=rows.at(-1);
    return {items:rows,nextCursor:rows.length===limit&&last?
      {before:last.published_at||last.created_at,beforeId:last.id}:null};
  });

  app.get("/v1/entries", async (req,reply) => {
    const args=cursorSchema.safeParse(req.query);
    if(!args.success)return reply.code(400).send({error:"Invalid query"});
    const {limit,before,beforeId,feedId}=args.data;
    const {rows}=await pool.query(
      `SELECT e.id,e.feed_id,e.source_url,e.title,e.author,e.summary,e.media_type,e.published_at,e.created_at,
              es.read_at,es.starred_at,es.saved_at,es.revision::int AS revision,es.updated_at AS state_updated_at,
              (SELECT m.source_url FROM entry_media m WHERE m.entry_id=e.id
                 ORDER BY m.position ASC LIMIT 1) AS thumbnail
         FROM entries e JOIN subscriptions s ON s.feed_id=e.feed_id AND s.user_id=$1
         LEFT JOIN entry_states es ON es.entry_id=e.id AND es.user_id=$1
        WHERE ($2::uuid IS NULL OR e.feed_id=$2::uuid)
          AND ($3::timestamptz IS NULL OR
            (COALESCE(e.published_at,e.created_at),e.id)<($3::timestamptz,$4::uuid))
        ORDER BY COALESCE(e.published_at,e.created_at) DESC,e.id DESC LIMIT $5`,
      [req.readerUserId!,feedId||null,before||null,beforeId||null,limit]
    );
    const last=rows.at(-1);
    return {items:rows,nextCursor:rows.length===limit&&last?
      {before:last.published_at||last.created_at,beforeId:last.id}:null};
  });

  const syncSchema=z.object({
    after:z.iso.datetime({offset:true}).optional(),
    // Permit RFC 4122 UUIDs plus MIN/MAX sentinel values for the initial cursor.
    afterId:z.string().regex(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i).optional(),
    limit:z.coerce.number().int().min(1).max(100).default(50)
  }).refine(value=>Boolean(value.after)===Boolean(value.afterId),
    "Both after and afterId are required for a sync cursor");

  app.get("/v1/sync/states", async (req,reply) => {
    const parsed=syncSchema.safeParse(req.query);
    if(!parsed.success)return reply.code(400).send({error:"Invalid sync cursor"});
    const {after,afterId,limit}=parsed.data;
    // Take the cut-off before the query. New writes after this timestamp
    // remain visible to the next poll; no device-specific server state needed.
    const ts=await pool.query<{watermark:Date}>("SELECT clock_timestamp() AS watermark");
    const watermark=ts.rows[0].watermark;
    const {rows}=await pool.query(
      `SELECT st.entry_id,st.read_at,st.starred_at,st.saved_at,st.revision::int AS revision,st.updated_at
         FROM entry_states st
         JOIN entries e ON e.id=st.entry_id
         JOIN subscriptions sub ON sub.feed_id=e.feed_id AND sub.user_id=st.user_id
        WHERE st.user_id=$1
          AND ($2::timestamptz IS NULL OR (st.updated_at,st.entry_id)>($2::timestamptz,$3::uuid))
          AND st.updated_at<=$4
        ORDER BY st.updated_at ASC,st.entry_id ASC LIMIT $5`,
      [req.readerUserId!,after||null,afterId||null,watermark,limit]
    );
    const last=rows.at(-1);
    return {items:rows,watermark:watermark.toISOString(),
      nextCursor:rows.length===limit&&last?
        {after:last.updated_at,afterId:last.entry_id}:null};
  });

  app.patch("/v1/entries/:id/state", async (req,reply) => {
    const params=req.params as {id?:string};
    if(!params.id || !/^[0-9a-f-]{36}$/i.test(params.id))
      return reply.code(400).send({error:"Invalid id"});
    const input=entryStateSchema.safeParse(req.body);
    if(!input.success)return reply.code(400).send({error:"Invalid state"});
    const patch=input.data;
    const {rows}=await pool.query(
      `INSERT INTO entry_states(user_id,entry_id,read_at,starred_at,saved_at,revision)
       SELECT $1,e.id,
         CASE WHEN $3::boolean IS TRUE THEN clock_timestamp() END,
         CASE WHEN $4::boolean IS TRUE THEN clock_timestamp() END,
         CASE WHEN $5::boolean IS TRUE THEN clock_timestamp() END,1
       FROM entries e JOIN subscriptions s ON s.feed_id=e.feed_id AND s.user_id=$1
       WHERE e.id=$2 AND ($9::bigint IS NULL OR $9::bigint=0)
       ON CONFLICT(user_id,entry_id) DO UPDATE SET
         read_at=CASE WHEN $6::boolean THEN CASE WHEN $3::boolean THEN clock_timestamp() ELSE NULL END ELSE entry_states.read_at END,
         starred_at=CASE WHEN $7::boolean THEN CASE WHEN $4::boolean THEN clock_timestamp() ELSE NULL END ELSE entry_states.starred_at END,
         saved_at=CASE WHEN $8::boolean THEN CASE WHEN $5::boolean THEN clock_timestamp() ELSE NULL END ELSE entry_states.saved_at END,
         updated_at=GREATEST(clock_timestamp(),entry_states.updated_at+INTERVAL '1 microsecond'),
         revision=entry_states.revision+1
       WHERE ($9::bigint IS NULL OR entry_states.revision=$9::bigint)
       RETURNING read_at,starred_at,saved_at,revision::int AS revision,updated_at`,
      [req.readerUserId!,params.id,patch.read??null,patch.starred??null,patch.saved??null,
       patch.read!==undefined,patch.starred!==undefined,patch.saved!==undefined,
       patch.expectedRevision??null]
    );
    if(!rows.length){
      const existing=await pool.query(
        "SELECT st.revision::int AS revision,st.read_at,st.starred_at,st.saved_at,st.updated_at "+
        "FROM entries e JOIN subscriptions sub ON sub.feed_id=e.feed_id AND sub.user_id=$1 "+
        "LEFT JOIN entry_states st ON st.entry_id=e.id AND st.user_id=$1 WHERE e.id=$2",
        [req.readerUserId!,params.id]);
      if(!existing.rows.length)return reply.code(404).send({error:"Entry not found"});
      return reply.code(409).send({error:"State changed on another device",state:existing.rows[0]});
    }
    return {state:rows[0]};
  });
  app.setErrorHandler((err,req,reply)=>{
    req.log.error(err);
    reply.code(500).send({error:"Internal error"});
  });
  return app;
}

async function main(){
  const token=process.env.READER_API_TOKEN;
  const url=process.env.DATABASE_URL;
  if(!process.env.READER_SESSION_SECRET || process.env.READER_SESSION_SECRET.length<32)
    throw Error("Set READER_SESSION_SECRET to a random value of at least 32 characters");
  if(!url)throw Error("DATABASE_URL is required");
  const pool=connectPool(url);
  const app=buildApp(pool,token);
  const shutdown=async()=>{await app.close();await pool.end();};
  process.once("SIGINT",()=>{void shutdown();});
  process.once("SIGTERM",()=>{void shutdown();});
  await app.listen({port:Number(process.env.API_PORT||3100),host:process.env.API_HOST||"127.0.0.1"});
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])
  main().catch(e=>{console.error(e);process.exitCode=1;});
