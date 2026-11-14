import {useEffect,useMemo,useState} from "react";
import {api,type EntryMedia,type EntryMediaPage} from "./api.js";
import {cacheImage,cachedImages,deleteCachedImage,isVaultUnlocked,
  type CachedImage} from "./offline-vault.js";

export function safeMediaUrl(raw:string|null|undefined):string|null{
  if(!raw||raw.length>4096)return null;
  try{
    const url=new URL(raw);
    if(!["http:","https:"].includes(url.protocol)||url.username||url.password)return null;
    return url.href;
  }catch{return null;}
}
export function normalizedGallery(items:EntryMedia[],fallback:string|null):EntryMedia[]{
  const seen=new Set<string>();
  const result:EntryMedia[]=[];
  for(const item of items){
    if(!["image","video","audio"].includes(item.kind))continue;
    const url=safeMediaUrl(item.url);
    if(!url||seen.has(url))continue;
    seen.add(url);
    result.push({...item,url});
    if(result.length===32)break;
  }
  if(!result.length){
    const url=safeMediaUrl(fallback);
    if(url)result.push({id:"preview",url,kind:"image",mimeType:null,
      position:0,width:null,height:null});
  }
  return result;
}
type Props={entryId:string;title:string;preview:string|null;
  csrf:string;offline:boolean;userId:string;onError?:(message:string)=>void};
