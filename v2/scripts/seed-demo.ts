import {randomUUID} from "node:crypto";
import {connectPool} from "../apps/api/src/db.js";
async function main(){
 if(process.env.READER_DEPLOYMENT==="production"||process.env.READER_ENABLE_DEMO!=="true")
  throw Error("Demo seed requires READER_ENABLE_DEMO=true outside production");
 const pool=connectPool(process.env.DATABASE_URL!);
 const uid=process.env.READER_OWNER_ID||"00000000-0000-4000-8000-000000000001";
 const feed="00000000-0000-4000-8000-000000002001",entry="00000000-0000-4000-8000-000000002002";
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  if(!(await db.query("SELECT 1 FROM reader_users WHERE id=$1",[uid])).rowCount)
    throw Error("Owner account missing; run migrations first");
  await db.query("INSERT INTO feeds(id,canonical_url,title) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title",
    [feed,"https://example.org/kamdar-reader-demo.xml","Demo RSS – ukázkový zdroj"]);
  await db.query("INSERT INTO subscriptions(id,user_id,feed_id) VALUES($1,$2,$3) ON CONFLICT(user_id,feed_id) DO NOTHING",
    [randomUUID(),uid,feed]);
  await db.query("INSERT INTO entries(id,feed_id,source_guid,source_url,title,summary,media_type,published_at) VALUES($1,$2,$3,$4,$5,$6,'image',NOW()) ON CONFLICT(id) DO UPDATE SET title=EXCLUDED.title,summary=EXCLUDED.summary",
    [entry,feed,"demo-entry","https://example.org/demo",
    "Ukázkový článek čtečky 2.0","Testovací příspěvek pro ověření galerie, přečtení, oblíbených a offline režimu."]);
  const media=[
   ["00000000-0000-4000-8000-000000002003","https://images.example.org/demo-1.png",0],
   ["00000000-0000-4000-8000-000000002004","https://images.example.org/demo-2.png",1]
  ] as const;
  for(const [id,url,position] of media)
   await db.query("INSERT INTO entry_media(id,entry_id,source_url,mime_type,kind,position) VALUES($1,$2,$3,'image/png','image',$4) ON CONFLICT(id) DO NOTHING",
   [id,entry,url,position]);
  await db.query("COMMIT");
  console.log("Demo RSS seed: one source, one article, two placeholder image URLs (no real images).");
 }catch(error){await db.query("ROLLBACK");throw error;}
 finally{db.release();await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});