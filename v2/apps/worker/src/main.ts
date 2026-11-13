import {fileURLToPath} from "node:url";
import {connectPool} from "../../api/src/db.js";
import {pollDueFeeds} from "./poller.js";

async function main(){
  const url=process.env.DATABASE_URL;
  if(!url)throw Error("DATABASE_URL is required");
  const pool=connectPool(url);
  let running=true;
  for(const sig of ["SIGINT","SIGTERM"] as const)
    process.on(sig,()=>{running=false;});
  const once=process.argv.includes("--once");
  try{
    do{
      const results=await pollDueFeeds(pool,undefined,10);
      for(const r of results)console.log(JSON.stringify(r));
      if(once)break;
      await new Promise(resolve=>setTimeout(resolve,30_000));
    }while(running);
  }finally{await pool.end();}
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1])
  main().catch(e=>{console.error(e);process.exitCode=1;});
