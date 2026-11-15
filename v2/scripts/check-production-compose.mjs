// Read 'docker compose config --format json' from stdin in CI.
let content="";
for await(const chunk of process.stdin)content+=chunk;
const compose=JSON.parse(content);
const services=compose.services||{};
for(const name of ["web","api","worker","redis","postgres","migrate"]){
  if(!services[name])throw Error("Missing production service: "+name);
}
for(const [name,service] of Object.entries(services)){
  if(name!=="web"&&(service.ports||[]).length)
    throw Error("Only Caddy web can publish ports: "+name);
}
const published=(services.web.ports||[]).map(x=>Number(x.published));
if(!published.includes(80)||!published.includes(443))
  throw Error("Public HTTPS and ACME ports are required");
if(services.api.environment.READER_TRUST_PROXY!=="true")
  throw Error("Behind Caddy, trusted forwarding must be enabled for correct IP limits");
if(services.api.environment.READER_DEPLOYMENT!=="production")
  throw Error("Production guard not enabled");
if(services.api.environment.ALLOW_DEV_TOKEN!=="false")
  throw Error("Development bearer tokens must be disabled");
if(!services.api.environment.APP_ORIGIN.startsWith("https://"))
  throw Error("Production APP_ORIGIN must use HTTPS");
if(!services.api.environment.REDIS_URL.startsWith("redis://"))
  throw Error("Shared limiter is not configured");
for(const name of ["api","worker"]){
  if(services[name].read_only!==true)
    throw Error(name+" should have a read-only root filesystem");
}
process.stdout.write("Production compose isolation checks passed.\n");
