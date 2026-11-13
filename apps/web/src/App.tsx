import {useCallback,useEffect,useMemo,useState,type FormEvent} from "react";
import {authenticate,HttpError,loadSession,request,setCsrf,type Entry,type Feed,type Session,type SyncEvent} from "./api";

type Layout="gallery"|"cards"|"list";
type View="all"|"unread"|"starred"|"saved";
type Media="all"|"image"|"article"|"audio"|"video";

function formattedDate(value:string){
  const d=new Date(value);return Number.isNaN(d.getTime())?"Bez data":
    new Intl.DateTimeFormat("cs-CZ",{dateStyle:"medium",timeStyle:"short"}).format(d);
}
function timeAgo(value:string){
  const delta=Math.max(0,Date.now()-new Date(value).getTime());
  if(!Number.isFinite(delta))return "—";
  if(delta<3600000)return Math.max(1,Math.floor(delta/60000))+" min";
  if(delta<86400000)return Math.floor(delta/3600000)+" h";
  if(delta<604800000)return Math.floor(delta/86400000)+" d";
  return new Intl.DateTimeFormat("cs-CZ",{day:"numeric",month:"short"}).format(new Date(value));
}
function useTheme(){
  const [theme,setTheme]=useState<"dark"|"light">(()=>{
    try{return localStorage.getItem("kr-theme")==="light"?"light":"dark";}catch{return "dark";}
  });
  useEffect(()=>{document.documentElement.dataset.theme=theme;try{localStorage.setItem("kr-theme",theme);}catch{/* no storage */}},[theme]);
  return [theme,setTheme] as const;
}
function AuthScreen({onSuccess}:{onSuccess:(s:Session)=>void}){
  const [mode,setMode]=useState<"login"|"bootstrap">("login");
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [token,setToken]=useState("");
  const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function submit(e:FormEvent){
    e.preventDefault();setBusy(true);setError("");
    try{onSuccess(await authenticate(mode,email,password,token));}catch(err){setError(err instanceof Error?err.message:"Přihlášení selhalo");}
    finally{setBusy(false);}
  }
  return <main className="auth-page">
    <form className="auth-card" onSubmit={submit}>
      <div className="auth-logo">K<span>.</span></div>
      <div className="eyebrow">OSOBNÍ RSS PROSTŘEDÍ</div>
      <h1>Kamdar Reader <span>2.0</span></h1>
      <p>Tvůj obsah, tvoje pravidla. Obrázky, články a přehled zdrojů na jednom místě.</p>
      <div className="auth-tabs"><button type="button" className={mode==="login"?"selected":""} onClick={()=>setMode("login")}>Přihlášení</button><button type="button" className={mode==="bootstrap"?"selected":""} onClick={()=>setMode("bootstrap")}>První nastavení</button></div>
      <label>E-mail<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="username"/></label>
      <label>Heslo<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={mode==="bootstrap"?12:1} autoComplete={mode==="login"?"current-password":"new-password"}/></label>
      {mode==="bootstrap"&&<><label>Jednorázový zakládací klíč<input type="password" value={token} onChange={e=>setToken(e.target.value)} required autoComplete="off"/></label><p className="hint">Klíč nastav v soukromém souboru .env jako BOOTSTRAP_TOKEN. Lze vytvořit pouze první účet.</p></>}
      {error&&<p role="alert" className="error">{error}</p>}
      <button className="primary" disabled={busy}>{busy?"Zpracovávám…":mode==="login"?"Přihlásit se":"Vytvořit první účet"}</button>
      <small>Soukromá instance · Synchronizované čtení · Bez externí AI</small>
    </form>
  </main>;
}
export default function App(){
  const [session,setSession]=useState<Session|null>(null);
  const [checking,setChecking]=useState(true);
  const [feeds,setFeeds]=useState<Feed[]>([]);
  const [entries,setEntries]=useState<Entry[]>([]);
  const [cursor,setCursor]=useState<string|null>(null);
  const [media,setMedia]=useState<Media>("all");
  const [view,setView]=useState<View>("all");
  const [feedId,setFeedId]=useState("");
  const [search,setSearch]=useState("");
  const [layout,setLayout]=useState<Layout>("gallery");
  const [selected,setSelected]=useState<string|null>(null);
  const [error,setError]=useState("");const [message,setMessage]=useState("");
  const [loading,setLoading]=useState(false);const [adding,setAdding]=useState(false);
  const [addUrl,setAddUrl]=useState("");const [addName,setAddName]=useState("");
  const [refreshTime,setRefreshTime]=useState("");
  const [showNav,setShowNav]=useState(false);
  const [noteDraft,setNoteDraft]=useState("");const [busyEntry,setBusyEntry]=useState<string|null>(null);
  const [theme,setTheme]=useTheme();

  const loadFeeds=useCallback(async()=>{
    if(!session)return;
    try{const result=await request<{feeds:Feed[]}>("/feeds");setFeeds(result.feeds);}
    catch(e){setError(e instanceof Error?e.message:"Nepodařilo se načíst zdroje");}
  },[session]);
  const loadEntries=useCallback(async(query:{filter?:View;feedId?:string;search?:string;media?:Media;cursor?:string;append?:boolean}={})=>{
    if(!session)return;
    setLoading(true);
    try{
      const p=new URLSearchParams({limit:"100"});
      if(query.feedId)p.set("feedId",query.feedId);
      if(query.filter&&query.filter!=="all")p.set("filter",query.filter);
      if(query.search)p.set("q",query.search);
      if(query.media && query.media!=="all")p.set("media",query.media);
      if(query.cursor)p.set("cursor",query.cursor);
      const result=await request<{entries:Entry[];nextCursor:string|null}>("/entries?"+p.toString());
      setEntries(old=>query.append?[...old,...result.entries.filter(e=>!old.some(previous=>previous.id===e.id))]:result.entries);
      setCursor(result.nextCursor);setError("");
      setRefreshTime(new Intl.DateTimeFormat("cs-CZ",{hour:"2-digit",minute:"2-digit"}).format(new Date()));
    }catch(e){setError(e instanceof Error?e.message:"Nelze načíst příspěvky");}
    finally{setLoading(false);}
  },[session]);

  useEffect(()=>{let live=true;void loadSession().then(s=>{if(live){setSession(s);setChecking(false);}});return()=>{live=false;};},[]);
  useEffect(()=>{if(!session)return;void loadFeeds();},[session,loadFeeds]);
  useEffect(()=>{const id=setTimeout(()=>{void loadEntries({feedId,filter:view,search,media});},search?350:0);return()=>clearTimeout(id);},[feedId,view,search,media,loadEntries]);
  useEffect(()=>{
    if(!session)return;
    let alive=true;let seq=0;
    const poll=async()=>{
      try{
        const res=await request<{events:SyncEvent[];next:number}>("/sync?after="+seq);
        if(!alive)return;
        seq=res.next;
        if(res.events.length){
          const map=new Map(res.events.map(e=>[e.entry_id,e.state]));
          setEntries(rows=>rows.map(row=>{const s=map.get(row.id);return s?{...row,...s}:row;}));
        }
      }catch{/* network temporarily unavailable; retry later */}
    };
    const timer=setInterval(()=>void poll(),5000);
    const reload=setInterval(()=>{void loadFeeds();void loadEntries({feedId,filter:view,search,media});},60000);
    return()=>{alive=false;clearInterval(timer);clearInterval(reload);};
  },[session,loadFeeds,loadEntries,feedId,view,search,media]);
  useEffect(()=>{const current=entries.find(e=>e.id===selected);setNoteDraft(current?.note||"");},[selected]);
  useEffect(()=>{
    function onKey(event:KeyboardEvent){
      if(event.key==="Escape"){setSelected(null);setAdding(false);setShowNav(false);}
      if(event.key==="/"&&!["INPUT","TEXTAREA"].includes((event.target as HTMLElement).tagName)){
        event.preventDefault();document.getElementById("globalSearch")?.focus();
      }
    }
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[]);

  const active=useMemo(()=>entries.find(e=>e.id===selected)||null,[entries,selected]);
  const stat=useMemo(()=>({
    all:entries.length,unread:entries.filter(e=>!e.is_read).length,
    starred:entries.filter(e=>e.is_starred).length,saved:entries.filter(e=>e.is_saved).length,
  }),[entries]);
  async function updateEntry(entry:Entry,delta:Record<string,unknown>){
    setBusyEntry(entry.id);
    try{
      const result=await request<{state:{is_read:boolean;is_starred:boolean;is_saved:boolean;note:string;revision:number}}>(
        "/entries/"+entry.id+"/state",{method:"PATCH",body:JSON.stringify({...delta,expectedRevision:entry.revision})});
      setEntries(old=>old.map(e=>e.id===entry.id?{...e,...result.state}:e));
      if(view==="unread"&&delta.isRead===true)setEntries(rows=>rows.filter(e=>e.id!==entry.id));
    }catch(e){
      setError(e instanceof HttpError&&e.code===409?"Konflikt změn na jiném zařízení. Načítám aktuální stav.":e instanceof Error?e.message:"Uložení se nezdařilo");
      void loadEntries({feedId,filter:view,search,media});
    }finally{setBusyEntry(null);}
  }
  async function addFeed(e:FormEvent){
    e.preventDefault();
    try{
      await request("/feeds",{method:"POST",body:JSON.stringify({url:addUrl,name:addName})});
      setAdding(false);setAddUrl("");setAddName("");setMessage("Zdroj přidán. Worker jej načte při nejbližším průchodu.");
      await loadFeeds();
    }catch(e){setError(e instanceof Error?e.message:"Kanál se nepodařilo přidat");}
  }
  async function uploadOpml(file:File){
    try{
      const text=await file.text();
      const r=await request<{imported:number;skipped:number}>("/feeds/import",{method:"POST",body:JSON.stringify({opml:text})});
      setMessage("Importováno: "+r.imported+" kanálů; přeskočeno: "+r.skipped);
      setAdding(false);await loadFeeds();
    }catch(e){setError(e instanceof Error?e.message:"Import OPML selhal");}
  }
  async function exportOpml(){
    try{
      const response=await fetch("/api/v1/feeds/export",{credentials:"include"});
      if(!response.ok)throw new Error("Export selhal: HTTP "+response.status);
      const url=URL.createObjectURL(await response.blob());
      const a=document.createElement("a");a.href=url;a.download="kamdar-feeds.opml";
      document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(e){setError(e instanceof Error?e.message:"Export se nezdařil");}
  }
  async function logout(){
    try{await request("/auth/logout",{method:"POST"});}catch{/* session may have expired */}
    setCsrf("");setSession(null);setEntries([]);setFeeds([]);
  }
  if(checking)return <main className="auth-page"><div className="splash">Kamdar Reader <span>2.0</span><p>Načítám účet…</p></div></main>;
  if(!session)return <AuthScreen onSuccess={s=>{setSession(s);setError("");}}/>;

  function nav(viewName:View,label:string,icon:string){
    return <button className={"nav-link "+(view===viewName&&!feedId?"active":"")} onClick={()=>{
      setFeedId("");setView(viewName);setShowNav(false);setSelected(null);
    }}><span className="nav-icon">{icon}</span><span>{label}</span><span className="nav-counter">{stat[viewName]}</span></button>;
  }
  return <div className="shell">
    <aside className={"sidebar "+(showNav?"mobile-open":"")}>
      <div className="brand"><div className="logo">K<span>.</span></div><div><strong>Kamdar Reader</strong><small>RSS STUDIO <span>2.0 alpha</span></small></div></div>
      <div className="sidebar-scroll">
        <div className="section-title">KNIHOVNA</div>
        {nav("all","Všechny příspěvky","▦")}
        {nav("unread","Nepřečtené","◌")}
        {nav("starred","Oblíbené","☆")}
        {nav("saved","Číst později","▤")}
        <div className="sidebar-section">
          <div className="section-title">ZDROJE <button className="text-btn" onClick={()=>setAdding(true)} aria-label="Přidat zdroj">＋</button></div>
          {feeds.length===0?<p className="empty-sidebar">Zatím žádné odběry</p>:
            feeds.map(feed=><button key={feed.id} title={feed.url} className={"feed-link "+(feedId===feed.id?"active":"")} onClick={()=>{
              setFeedId(feed.id);setView("all");setSelected(null);setShowNav(false);
            }}><span className="feed-letter">{feed.title.charAt(0).toUpperCase()}</span><span className="feed-name">{feed.title}</span><span className={"feed-health "+(feed.status==="error"?"bad":"")} title={feed.last_error||"Aktualizace"}>{feed.status==="error"?"!":"·"}</span></button>)}
        </div>
      </div>
      <div className="sidebar-bottom"><span className="online-dot"/> <span>Serverová synchronizace</span></div>
    </aside>
    {showNav&&<button className="mobile-backdrop" onClick={()=>setShowNav(false)} aria-label="Zavřít navigaci"/>}
    <section className="main-area">
      <header className="topbar">
        <button className="hamburger icon-control" onClick={()=>setShowNav(v=>!v)} aria-label="Navigace">☰</button>
        <label className="search"><span>⌕</span><input id="globalSearch" placeholder="Hledat v titulcích a obsahu… /" value={search} onChange={e=>setSearch(e.target.value)}/></label>
        <div className="top-buttons"><span className="last-sync">{refreshTime&&"Načteno "+refreshTime}</span>
          <button className="icon-control" aria-label="Obnovit" title="Obnovit" onClick={()=>{void loadFeeds();void loadEntries({feedId,filter:view,search,media});}}>↻</button>
          <button className="primary top-add" onClick={()=>setAdding(true)}>＋ <span>Nový zdroj</span></button>
          <button className="icon-control" title="Přepnout téma" aria-label="Přepnout téma" onClick={()=>setTheme(theme==="dark"?"light":"dark")}>{theme==="dark"?"☾":"☼"}</button>
        </div>
      </header>
      <div className="content">
        <div className="heading"><div><p className="eyebrow">KNIHOVNA RSS</p><h1>{feedId?feeds.find(f=>f.id===feedId)?.title||"Zdroj":({all:"Všechny příspěvky",unread:"Nepřečtené",starred:"Oblíbené",saved:"Číst později"}[view])}</h1>
          <p className="subtitle">{loading?"Aktualizuji příspěvky…":entries.length+" dostupných příspěvků"} · {feeds.length} zdrojů</p></div>
          <div className="head-commands"><span className="kbd-hint">J/K posun · / hledat</span></div>
        </div>
        {(error||message)&&<div className={"banner "+(error?"error-banner":"ok-banner")} role="status">{error||message}<button aria-label="Zavřít zprávu" onClick={()=>{setError("");setMessage("");}}>×</button></div>}
        {feeds.some(f=>f.status==="error")&&<div className="banner warning-banner">Některé kanály se nepodařilo aktualizovat. U zdrojů v nabídce je zobrazena chyba, ostatní kanály pokračují v načítání.</div>}
        <div className="content-tools"><div className="tabs">
          {(["gallery","cards","list"] as Layout[]).map(t=><button key={t} className={layout===t?"active":""} onClick={()=>setLayout(t)}>{t==="gallery"?"▦ Galerie":t==="cards"?"▤ Karty":"≡ Seznam"}</button>)}
        </div><div className="filter-controls"><select className="media-filter" aria-label="Filtrovat typ obsahu" value={media} onChange={e=>setMedia(e.target.value as Media)}><option value="all">Veškerý obsah</option><option value="image">Obrázky</option><option value="article">Články</option><option value="audio">Audio</option><option value="video">Video</option></select><span className="results">{entries.length} položek</span></div></div>
        {!loading&&entries.length===0?<div className="empty-message"><div className="empty-symbol">▧</div><h2>Žádné položky</h2><p>Zkontroluj odběry nebo počkej na první serverové načtení.</p><button className="primary" onClick={()=>setAdding(true)}>Přidat RSS kanál</button></div>:
          <div className={"entries "+layout}>
            {entries.map(entry=><article className={"entry "+(entry.is_read?"read":"")} key={entry.id}>
              <button className="entry-open" onClick={()=>{
                setSelected(entry.id);if(!entry.is_read)void updateEntry(entry,{isRead:true});
              }}>
                <div className="entry-art">{entry.image_url?<img loading="lazy" decoding="async" src={entry.image_url} alt="" onError={e=>{e.currentTarget.style.display="none";}}/>:<span className="entry-placeholder">▧</span>}
                  <span className="type-tag">{entry.media_type==="image"?"OBRÁZEK":entry.media_type==="audio"?"AUDIO":entry.media_type==="video"?"VIDEO":"ČLÁNEK"}</span></div>
                <div className="entry-copy"><span className="entry-feed">{entry.feed_title}</span><h2>{entry.title}</h2>
                  {layout!=="gallery"&&<p>{entry.summary||"Bez dostupného úryvku"}</p>}</div>
              </button>
              <div className="entry-actions"><time title={formattedDate(entry.published_at)}>{timeAgo(entry.published_at)}</time>
                <div><button disabled={busyEntry===entry.id} className={entry.is_starred?"active":""} aria-label="Přepnout oblíbené" onClick={()=>void updateEntry(entry,{isStarred:!entry.is_starred})}>{entry.is_starred?"★":"☆"}</button>
                <button disabled={busyEntry===entry.id} className={entry.is_saved?"active":""} aria-label="Uložit na později" onClick={()=>void updateEntry(entry,{isSaved:!entry.is_saved})}>{entry.is_saved?"▣":"▤"}</button></div>
              </div>
            </article>)}
          </div>}
        {cursor&&<div className="more-area"><button className="secondary" disabled={loading} onClick={()=>void loadEntries({feedId,filter:view,search,media,cursor,append:true})}>{loading?"Načítám…":"Načíst další příspěvky ↓"}</button></div>}
      </div>
    </section>
    {selected&&<><div className="modal-shade" onClick={()=>setSelected(null)}/><aside className="detail">
      <header><button className="icon-control" onClick={()=>setSelected(null)} aria-label="Zavřít detail">×</button><span>{active?.feed_title}</span>
        <div><button disabled={!active||busyEntry===active.id} aria-label="Oblíbené" className="icon-control" onClick={()=>{if(active)void updateEntry(active,{isStarred:!active.is_starred});}}>{active?.is_starred?"★":"☆"}</button>
        <button disabled={!active||busyEntry===active.id} aria-label="Číst později" className="icon-control" onClick={()=>{if(active)void updateEntry(active,{isSaved:!active.is_saved});}}>{active?.is_saved?"▣":"▤"}</button></div></header>
      <div className="detail-scroll">{active&&<>
        <div className="eyebrow">{formattedDate(active.published_at)} · {active.media_type.toUpperCase()}</div><h1>{active.title}</h1>
        {active.image_url&&<div className="detail-media"><img src={active.image_url} alt={active.title}/></div>}
        <p className="detail-text">{active.summary||"Zdroj neposkytuje textový obsah."}</p>
        <label className="note-label">Osobní poznámka<textarea rows={4} value={noteDraft} onChange={e=>setNoteDraft(e.target.value)} placeholder="Poznámka se uloží na serveru…"/></label>
        <div className="detail-controls"><button className="secondary" disabled={busyEntry===active.id} onClick={()=>void updateEntry(active,{note:noteDraft})}>Uložit poznámku</button>
          {active.link&&<a className="primary" href={active.link} target="_blank" rel="noreferrer noopener">Otevřít originál ↗</a>}</div>
      </>}</div>
    </aside></>}
    {adding&&<div className="dialog-backdrop" role="presentation" onMouseDown={()=>setAdding(false)}><div className="dialog" role="dialog" aria-label="Přidat kanál" onMouseDown={e=>e.stopPropagation()}>
      <header><div><span className="eyebrow">SPRÁVA ODBĚRŮ</span><h2>Přidat RSS zdroj</h2></div><button className="icon-control" onClick={()=>setAdding(false)}>×</button></header>
      <div className="import-area"><button className="secondary" onClick={()=>{setAddUrl("https://kamdar-wolf.github.io/e621-rss-gallery/feed.xml");setAddName("e621 – sledovaní autoři");}}>Použít současný e621 kanál</button></div>
      <form onSubmit={e=>void addFeed(e)}><label>URL kanálu<input type="url" placeholder="https://example.com/feed.xml" required value={addUrl} onChange={e=>setAddUrl(e.target.value)}/></label>
        <label>Vlastní název (volitelné)<input value={addName} onChange={e=>setAddName(e.target.value)} placeholder="Například Technologie"/></label>
        <button className="primary" type="submit">Přidat zdroj</button></form>
      <div className="import-area"><h3>Import Inoreader / OPML</h3><p>Hromadně založí odběry. Kanály se potom načítají serverem, takže prohlížeč není omezen politikou CORS.</p>
        <label className="file-upload">Vybrat soubor OPML<input type="file" accept=".xml,.opml" onChange={e=>{const f=e.target.files?.[0];if(f)void uploadOpml(f);}}/></label> <button className="secondary" onClick={()=>void exportOpml()}>Exportovat OPML</button></div>
      <div className="import-area"><h3>Správa e621 značek</h3><p>Původní generátor lze nadále spravovat přes tags.txt, než vznikne editor značek v aplikaci.</p>
        <a href="https://github.com/Kamdar-Wolf/e621-rss-gallery/blob/main/tags.txt" target="_blank" rel="noreferrer">Otevřít seznam značek ↗</a></div>
      <hr/><button className="text-btn" onClick={()=>void logout()}>Odhlásit se z tohoto zařízení</button>
    </div></div>}
  </div>;
}
