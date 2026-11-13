import {randomUUID} from "node:crypto";
import {connectPool} from "../apps/api/src/db.js";
import {makePasswordHash,validateHandle} from "../apps/api/src/auth.js";

/** One-time offline bootstrap; password is taken from environment, not CLI args. */
async function main(){
  const handle=validateHandle(process.env.READER_BOOTSTRAP_USER||"owner");
  const password=process.env.READER_BOOTSTRAP_PASSWORD;
  const database=process.env.DATABASE_URL;
  if(!handle||!database||!password||password.length<12||password.length>256)
    throw Error("Provide DATABASE_URL, valid READER_BOOTSTRAP_USER and password (12-256 characters) via environment");
  const pool=connectPool(database);
  try{
    const user=await pool.query<{id:string}>(
      "INSERT INTO reader_users(id,handle,password_hash) VALUES($1,$2,$3) "+
      "ON CONFLICT(handle) DO UPDATE SET password_hash=EXCLUDED.password_hash RETURNING id",
      [handle==="owner"?(process.env.READER_OWNER_ID||"00000000-0000-4000-8000-000000000001"):randomUUID(),
       handle,makePasswordHash(password)]);
    await pool.query("UPDATE reader_sessions SET revoked_at=NOW() WHERE user_id=$1",[user.rows[0].id]);
    console.log("Account initialized:",handle,"(existing sessions revoked)");
  }finally{await pool.end();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Bootstrap failed");process.exitCode=1;});
