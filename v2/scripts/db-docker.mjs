import {spawnSync} from "node:child_process";
import {existsSync,statSync} from "node:fs";
import {resolve} from "node:path";

export function option(name,fallback=""){
 const pos=process.argv.indexOf(name);
 return pos>=0?process.argv[pos+1]||fallback:fallback;
}
export function docker(...args){
 const run=spawnSync("docker",args,{encoding:"utf8",maxBuffer:12*1024*1024});
 if(run.error)throw Error("Docker cannot be started: "+run.error.message);
 if(run.status!==0)throw Error("docker "+args.slice(0,2).join(" ")+": "+
   (run.stderr||run.stdout||"command failed").trim().slice(-1500));
 return (run.stdout||"").trim();
}
export function composeArgs(){
 const args=["compose"];
 const env=option("--env-file");
 if(env)args.push("--env-file",resolve(env));
 args.push("-f",resolve(option("--compose","docker-compose.yml")));
 return args;
}
export function databaseContainer(){
 const id=docker(...composeArgs(),"ps","-q","postgres");
 if(!/^[a-f0-9]{12,64}$/i.test(id))throw Error("Postgres container is not running");
 return id;
}
export function assertDump(file){
 if(!existsSync(file)||statSync(file).size<100)
  throw Error("Backup file is missing or suspiciously small: "+file);
}
