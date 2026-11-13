export interface Feed {
  id:string;title:string;display_title:string;url:string;folder_id:string|null;
  last_success_at:string|null;last_error:string|null;next_poll_at:string|null;
  last_checked_at:string|null;last_http_status:number|null;failure_count:number;
}
export interface Entry {
  id:string;feed_id:string;source_url:string;title:string;author:string|null;
  summary:string|null;media_type:string;published_at:string|null;
  created_at:string;thumbnail:string|null;
  read_at:string|null;starred_at:string|null;saved_at:string|null;
}
export interface Cursor { before:string;beforeId:string }
export interface EntryPage { items:Entry[];nextCursor:Cursor|null }
export interface Stats { subscriptions:number;entries:number;unread:number;starred:number;saved:number }
const BASE="http://127.0.0.1:3100";
export async function api<T>(token:string,path:string,options:RequestInit={}):Promise<T>{
  if(!path.startsWith("/v1/"))throw Error("Invalid API path");
  const headers=new Headers(options.headers);
  headers.set("Authorization","Bearer "+token);
  if(options.body)headers.set("Content-Type","application/json");
  let resp:Response;
  try {resp=await fetch(BASE+path,{...options,headers,cache:"no-store"});}
  catch {throw Error("Nelze se připojit k místnímu API na 127.0.0.1:3100.");}
  if(resp.status===204)return undefined as T;
  if(!resp.ok){
    const data=await resp.json().catch(()=>({error:"HTTP "+resp.status})) as {error?:string};
    throw Error(data.error||"HTTP "+resp.status);
  }
  return await resp.json() as T;
}