export function MediaGallery({entryId,title,preview,csrf,offline,userId,onError}:Props){
  const [items,setItems]=useState<EntryMedia[]>([]);
  const [loading,setLoading]=useState(false);
  const [current,setCurrent]=useState(0);
  const [zoom,setZoom]=useState(false);
  const [magnified,setMagnified]=useState(false);
  const [failed,setFailed]=useState<string[]>([]);
  const [cachedRows,setCachedRows]=useState<CachedImage[]>([]);
  const [localMedia,setLocalMedia]=useState<EntryMedia[]>([]);
  const [mediaRevision,setMediaRevision]=useState(0);
  const [saving,setSaving]=useState(false);
  const [cacheNotice,setCacheNotice]=useState("");
  useEffect(()=>{
    setItems([]);setCurrent(0);setZoom(false);setMagnified(false);setFailed([]);
    if(offline||!csrf)return;
    let live=true;
    setLoading(true);
    void api<EntryMediaPage>(csrf,"/v1/entries/"+entryId+"/media")
      .then(result=>{if(live)setItems(result.items);})
      .catch(error=>{
        if(live)onError?.(error instanceof Error?error.message:"Nelze načíst média.");
      }).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[entryId,csrf,offline]);
  useEffect(()=>{
    let live=true;
    const urls:string[]=[];
    setCachedRows([]);setLocalMedia([]);setCacheNotice("");
    if(!userId||!isVaultUnlocked(userId))return;
    void cachedImages(userId,entryId).then(images=>{
      if(!live)return;
      setCachedRows(images);
      if(offline)setLocalMedia(images.map(image=>{
        const url=URL.createObjectURL(image.blob);
        urls.push(url);
        return {id:image.id,url,kind:"image" as const,mimeType:image.mimeType,
          position:image.position,width:null,height:null};
      }));
    }).catch(error=>{
      if(live)onError?.(error instanceof Error?error.message:
        "Offline kopie obrázků je poškozená.");
    });
    return()=>{live=false;for(const url of urls)URL.revokeObjectURL(url);};
  },[entryId,userId,offline,mediaRevision]);
  const gallery=useMemo(()=>offline?localMedia:
    normalizedGallery(items,loading?null:preview),
    [offline,localMedia,items,loading,preview]);
  const canSave=!offline&&!!csrf&&!!userId&&isVaultUnlocked(userId);
  async function saveCurrent(){
    if(!active||active.kind!=="image"||!canSave)return;
    setSaving(true);setCacheNotice("");
    try{
      const result=await cacheImage(userId,entryId,active.url,active.position);
      setCacheNotice("Obrázek zašifrován: "+(result.bytes/1048576).toFixed(2)+" MiB.");
      setMediaRevision(value=>value+1);
    }catch(error){
      setCacheNotice((error instanceof Error?error.message:"Uložení obrázku selhalo.")+
        " Zdroj musí povolit CORS stažení.");
    }finally{setSaving(false);}
  }
  async function removeCurrent(){
    if(!active||!userId||!isVaultUnlocked(userId))return;
    const row=offline?cachedRows.find(x=>x.id===active.id):
      cachedRows.find(x=>x.url===active.url);
    if(!row)return;
    setSaving(true);setCacheNotice("");
    try{
      await deleteCachedImage(userId,row.id);
      setCacheNotice("Offline kopie odstraněna.");
      setCurrent(0);setMediaRevision(value=>value+1);
    }catch(error){
      setCacheNotice(error instanceof Error?error.message:"Soubor nelze odstranit.");
    }finally{setSaving(false);}
  }

  const index=Math.min(current,Math.max(gallery.length-1,0));
  const active=gallery[index];
  const available=active&&!failed.includes(active.url);
  const go=(step:number)=>setCurrent(previous=>{
    const length=gallery.length;
    return length?((previous+step)%length+length)%length:0;
  });
  useEffect(()=>{
    if(!zoom)return;
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape"){
        event.preventDefault();event.stopImmediatePropagation();
        setZoom(false);setMagnified(false);
      }else if(event.key==="ArrowLeft"){
        event.preventDefault();event.stopImmediatePropagation();
        go(-1);setMagnified(false);
      }else if(event.key==="ArrowRight"){
        event.preventDefault();event.stopImmediatePropagation();
        go(1);setMagnified(false);
      }
    };
    window.addEventListener("keydown",onKey,true);
    return()=>window.removeEventListener("keydown",onKey,true);
  },[zoom,gallery.length]);
  if(offline&&!gallery.length)return <div className="media-empty" role="status">
    Pro tento příspěvek není uložený žádný offline obrázek. Text zůstává dostupný.
  </div>;
  if(loading)return <div className="media-empty" role="status">Načítám přílohy…</div>;
  if(!gallery.length)return <div className="media-empty">Zdroj nemá obrazové ani zvukové přílohy.</div>;
  return <section className="media-gallery" aria-label={"Média: "+title}>
    <div className="media-stage">
      {available&&active.kind==="image"?<button type="button" className="media-photo"
        onClick={()=>setZoom(true)} aria-label="Zvětšit obrázek">
        <img src={active.url} alt={title+" – obrázek "+(index+1)}
          loading="eager" decoding="async"
          onError={()=>setFailed(previous=>[...previous,active.url])}/>
      </button>:available&&active.kind==="video"?
        <video key={active.id} controls playsInline preload="metadata"
          src={active.url} onError={()=>setFailed(previous=>[...previous,active.url])}>
          Prohlížeč nepodporuje přehrání videa.</video>
        :available&&active.kind==="audio"?
        <div className="media-audio"><span aria-hidden="true">♫</span>
          <audio key={active.id} controls preload="none" src={active.url}
            onError={()=>setFailed(previous=>[...previous,active.url])}>
            Prohlížeč nepodporuje přehrání zvuku.</audio>
        </div>:
        <p className="media-empty">Médium nelze načíst přímo. Otevři soubor na původním serveru.</p>}
      {gallery.length>1?<div className="media-stage-controls">
        <button type="button" onClick={()=>go(-1)} aria-label="Předchozí médium">‹</button>
        <span aria-live="polite">{index+1} / {gallery.length}</span>
        <button type="button" onClick={()=>go(1)} aria-label="Další médium">›</button>
      </div>:null}
    </div>
    <div className="media-toolbar">
      <span>{active.kind==="image"?"Obrázek":active.kind==="video"?"Video":"Audio"}
        {active.width&&active.height?" · "+active.width+" × "+active.height:""}
      </span>
      <a href={active.url} target="_blank" rel="noopener noreferrer">
        {offline?"Otevřít offline kopii":"Otevřít originální soubor"}</a>
      {canSave&&active.kind==="image"&&!cachedRows.some(image=>image.url===active.url)?
        <button type="button" disabled={saving} onClick={()=>void saveCurrent()}>
          {saving?"Ukládám…":"Uložit obrázek offline"}</button>:null}
      {active.kind==="image"&&(offline?
        cachedRows.some(image=>image.id===active.id):
        cachedRows.some(image=>image.url===active.url))?
        <button type="button" disabled={saving} onClick={()=>void removeCurrent()}>
          Odebrat offline kopii</button>:null}
      {active.kind==="image"&&available?<button type="button"
        onClick={()=>setZoom(true)}>Celá obrazovka</button>:null}
    </div>
    {cacheNotice?<p className="media-cache-notice" role="status">{cacheNotice}</p>:null}
    {gallery.length>1?<div className="media-strip" role="group" aria-label="Výběr přílohy">
      {gallery.map((item,i)=><button type="button" key={item.id+"-"+i}
        className={index===i?"selected":""}
        aria-pressed={index===i} title={"Příloha "+(i+1)+": "+item.kind}
        onClick={()=>setCurrent(i)}>
        {item.kind==="image"?<img loading="lazy" decoding="async" src={item.url}
          alt={"Náhled přílohy "+(i+1)}/>:<span>{item.kind==="video"?"▶":"♫"}</span>}
        <small>{i+1}</small>
      </button>)}
    </div>:null}
    {zoom&&active.kind==="image"?<div className="media-lightbox" role="dialog"
      aria-modal="true" aria-label={"Zvětšený obrázek "+(index+1)}
      onClick={()=>{setZoom(false);setMagnified(false);}}>
      <div className="media-lightbox-top" onClick={e=>e.stopPropagation()}>
        <span>{index+1} / {gallery.length}</span>
        <button type="button" onClick={()=>setMagnified(value=>!value)}>
          {magnified?"Přizpůsobit":"Přiblížit 2×"}</button>
        <a href={active.url} target="_blank" rel="noopener noreferrer">Otevřít originál</a>
        <button type="button" aria-label="Zavřít zvětšení"
          onClick={()=>{setZoom(false);setMagnified(false);}}>×</button>
      </div>
      <div className={"media-lightbox-image "+(magnified?"magnified":"")}
        onClick={e=>e.stopPropagation()}>
        <img src={active.url} alt={title} draggable={false}/>
      </div>
      {gallery.length>1?<div className="media-lightbox-navigation"
        onClick={e=>e.stopPropagation()}>
        <button type="button" onClick={()=>{go(-1);setMagnified(false);}}
          aria-label="Předchozí příloha">‹</button>
        <button type="button" onClick={()=>{go(1);setMagnified(false);}}
          aria-label="Další příloha">›</button>
      </div>:null}
    </div>:null}
  </section>;
}
