import {lookup as dnsLookup} from "node:dns/promises";
import {request as httpRequest} from "node:http";
import {request as httpsRequest} from "node:https";
import ipaddr from "ipaddr.js";

export type Resolver = (host:string)=>Promise<Array<{address:string;family:number}>>;
export type FeedHttpResponse = {
  status:number; url:string; body:Buffer; headers:Record<string,string>;
};
export class FeedFetchError extends Error {
  constructor(message:string,public readonly code:string,public readonly status?:number){super(message);}
}
const UA="KamdarReader/0.2 (RSS reader; contact https://github.com/Kamdar-Wolf/e621-rss-gallery)";
const maxBytes=4_000_000;
const maxRedirects=4;

export function checkDestination(raw:string):URL {
  let url:URL;
  try{url=new URL(raw);}catch{throw new FeedFetchError("Invalid URL","url");}
  if(!["http:","https:"].includes(url.protocol))throw new FeedFetchError("Only HTTP(S) is supported","scheme");
  if(url.username||url.password)throw new FeedFetchError("URL credentials are forbidden","credentials");
  if(url.port && !((url.protocol==="https:"&&url.port==="443")||(url.protocol==="http:"&&url.port==="80")))
    throw new FeedFetchError("Nonstandard ports are not supported","port");
  const host=url.hostname.toLowerCase().replace(/\.$/,"");
  if(!host||!host.includes(".")||host==="localhost"||
    /\.(?:local|internal|localhost|test|invalid|home|lan)$/i.test(host))
    throw new FeedFetchError("Local or unqualified host is blocked","hostname");
  if(ipaddr.isValid(host))throw new FeedFetchError("Literal IP addresses are not allowed","ip-literal");
  if(host.length>253)throw new FeedFetchError("Hostname too long","hostname");
  url.hash="";
  return url;
}
export function verifyAddresses(addresses:Array<{address:string;family:number}>):Array<{address:string;family:number}>{
  if(addresses.length===0)throw new FeedFetchError("DNS returned no records","dns-empty");
  if(addresses.length>30)throw new FeedFetchError("Too many DNS records","dns-overflow");
  for(const record of addresses){
    if(!ipaddr.isValid(record.address))throw new FeedFetchError("DNS returned invalid IP","dns-ip");
    const ip=ipaddr.process(record.address);
    if(ip.range()!=="unicast")
      throw new FeedFetchError("DNS resolves to private, loopback or reserved address","private-ip");
    // DNS64 well-known NAT64 prefix can carry an embedded private IPv4 target.
    if(ip.kind()==="ipv6"&&ip.match(ipaddr.parse("64:ff9b::"),96))
      throw new FeedFetchError("NAT64 target is not allowed","nat64");
  }
  return addresses;
}
export async function resolvePublicUrl(raw:string,resolver:Resolver=async host=>dnsLookup(host,{all:true,verbatim:true})):Promise<{url:URL;address:string;family:number}>{
  const url=checkDestination(raw);
  const records=verifyAddresses(await resolver(url.hostname));
  // Pin the verified address in the socket lookup to prevent DNS rebinding.
  return {url,address:records[0].address,family:records[0].family};
}
function headerValue(input:string|string[]|number|undefined):string{
  return Array.isArray(input)?input.join(", "):String(input??"");
}
async function oneRequest(target:{url:URL;address:string;family:number},
  conditional:{etag?:string|null;lastModified?:string|null}):Promise<FeedHttpResponse>{
  return new Promise((resolve,reject)=>{
    const url=target.url;
    const headers:Record<string,string>={
      "User-Agent":UA,"Accept":"application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*;q=0.5",
      "Accept-Encoding":"identity"
    };
    if(conditional.etag)headers["If-None-Match"]=conditional.etag.slice(0,500);
    if(conditional.lastModified)headers["If-Modified-Since"]=conditional.lastModified.slice(0,100);
    const req=(url.protocol==="https:"?httpsRequest:httpRequest)(url,{
      method:"GET",headers,timeout:13000,
      lookup:(_host,_options,callback)=>{
        (callback as (err:Error|null,address:string,family:number)=>void)(null,target.address,target.family);
      },
      maxHeaderSize:16384,
      rejectUnauthorized:true
    },res=>{
      const status=res.statusCode||0;
      const h:Record<string,string>={};
      for(const name of ["content-type","content-length","etag","last-modified","location","retry-after","content-encoding"])
        h[name]=headerValue(res.headers[name]);
      if(Number(h["content-length"])>maxBytes && ![301,302,303,307,308,304].includes(status)){
        res.destroy();reject(new FeedFetchError("Feed exceeds size limit","size",status));return;
      }
      const bytes:Buffer[]=[];let total=0;
      res.on("data",(chunk:Buffer)=>{
        total+=chunk.length;
        if(total>maxBytes){
          res.destroy();reject(new FeedFetchError("Feed exceeds size limit","size",status));return;
        }
        bytes.push(chunk);
      });
      res.on("end",()=>resolve({url:url.toString(),status,headers:h,body:Buffer.concat(bytes)}));
      res.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new FeedFetchError("Timeout","timeout")));
    req.on("error",reject);
    req.end();
  });
}

export async function fetchFeed(url:string,conditional:{etag?:string|null;lastModified?:string|null}={},
  resolver?:Resolver):Promise<FeedHttpResponse> {
  let current=url;
  const visited=new Set<string>();
  for(let count=0;count<=maxRedirects;count++){
    const resolved=await resolvePublicUrl(current,resolver);
    const target=resolved.url.toString();
    if(visited.has(target))throw new FeedFetchError("Redirect loop","redirect-loop");
    visited.add(target);
    const response=await oneRequest(resolved,conditional);
    if([301,302,303,307,308].includes(response.status)){
      if(count===maxRedirects)throw new FeedFetchError("Too many redirects","redirect-limit",response.status);
      const location=response.headers.location;
      if(!location)throw new FeedFetchError("Redirect lacks Location","redirect",response.status);
      const next=new URL(location,resolved.url);
      if(resolved.url.protocol==="https:" && next.protocol!=="https:")
        throw new FeedFetchError("HTTPS to HTTP downgrade blocked","downgrade",response.status);
      current=next.toString();
      continue;
    }
    if(response.status===200){
      if(response.headers["content-encoding"] && response.headers["content-encoding"]!=="identity")
        throw new FeedFetchError("Compressed server responses are not yet supported","encoding",response.status);
    }
    return response;
  }
  throw new FeedFetchError("Redirect limit reached","redirect-limit");
}
