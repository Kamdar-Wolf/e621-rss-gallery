import { readFile,readdir } from "node:fs/promises";
import { join } from "node:path";
import { connectPool } from "../apps/api/src/db.js";

const cwd=process.cwd();
async function main(){
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL is required");
  const pool=connectPool(process.env.DATABASE_URL);
  try{
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const dir=join(cwd,"db/migrations");
    const versions=(await readdir(dir)).filter(x=>x.endsWith(".sql")).sort();
    for(const filename of versions){
      const found=await pool.query("SELECT 1 FROM schema_migrations WHERE version=$1",[filename]);
      if(found.rowCount)continue;
      const client=await pool.connect();
      try{
        await client.query("BEGIN");
        const sql=await readFile(join(dir,filename),"utf8");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(version) VALUES($1)",[filename]);
        await client.query("COMMIT");
        console.log("Applied",filename);
      }catch(e){await client.query("ROLLBACK");throw e;}
      finally{client.release();}
    }
    const owner=process.env.READER_OWNER_ID||"00000000-0000-4000-8000-000000000001";
    await pool.query(
      "INSERT INTO reader_users(id,handle) VALUES($1,'owner') ON CONFLICT(id) DO NOTHING",[owner]);
    console.log("Database ready. Single-user owner initialized:",owner);
  }finally{await pool.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
