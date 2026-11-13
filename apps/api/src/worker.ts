import { Redis } from "ioredis";
import {Queue, Worker} from "bullmq";
import {config} from "./config.js";
import {pool} from "./db.js";
import {migrate} from "./migrate.js";
import {ingestFeed} from "./ingest.js";

const redis=new Redis(config.redisUrl,{maxRetriesPerRequest:null});
const queue=new Queue("feed-ingest",{connection:redis});
const worker=new Worker("feed-ingest",async job=>{
  return ingestFeed(job.data.feedId as string);
},{connection:redis,concurrency:2});
worker.on("failed",(job,error)=>console.error("Feed worker failed",job?.id,error.message));
worker.on("completed",(job)=>console.log("Updated feed",job.data.feedId));
let running=true;
async function scan(){
  const result=await pool.query<{id:string}>(
    `UPDATE feeds SET next_fetch_at=now()+interval '15 minutes'
     WHERE id IN (SELECT id FROM feeds WHERE next_fetch_at<=now()
       ORDER BY next_fetch_at FOR UPDATE SKIP LOCKED LIMIT 50)
     RETURNING id`);
  for(const f of result.rows){
    await queue.add("fetch",{feedId:f.id},{removeOnComplete:100,removeOnFail:100,attempts:1});
  }
}
async function start(){
  await migrate();
  console.log("RSS worker started");
  while(running){
    try{await scan();}catch(e){console.error("Scheduler",e);}
    await new Promise(resolve=>setTimeout(resolve,30000));
  }
}
async function stop(){running=false;await worker.close();await queue.close();await redis.quit();await pool.end();}
process.on("SIGTERM",()=>void stop());
process.on("SIGINT",()=>void stop());
void start().catch(e=>{console.error(e);process.exitCode=1;});
