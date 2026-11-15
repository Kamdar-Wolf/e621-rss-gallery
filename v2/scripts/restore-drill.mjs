import {randomBytes} from "node:crypto";
import {resolve} from "node:path";
import {docker,databaseContainer,option,assertDump} from "./db-docker.mjs";
const file=resolve(option("--file"));
assertDump(file);
const container=databaseContainer();
const random=randomBytes(5).toString("hex");
const database="kr_restore_"+random;
const remote="/tmp/kr-restore-"+random+".dump";
let created=false;
try{
 docker("cp",file,container+":"+remote);
 docker("exec","-u","postgres",container,"pg_restore","-l",remote);
 docker("exec","-u","postgres",container,"createdb","-U","reader","-O","reader",database);
 created=true;
 docker("exec","-u","postgres",container,"pg_restore","-U","reader",
   "--no-owner","--no-acl","-d",database,remote);
 const sql="SELECT (SELECT COUNT(*) FROM schema_migrations),"+
  "(SELECT COUNT(*) FROM reader_users),"+
  "(SELECT COUNT(*) FROM feeds),"+
  "(SELECT COUNT(*) FROM entries),"+
  "(SELECT COUNT(*) FROM subscriptions)";
 const raw=docker("exec","-u","postgres",container,"psql","-U","reader","-d",database,
   "-At","-c",sql);
 const numbers=raw.split("|").map(Number);
 if(numbers.length!==5||numbers.some(n=>!Number.isSafeInteger(n)||n<0)||
   numbers[0]<1||numbers[1]<1)throw Error("Restore verification failed: "+raw);
 console.log("Restore passed in isolated temporary database:",database);
 console.log("Migrations/users/feeds/entries/subscriptions:",numbers.join("/"));
 console.log("Original reader database was NOT modified.");
}finally{
 if(created){
  try{docker("exec","-u","postgres",container,"dropdb","-U","reader",database);}
  catch(e){console.error("WARNING: temporary database requires manual removal:",database);throw e;}
 }
 try{docker("exec",container,"rm","-f",remote);}catch{}
}
