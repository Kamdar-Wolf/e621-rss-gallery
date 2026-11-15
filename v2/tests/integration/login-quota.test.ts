import test from "node:test";
import assert from "node:assert/strict";
import {buildApp} from "../../apps/api/src/server.js";
import {downloadVerifiedImage} from "../../apps/api/src/media-download.js";
import {connectPool} from "../../apps/api/src/db.js";

const pool=connectPool(process.env.DATABASE_URL!);
const token=process.env.READER_API_TOKEN;
const origin=process.env.APP_ORIGIN||"http://127.0.0.1:5173";
const credentials={username:"owner",password:"this-password-is-intentionally-invalid"};

test("login endpoint rejects exhausted shared quota before checking passwords",async()=>{
  const captured:string[]=[];
  const app=buildApp(pool,token,downloadVerifiedImage,undefined,{
    allow:async ip=>{captured.push(ip);return false;}
  });
  try{
    const response=await app.inject({method:"POST",url:"/v1/auth/login",
      headers:{origin},payload:credentials});
    assert.equal(response.statusCode,429,response.body);
    assert.equal(response.headers["retry-after"],"900");
    assert.equal(captured.length,1);
    assert.ok(captured[0].length>0);
  }finally{await app.close();}
});
test("login returns 503 if distributed quota is unavailable, never falls back",async()=>{
  const app=buildApp(pool,token,downloadVerifiedImage,undefined,{
    allow:async()=>{throw Error("Redis unavailable");}
  });
  try{
    const response=await app.inject({method:"POST",url:"/v1/auth/login",
      headers:{origin},payload:credentials});
    assert.equal(response.statusCode,503,response.body);
    assert.match(response.json().error,/temporarily unavailable/);
  }finally{await app.close();}
});
test.after(async()=>{await pool.end();});
