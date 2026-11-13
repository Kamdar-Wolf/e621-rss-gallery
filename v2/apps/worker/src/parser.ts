import { XMLParser, XMLValidator } from "fast-xml-parser";
import { decode } from "html-entities";

export type MediaType = "image" | "video" | "audio" | "article";
export type NormalizedMedia = {url:string; type:MediaType; mime:string|null; position:number};
export type NormalizedEntry = {
  guid:string; url:string; title:string; author:string|null; summary:string;
  publishedAt:Date|null; updatedAt:Date|null; mediaType:MediaType; media:NormalizedMedia[];
};
export type ParsedFeed = {title:string|null; entries:NormalizedEntry[]};

const parser = new XMLParser({
  ignoreAttributes:false, attributeNamePrefix:"@_", textNodeName:"#text",
  processEntities:false, trimValues:true, removeNSPrefix:false,
  parseTagValue:false, parseAttributeValue:false,
  isArray:(tag)=>["item","entry","link","enclosure","media:thumbnail","media:content","media:group","author","attachment","category"].includes(tag)
});

function arr(x:unknown):unknown[] {return x===undefined||x===null?[]:Array.isArray(x)?x:[x];}
function obj(x:unknown):Record<string,unknown> {return x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:{};}
function val(x:unknown):string {
  if(typeof x==="string"||typeof x==="number")return decode(String(x).trim());
  return val(obj(x)["#text"]);
}
function attr(x:unknown,name:string):string{return val(obj(x)["@_"+name]);}
function httpUrl(raw:string):string {
  try {
    const url=new URL(raw);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return "";
    return url.href;
  }catch{return "";}
}
function htmlToText(input:string):string {
  return decode(input).replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi," ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi," ")
    .replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().slice(0,25000);
}
function dateValue(raw:string):Date|null {
  if(!raw)return null;const d=new Date(raw);return Number.isFinite(d.getTime())?d:null;
}
function addMedia(medias:NormalizedMedia[],raw:string,mime:string|null,type:MediaType) {
  const url=httpUrl(raw);
  if(!url||medias.some(x=>x.url===url)||medias.length>=32)return;
  const suffix=(new URL(url)).pathname.toLowerCase();
  const extType=/\.(?:jpg|jpeg|png|webp|gif|avif)$/.test(suffix)?"image":/\.(?:mp4|webm|m4v)$/.test(suffix)?"video":/\.(?:mp3|m4a|ogg|opus|flac)$/.test(suffix)?"audio":type;
  const byMime=mime?.startsWith("image/")?"image":mime?.startsWith("audio/")?"audio":mime?.startsWith("video/")?"video":extType;
  if(byMime==="article")return;
  medias.push({url,type:byMime,mime,position:medias.length});
}
function mediaFromHtml(media:NormalizedMedia[],html:string){
  html=decode(html);
  const re=/<img\b[^>]*\b(?:src|data-src|data-original)\s*=\s*(['"])(.*?)\1/gi;
  let match:RegExpExecArray|null;
  while((match=re.exec(html))!==null&&media.length<32)
    addMedia(media,decode(match[2]),null,"image");
}
function rssItem(raw:unknown):NormalizedEntry|null {
  const o=obj(raw),title=val(o.title)||"(Bez názvu)";
  const links=arr(o.link);
  const link=httpUrl(links.map(x=>val(x)||attr(x,"href")).find(x=>httpUrl(x))||"");
  const guid=val(o.guid)||link;
  if(!guid)return null;
  const html=val(o["content:encoded"])||val(o.description)||val(o.summary)||"";
  const medias:NormalizedMedia[]=[];
  for(const enclosure of arr(o.enclosure))addMedia(medias,attr(enclosure,"url"),attr(enclosure,"type")||null,"article");
  for(const thumb of arr(o["media:thumbnail"]))addMedia(medias,attr(thumb,"url"),"image/jpeg","image");
  for(const m of arr(o["media:content"]))addMedia(medias,attr(m,"url"),attr(m,"type")||null,attr(m,"medium")==="video"?"video":"image");
  for(const group of arr(o["media:group"])){
    for(const thumb of arr(obj(group)["media:thumbnail"]))addMedia(medias,attr(thumb,"url"),"image/jpeg","image");
    for(const m of arr(obj(group)["media:content"]))addMedia(medias,attr(m,"url"),attr(m,"type")||null,"image");
  }
  mediaFromHtml(medias,html);
  return {guid:guid.slice(0,2048),url:link||httpUrl(guid)||"",title:title.slice(0,2000),author:val(o["dc:creator"]||o.author)||null,
    summary:htmlToText(html),publishedAt:dateValue(val(o.pubDate||o["dc:date"]||o.published)),updatedAt:dateValue(val(o.updated)),
    mediaType:medias[0]?.type||"article",media:medias};
}
function atomLink(links:unknown[],rel:string):string {
  for(const l of links){
    if((attr(l,"rel")||"alternate")===rel){
      const u=httpUrl(attr(l,"href"));if(u)return u;
    }
  }
  return "";
}
function atomEntry(raw:unknown):NormalizedEntry|null {
  const o=obj(raw);
  const links=arr(o.link);
  const link=atomLink(links,"alternate")||atomLink(links,"via");
  const guid=val(o.id)||link;
  if(!guid)return null;
  const title=val(o.title)||"(Bez názvu)";
  const content=val(o.content)||val(o.summary)||"";
  const medias:NormalizedMedia[]=[];
  for(const l of links) if((attr(l,"rel")||"")==="enclosure")
    addMedia(medias,attr(l,"href"),attr(l,"type")||null,"article");
  for(const th of arr(o["media:thumbnail"]))addMedia(medias,attr(th,"url"),"image/jpeg","image");
  for(const m of arr(o["media:content"]))addMedia(medias,attr(m,"url"),attr(m,"type")||null,"image");
  mediaFromHtml(medias,content);
  return {guid:guid.slice(0,2048),url:link||httpUrl(guid)||"",title:title.slice(0,2000),
    author:val(obj(arr(o.author)[0]).name)||null,summary:htmlToText(content),
    publishedAt:dateValue(val(o.published||o.updated)),updatedAt:dateValue(val(o.updated)),
    mediaType:medias[0]?.type||"article",media:medias};
}
function jsonFeed(input:unknown):ParsedFeed {
  const f=obj(input);
  if(!val(f.version).startsWith("https://jsonfeed.org/version/"))throw Error("Not a JSON Feed");
  if(!Array.isArray(f.items))throw Error("JSON Feed lacks items");
  const entries:NormalizedEntry[]=[];
  for(const raw of f.items.slice(0,500)){
    const o=obj(raw),id=val(o.id)||val(o.url),url=httpUrl(val(o.url));
    if(!id)continue;
    const html=val(o.content_html)||val(o.content_text)||val(o.summary);
    const media:NormalizedMedia[]=[];
    for(const attachment of arr(o.attachments)){
      const a=obj(attachment);
      addMedia(media,val(a.url),val(a.mime_type)||null,"article");
    }
    mediaFromHtml(media,html);
    entries.push({guid:id.slice(0,2048),url,title:(val(o.title)||"(Bez názvu)").slice(0,2000),
      author:val(obj(o.author).name)||null,summary:htmlToText(html),
      publishedAt:dateValue(val(o.date_published)),updatedAt:dateValue(val(o.date_modified)),
      mediaType:media[0]?.type||"article",media});
  }
  return {title:val(f.title)||null,entries};
}

export function parseFeed(raw:Buffer|string,contentType=""):ParsedFeed {
  const text=Buffer.isBuffer(raw)?raw.toString("utf8"):raw;
  if(Buffer.byteLength(text)>4_000_000)throw Error("Feed exceeds 4 MB limit");
  if(/<!DOCTYPE|<!ENTITY/i.test(text))throw Error("DTD and entities are not permitted");
  if(contentType.includes("json")||text.trimStart().startsWith("{"))
    return jsonFeed(JSON.parse(text));
  const validation=XMLValidator.validate(text);
  if(validation!==true)throw Error("Malformed feed XML");
  const parsed=obj(parser.parse(text));
  if(parsed.rss){
    const channel=obj(obj(parsed.rss).channel);
    const items=arr(channel.item).slice(0,500);
    return {title:val(channel.title)||null,entries:items.map(rssItem).filter((x):x is NormalizedEntry=>!!x)};
  }
  if(parsed.feed){
    const feed=obj(parsed.feed),entries=arr(feed.entry).slice(0,500);
    return {title:val(feed.title)||null,entries:entries.map(atomEntry).filter((x):x is NormalizedEntry=>!!x)};
  }
  if(parsed["rdf:RDF"]){
    const rdf=obj(parsed["rdf:RDF"]);const ch=obj(rdf.channel);
    return {title:val(ch.title)||null,entries:arr(rdf.item).slice(0,500).map(rssItem).filter((x):x is NormalizedEntry=>!!x)};
  }
  throw Error("Not a recognized RSS/Atom/JSON Feed");
}
