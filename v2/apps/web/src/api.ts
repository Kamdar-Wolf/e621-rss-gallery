export interface Feed {
  id:string;title:string;display_title:string;url:string;folder_id:string|null;folder_name:string|null;
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
export interface AuthSession { user:{id:string;handle:string};csrf:string }
export async function api<T>(csrfToken:string,path:string,options:RequestInit={}):Promise<T>{
  if(!path.startsWith("/v1/"))throw Error("Invalid API path");
  const headers=new Headers(options.headers);
  if(options.body)headers.set("Content-Type","application/json");
  if(["POST","PUT","PATCH","DELETE"].includes(options.method?.toUpperCase()||"GET") &&
      !path.startsWith("/v1/auth/login"))
    headers.set("X-Kr-Csrf",csrfToken);
  let response:Response;
  try{response=await fetch("/api"+path,{...options,headers,credentials:"same-origin",cache:"no-store"});}
  catch{throw Error("API není dostupné. Zkontroluj místní Docker server.");}
  if(response.status===204)return undefined as T;
  if(!response.ok){
    const error=await response.json().catch(()=>({error:"HTTP "+response.status})) as {error?:string};
    throw Error(error.error||"HTTP "+response.status);
  }
  return await response.json() as T;
}
