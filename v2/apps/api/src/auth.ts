import {createHash,createHmac,randomBytes,randomUUID,scryptSync,timingSafeEqual} from "node:crypto";
import type pg from "pg";
import type {FastifyInstance,FastifyRequest} from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    readerUserId: string|null;
    readerHandle: string|null;
    readerSessionHash: string|null;
    readerRawToken: string|null;
  }
}

const COOKIE_NAME="kr_session";
const SESSION_DAYS=14;
const PASSWORD_LENGTH=64;
const PASSWORD_COST=16384;
const PASSWORD_REGEX=/^[a-z0-9][a-z0-9_-]{2,31}$/;
const TOKEN_REGEX=/^[a-f0-9]{64}$/;
const riskyMethods=new Set(["POST","PUT","PATCH","DELETE"]);
const EMPTY_PASSWORD_HASH=makePasswordHash("dummy-password-used-for-unknown-user");

export function validateHandle(raw:unknown):string|null{
  if(typeof raw!=="string")return null;
  const value=raw.toLowerCase().trim();
  return PASSWORD_REGEX.test(value)?value:null;
}
export function makePasswordHash(password:string):string{
  if(password.length<12||password.length>256)throw Error("Password length must be 12-256 characters");
  const salt=randomBytes(16);
  const digest=scryptSync(password,salt,PASSWORD_LENGTH,{N:PASSWORD_COST,r:8,p:1,maxmem:64*1024*1024});
  return ["scrypt",PASSWORD_COST,salt.toString("hex"),digest.toString("hex")].join("$");
}
export function verifyPassword(password:string,stored:string):boolean{
  const [scheme,costText,saltHex,expectedHex]=stored.split("$");
  if(scheme!=="scrypt"||costText!==String(PASSWORD_COST)||!saltHex||!expectedHex||
    !/^[a-f0-9]{32}$/.test(saltHex)||!/^[a-f0-9]{128}$/.test(expectedHex)||password.length>256)return false;
  const actual=scryptSync(password,Buffer.from(saltHex,"hex"),PASSWORD_LENGTH,
    {N:PASSWORD_COST,r:8,p:1,maxmem:64*1024*1024});
  const expected=Buffer.from(expectedHex,"hex");
  return timingSafeEqual(actual,expected);
}
function digest(raw:string):string{return createHash("sha256").update(raw).digest("hex");}
function csrf(raw:string,secret:string):string{
  return createHmac("sha256",secret).update("kr-csrf:"+raw).digest("hex");
}
function equalHex(a:unknown,b:string):boolean{
  if(typeof a!=="string"||!/^[a-f0-9]{64}$/.test(a))return false;
  return timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}
