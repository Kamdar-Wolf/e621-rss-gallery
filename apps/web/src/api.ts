export interface User {id:string;email:string}
export interface Session {user:User;csrf:string}
export interface Feed {id:string;url:string;title:string;status:string;last_error:string|null;last_fetched_at:string|null;item_count:number}
export interface Entry {
  id:string;feed_id:string;guid:string;title:string;link:string|null;author:string|null;summary:string|null;
  image_url:string|null;media_type:"image"|"article"|"audio"|"video";published_at:string;feed_title:string;
  is_read:boolean;is_starred:boolean;is_saved:boolean;note:string;revision:number;
}
export interface SyncEvent {id:number;entry_id:string;state:{is_read:boolean;is_starred:boolean;is_saved:boolean;note:string;revision:number}}
let csrf="";
export function setCsrf(value:string){csrf=value;}
export class HttpError extends Error {
  constructor(public code:number,message:string){super(message);}
}
export async function request<T>(path:string,options:RequestInit={}):Promise<T>{
  const headers=new Headers(options.headers);
  if(options.body && !headers.has("Content-Type"))headers.set("Content-Type","application/json");
  if(options.method && !["GET","HEAD"].includes(options.method.toUpperCase()) && csrf)headers.set("X-CSRF-Token",csrf);
  const response=await fetch("/api/v1"+path,{...options,headers,credentials:"include"});
  const data=await response.json().catch(()=>({error:"Server returned an invalid response"})) as Record<string,unknown>;
  if(!response.ok)throw new HttpError(response.status,String(data.error||"HTTP "+response.status));
  return data as T;
}
export async function loadSession():Promise<Session|null>{
  try{const s=await request<Session>("/auth/session");setCsrf(s.csrf);return s;}
  catch{return null;}
}
export async function authenticate(mode:"login"|"bootstrap",email:string,password:string,bootstrapToken:string):Promise<Session>{
  const s=await request<Session>("/auth/"+mode,{method:"POST",body:JSON.stringify({email,password,...(mode==="bootstrap"?{bootstrapToken}:{})})});
  setCsrf(s.csrf);return s;
}
