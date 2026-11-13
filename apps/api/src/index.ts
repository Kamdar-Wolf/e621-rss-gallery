import Fastify from "fastify";
import cookie from "@fastify/cookie";
import {pool} from "./db.js";
import {authRoutes} from "./auth.js";
import {apiRoutes} from "./routes.js";
import {migrate} from "./migrate.js";
import {config} from "./config.js";

export async function createServer(){
  const app=Fastify({logger:true,bodyLimit:1_200_000,trustProxy:false});
  await app.register(cookie);
  app.addHook("onRequest",async(req,reply)=>{
    if(["POST","PUT","PATCH","DELETE"].includes(req.method)&&req.url.startsWith("/api/v1/")){
      const origin=req.headers.origin;
      if(origin&&origin!==config.publicOrigin){
        reply.code(403).send({error:"Invalid request origin"});
      }
    }
  });
  app.get("/health",async(_,reply)=>{
    try{await pool.query("SELECT 1");return {status:"ok",db:true};}
    catch{return reply.code(503).send({status:"error",db:false});}
  });
  authRoutes(app);
  apiRoutes(app);
  app.setErrorHandler((error,req,reply)=>{
    req.log.error(error);
    if(error.validation)return reply.code(400).send({error:"Invalid input"});
    return reply.code(500).send({error:"Internal server error"});
  });
  return app;
}
async function main(){
  await migrate();
  const app=await createServer();
  await app.listen({port:config.port,host:config.host});
  const shut=async()=>{await app.close();await pool.end();};
  process.once("SIGTERM",()=>void shut());
  process.once("SIGINT",()=>void shut());
}
if(process.env.NODE_ENV!=="test")void main().catch(e=>{console.error(e);process.exitCode=1;});
