import {request as httpsRequest} from "node:https";
import {lookup as dnsLookup} from "node:dns/promises";
import {resolvePublicUrl,type Resolver} from "../../worker/src/safe-fetch.js";

export type VerifiedImage={
  mimeType:string;body:Buffer;finalUrl:string;
};
export class MediaDownloadError extends Error{
  constructor(message:string,public readonly status=422){
    super(message);this.name="MediaDownloadError";
  }
}
export const IMAGE_LIMIT=5*1024*1024;
export const IMAGE_REDIRECT_LIMIT=3;
const mimeTypes=new Set([
  "image/jpeg","image/png","image/webp","image/gif","image/avif"
]);
const defaultResolver:Resolver=async host=>dnsLookup(host,{all:true,verbatim:true});
export function validateImageType(raw:string):string{
  const mime=raw.split(";")[0].trim().toLowerCase();
  if(!mimeTypes.has(mime))
    throw new MediaDownloadError("Unsupported image content type",415);
  return mime;
}
export function hasImageSignature(bytes:Buffer,mime:string):boolean{
  if(mime==="image/jpeg")
    return bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(mime==="image/png")
    return bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
  if(mime==="image/gif")
    return bytes.length>=6&&bytes.toString("ascii",0,4)==="GIF8"&&
      [ "GIF87a","GIF89a" ].includes(bytes.toString("ascii",0,6));
  if(mime==="image/webp")
    return bytes.length>=12&&bytes.toString("ascii",0,4)==="RIFF"&&
      bytes.toString("ascii",8,12)==="WEBP";
  if(mime==="image/avif")
    return bytes.length>=12&&bytes.toString("ascii",4,8)==="ftyp"&&
      ["avif","avis"].includes(bytes.toString("ascii",8,12));
  return false;
}
type RequestResult={
  status:number;headers:Record<string,string>;body:Buffer;
};
export type ImageTransport=(target:{
  url:URL;address:string;family:number
})=>Promise<RequestResult>;
function headerString(value:string|string[]|number|undefined):string{
  return Array.isArray(value)?value.join(", "):String(value??"");
}
const redirects=new Set([301,302,303,307,308]);
const connectTimeoutMs=12_000;
async function singleRequest(target:{
  url:URL;address:string;family:number
}):Promise<RequestResult>{
  return new Promise((resolve,reject)=>{
    const req=httpsRequest(target.url,{
      method:"GET",timeout:connectTimeoutMs,maxHeaderSize:16_384,
      rejectUnauthorized:true,
      headers:{
        "User-Agent":"KamdarReader/0.2 (personal RSS reader)",
        "Accept":"image/avif,image/webp,image/png,image/jpeg,image/gif",
        "Accept-Encoding":"identity",
        "Cache-Control":"no-store",
        "Connection":"close"
      },
      // The socket gets the address already checked for public reachability.
      // TLS SNI and certificate validation still use the original hostname.
      lookup:(_host,_options,callback)=>{
        (callback as (err:Error|null,address:string,family:number)=>void)(
          null,target.address,target.family);
      }
    },res=>{
      const status=res.statusCode||0;
      const headers:Record<string,string>={};
      for(const name of ["content-type","content-length","content-encoding","location"])
        headers[name]=headerString(res.headers[name]);
      if(redirects.has(status)){
        res.destroy();
        resolve({status,headers,body:Buffer.alloc(0)});
        return;
      }
      if(status!==200){
        res.destroy();
        resolve({status,headers,body:Buffer.alloc(0)});
        return;
      }
      const declared=Number(headers["content-length"]||"0");
      if(!Number.isFinite(declared)||declared<0||declared>IMAGE_LIMIT){
        res.destroy();
        reject(new MediaDownloadError("Remote image exceeds 5 MiB",413));return;
      }
      if(headers["content-encoding"]&&headers["content-encoding"].toLowerCase()!=="identity"){
        res.destroy();
        reject(new MediaDownloadError("Compressed image transfer is not supported",415));return;
      }
      try{validateImageType(headers["content-type"]||"");}
      catch(error){res.destroy();reject(error);return;}
      let total=0;
      const chunks:Buffer[]=[];
      res.on("data",(chunk:Buffer)=>{
        total+=chunk.byteLength;
        if(total>IMAGE_LIMIT){
          res.destroy();
          reject(new MediaDownloadError("Remote image exceeds 5 MiB",413));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end",()=>resolve({status,headers,body:Buffer.concat(chunks,total)}));
      res.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new MediaDownloadError("Image download timeout",504)));
    req.on("error",reject);
    req.end();
  });
}
/** Coarse in-process abuse guard; clustered production deployments need a shared limiter. */
export function createImageDownloadLimiter(now:()=>number=Date.now){
  const users=new Map<string,{windowStart:number;requests:number;active:number}>();
  let globalActive=0;
  return function reserve(userId:string):()=>void{
    const time=now();
    let row=users.get(userId);
    if(!row||time-row.windowStart>=15*60_000){
      const active=row?.active||0;
      row={windowStart:time,requests:0,active};
      users.set(userId,row);
    }
    if(row.requests>=40||row.active>=2||globalActive>=8)
      throw new MediaDownloadError("Image download rate limit exceeded",429);
    row.requests++;row.active++;globalActive++;
    if(users.size>10000){
      for(const [id,value] of users)
        if(value.active===0&&time-value.windowStart>=15*60_000)users.delete(id);
    }
    let released=false;
    return ()=>{
      if(released)return;
      released=true;
      row!.active--;globalActive--;
    };
  };
}

/** Only for URLs retrieved from the authorized entry_media table, never raw user input. */
export async function downloadVerifiedImage(
  rawUrl:string,resolver:Resolver=defaultResolver,
  transport:ImageTransport=singleRequest
):Promise<VerifiedImage>{
  if(rawUrl.length>4096)throw new MediaDownloadError("Image URL is too long");
  let current=rawUrl;
  const visited=new Set<string>();
  for(let hop=0;hop<=IMAGE_REDIRECT_LIMIT;hop++){
    let target:{url:URL;address:string;family:number};
    try{target=await resolvePublicUrl(current,resolver);}
    catch{throw new MediaDownloadError("Destination is blocked by SSRF protection");}
    if(target.url.protocol!=="https:")
      throw new MediaDownloadError("HTTPS is required for remote images");
    if(target.url.href.length>4096)
      throw new MediaDownloadError("Image URL is too long");
    if(visited.has(target.url.href))
      throw new MediaDownloadError("Redirect loop detected");
    visited.add(target.url.href);
    const response=await transport(target);
    if(redirects.has(response.status)){
      if(hop===IMAGE_REDIRECT_LIMIT)
        throw new MediaDownloadError("Too many image redirects");
      if(!response.headers.location)
        throw new MediaDownloadError("Image redirect has no Location");
      try{current=new URL(response.headers.location,target.url).href;}
      catch{throw new MediaDownloadError("Invalid image redirect Location");}
      continue; // Each hop must independently pass pinned DNS + public IP verification.
    }
    if(response.status!==200)
      throw new MediaDownloadError("Remote image is unavailable (HTTP "+response.status+")",
        [401,403,404,410].includes(response.status)?422:502);
    if(response.headers["content-encoding"]&&
      response.headers["content-encoding"].toLowerCase()!=="identity")
      throw new MediaDownloadError("Compressed image response is not supported",415);
    const declared=Number(response.headers["content-length"]||"0");
    if(!Number.isFinite(declared)||declared<0||declared>IMAGE_LIMIT||
      response.body.byteLength>IMAGE_LIMIT)
      throw new MediaDownloadError("Remote image exceeds 5 MiB",413);
    const mime=validateImageType(response.headers["content-type"]||"");
    if(!hasImageSignature(response.body,mime))
      throw new MediaDownloadError("Remote bytes do not match the declared image type",415);
    return {body:response.body,mimeType:mime,finalUrl:target.url.href};
  }
  throw new MediaDownloadError("Image redirect limit reached");
}
