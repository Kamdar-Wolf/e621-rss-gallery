import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {connectPool} from "../apps/api/src/db.js";
import {parseOpml} from "../apps/worker/src/opml.js";

const OWNER_ID=process.env.READER_OWNER_ID||"00000000-0000-4000-8000-000000000001";
async function main(){
  const filename=process.argv[2];
  if(!filename)throw Error("Usage: npm run import:opml -- /path/to/export.opml");
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const list=parseOpml(await readFile(filename,"utf8"));
  const pool=connectPool(process.env.DATABASE_URL);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const folders=new Map<string,string>();
    async function ensureFolder(name:string,parent:string|null):Promise<string>{
      const key=(parent||"root")+"\u0000"+name;
      const existing=folders.get(key);if(existing)return existing;
      const previous=await client.query<{id:string}>(
        "SELECT id FROM folders WHERE user_id=$1 AND name=$2 AND parent_id IS NOT DISTINCT FROM $3::uuid LIMIT 1",
        [OWNER_ID,name,parent]);
      if(previous.rows[0]){folders.set(key,previous.rows[0].id);return previous.rows[0].id;}
      const id=randomUUID();
      await client.query("INSERT INTO folders(id,user_id,parent_id,name) VALUES($1,$2,$3,$4)",[id,OWNER_ID,parent,name]);
      folders.set(key,id);return id;
    }
    let created=0;
    for(const s of list){
      let folder:string|null=null;
      for(const name of s.folders)folder=await ensureFolder(name,folder);
      const feed=await client.query<{id:string}>(
        "INSERT INTO feeds(id,canonical_url,title,next_poll_at) VALUES($1,$2,$3,NOW())"+
        " ON CONFLICT(canonical_url) DO UPDATE SET title=feeds.title RETURNING id",
        [randomUUID(),s.url,s.title]);
      const inserted=await client.query(
        "INSERT INTO subscriptions(id,user_id,feed_id,folder_id) VALUES($1,$2,$3,$4) "+
        "ON CONFLICT(user_id,feed_id) DO UPDATE SET folder_id=EXCLUDED.folder_id RETURNING id",
        [randomUUID(),OWNER_ID,feed.rows[0].id,folder]);
      created+=inserted.rowCount||0;
    }
    await client.query("COMMIT");
    console.log("OPML imported:",created,"subscriptions,",folders.size,"folders.");
    // Intentionally never print feed URLs: private OPML can contain access tokens.
  }catch(err){await client.query("ROLLBACK");throw err;}
  finally{client.release();await pool.end();}
}
main().catch(err=>{console.error(err instanceof Error?err.message:"Import failed");process.exitCode=1;});
