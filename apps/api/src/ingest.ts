import {pool} from "./db.js";
import {fetchFeed} from "./fetch-feed.js";
import {normalizeFeed} from "./normalize.js";

export async function ingestFeed(feedId:string):Promise<{count:number;status:string}>{
  const result=await pool.query<{url:string;etag:string|null;last_modified:string|null}>(
    "SELECT url,etag,last_modified FROM feeds WHERE id=$1",[feedId]);
  const feed=result.rows[0];
  if(!feed)return {count:0,status:"missing"};
  try{
    const fetched=await fetchFeed(feed.url,feed.etag,feed.last_modified);
    if(fetched.status===304){
      await pool.query(`UPDATE feeds SET status='ok',last_error=NULL,failure_count=0,last_fetched_at=now(),
        next_fetch_at=now()+interval '15 minutes' WHERE id=$1`,[feedId]);
      return {count:0,status:"unchanged"};
    }
    const parsed=normalizeFeed(fetched.body,fetched.url);
    if(parsed.entries.length===0)throw new Error("Feed contains no entries; retaining previous content");
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      let inserted=0;
      for(const e of parsed.entries){
        const r=await client.query(
          `INSERT INTO entries(feed_id,guid,title,link,author,summary,image_url,media_type,published_at)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT(feed_id,guid) DO UPDATE SET
             title=EXCLUDED.title,link=EXCLUDED.link,author=EXCLUDED.author,
             summary=EXCLUDED.summary,image_url=EXCLUDED.image_url,media_type=EXCLUDED.media_type,
             updated_at=now() RETURNING id`,
          [feedId,e.guid,e.title,e.link,e.author,e.summary,e.imageUrl,e.mediaType,e.publishedAt]);
        if(r.rowCount)inserted++;
      }
      await client.query(
        `UPDATE feeds SET title=$2,description=$3,etag=$4,last_modified=$5,
        last_fetched_at=now(),next_fetch_at=now()+interval '15 minutes',
        status='ok',last_error=NULL,failure_count=0 WHERE id=$1`,
        [feedId,parsed.title.slice(0,200),parsed.description.slice(0,2000),fetched.etag,fetched.lastModified]);
      await client.query(
        "INSERT INTO fetch_runs(feed_id,status,entry_count) VALUES($1,'ok',$2)",[feedId,parsed.entries.length]);
      await client.query("COMMIT");
      return {count:inserted,status:"ok"};
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  }catch(error){
    const message=String(error instanceof Error?error.message:error).slice(0,1000);
    await pool.query(
      `UPDATE feeds SET status='error',last_error=$2,failure_count=failure_count+1,
      last_fetched_at=now(),next_fetch_at=now()+(least(3600,60*power(2,least(failure_count,6))) || ' seconds')::interval
      WHERE id=$1`,[feedId,message]);
    await pool.query("INSERT INTO fetch_runs(feed_id,status,details) VALUES($1,'error',$2)",[feedId,message]);
    throw error;
  }
}
