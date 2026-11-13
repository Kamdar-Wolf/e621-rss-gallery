import {useCallback,useEffect,useMemo,useRef,useState, type ChangeEvent, type FormEvent} from "react";
import {api,type Feed,type Entry,type EntryPage,type Cursor,type Stats} from "./api.js";

type FolderView="all"|"unread"|"starred"|"saved";
type Layout="gallery"|"cards"|"list";
const dateFmt=new Intl.DateTimeFormat("cs-CZ",{day:"numeric",month:"short",year:"numeric"});
const emptyStats:Stats={subscriptions:0,entries:0,unread:0,starred:0,saved:0};

function Icon({name}:{name:string}){
  const glyph:Record<string,string>={all:"▦",unread:"◌",starred:"☆",saved:"▤",refresh:"↻",settings:"⚙",rss:"◔",search:"⌕",image:"▧",close:"×"};
  return <span aria-hidden="true" className="icon">{glyph[name]||"•"}</span>;
}
function TileImage({src,alt}:{src:string|null;alt:string}){
  const [error,setError]=useState(false);
  useEffect(()=>setError(false),[src]);
  return <div className="tile-image">
    {src&&!error?<img src={src} alt={alt} loading="lazy" onError={()=>setError(true)}/>:
      <span className="image-placeholder"><Icon name="image"/></span>}
  </div>;
}
function Tile({entry,layout,source,onSelect,onStar,onRead}:{
  entry:Entry;layout:Layout;source:string;
  onSelect:(entry:Entry)=>void;onStar:(entry:Entry)=>void;onRead:(entry:Entry)=>void;
}){
  return <article className={"tile "+layout+(entry.read_at?" read":"")}>
    <button className="tile-open" type="button" onClick={()=>onSelect(entry)}
      aria-label={"Otevřít "+entry.title}>
      <TileImage src={entry.thumbnail} alt={entry.title}/>
      <div className="tile-text">
        <span className="source-label">{source}</span>
        <h3>{entry.title}</h3>
        {layout!=="gallery"&&entry.summary?<p>{entry.summary.slice(0,160)}</p>:null}
      </div>
    </button>
    <div className="tile-bottom">
      <time>{entry.published_at?dateFmt.format(new Date(entry.published_at)):"Bez data"}</time>
      <div className="quick-actions">
        <button title={entry.read_at?"Označit nepřečtené":"Označit přečtené"} onClick={()=>onRead(entry)}>{entry.read_at?"●":"◌"}</button>
        <button className={entry.starred_at?"is-starred":""} title="Oblíbené" onClick={()=>onStar(entry)}>{entry.starred_at?"★":"☆"}</button>
      </div>
    </div>
  </article>;
}

