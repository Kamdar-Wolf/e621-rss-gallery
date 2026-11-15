import {randomBytes} from "node:crypto";
import {mkdirSync,existsSync,chmodSync} from "node:fs";
import {resolve,join} from "node:path";
import {docker,databaseContainer,option,assertDump} from "./db-docker.mjs";
const outputDir=resolve(option("--output-dir","backups"));
const filename="reader-"+new Date().toISOString().replace(/[:.]/g,"-")+
 "-"+randomBytes(3).toString("hex")+".dump";
mkdirSync(outputDir,{recursive:true,mode:0o700});
const destination=join(outputDir,filename);
if(existsSync(destination))throw Error("Refusing to overwrite backup "+destination);
const container=databaseContainer();
const remote="/tmp/kr-backup-"+randomBytes(8).toString("hex")+".dump";
try{
 docker("exec","-u","postgres",container,"pg_dump",
   "-U","reader","-d","reader","-Fc","--no-owner","--no-acl","-f",remote);
 docker("exec","-u","postgres",container,"pg_restore","-l",remote);
 docker("cp",container+":"+remote,destination);
 chmodSync(destination,0o600);
 assertDump(destination);
 console.log("Backup created and validated:",destination);
 console.log("Contents may include private RSS URLs and user data. Store securely.");
}finally{
 try{docker("exec",container,"rm","-f",remote);}catch{}
}
