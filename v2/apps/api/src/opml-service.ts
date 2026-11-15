import { randomUUID } from "node:crypto";
import type pg from "pg";
import { parseOpml } from "../../worker/src/opml.js";

export type OpmlImportResult = {
  total:number; added:number; alreadySubscribed:number; folders:number;
};

/** Import OPML atomically; no private XML or URLs are written to logs. */
export async function importOpml(pool:pg.Pool, ownerId:string, xml:string):Promise<OpmlImportResult>{
  const subscriptions=parseOpml(xml);
  if(subscriptions.length<1)throw Error("OPML does not contain any valid RSS/Atom sources");
  const client=await pool.connect();
  const folderIds=new Map<string,string>();
  let added=0;
  try{
    await client.query("BEGIN");
    // Prevent two imports from creating duplicate folders for this owner.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["kamdar-opml:"+ownerId]);
    async function folder(name:string,parentId:string|null):Promise<string>{
      const key=(parentId||"root")+"\u0000"+name;
      const known=folderIds.get(key);
      if(known)return known;
      const existing=await client.query<{id:string}>(
        "SELECT id FROM folders WHERE user_id=$1 AND parent_id IS NOT DISTINCT FROM $2::uuid "+
        "AND name=$3 ORDER BY created_at ASC LIMIT 1",[ownerId,parentId,name]);
      let folderId=existing.rows[0]?.id;
      if(!folderId){
        folderId=randomUUID();
        await client.query(
          "INSERT INTO folders(id,user_id,parent_id,name) VALUES($1,$2,$3,$4)",
          [folderId,ownerId,parentId,name]);
      }
      folderIds.set(key,folderId);
      return folderId;
    }
    for(const subscription of subscriptions){
      let parentId:string|null=null;
      for(const name of subscription.folders)parentId=await folder(name,parentId);
      const found=await client.query<{id:string}>(
        "INSERT INTO feeds(id,canonical_url,title,next_poll_at) "+
        "VALUES($1,$2,$3,NOW()) "+
        "ON CONFLICT(canonical_url) DO UPDATE SET title=feeds.title RETURNING id",
        [randomUUID(),subscription.url,subscription.title]);
      const feedId=found.rows[0]?.id;
      if(!feedId)throw Error("Database returned no feed identifier");
      const existing=await client.query<{id:string}>(
        "SELECT id FROM subscriptions WHERE user_id=$1 AND feed_id=$2",
        [ownerId,feedId]);
      if(!existing.rows.length)added++;
      await client.query(
        "INSERT INTO subscriptions(id,user_id,feed_id,folder_id) "+
        "VALUES($1,$2,$3,$4) "+
        "ON CONFLICT(user_id,feed_id) DO UPDATE SET "+
        "folder_id=EXCLUDED.folder_id",
        [randomUUID(),ownerId,feedId,parentId]);
    }
    await client.query("COMMIT");
    return {total:subscriptions.length,added,alreadySubscribed:subscriptions.length-added,
      folders:folderIds.size};
  }catch(error){
    await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}

function escapeXml(value:unknown):string{
  return String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
type FolderRow={id:string;name:string;parent_id:string|null};
type SubscriptionRow={canonical_url:string;name:string;folder_id:string|null};

export async function exportOpml(pool:pg.Pool,ownerId:string):Promise<string>{
  const [fr,sr]=await Promise.all([
    pool.query<FolderRow>(
      "SELECT id,name,parent_id FROM folders WHERE user_id=$1 ORDER BY name,id",[ownerId]),
    pool.query<SubscriptionRow>(
      "SELECT f.canonical_url,COALESCE(s.title_override,f.title) AS name,s.folder_id "+
      "FROM subscriptions s JOIN feeds f ON f.id=s.feed_id WHERE s.user_id=$1 "+
      "ORDER BY name,f.canonical_url",[ownerId])
  ]);
  const byParent=new Map<string,FolderRow[]>();
  const byFolder=new Map<string,SubscriptionRow[]>();
  const folderIds=new Set(fr.rows.map(f=>f.id));
  for(const f of fr.rows){
    const key=f.parent_id&&folderIds.has(f.parent_id)?f.parent_id:"root";
    const current=byParent.get(key)||[];current.push(f);byParent.set(key,current);
  }
  for(const s of sr.rows){
    const key=s.folder_id&&folderIds.has(s.folder_id)?s.folder_id:"root";
    const current=byFolder.get(key)||[];current.push(s);byFolder.set(key,current);
  }
  const lines=[
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head><title>Kamdar Reader – export zdrojů</title></head>',
    '  <body>'
  ];
  const visited=new Set<string>();
  function writeChildren(parentId:string,depth:number):void{
    if(depth>15)throw Error("Folder nesting exceeds OPML export limit");
    for(const f of byParent.get(parentId)||[]){
      if(visited.has(f.id))continue;
      visited.add(f.id);
      const indent="    ".repeat(depth+1);
      lines.push(indent+'<outline text="'+escapeXml(f.name)+'" title="'+escapeXml(f.name)+'">');
      writeChildren(f.id,depth+1);
      lines.push(indent+"</outline>");
    }
    for(const s of byFolder.get(parentId)||[]){
      const indent="    ".repeat(depth+1);
      lines.push(indent+'<outline type="rss" text="'+escapeXml(s.name)+
        '" title="'+escapeXml(s.name)+'" xmlUrl="'+escapeXml(s.canonical_url)+'"/>');
    }
  }
  writeChildren("root",0);
  lines.push("  </body>","</opml>");
  return lines.join("\n")+"\n";
}
