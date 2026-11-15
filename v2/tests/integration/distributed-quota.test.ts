import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createClient} from "redis";
import {createRedisImageDownloadQuota,createRedisLoginAttemptQuota,
  type RedisScriptClient} from "../../apps/api/src/distributed-quota.js";
import {MediaDownloadError} from "../../apps/api/src/media-download.js";

const redisUrl=process.env.REDIS_URL;
test("distributed download quotas coordinate two API replicas",{
  skip:!redisUrl?"REDIS_URL not configured":false
},async()=>{
  const a=createClient({url:redisUrl!}),b=createClient({url:redisUrl!});
  a.on("error",()=>{});b.on("error",()=>{});
  await Promise.all([a.connect(),b.connect()]);
  try{
    const first=createRedisImageDownloadQuota(a as unknown as RedisScriptClient);
    const second=createRedisImageDownloadQuota(b as unknown as RedisScriptClient);
    const user=randomUUID();
    const releaseA=await first.reserve(user);
    const releaseB=await second.reserve(user);
    await assert.rejects(second.reserve(user),error=>
      error instanceof MediaDownloadError&&error.status===429);
    await releaseA();await releaseA();
    const releaseC=await second.reserve(user);
    await releaseB();await releaseC();
    const quotaUser=randomUUID();
    for(let index=0;index<40;index++){
      const release=(index%2?first:second).reserve(quotaUser);
      await (await release)();
    }
    await assert.rejects(first.reserve(quotaUser),error=>
      error instanceof MediaDownloadError&&error.status===429);
    const held: Array<()=>Promise<void>>=[];
    for(let i=0;i<8;i++){
      held.push(await (i%2?first:second).reserve(randomUUID()));
    }
    await assert.rejects(second.reserve(randomUUID()),error=>
      error instanceof MediaDownloadError&&error.status===429);
    for(const release of held)await release();
    const finalRelease=await first.reserve(randomUUID());
    await finalRelease();
  }finally{
    await Promise.all([a.quit(),b.quit()]);
  }
});
test("distributed limiter fails closed when Redis is down or returns invalid results",async()=>{
  const client:RedisScriptClient={eval:async()=>{throw Error("Redis offline");}};
  const quota=createRedisImageDownloadQuota(client);
  await assert.rejects(quota.reserve(randomUUID()),error=>
    error instanceof MediaDownloadError&&error.status===503);
  const corrupted=createRedisImageDownloadQuota({eval:async()=>null});
  await assert.rejects(corrupted.reserve(randomUUID()),error=>
    error instanceof MediaDownloadError&&error.status===503);
  await assert.rejects(quota.reserve("not-a-user"),error=>
    error instanceof MediaDownloadError&&error.status===403);
});

test("distributed login attempts stay limited across two replicas",{
  skip:!redisUrl?"REDIS_URL not configured":false
},async()=>{
  const a=createClient({url:redisUrl!}),b=createClient({url:redisUrl!});
  a.on("error",()=>{});b.on("error",()=>{});
  await Promise.all([a.connect(),b.connect()]);
  try{
    const quotaA=createRedisLoginAttemptQuota(a as unknown as RedisScriptClient);
    const quotaB=createRedisLoginAttemptQuota(b as unknown as RedisScriptClient);
    const ip="203.0.113."+Math.floor(Math.random()*240+10);
    for(let i=0;i<10;i++)
      assert.equal(await (i%2?quotaA:quotaB).allow(ip),true);
    assert.equal(await quotaB.allow(ip),false);
    assert.equal(await quotaA.allow("198.51.100.101"),true);
    const leaked=await a.keys("*"+ip+"*");
    assert.deepEqual(leaked,[],"Raw IP address must never be in Redis key names");
  }finally{
    await Promise.all([a.quit(),b.quit()]);
  }
});
test("distributed login quota fails closed when Redis is unavailable",async()=>{
  const broken=createRedisLoginAttemptQuota({eval:async()=>{throw Error("offline");}});
  await assert.rejects(broken.allow("198.51.100.99"),/unavailable/);
  const invalid=createRedisLoginAttemptQuota({eval:async()=>undefined});
  await assert.rejects(invalid.allow("198.51.100.99"),/invalid/);
});
