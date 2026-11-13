import dns from "node:dns/promises";
import type { LookupFunction } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isPublicIp, normalizeFeedUrl } from "./validation.js";

const MAX_BYTES = 3_000_000;
const UA = "KamdarReader/0.2 (by Kamdar-Wolf; +https://github.com/Kamdar-Wolf/e621-rss-gallery)";
export type Fetched = {status:number;body:string;etag:string|null;lastModified:string|null;url:string};

const safeLookup: LookupFunction = (hostname, _options, callback) => {
  void dns.lookup(hostname, {all:true,verbatim:true}).then(addresses=>{
    if(!addresses.length||addresses.some(address=>!isPublicIp(address.address))){
      callback(new Error("Unsafe DNS target denied"),"","" as never);
      return;
    }
    const address=addresses[0]!;
    callback(null,address.address,address.family);
  },(error:Error)=>callback(error,"",4));
};

export async function fetchFeed(input:string,etag?:string|null,lastModified?:string|null,redirects=0):Promise<Fetched>{
  if(redirects>3)throw new Error("Too many HTTP redirects");
  const url=new URL(normalizeFeedUrl(input));
  const mod=url.protocol==="https:"?https:http;
  const headers:Record<string,string>={
    "User-Agent":UA,
    "Accept":"application/rss+xml,application/atom+xml,application/xml,text/xml,application/feed+json,application/json;q=.9,*/*;q=.2",
    "Accept-Encoding":"identity",
  };
  if(etag)headers["If-None-Match"]=etag;
  if(lastModified)headers["If-Modified-Since"]=lastModified;
  return await new Promise<Fetched>((resolve,reject)=>{
    const request=mod.request(url,{method:"GET",headers,lookup:safeLookup,timeout:16000},response=>{
      const status=response.statusCode||0;
      const location=response.headers.location;
      if(status>=300&&status<400&&location){
        response.resume();
        const next=new URL(location,url).href;
        void fetchFeed(next,null,null,redirects+1).then(resolve,reject);
        return;
      }
      const e=typeof response.headers.etag==="string"?response.headers.etag:null;
      const m=typeof response.headers["last-modified"]==="string"?response.headers["last-modified"]:null;
      if(status===304){response.resume();resolve({status,body:"",etag:e,lastModified:m,url:url.href});return;}
      if(status!==200){response.resume();reject(new Error("Feed HTTP "+status));return;}
      const announced=Number(response.headers["content-length"]||0);
      if(announced>MAX_BYTES){response.destroy(new Error("Feed exceeds byte limit"));return;}
      let size=0;const chunks:Buffer[]=[];
      response.on("data",(chunk:Buffer)=>{
        size+=chunk.length;
        if(size>MAX_BYTES){response.destroy(new Error("Feed exceeds byte limit"));return;}
        chunks.push(chunk);
      });
      response.on("end",()=>resolve({status,body:Buffer.concat(chunks).toString("utf8"),etag:e,lastModified:m,url:url.href}));
      response.on("error",reject);
    });
    request.on("timeout",()=>request.destroy(new Error("Feed fetch timed out")));
    request.on("error",reject);
    request.end();
  });
}