export function App(){
  const [tokenInput,setTokenInput]=useState("");
  const [token,setToken]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [feeds,setFeeds]=useState<Feed[]>([]);
  const [entries,setEntries]=useState<Entry[]>([]);
  const [stats,setStats]=useState<Stats>(emptyStats);
  const [cursor,setCursor]=useState<Cursor|null>(null);
  const [view,setView]=useState<FolderView>("all");
  const [feedId,setFeedId]=useState("");
  const [layout,setLayout]=useState<Layout>("gallery");
  const [media,setMedia]=useState("all");
  const [search,setSearch]=useState("");
  const [remoteResults,setRemoteResults]=useState<Entry[]|null>(null);
  const [remoteCursor,setRemoteCursor]=useState<Cursor|null>(null);
  const [searchBusy,setSearchBusy]=useState(false);
  const [sort,setSort]=useState("newest");
  const [active,setActive]=useState<Entry|null>(null);
  const [newFeed,setNewFeed]=useState("");
  const [newTitle,setNewTitle]=useState("");
  const [adding,setAdding]=useState(false);
  const [mobileNav,setMobileNav]=useState(false);
  const [theme,setTheme]=useState<"dark"|"light">("dark");
  const opmlInput=useRef<HTMLInputElement>(null);
  const [opmlBusy,setOpmlBusy]=useState(false);

  const load=useCallback(async (auth:string,selected:string,loadMore=false,next:Cursor|null=null)=>{
    setError("");setLoading(true);
    try{
      const query=new URLSearchParams({limit:"100"});
      if(selected)query.set("feedId",selected);
      if(loadMore&&next){query.set("before",next.before);query.set("beforeId",next.beforeId);}
      if(loadMore){
        const page=await api<EntryPage>(auth,"/v1/entries?"+query);
        setEntries(previous=>[...previous,...page.items]);setCursor(page.nextCursor);
      }else{
        const [sources,page,summary]=await Promise.all([
          api<{items:Feed[]}>(auth,"/v1/feeds"),
          api<EntryPage>(auth,"/v1/entries?"+query),
          api<Stats>(auth,"/v1/stats")
        ]);
        setFeeds(sources.items);setEntries(page.items);setCursor(page.nextCursor);setStats(summary);
      }
    }catch(e){setError(e instanceof Error?e.message:"Neznámá chyba");}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{if(token)void load(token,feedId);},[token,feedId,load]);

  // Database-wide search, debounced to avoid one request per keystroke.
  useEffect(()=>{
    const query=search.trim();
    if(!token||query.length<2){
      setRemoteResults(null);setRemoteCursor(null);setSearchBusy(false);
      return;
    }
    let cancelled=false;
    setRemoteResults(null);setRemoteCursor(null);setSearchBusy(true);
    const timer=setTimeout(async()=>{
      try{
        const params=new URLSearchParams({q:query,limit:"100"});
        if(feedId)params.set("feedId",feedId);
        const page=await api<EntryPage>(token,"/v1/search?"+params);
        if(!cancelled){setRemoteResults(page.items);setRemoteCursor(page.nextCursor);}
      }catch(error){
        if(!cancelled)setError(error instanceof Error?error.message:"Vyhledávání selhalo");
      }finally{if(!cancelled)setSearchBusy(false);}
    },300);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[search,token,feedId]);

  async function loadMoreSearch(){
    if(!remoteCursor||search.trim().length<2)return;
    setSearchBusy(true);
    try{
      const params=new URLSearchParams({
        q:search.trim(),limit:"100",
        before:remoteCursor.before,beforeId:remoteCursor.beforeId
      });
      if(feedId)params.set("feedId",feedId);
      const page=await api<EntryPage>(token,"/v1/search?"+params);
      setRemoteResults(previous=>[...(previous||[]),...page.items]);
      setRemoteCursor(page.nextCursor);
    }catch(error){setError(error instanceof Error?error.message:"Další výsledky se nenačetly");}
    finally{setSearchBusy(false);}
  }

  const currentEntries=useMemo(()=>{
    const term=search.trim().toLocaleLowerCase("cs");
    let results=(remoteResults||entries).filter(e=>{
      if(view==="unread"&&e.read_at)return false;
      if(view==="starred"&&!e.starred_at)return false;
      if(view==="saved"&&!e.saved_at)return false;
      if(media!=="all"&&e.media_type!==media)return false;
      return remoteResults!==null || !term ||
        (e.title+" "+(e.summary||"")+" "+(e.author||"")).toLocaleLowerCase("cs").includes(term);
    });
    if(sort==="oldest")results=results.sort((a,b)=>+new Date(a.published_at||a.created_at)-+new Date(b.published_at||b.created_at));
    else if(sort==="title")results=results.sort((a,b)=>a.title.localeCompare(b.title,"cs"));
    return results;
  },[entries,remoteResults,view,media,search,sort]);

  const sourceNames=useMemo(()=>Object.fromEntries(feeds.map(f=>[f.id,f.display_title||f.title])),[feeds]);
  const groupedFeeds=useMemo(()=>{
    const groups=new Map<string,Feed[]>();
    for(const feed of feeds){
      const category=feed.folder_name||"Nezařazené";
      const list=groups.get(category)||[];
      list.push(feed);groups.set(category,list);
    }
    return [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0],"cs"));
  },[feeds]);
  const viewName=feedId?(sourceNames[feedId]||"Vybraný zdroj"):
    ({all:"Všechny příspěvky",unread:"Nepřečtené",starred:"Oblíbené",saved:"Číst později"} as Record<FolderView,string>)[view];

  async function login(e:FormEvent){
    e.preventDefault();setError("");setLoading(true);
    try{
      await api<Stats>(tokenInput,"/v1/stats");
      setToken(tokenInput);setTokenInput("");
    }catch(err){setError(err instanceof Error?err.message:"Přístup zamítnut");}
    finally{setLoading(false);}
  }
  function switchView(next:FolderView){setView(next);setFeedId("");setActive(null);setMobileNav(false);}
  async function changeState(entry:Entry,key:"read"|"starred"|"saved"){
    const current=key==="read"?entry.read_at:key==="starred"?entry.starred_at:entry.saved_at;
    const val=!current;
    const next={...entry,[key==="read"?"read_at":key==="starred"?"starred_at":"saved_at"]:val?new Date().toISOString():null};
    setEntries(old=>old.map(e=>e.id===entry.id?next:e));
    setRemoteResults(old=>old?old.map(e=>e.id===entry.id?next:e):old);
    if(active?.id===entry.id)setActive(next);
    try{
      await api(token,"/v1/entries/"+entry.id+"/state",{method:"PATCH",body:JSON.stringify({[key]:val})});
      const summary=await api<Stats>(token,"/v1/stats");
      setStats(summary);
    }catch(e){setError(e instanceof Error?e.message:"Uložení selhalo");void load(token,feedId);}
  }
  async function addSource(e:FormEvent){
    e.preventDefault();setError("");
    try{
      await api(token,"/v1/feeds",{method:"POST",body:JSON.stringify({url:newFeed,title:newTitle||undefined})});
      setNewFeed("");setNewTitle("");setAdding(false);setNotice("Zdroj byl přidán. Obsah se stáhne v nejbližším cyklu workeru.");
      await load(token,feedId);
    }catch(err){setError(err instanceof Error?err.message:"Zdroj nelze přidat");}
  }
  async function importOPMLFile(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];
    event.target.value="";
    if(!file)return;
    if(file.size>190_000){setError("OPML je příliš velké (limit 190 kB).");return;}
    setError("");setNotice("");setOpmlBusy(true);
    try{
      const opml=await file.text();
      const result=await api<{total:number;added:number;alreadySubscribed:number;folders:number}>(
        token,"/v1/opml/import",{method:"POST",body:JSON.stringify({opml})});
      setNotice("Import dokončen: "+result.added+" nových kanálů z "+
        result.total+"; "+result.alreadySubscribed+" již sledovaných. Složky: "+result.folders+".");
      await load(token,feedId);
    }catch(error){
      setError(error instanceof Error?error.message:"Import OPML se nezdařil.");
    }finally{setOpmlBusy(false);}
  }
  async function exportOPMLFile(){
    setError("");setNotice("");setOpmlBusy(true);
    try{
      const result=await api<{xml:string;filename:string}>(token,"/v1/opml/export");
      const blob=new Blob([result.xml],{type:"application/xml;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url;a.download="kamdar-reader.opml";
      document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1000);
      setNotice("OPML exportováno. Ulož soubor bezpečně – může obsahovat soukromé URL.");
    }catch(error){
      setError(error instanceof Error?error.message:"Export OPML se nezdařil.");
    }finally{setOpmlBusy(false);}
  }

  async function refresh(){
    setNotice("");setError("");
    try{
      if(feedId){
        await api(token,"/v1/feeds/"+feedId+"/refresh",{method:"POST"});
        setNotice("Aktualizace kanálu byla zařazena do fronty.");
      }else{
        for(const f of feeds)await api(token,"/v1/feeds/"+f.id+"/refresh",{method:"POST"});
        setNotice("Aktualizace odběrů byly zařazeny do fronty.");
      }
      await load(token,feedId);
    }catch(e){setError(e instanceof Error?e.message:"Aktualizace selhala");}
  }
  async function unsubscribe(feed:Feed){
    if(!window.confirm("Opravdu přestat sledovat „"+feed.display_title+"“?"))return;
    try{
      await api(token,"/v1/feeds/"+feed.id,{method:"DELETE"});
      setNotice("Odběr byl zrušen.");setFeedId("");await load(token,"");
    }catch(e){setError(e instanceof Error?e.message:"Odhlášení selhalo");}
  }
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape"){setActive(null);setAdding(false);setMobileNav(false);}};
    window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);
  },[]);

  if(!token){
    return <main className="login-shell" data-theme={theme}>
      <div className="login-card">
        <div className="logo-symbol">K<span>·</span></div>
        <div className="eyebrow">KAMDAR READER 2.0</div>
        <h1>Vlastní obsah.<br/>Vlastní čtečka.</h1>
        <p>Vývojové rozhraní pro místní server. Prozatím používá jednouživatelský přístupový token, nikoli hotové uživatelské účty.</p>
        <form onSubmit={login}>
          <label htmlFor="dev-token">Přístupový token z místního nastavení API</label>
          <input id="dev-token" type="password" required minLength={32} value={tokenInput}
            onChange={e=>setTokenInput(e.target.value)} placeholder="READER_API_TOKEN" autoComplete="off"/>
          <button className="primary" type="submit" disabled={loading}>{loading?"Ověřuji…":"Otevřít místní knihovnu"}</button>
        </form>
        {error?<div className="alert error" role="alert">{error}</div>:null}
        <small>Token se neukládá do localStorage ani do veřejného zdrojového kódu. API je dostupné pouze na localhostu.</small>
      </div>
    </main>;
  }
  return <div className="shell" data-theme={theme}>
    <aside className={"sidebar "+(mobileNav?"open":"")}>
      <div className="brand"><div className="logo-symbol">K<span>·</span></div>
        <div><strong>Kamdar Reader</strong><small>VERSION 2.0 · DEVELOPMENT</small></div>
        <button className="side-close" title="Zavřít navigaci" onClick={()=>setMobileNav(false)}>×</button>
      </div>
      <section className="side-section">
        <p className="section-label">KNIHOVNA</p>
        {([["all","▦","Všechny příspěvky",stats.entries],["unread","◌","Nepřečtené",stats.unread],
          ["starred","☆","Oblíbené",stats.starred],["saved","▤","Číst později",stats.saved]] as const)
          .map(([key,icon,label,count])=><button key={key} className={"nav-item "+(view===key&&!feedId?"active":"")}
            onClick={()=>switchView(key)}>
            <span className="nav-glyph">{icon}</span><span>{label}</span><b>{count}</b>
          </button>)}
      </section>
      <section className="side-section feeds-section">
        <div className="section-row"><p className="section-label">ZDROJE · {stats.subscriptions}</p>
          <button className="plus" title="Přidat RSS" onClick={()=>setAdding(true)}>+</button></div>
        <div className="opml-actions">
          <button type="button" disabled={opmlBusy} onClick={()=>opmlInput.current?.click()}>
            ↑ Import OPML</button>
          <button type="button" disabled={opmlBusy} onClick={()=>void exportOPMLFile()}>
            ↓ Export OPML</button>
        </div>
        <input ref={opmlInput} className="visually-hidden" type="file" accept=".opml,.xml,application/xml,text/xml"
          aria-label="Vybrat soubor OPML" onChange={event=>void importOPMLFile(event)} />
        {groupedFeeds.map(([folder,list])=><div key={folder}>
          <h3 className="feed-folder-heading">{folder}</h3>
          {list.map(f=><div className={"feed-wrap "+(feedId===f.id?"selected":"")} key={f.id}>
            <button className="feed-item" title={f.last_error||f.url} onClick={()=>{setFeedId(f.id);setView("all");setActive(null);setMobileNav(false);}}>
              <span className="feed-symbol">{f.display_title?.slice(0,1).toUpperCase()||"R"}</span>
              <span className="feed-text">{f.display_title||f.title}</span>
              {f.last_error?<span className="feed-error" title={f.last_error}>!</span>:null}
            </button>
            <button className="feed-delete" title="Odhlásit zdroj" onClick={()=>void unsubscribe(f)}>×</button>
          </div>)}
        </div>)}
        {!feeds.length?<p className="muted-small">Zatím žádné zdroje. Přidej RSS nebo importuj OPML.</p>:null}
      </section>
      <div className="sidebar-bottom"><div className="online-dot"></div>Lokální vývojová instance
        <button title="Odhlásit" onClick={()=>{setToken("");setEntries([]);setFeeds([]);}}>Odhlásit</button>
      </div>
    </aside>
    {mobileNav?<button className="nav-mask" aria-label="Zavřít nabídku" onClick={()=>setMobileNav(false)}/>:null}
    <div className="workspace">
      <header className="topbar">
        <button className="mobile-menu" aria-label="Otevřít navigaci" onClick={()=>setMobileNav(true)}>☰</button>
        <div className="search-field"><Icon name="search"/>
          <input type="search" value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Hledat v načtených příspěvcích…" aria-label="Hledat"/>
        </div>
        <div className="topbar-actions">
          <button className="icon-action" title="Přepnout téma" onClick={()=>setTheme(t=>t==="dark"?"light":"dark")}>◐</button>
          <button className="icon-action" title="Znovu načíst" onClick={()=>void load(token,feedId)}>↻</button>
          <button className="primary compact" onClick={()=>setAdding(true)}>+ <span>Přidat kanál</span></button>
        </div>
      </header>
      <div className="page">
        <div className="page-header">
          <div><div className="eyebrow">MOJE KNIHOVNA / {feedId?"KANÁL":"PŘEHLED"}</div>
            <h1>{viewName}</h1>
            <p>{feedId?feeds.find(f=>f.id===feedId)?.url:"Tvůj obsah, na tvém serveru."}</p></div>
          <button className="subtle" onClick={()=>void refresh()} disabled={loading}>↻ Obnovit zdroje</button>
        </div>
        {error?<div role="alert" className="alert error">{error}</div>:null}
        {notice?<div role="status" className="alert success">{notice}</div>:null}
        <div className="toolbar">
          <div className="layouts">
            {([["gallery","▦","Galerie"],["cards","▤","Karty"],["list","☰","Seznam"]] as const).map(([l,g,label])=>
              <button key={l} title={label} className={layout===l?"active":""} onClick={()=>setLayout(l)}>{g} <span>{label}</span></button>)}
          </div>
          <div className="selectors">
            <select aria-label="Typ obsahu" value={media} onChange={e=>setMedia(e.target.value)}>
              <option value="all">Všechna média</option><option value="image">Obrázky</option>
              <option value="article">Články</option><option value="video">Videa</option>
              <option value="audio">Audio</option>
            </select>
            <select aria-label="Řazení" value={sort} onChange={e=>setSort(e.target.value)}>
              <option value="newest">Nejnovější</option><option value="oldest">Nejstarší</option>
              <option value="title">Podle názvu</option>
            </select>
          </div>
        </div>
        <div className="result-heading">
          <span>{loading||searchBusy?"Načítám…":currentEntries.length+" zobrazených položek"}{
            (search.trim().length>=2?remoteCursor:cursor)?" · další jsou dostupné":""}</span>
          <span>{search.trim().length>=2?"Vyhledávání v databázi":"Vývojová verze · serverová synchronizace"}</span>
        </div>
        <section className={"grid "+layout}>
          {currentEntries.map(e=><Tile key={e.id} entry={e} layout={layout}
            source={sourceNames[e.feed_id]||"RSS zdroj"} onSelect={entry=>{setActive(entry);void changeStateIfUnread(entry);}}
            onStar={entry=>void changeState(entry,"starred")} onRead={entry=>void changeState(entry,"read")}/>)}
        </section>
        {!loading&&!currentEntries.length?<div className="empty-state">
          <span className="empty-glyph">▤</span><h2>Žádné příspěvky k zobrazení</h2>
          <p>Uprav filtr nebo přidej zdroj. RSS worker může potřebovat jeden cyklus ke stažení nového kanálu.</p>
        </div>:null}
        {(search.trim().length>=2?remoteCursor:cursor)?<div className="more">
          <button className="subtle" disabled={loading||searchBusy}
            onClick={()=>search.trim().length>=2?void loadMoreSearch():void load(token,feedId,true,cursor)}>
            {loading||searchBusy?"Načítám…":"Načíst další příspěvky"}</button>
        </div>:null}
      </div>
    </div>
    {active?<div className="reader-mask" onClick={()=>setActive(null)}>
      <aside className="reader" role="dialog" aria-modal="true" aria-label="Detail příspěvku" onClick={e=>e.stopPropagation()}>
        <div className="reader-top"><button aria-label="Zavřít" onClick={()=>setActive(null)}>×</button>
          <span>{sourceNames[active.feed_id]||"RSS zdroj"}</span>
          <button className={active.starred_at?"is-starred":""} onClick={()=>void changeState(active,"starred")}>{active.starred_at?"★":"☆"}</button>
          <button onClick={()=>void changeState(active,"saved")}>{active.saved_at?"▣":"▤"}</button>
        </div>
        <div className="reader-scroll"><div className="eyebrow">{active.published_at?dateFmt.format(new Date(active.published_at)):"Bez data"} · {active.media_type}</div>
          <h2>{active.title}</h2>
          <TileImage src={active.thumbnail} alt={active.title}/>
          {active.author?<p className="author">Autor: {active.author}</p>:null}
          <p className="reader-summary">{active.summary||"Zdroj neposkytuje textový popis příspěvku."}</p>
          {active.source_url?<a className="primary reader-link" href={active.source_url} target="_blank" rel="noopener noreferrer">
            Otevřít původní zdroj ↗</a>:null}
          <p className="reader-footnote">Zobrazený text pochází z RSS. Plný obsah článků a pokročilé poznámky budou doplněny později.</p>
        </div>
      </aside>
    </div>:null}
    {adding?<div className="dialog-mask" onClick={()=>setAdding(false)}>
      <section className="dialog-card" role="dialog" aria-modal="true" aria-label="Přidat RSS kanál" onClick={e=>e.stopPropagation()}>
        <div className="dialog-header"><h2>Přidat RSS kanál</h2><button onClick={()=>setAdding(false)}>×</button></div>
        <form onSubmit={addSource}>
          <label>Adresa RSS nebo Atom<input value={newFeed} type="url" required
            onChange={e=>setNewFeed(e.target.value)} placeholder="https://example.org/rss.xml"/></label>
          <label>Název (nepovinné)<input value={newTitle} onChange={e=>setNewTitle(e.target.value)} placeholder="Můj nový kanál"/></label>
          <p>Server kanál bezpečně prověří a načte při dalším cyklu. Zdrojům se zakázaným přístupem zobrazíme konkrétní chybu.</p>
          <button className="primary" type="submit">Uložit kanál</button>
        </form>
      </section>
    </div>:null}
  </div>;

  async function changeStateIfUnread(entry:Entry){
    if(!entry.read_at)await changeState(entry,"read");
  }
}
