import {randomUUID} from "node:crypto";
import {MediaDownloadError} from "./media-download.js";

/**
 * Redis EVAL support, intentionally decoupled from a specific Redis client
 * to permit deterministic tests. Redis scripts are atomic on the server.
 */
export interface RedisScriptClient{
  eval(script:string,options:{keys:string[];arguments:string[]}):Promise<unknown>;
}
export interface ImageDownloadQuota{
  reserve(userId:string):Promise<()=>Promise<void>>;
}
const WINDOW_MS=900_000;
const LEASE_MS=90_000;
const VALID_USER=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// All keys share a Redis Cluster hash tag so the script is cluster-compatible.
const RESERVE_SCRIPT=String.raw`
local t=redis.call('TIME')
local now=tonumber(t[1])*1000+math.floor(tonumber(t[2])/1000)
local attempts=tonumber(redis.call('GET',KEYS[1]) or '0')
if attempts>=tonumber(ARGV[1]) then
  return {0,math.max(redis.call('PTTL',KEYS[1]),1000)}
end
redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now)
redis.call('ZREMRANGEBYSCORE',KEYS[3],'-inf',now)
if redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[2]) or
   redis.call('ZCARD',KEYS[3])>=tonumber(ARGV[3]) then
  return {0,1000}
end
if attempts==0 then
  redis.call('SET',KEYS[1],'1','PX',ARGV[4])
else
  redis.call('INCR',KEYS[1])
end
local expiry=now+tonumber(ARGV[5])
redis.call('ZADD',KEYS[2],expiry,ARGV[6])
redis.call('ZADD',KEYS[3],expiry,ARGV[6])
redis.call('PEXPIRE',KEYS[2],ARGV[5])
redis.call('PEXPIRE',KEYS[3],ARGV[5])
return {1,0}
`;
const RELEASE_SCRIPT=String.raw`
redis.call('ZREM',KEYS[1],ARGV[1])
redis.call('ZREM',KEYS[2],ARGV[1])
return 1
`;

/** 40 requests / 15 min, two concurrent / user, eight concurrent / fleet. */
export function createRedisImageDownloadQuota(client:RedisScriptClient):ImageDownloadQuota{
  return {
    async reserve(userId:string):Promise<()=>Promise<void>>{
      if(!VALID_USER.test(userId))throw new MediaDownloadError("Invalid reader identity",403);
      const base="kr:{media-quota}:";
      const windowKey=base+"window:"+userId;
      const activeUser=base+"active:"+userId;
      const activeGlobal=base+"active:all";
      const token=randomUUID();
      let raw:unknown;
      try{
        raw=await client.eval(RESERVE_SCRIPT,{
          keys:[windowKey,activeUser,activeGlobal],
          arguments:["40","2","8",String(WINDOW_MS),String(LEASE_MS),token]
        });
      }catch{
        // No quota storage means no downloading. Never fall back to local limits
        // in production, as that permits replica-wide quota bypasses.
        throw new MediaDownloadError("Shared image quota unavailable",503);
      }
      if(!Array.isArray(raw)||!Number.isFinite(Number(raw[0]))){
        throw new MediaDownloadError("Shared image quota returned invalid result",503);
      }
      if(Number(raw[0])!==1)
        throw new MediaDownloadError("Image download quota exceeded",429);
      let released=false;
      return async()=>{
        if(released)return;
        released=true;
        try{
          await client.eval(RELEASE_SCRIPT,{
            keys:[activeUser,activeGlobal],
            arguments:[token]
          });
        }catch{
          // Slots expire after LEASE_MS even if the API process crashes or Redis
          // is unavailable at release. A temporarily stale slot denies traffic.
        }
      };
    }
  };
}

/** Compatibility wrapper, only for explicitly local/single-process development. */
export function createLocalImageDownloadQuota(
  reserve:(userId:string)=>()=>void
):ImageDownloadQuota{
  return {
    async reserve(userId:string){
      const release=reserve(userId);
      return async()=>{release();};
    }
  };
}
