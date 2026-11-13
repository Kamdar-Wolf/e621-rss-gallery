import { createHash } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";

export type NormalizedEntry={
  guid:string;title:string;link:string|null;author:string|null;summary:string|null;
  imageUrl:string|null;mediaType:"image"|"article"|"audio"|"video";
  publishedAt:string;
};
export type NormalizedFeed={title:string;description:string;entries:NormalizedEntry[]};

const xmlParser=new XMLParser({
  ignoreAttributes:false,attributeNamePrefix:"@_",trimValues:true,parseTagValue:false,
  parseAttributeValue:false,processEntities:false,removeNSPrefix:false,
});
const arr=(v:unknown):unknown[]=>v===undefined||v===null?[]:Array.isArray(v)?v:[v];
const obj=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==="object"?v as Record<string,unknown>:{};
const str=(v:unknown):string=>{
  if(typeof v==="string")return v;
  if(typeof v==="number")return String(v);
  if(v&&typeof v==="object"){const o=obj(v);return str(o["#text"]||o["__cdata"]||"");}
  return "";
};
const first=(...xs:unknown[])=>xs.map(str).find(s=>s.trim())||"";
const safe=(u:unknown,base?:string):string|null=>{
  if(!u)return null;
  try{const x=new URL(String(u),base);return x.protocol==="https:"||x.protocol==="http:"?x.href:null;}
  catch{return null;}
};
const decodeHtml=(s:string)=>s.replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&apos;/gi,"\'").replace(/&amp;/gi,"&");
const htmlImage=(s:string,base?:string):string|null=>{
  const match=/<img\b[^>]*?\b(?:src|data-src)\s*=\s*["']([^"'<>]+)["']/i.exec(decodeHtml(s));
  return safe(match?.[1],base);
};
const plain=(s:string):string=>s.replace(/<[^>]+>/g," ").replace(/&(?:nbsp|amp|lt|gt|quot);/g," ").replace(/\s+/g," ").trim().slice(0,10000);
const date=(v:unknown)=>{const t=Date.parse(str(v));return Number.isFinite(t)?new Date(t).toISOString():new Date().toISOString();};
function linkFrom(v:unknown,base:string):string|null{
  for(const l of arr(v)){
    if(typeof l==="string")return safe(l,base);
    const x=obj(l);
    if(!x["@_rel"]||x["@_rel"]==="alternate")return safe(x["@_href"]||x["#text"],base);
  }
  return null;
}
function entryFrom(raw:unknown,base:string,atom:boolean):NormalizedEntry{
  const x=obj(raw);
  const link=linkFrom(x.link,base);
  const title=plain(first(x.title))||"Bez názvu";
  const content=first(x["content:encoded"],x.description,x.content,x.summary);
  const summary=plain(content).slice(0,3000)||null;
  const mediaThumb=obj(x["media:thumbnail"]);
  const mediaContent=obj(x["media:content"]);
  const enc=obj(x.enclosure);
  const photo=safe(mediaThumb["@_url"]||mediaContent["@_url"],base)||
    ((str(enc["@_type"]).startsWith("image/"))?safe(enc["@_url"],base):null)||
    htmlImage(content,base);
  const type = str(enc["@_type"]);
  const mediaType:typeOfMedia=type.startsWith("audio/")?"audio":
    type.startsWith("video/")||str(mediaContent["@_medium"])==="video"?"video":
      photo?"image":"article";
  const guid=first(x.guid,x.id,link)||createHash("sha256").update(title+content).digest("hex");
  return {guid:guid.slice(0,1024),title:title.slice(0,1200),link,author:first(obj(x.author).name,x["dc:creator"],x.author)||null,
    summary,imageUrl:photo,mediaType,publishedAt:date(first(x.pubDate,x.published,x.updated,x["dc:date"]))};
}
type typeOfMedia="image"|"article"|"audio"|"video";
export function normalizeFeed(input:string,base:string):NormalizedFeed{
  if(input.length>3_000_000)throw new Error("Feed too large");
  let parsed:unknown;
  if(input.trimStart().startsWith("{")){
    const j=JSON.parse(input) as Record<string,unknown>;
    if(!Array.isArray(j.items))throw new Error("Invalid JSON Feed");
    return {title:first(j.title)||base,description:first(j.description),entries:j.items.slice(0,500).map(raw=>{
      const x=obj(raw);const attachments=arr(x.attachments).map(obj);
      const attachment=attachments[0]||{};
      const kind=str(attachment.mime_type);
      const text=first(x.content_text,x.summary,x.content_html);
      const image=safe(x.image||x.banner_image,base)||htmlImage(str(x.content_html),base);
      return {guid:first(x.id,x.url)||createHash("sha256").update(JSON.stringify(x)).digest("hex"),title:plain(first(x.title))||"Bez názvu",
        link:safe(x.url||x.external_url,base),author:first(obj(x.author).name)||null,
        summary:plain(text).slice(0,3000)||null,imageUrl:image,
        mediaType:kind.startsWith("audio/")?"audio":kind.startsWith("video/")?"video":image?"image":"article",
        publishedAt:date(x.date_published||x.date_modified)};
    })};
  }
  if(XMLValidator.validate(input)!==true)throw new Error("Invalid XML feed");
  parsed=xmlParser.parse(input);
  const root=obj(parsed);
  const atom=obj(root.feed);
  const rss=obj(root.rss);
  const channel=obj(rss.channel||root["rdf:RDF"]);
  if(root.feed){
    return {title:first(atom.title)||base,description:first(atom.subtitle),
      entries:arr(atom.entry).slice(0,500).map(x=>entryFrom(x,base,true))};
  }
  if(root.rss||root["rdf:RDF"]){
    const source=root["rdf:RDF"]?obj(root["rdf:RDF"]):channel;
    const entries=root["rdf:RDF"]?arr(source.item):arr(channel.item);
    const meta=root["rdf:RDF"]?obj(source.channel):channel;
    return {title:first(meta.title)||base,description:first(meta.description),
      entries:entries.slice(0,500).map(x=>entryFrom(x,base,false))};
  }
  throw new Error("Unsupported feed type");
}
