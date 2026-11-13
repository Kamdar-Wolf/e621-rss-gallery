import argon2 from "argon2";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pool } from "./db.js";
import { config } from "./config.js";
import { emailValue } from "./validation.js";

const cookieName = "kr_session";
const thirtyDays = 30 * 24 * 60 * 60;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export interface CurrentUser { id: string; email: string; csrf: string; }

async function issueSession(reply: FastifyReply, user: {id:string;email:string}) {
  const token = randomBytes(32).toString("base64url");
  const csrf = randomBytes(24).toString("base64url");
  await pool.query(
    "INSERT INTO sessions(user_id,token_hash,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
    [user.id, digest(token), csrf]
  );
  reply.setCookie(cookieName, token, { httpOnly: true, secure: config.secureCookies, sameSite: "strict", path: "/api/v1", maxAge: thirtyDays });
  return {user: {id:user.id,email:user.email},csrf};
}

export async function getCurrentUser(request: FastifyRequest): Promise<CurrentUser | null> {
  const token = request.cookies?.[cookieName];
  if (!token || token.length > 256) return null;
  const result = await pool.query<{id:string;email:string;csrf_token:string}>(
    `SELECT u.id,u.email,s.csrf_token FROM sessions s
     JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL
       AND s.expires_at > now()`,
    [digest(token)]
  );
  const row=result.rows[0];
  return row?{id:row.id,email:row.email,csrf:row.csrf_token}:null;
}

export async function authenticated(request: FastifyRequest, reply: FastifyReply, write = false) {
  const user = await getCurrentUser(request);
  if (!user) { reply.code(401).send({error:"Not authenticated"}); return null; }
  if (write) {
    const submitted = request.headers["x-csrf-token"];
    const supplied = typeof submitted === "string" ? submitted : "";
    const a=Buffer.from(supplied),b=Buffer.from(user.csrf);
    if(a.length!==b.length || !timingSafeEqual(a,b)) {
      reply.code(403).send({error:"Invalid CSRF token"});return null;
    }
  }
  return user;
}

export function authRoutes(app: FastifyInstance) {
  app.post("/api/v1/auth/bootstrap", async (req,reply) => {
    const body = req.body as {email?:unknown;password?:unknown;bootstrapToken?:unknown} | null;
    if (!config.bootstrapToken) return reply.code(503).send({error:"Server bootstrap is not configured"});
    if (!body || body.bootstrapToken!==config.bootstrapToken) return reply.code(403).send({error:"Invalid bootstrap token"});
    let email;
    try {email=emailValue(body.email);}catch{return reply.code(400).send({error:"Invalid email"});}
    if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 256)
      return reply.code(400).send({error:"Password must have 12–256 characters"});
    const hash=await argon2.hash(body.password,{type:argon2.argon2id});
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(67219912)");
      const count=await client.query("SELECT count(*)::int AS count FROM users");
      if ((count.rows[0]?.count??0)>0){
        await client.query("ROLLBACK");
        return reply.code(409).send({error:"Initial account already exists"});
      }
      const result=await client.query<{id:string;email:string}>("INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email",[email,hash]);
      await client.query("COMMIT");
      return reply.code(201).send(await issueSession(reply,result.rows[0]!));
    }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  });
  app.post("/api/v1/auth/login",async(req,reply)=>{
    const body=req.body as {email?:unknown;password?:unknown} | null;
    let email;try{email=emailValue(body?.email);}catch{return reply.code(401).send({error:"Invalid credentials"});}
    if(typeof body?.password!=="string" || body.password.length>256)return reply.code(401).send({error:"Invalid credentials"});
    const result=await pool.query<{id:string;email:string;password_hash:string}>("SELECT id,email,password_hash FROM users WHERE email=$1",[email]);
    const row=result.rows[0];
    if(!row || !await argon2.verify(row.password_hash,body.password))return reply.code(401).send({error:"Invalid credentials"});
    return reply.send(await issueSession(reply,row));
  });
  app.get("/api/v1/auth/session",async(req,reply)=>{
    const user=await authenticated(req,reply);if(!user)return;
    return {user:{id:user.id,email:user.email},csrf:user.csrf};
  });
  app.post("/api/v1/auth/logout",async(req,reply)=>{
    const user=await authenticated(req,reply,true);if(!user)return;
    const token=req.cookies?.[cookieName];
    if(token)await pool.query("UPDATE sessions SET revoked_at=now() WHERE token_hash=$1 AND user_id=$2",[digest(token),user.id]);
    reply.clearCookie(cookieName,{path:"/api/v1"});return {ok:true};
  });
}