function parseCookie(header:string|undefined):string|null{
  const found=(header||"").split(";").map(x=>x.trim())
    .find(x=>x.startsWith(COOKIE_NAME+"="));
  const token=found?.slice(COOKIE_NAME.length+1)||"";
  return TOKEN_REGEX.test(token)?token:null;
}
function cookie(raw:string,secure:boolean,maxAge:number):string{
  return COOKIE_NAME+"="+raw+"; Path=/; HttpOnly; SameSite=Strict; Max-Age="+maxAge+
    (secure?"; Secure":"");
}
export type AuthConfig={
  sessionSecret:string;
  origin:string;
  allowDevToken?:boolean;
  devToken?:string;
  devOwnerId?:string;
};
export function configureAuth(app:FastifyInstance,pool:pg.Pool,config:AuthConfig){
  if(config.sessionSecret.length<32)throw Error("READER_SESSION_SECRET requires at least 32 characters");
  const targetOrigin=new URL(config.origin).origin;
  const secure=targetOrigin.startsWith("https://");
  if(!secure && !["http://127.0.0.1:5173","http://localhost:5173","http://127.0.0.1:3100"]
    .includes(targetOrigin))throw Error("HTTP logins are permitted only on local development origins");
  const devAllowed=config.allowDevToken===true&&process.env.NODE_ENV!=="production"&&
    !!config.devToken&&config.devToken.length>=32;
  app.decorateRequest("readerUserId",null);
  app.decorateRequest("readerHandle",null);
  app.decorateRequest("readerSessionHash",null);
  app.decorateRequest("readerRawToken",null);

  // Local-only bootstrap sign-in. No public registration endpoint.
  const attempts=new Map<string,{count:number;until:number}>();
  app.post("/v1/auth/login",async(req,reply)=>{
    if(req.headers.origin!==targetOrigin)
      return reply.code(403).send({error:"Origin rejected"});
    const body=req.body as {username?:unknown;password?:unknown}|null;
    const username=validateHandle(body?.username);
    const password=body?.password;
    if(!username||typeof password!=="string"||password.length<12||password.length>256)
      return reply.code(400).send({error:"Invalid credentials"});
    const key=req.ip;
    const now=Date.now();
    const current=attempts.get(key);
    const record=current && current.until>now?current:{count:0,until:now+15*60_000};
    if(record.count>=10)return reply.code(429).send({error:"Too many login attempts"});
    const {rows}=await pool.query<{id:string;handle:string;password_hash:string|null}>(
      "SELECT id,handle,password_hash FROM reader_users WHERE handle=$1",[username]);
    const user=rows[0];
    // Verify a dummy hash for unknown accounts to reduce timing-based enumeration.
    const valid=verifyPassword(password,user?.password_hash||EMPTY_PASSWORD_HASH);
    if(!user||!valid){
      record.count++;attempts.set(key,record);
      if(attempts.size>10000)attempts.clear();
      return reply.code(401).send({error:"Invalid credentials"});
    }
    attempts.delete(key);
    const raw=randomBytes(32).toString("hex");
    await pool.query(
      "INSERT INTO reader_sessions(id,user_id,token_hash,expires_at) "+
      "VALUES($1,$2,$3,NOW()+INTERVAL '14 days')",
      [randomUUID(),user.id,digest(raw)]);
    reply.header("Set-Cookie",cookie(raw,secure,SESSION_DAYS*86400));
    return {user:{id:user.id,handle:user.handle},csrf:csrf(raw,config.sessionSecret)};
  });

  app.addHook("preHandler",async(req,reply)=>{
    if(req.url==="/health"||req.url==="/ready"||req.url==="/v1/auth/login")return;
    if(devAllowed && typeof req.headers.authorization==="string" &&
      req.headers.authorization.startsWith("Bearer ")){
      const raw=req.headers.authorization.slice(7);
      if(raw.length<=512 && timingSafeEqual(digestBuffer(raw),digestBuffer(config.devToken!))){
        req.readerUserId=config.devOwnerId||"00000000-0000-4000-8000-000000000001";
        req.readerHandle="owner";return;
      }
    }
    const raw=parseCookie(req.headers.cookie);
    if(!raw)return reply.code(401).send({error:"Authentication required"});
    const tokenHash=digest(raw);
    const {rows}=await pool.query<{id:string;handle:string}>(
      "SELECT u.id,u.handle FROM reader_sessions s JOIN reader_users u ON s.user_id=u.id "+
      "WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>NOW()",
      [tokenHash]);
    const user=rows[0];
    if(!user)return reply.code(401).send({error:"Session expired"});
    if(riskyMethods.has(req.method)){
      if(req.headers.origin!==targetOrigin)return reply.code(403).send({error:"Origin rejected"});
      if(!equalHex(req.headers["x-kr-csrf"],csrf(raw,config.sessionSecret)))
        return reply.code(403).send({error:"CSRF token rejected"});
    }
    req.readerUserId=user.id;
    req.readerHandle=user.handle;
    req.readerSessionHash=tokenHash;
    req.readerRawToken=raw;
  });

  app.get("/v1/auth/session",async(req)=>{
    const raw=req.readerRawToken;
    return {user:{id:req.readerUserId,handle:req.readerHandle},
      csrf:raw?csrf(raw,config.sessionSecret):""};
  });

  app.post("/v1/auth/logout",async(req,reply)=>{
    if(req.readerSessionHash)
      await pool.query("UPDATE reader_sessions SET revoked_at=NOW() WHERE token_hash=$1",
        [req.readerSessionHash]);
    reply.header("Set-Cookie",cookie("",secure,0));
    return {loggedOut:true};
  });
}
function digestBuffer(raw:string):Buffer {
  return createHash("sha256").update(raw).digest();
}
