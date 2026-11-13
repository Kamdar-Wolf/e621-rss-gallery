import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { addFeedSchema, canonicalFeedUrl, cursorSchema, entryStateSchema } from "../../../packages/shared/src/schemas.js";
import { connectPool } from "./db.js";

const OWNER_ID = process.env.READER_OWNER_ID || "00000000-0000-4000-8000-000000000001";

function authorized(tokenHeader: unknown, secret: string): boolean {
  if(typeof tokenHeader !== "string" || !tokenHeader.startsWith("Bearer ")) return false;
  const incoming = tokenHeader.slice(7);
  if(!incoming || incoming.length > 512) return false;
  const first=createHash("sha256").update(incoming).digest();
  const second=createHash("sha256").update(secret).digest();
  return timingSafeEqual(first,second);
}

export function buildApp(pool: pg.Pool, apiToken: string) {
  const app=Fastify({logger: true, bodyLimit: 256*1024, trustProxy: false});
  void app.register(cors, {origin: process.env.CORS_ORIGIN || false});
  app.get("/health", async () => ({status:"ok",service:"kamdar-reader-api",version:"0.2.0-alpha.1"}));
  app.get("/ready", async (_req,reply) => {
    try { await pool.query("SELECT 1"); return {ready:true}; }
    catch {return reply.code(503).send({ready:false});}
  });

  app.addHook("preHandler", async (request,reply) => {
    if(request.url === "/health" || request.url === "/ready") return;
    if(!authorized(request.headers.authorization, apiToken))
      return reply.code(401).send({error:"Unauthorized"});
  });

  app.get("/v1/feeds", async () => {
    const {rows}=await pool.query(
      `SELECT f.id,f.title,f.canonical_url AS url,f.last_success_at,f.last_error,
              s.folder_id,COALESCE(s.title_override,f.title) AS display_title
         FROM subscriptions s JOIN feeds f ON s.feed_id=f.id
        WHERE s.user_id=$1 ORDER BY display_title ASC`,[OWNER_ID]
    );
    return {items:rows};
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
        [randomUUID(),OWNER_ID,feed.rows[0].id]
      );
      await client.query("COMMIT");
      return reply.code(201).send(feed.rows[0]);
    }catch(e){await client.query("ROLLBACK");throw e;}
    finally{client.release();}
  });

  app.get("/v1/entries", async (req,reply) => {
    const args=cursorSchema.safeParse(req.query);
    if(!args.success)return reply.code(400).send({error:"Invalid query"});
    const {limit,before,feedId}=args.data;
    const {rows}=await pool.query(
      `SELECT e.id,e.feed_id,e.source_url,e.title,e.author,e.summary,e.media_type,e.published_at,
              es.read_at,es.starred_at,es.saved_at,
              (SELECT m.source_url FROM entry_media m WHERE m.entry_id=e.id
                 ORDER BY m.position ASC LIMIT 1) AS thumbnail
         FROM entries e JOIN subscriptions s ON s.feed_id=e.feed_id AND s.user_id=$1
         LEFT JOIN entry_states es ON es.entry_id=e.id AND es.user_id=$1
        WHERE ($2::uuid IS NULL OR e.feed_id=$2::uuid)
          AND ($3::timestamptz IS NULL OR e.published_at<$3::timestamptz)
        ORDER BY e.published_at DESC NULLS LAST,e.id DESC LIMIT $4`,
      [OWNER_ID,feedId||null,before||null,limit]
    );
    return {items:rows,nextCursor:rows.length===limit?rows.at(-1)?.published_at:null};
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
         CASE WHEN $3::boolean IS TRUE THEN NOW() END,
         CASE WHEN $4::boolean IS TRUE THEN NOW() END,
         CASE WHEN $5::boolean IS TRUE THEN NOW() END,1
       FROM entries e JOIN subscriptions s ON s.feed_id=e.feed_id AND s.user_id=$1
       WHERE e.id=$2
       ON CONFLICT(user_id,entry_id) DO UPDATE SET
         read_at=CASE WHEN $6::boolean THEN CASE WHEN $3::boolean THEN NOW() ELSE NULL END ELSE entry_states.read_at END,
         starred_at=CASE WHEN $7::boolean THEN CASE WHEN $4::boolean THEN NOW() ELSE NULL END ELSE entry_states.starred_at END,
         saved_at=CASE WHEN $8::boolean THEN CASE WHEN $5::boolean THEN NOW() ELSE NULL END ELSE entry_states.saved_at END,
         updated_at=NOW(),revision=entry_states.revision+1
       RETURNING read_at,starred_at,saved_at,revision,updated_at`,
      [OWNER_ID,params.id,patch.read??null,patch.starred??null,patch.saved??null,
       patch.read!==undefined,patch.starred!==undefined,patch.saved!==undefined]
    );
    if(!rows.length)return reply.code(404).send({error:"Entry not found"});
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
  if(!token || token.length<32 || token==="REPLACE_WITH_RANDOM_TOKEN_AT_LEAST_32_CHARACTERS")
    throw Error("Set a random READER_API_TOKEN of at least 32 characters");
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
