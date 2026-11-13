import {randomUUID} from "node:crypto";
import type pg from "pg";
import {parseFeed, type NormalizedEntry} from "./parser.js";
import {fetchFeed, type FeedHttpResponse, FeedFetchError} from "./safe-fetch.js";

export type DueFeed = {id:string;canonical_url:string;etag:string|null;last_modified:string|null;failure_count:number};
export type FetchFunction=(url:string,conditional:{etag?:string|null;lastModified?:string|null})=>Promise<FeedHttpResponse>;
export type PollResult={feedId:string;status:"updated"|"not-modified"|"failed";items:number;error?:string};
const MAX_ERROR=500;
const REFRESH_MS=20*60_000;

function retryDelay(failures:number,httpStatus:number):number{
  if(httpStatus===404||httpStatus===410)return 12*60*60_000;
  if(httpStatus===401||httpStatus===403)return 3*60*60_000;
  if(httpStatus===429)return 60*60_000;
  return Math.min(24*60*60_000, 5*60_000*Math.pow(2,Math.min(failures,9)));
}
async function noteFailure(pool:pg.Pool,feed:DueFeed,detail:string,httpStatus=0):Promise<PollResult>{
  const count=feed.failure_count+1;
  await pool.query(
    "UPDATE feeds SET last_error=$2,last_http_status=$3,last_checked_at=NOW(), "+
    "failure_count=$4,next_poll_at=$5,fetch_locked_until=NULL WHERE id=$1",
    [feed.id,detail.slice(0,MAX_ERROR),httpStatus,count,new Date(Date.now()+retryDelay(count,httpStatus))]
  );
  return {feedId:feed.id,status:"failed",items:0,error:detail.slice(0,MAX_ERROR)};
}

export async function claimDueFeeds(pool:pg.Pool,limit=10):Promise<DueFeed[]>{
  const {rows}=await pool.query<DueFeed>(
    "WITH due AS ("+
      " SELECT id FROM feeds "+
      " WHERE next_poll_at<=NOW() AND "+
      " (fetch_locked_until IS NULL OR fetch_locked_until<NOW()) "+
      " ORDER BY next_poll_at ASC "+
      " LIMIT $1 FOR UPDATE SKIP LOCKED"+
    ") "+
    "UPDATE feeds AS f SET fetch_locked_until=NOW()+INTERVAL '3 minutes' "+
    "FROM due WHERE f.id=due.id "+
    "RETURNING f.id,f.canonical_url,f.etag,f.last_modified,f.failure_count",
    [Math.max(1,Math.min(limit,30))]
  );
  return rows;
}

async function storeEntry(client:pg.PoolClient,feedId:string,entry:NormalizedEntry):Promise<void>{
  // Upsert preserves stable entry id and per-user read/starred state.
  const sourceUrl=entry.url||"";
  const {rows}=await client.query<{id:string}>(
    "INSERT INTO entries(id,feed_id,source_guid,source_url,title,author,summary,sanitized_html, "+
    " media_type,published_at,updated_at) "+
    "VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10) "+
    "ON CONFLICT(feed_id,source_guid) DO UPDATE SET "+
    "source_url=EXCLUDED.source_url,title=EXCLUDED.title,author=EXCLUDED.author, "+
    "summary=EXCLUDED.summary,media_type=EXCLUDED.media_type, "+
    "published_at=EXCLUDED.published_at,updated_at=EXCLUDED.updated_at "+
    "RETURNING id",
    [randomUUID(),feedId,entry.guid,sourceUrl,entry.title,entry.author,entry.summary,
      entry.mediaType,entry.publishedAt,entry.updatedAt]
  );
  const entryId=rows[0].id;
  for(const media of entry.media){
    await client.query(
      "INSERT INTO entry_media(id,entry_id,source_url,mime_type,kind,position) "+
      "VALUES($1,$2,$3,$4,$5,$6) "+
      "ON CONFLICT(entry_id,source_url) DO UPDATE SET "+
      "mime_type=EXCLUDED.mime_type,kind=EXCLUDED.kind,position=EXCLUDED.position",
      [randomUUID(),entryId,media.url,media.mime,media.type,media.position]
    );
  }
  if(entry.media.length){
    await client.query("DELETE FROM entry_media WHERE entry_id=$1 AND NOT(source_url=ANY($2::text[]))",
      [entryId,entry.media.map(m=>m.url)]);
  }else await client.query("DELETE FROM entry_media WHERE entry_id=$1",[entryId]);
}

export async function pollFeed(pool:pg.Pool,feed:DueFeed,fetcher:FetchFunction=fetchFeed):Promise<PollResult>{
  let response:FeedHttpResponse;
  try{
    response=await fetcher(feed.canonical_url,{etag:feed.etag,lastModified:feed.last_modified});
  }catch(err){
    const detail=err instanceof Error?err.message:"Unknown network error";
    return noteFailure(pool,feed,detail,err instanceof FeedFetchError?err.status||0:0);
  }
  if(response.status===304){
    await pool.query(
      "UPDATE feeds SET last_checked_at=NOW(),last_error=NULL,last_http_status=304, "+
      "failure_count=0,fetch_locked_until=NULL,next_poll_at=$2 WHERE id=$1",
      [feed.id,new Date(Date.now()+REFRESH_MS)]
    );
    return {feedId:feed.id,status:"not-modified",items:0};
  }
  if(response.status!==200)
    return noteFailure(pool,feed,"Upstream HTTP "+response.status,response.status);
  let parsed:ReturnType<typeof parseFeed>;
  try{parsed=parseFeed(response.body,response.headers["content-type"]||"");}
  catch(err){
    return noteFailure(pool,feed,"Parse error: "+(err instanceof Error?err.message:"Invalid feed"),response.status);
  }
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    for(const entry of parsed.entries)await storeEntry(client,feed.id,entry);
    await client.query(
      "UPDATE feeds SET title=COALESCE(NULLIF($2,''),title),etag=COALESCE(NULLIF($3,''),etag), "+
      "last_modified=COALESCE(NULLIF($4,''),last_modified), "+
      "last_success_at=NOW(),last_checked_at=NOW(),last_error=NULL,last_http_status=200, "+
      "failure_count=0,next_poll_at=$5,fetch_locked_until=NULL WHERE id=$1",
      [feed.id,parsed.title||"",response.headers.etag||"",response.headers["last-modified"]||"",
       new Date(Date.now()+REFRESH_MS)]
    );
    await client.query("COMMIT");
  }catch(err){
    await client.query("ROLLBACK");
    return noteFailure(pool,feed,"DB write: "+(err instanceof Error?err.message:"Unknown database error"));
  }finally{client.release();}
  return {feedId:feed.id,status:"updated",items:parsed.entries.length};
}

export async function pollDueFeeds(pool:pg.Pool,fetcher:FetchFunction=fetchFeed,limit=10):Promise<PollResult[]>{
  const due=await claimDueFeeds(pool,limit);
  const results:PollResult[]=[];
  for(const feed of due){
    results.push(await pollFeed(pool,feed,fetcher));
    // Sequential polling with a minimum delay between requests.
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  return results;
}
