import {XMLParser,XMLValidator} from "fast-xml-parser";
import { decode } from "html-entities";
import {canonicalFeedUrl} from "../../../packages/shared/src/schemas.js";

export type SubscriptionFromOpml = {url:string;title:string;folders:string[]};
const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:"@_",processEntities:false,
  parseTagValue:false,isArray:(tag)=>tag==="outline"});

function record(x:unknown):Record<string,unknown>{
  return x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:{};
}
function arr(x:unknown):unknown[]{return x===null||x===undefined?[]:Array.isArray(x)?x:[x];}
function text(x:unknown):string{return typeof x==="string"?decode(x.trim()):"";}

export function parseOpml(raw:string):SubscriptionFromOpml[]{
  if(Buffer.byteLength(raw,"utf8")>2_000_000)throw Error("OPML exceeds 2MB");
  if(/<!DOCTYPE|<!ENTITY/i.test(raw))throw Error("DOCTYPE/ENTITY not permitted");
  if(XMLValidator.validate(raw)!==true)throw Error("Invalid OPML XML");
  const document=record(parser.parse(raw));
  const root=record(document.opml);
  if(!root.body)throw Error("Missing OPML body");
  const output:SubscriptionFromOpml[]=[];
  const visited=new Set<string>();
  function visit(nodes:unknown[],folders:string[],depth:number){
    if(depth>12)throw Error("OPML nesting too deep");
    for(const item of nodes){
      const o=record(item),rawUrl=text(o["@_xmlUrl"]);
      const label=text(o["@_title"])||text(o["@_text"])||"RSS";
      if(rawUrl){
        let url:string;
        try{url=canonicalFeedUrl(rawUrl);}catch{continue;}
        if(!visited.has(url)){
          output.push({url,title:label.slice(0,200),folders});
          visited.add(url);
          if(output.length>1000)throw Error("OPML source limit exceeded");
        }
      }else if(o.outline){
        visit(arr(o.outline),[...folders,label.slice(0,120)],depth+1);
      }
    }
  }
  visit(arr(record(root.body).outline),[],0);
  return output;
}
