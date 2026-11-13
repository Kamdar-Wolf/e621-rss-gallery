import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {buildApp} from "../../apps/api/src/server.js";
import {connectPool} from "../../apps/api/src/db.js";
import {makePasswordHash} from "../../apps/api/src/auth.js";

const pool=connectPool(process.env.DATABASE_URL!);
const app=buildApp(pool,process.env.READER_API_TOKEN);
const origin="http://127.0.0.1:5173";
const usernameA="usera"+randomUUID().slice(0,12).replace(/-/g,"");
const usernameB="userb"+randomUUID().slice(0,12).replace(/-/g,"");
const password="very-long-integration-password-2026";
const ids=[randomUUID(),randomUUID()];
const feedId=randomUUID();
let sessionA:{cookie:string;csrf:string};
let sessionB:{cookie:string;csrf:string};

function sessionCookie(reply: {headers:Record<string,unknown>}):string{
  return String(reply.headers["set-cookie"]||"").split(";")[0];
}
async function login(username:string){
  const response=await app.inject({method:"POST",url:"/v1/auth/login",
    headers:{origin},payload:{username,password}});
  assert.equal(response.statusCode,200,response.body);
  const cookie=sessionCookie(response);
  assert.match(cookie,/^kr_session=[a-f0-9]{64}$/);
  assert.match(String(response.headers["set-cookie"]),/HttpOnly/);
  assert.match(String(response.headers["set-cookie"]),/SameSite=Strict/);
  return {cookie,csrf:response.json().csrf as string};
}
function headers(session:{cookie:string;csrf:string},withCsrf=false):Record<string,string>{
  return {cookie:session.cookie,...(withCsrf?{origin,"x-kr-csrf":session.csrf}:{})};
}

test("create test users and log in with separate sessions",async()=>{
  for(const [idx,handle] of [usernameA,usernameB].entries())
    await pool.query("INSERT INTO reader_users(id,handle,password_hash) VALUES($1,$2,$3)",
      [ids[idx],handle,makePasswordHash(password)]);
  const bad=await app.inject({method:"POST",url:"/v1/auth/login",
    headers:{origin},payload:{username:usernameA,password:"wrong-password-1234"}});
  assert.equal(bad.statusCode,401,bad.body);
  const csrfBad=await app.inject({method:"POST",url:"/v1/auth/login",
    headers:{origin:"https://attacker.example"},payload:{username:usernameA,password}});
  assert.equal(csrfBad.statusCode,403,csrfBad.body);
  sessionA=await login(usernameA);
  sessionB=await login(usernameB);
  const verify=await app.inject({method:"GET",url:"/v1/auth/session",headers:headers(sessionA)});
  assert.equal(verify.statusCode,200);
  assert.equal(verify.json().user.id,ids[0]);
  assert.equal(verify.json().csrf,sessionA.csrf);
});
test("CSRF blocks authenticated state-changing requests",async()=>{
  const attempt=await app.inject({method:"POST",url:"/v1/feeds",
    headers:headers(sessionA),payload:{url:"https://example.org/csrf-reject.xml"}});
  assert.equal(attempt.statusCode,403,attempt.body);
  const otherOrigin=await app.inject({method:"POST",url:"/v1/feeds",
    headers:{...headers(sessionA,true),origin:"https://untrusted.example"},
    payload:{url:"https://example.org/csrf-reject.xml"}});
  assert.equal(otherOrigin.statusCode,403,otherOrigin.body);
});
test("subscriptions and entry states are isolated per user",async()=>{
  const url="https://example.org/auth-"+feedId+".xml";
  const create=await app.inject({method:"POST",url:"/v1/feeds",
    headers:headers(sessionA,true),payload:{url,title:"Private feed A"}});
  assert.equal(create.statusCode,201,create.body);
  const sourceId=create.json().id as string;
  assert.equal((await app.inject({method:"GET",url:"/v1/feeds",headers:headers(sessionA)}))
    .json().items.some((f:{id:string})=>f.id===sourceId),true);
  const listB=await app.inject({method:"GET",url:"/v1/feeds",headers:headers(sessionB)});
  assert.equal(listB.statusCode,200,listB.body);
  assert.equal(listB.json().items.some((f:{id:string})=>f.id===sourceId),false);
  const entryId=randomUUID();
  await pool.query(
    "INSERT INTO entries(id,feed_id,source_guid,source_url,title,summary) "+
    "VALUES($1,$2,$3,$4,$5,$6)",
    [entryId,sourceId,"auth-"+entryId,"https://example.org/auth-post",
      "Private post test","Private for account A"]);
  const mark=await app.inject({method:"PATCH",url:"/v1/entries/"+entryId+"/state",
    headers:headers(sessionA,true),payload:{read:true,starred:true}});
  assert.equal(mark.statusCode,200,mark.body);
  const other=await app.inject({method:"PATCH",url:"/v1/entries/"+entryId+"/state",
    headers:headers(sessionB,true),payload:{starred:true}});
  assert.equal(other.statusCode,404,other.body);
  const search=await app.inject({method:"GET",url:"/v1/search?q=Private",headers:headers(sessionB)});
  assert.equal(search.statusCode,200,search.body);
  assert.equal(search.json().items.some((e:{id:string})=>e.id===entryId),false);
  const listA=await app.inject({method:"GET",url:"/v1/entries",headers:headers(sessionA)});
  assert.equal(listA.json().items.some((e:{id:string})=>e.id===entryId),true);
  await pool.query("DELETE FROM feeds WHERE id=$1",[sourceId]);
});
test("logout revokes the cookie on the server",async()=>{
  const response=await app.inject({method:"POST",url:"/v1/auth/logout",
    headers:headers(sessionA,true)});
  assert.equal(response.statusCode,200,response.body);
  const revoked=await app.inject({method:"GET",url:"/v1/auth/session",headers:headers(sessionA)});
  assert.equal(revoked.statusCode,401);
  const another=await app.inject({method:"GET",url:"/v1/auth/session",headers:headers(sessionB)});
  assert.equal(another.statusCode,200);
});
test("clean up session tests",async()=>{
  try{
    for(const id of ids)await pool.query("DELETE FROM reader_users WHERE id=$1",[id]);
  }finally{await app.close();await pool.end();}
});
