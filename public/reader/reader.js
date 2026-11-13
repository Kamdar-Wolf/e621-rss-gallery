/* Kamdar Reader 0.1 — client-side RSS/PWA reader.
   State is stored only in this browser. Cross-device sync requires a backend. */
"use strict";
const $ = id => document.getElementById(id);
const CONFIG_KEY = "kamdar-reader-state-v1";
const PRIMARY = {id:"e621-main",name:"e621 – sledovaní autoři",group:"Obrázky",url:"../feed.xml",core:true};
const PREF = {theme:"dark",layout:"gallery",autoRead:true,blocked:"",highlight:""};
const now = () => Date.now();
const state = restore();
let sources = [PRIMARY, ...state.feeds];
let articleMap = new Map();
let feedStatus = new Map();
let section = state.section || "all";
let selectedFeed = state.selectedFeed || "";
let visibleLimit = 36;
let focused = 0;
let activeId = "";
let currentList = [];
let toastTimer = null;

function restore(){
  try {
    const v=JSON.parse(localStorage.getItem(CONFIG_KEY)||"{}");
    return {settings:{...PREF,...(v.settings||{})},marks:v.marks&&typeof v.marks==="object"?v.marks:{},
      feeds:Array.isArray(v.feeds)?v.feeds.filter(f=>f&&typeof f.url==="string").slice(0,300):[],
      section:typeof v.section==="string"?v.section:"all",
      selectedFeed:typeof v.selectedFeed==="string"?v.selectedFeed:""};
  }catch{return {settings:{...PREF},marks:{},feeds:[],section:"all",selectedFeed:""};}
}
function persist(){
  state.feeds=sources.filter(f=>!f.core);
  state.section=section; state.selectedFeed=selectedFeed;
  try{localStorage.setItem(CONFIG_KEY,JSON.stringify(state));}catch{toast("Místní úložiště je plné nebo nedostupné.");}
}
function toast(msg){
  const node=$("toast");node.textContent=msg;node.classList.add("show");
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove("show"),3900);
}
function elem(tag,cls,text){
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!==undefined)e.textContent=text;
  return e;
}
function httpUrl(text){
  try{
    const u=new URL(text,location.href);
    return u.protocol==="https:"||u.protocol==="http:"?u.href:"";
  }catch{return "";}
}
function fmtDate(ts){
  if(!ts||!Number.isFinite(ts))return "Bez data";
  return new Intl.DateTimeFormat("cs-CZ",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(new Date(ts));
}
function relativeDate(ts){
  if(!ts)return "Bez data";
  const delta=Math.max(0,now()-ts);
  if(delta<3600000)return Math.max(1,Math.floor(delta/60000))+" min";
  if(delta<86400000)return Math.floor(delta/3600000)+" h";
  if(delta<604800000)return Math.floor(delta/86400000)+" d";
  return fmtDate(ts);
}
function textValue(node,tag){
  const direct=Array.from(node.children).find(c=>c.localName.toLowerCase()===tag.toLowerCase());
  return direct?direct.textContent.trim():"";
}
function elementByName(node,name){
  return Array.from(node.children).find(c=>c.localName.toLowerCase()===name.toLowerCase())||null;
}
function htmlText(html){
  const doc=new DOMParser().parseFromString(html||"","text/html");
  return (doc.body.textContent||"").replace(/\s+/g," ").trim();
}
function imageFromDescription(html){
  const doc=new DOMParser().parseFromString(html||"","text/html");
  for(const i of doc.querySelectorAll("img")){
    const u=httpUrl(i.getAttribute("src")||i.getAttribute("data-src")||"");
    if(u)return u;
  }return "";
}
function imageFromEntry(item){
  const nodes=Array.from(item.children);
  for(const local of ["thumbnail","content"]){
    for(const n of nodes){
      if(n.localName.toLowerCase()===local&&n.namespaceURI==="http://search.yahoo.com/mrss/"){
        const u=httpUrl(n.getAttribute("url")||"");
        if(u)return u;
      }
    }
  }
  for(const n of nodes){
    if(n.localName.toLowerCase()==="enclosure"&&(n.getAttribute("type")||"").startsWith("image/")){
      const u=httpUrl(n.getAttribute("url")||"");if(u)return u;
    }
  }
  for(const tag of ["description","encoded","content","summary"]){
    const child=elementByName(item,tag);
    const u=imageFromDescription(child?.textContent||"");
    if(u)return u;
  }return "";
}
function entryLink(item){
  for(const n of Array.from(item.children)){
    if(n.localName.toLowerCase()==="link"){
      const href=n.getAttribute("href");
      if(href&&(n.getAttribute("rel")||"alternate")==="alternate")return httpUrl(href);
      if(n.textContent.trim())return httpUrl(n.textContent.trim());
    }
  }return "";
}
function feedData(xml,source){
  const doc=new DOMParser().parseFromString(xml,"application/xml");
  if(doc.querySelector("parsererror"))throw Error("Server vrátil neplatné XML");
  const root=doc.documentElement;
  const atom=root.localName.toLowerCase()==="feed";
  const items=atom?Array.from(root.children).filter(n=>n.localName.toLowerCase()==="entry"):
    Array.from(doc.getElementsByTagName("item"));
  if(items.length===0)throw Error("Kanál neobsahuje žádné příspěvky");
  return items.slice(0,300).map((node,index)=>{
    const title=textValue(node,"title")||"Bez názvu";
    const link=entryLink(node);
    const rawId=textValue(node,"guid")||textValue(node,"id")||link||String(index);
    const desc=textValue(node,"encoded")||textValue(node,"content")||
      textValue(node,"description")||textValue(node,"summary")||"";
    const date=textValue(node,"pubDate")||textValue(node,"published")||
      textValue(node,"updated")||"";
    const when=Date.parse(date)||0;
    const image=imageFromEntry(node);
    const enclosure=Array.from(node.children).find(n=>n.localName.toLowerCase()==="enclosure");
    const enclosureType=enclosure?.getAttribute("type")||"";
    const mediaNodes=Array.from(node.children).filter(n=>n.localName.toLowerCase()==="content"&&n.namespaceURI==="http://search.yahoo.com/mrss/");
    let type=image?"image":"article";
    if(enclosureType.startsWith("audio/"))type="audio";
    else if(enclosureType.startsWith("video/")||mediaNodes.some(n=>(n.getAttribute("medium")||"")==="video"))type="video";
    return {id:source.id+":"+rawId,sourceId:source.id,source:source.name,group:source.group||"",title,
      link,image,description:htmlText(desc).slice(0,3500),date:when,type,
      mediaUrl:httpUrl(enclosure?.getAttribute("url")||"")};
  });
}
function uniqueArticles(){
  const out=[];
  const seen=new Set();
  for(const items of articleMap.values()){
    for(const a of items){
      if(seen.has(a.id))continue;
      seen.add(a.id);out.push(a);
    }
  }return out;
}
function mark(id){return state.marks[id]||{};}
function setMark(id,partial){
  state.marks[id]={...mark(id),...partial};
  persist();render();
  if(activeId===id)refreshReaderButtons();
}
function applyTheme(){
  let t=state.settings.theme;
  if(t==="system")t=matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light";
  document.body.dataset.theme=t;
  document.querySelector('meta[name="theme-color"]').setAttribute("content",t==="dark"?"#111827":"#f6f8fb");
}
async function loadFeed(source,force=false){
  if(!force&&articleMap.has(source.id))return;
  feedStatus.set(source.id,{loading:true});render();
  try{
    const url=source.core?new URL("../feed.xml",location.href):new URL(source.url);
    if(force)url.searchParams.set("_fresh",String(now()));
    const res=await fetch(url.toString(),{cache:force?"no-store":"default"});
    if(!res.ok)throw Error("HTTP "+res.status);
    const parsed=feedData(await res.text(),source);
    articleMap.set(source.id,parsed);
    feedStatus.set(source.id,{ok:true,count:parsed.length,time:now()});
    if(source.core)$("lastSync").textContent="RSS načteno "+new Intl.DateTimeFormat("cs-CZ",{hour:"2-digit",minute:"2-digit"}).format(new Date());
  }catch(e){
    feedStatus.set(source.id,{error:e.message||"Nepodařilo se načíst"});
    if(!source.core)toast("Zdroj „"+source.name+"“ se nenačetl. Může blokovat CORS.");
    else toast("Chyba načítání hlavního RSS: "+e.message);
  }
  render();
}
function allFiltered(){
  let data=uniqueArticles();
  if(section==="feed"&&selectedFeed)data=data.filter(a=>a.sourceId===selectedFeed);
  if(section==="unread")data=data.filter(a=>!mark(a.id).read);
  if(section==="starred")data=data.filter(a=>mark(a.id).star);
  if(section==="saved")data=data.filter(a=>mark(a.id).saved);
  const q=$("searchInput").value.trim().toLocaleLowerCase("cs-CZ");
  if(q)data=data.filter(a=>(a.title+" "+a.description+" "+a.source+" "+(mark(a.id).tags||"")).toLocaleLowerCase("cs-CZ").includes(q));
  const type=$("mediaFilter").value;
  if(type!=="all")data=data.filter(a=>a.type===type);
  const blocked=state.settings.blocked.split(/\r?\n/).map(s=>s.trim().toLocaleLowerCase("cs-CZ")).filter(Boolean);
  if(blocked.length)data=data.filter(a=>!blocked.some(s=>(a.title+" "+a.description).toLocaleLowerCase("cs-CZ").includes(s)));
  const sort=$("sortSelect").value;
  data.sort((a,b)=>sort==="oldest"?a.date-b.date:sort==="title"?a.title.localeCompare(b.title,"cs"):b.date-a.date);
  return data;
}
function applyHighlight(target,text){
  const words=state.settings.highlight.split(/\r?\n/).map(v=>v.trim()).filter(Boolean).sort((a,b)=>b.length-a.length);
  if(!words.length){target.textContent=text;return;}
  const lower=text.toLocaleLowerCase("cs-CZ");let cursor=0;
  while(cursor<text.length){
    let best=-1,word="";
    for(const w of words){
      const i=lower.indexOf(w.toLocaleLowerCase("cs-CZ"),cursor);
      if(i!==-1&&(best===-1||i<best)){best=i;word=w;}
    }
    if(best===-1){target.append(document.createTextNode(text.slice(cursor)));break;}
    if(best>cursor)target.append(document.createTextNode(text.slice(cursor,best)));
    const m=document.createElement("mark");m.textContent=text.slice(best,best+word.length);target.append(m);
    cursor=best+word.length;
  }
}
function renderCard(a){
  const m=mark(a.id),card=elem("article","entry-card"+(m.read?" is-read":""));
  card.dataset.id=a.id;
  const opener=elem("button","entry-open");opener.type="button";opener.setAttribute("aria-label","Otevřít: "+a.title);
  const media=elem("div","entry-img"+(!a.image?" placeholder":""));
  if(a.image){
    const image=elem("img");image.src=a.image;image.loading="lazy";image.decoding="async";image.alt=a.title;
    image.addEventListener("error",()=>{image.remove();media.classList.add("placeholder");media.append(elem("span","image-fallback","▧"));});
    media.append(image);
  }else media.append(elem("span","image-fallback",a.type==="audio"?"♫":a.type==="video"?"▷":"▤"));
  media.append(elem("span","entry-type",a.type==="image"?"OBRÁZEK":a.type==="audio"?"AUDIO":a.type==="video"?"VIDEO":"ČLÁNEK"));
  const content=elem("div","entry-content");
  content.append(elem("div","entry-source",a.source));
  const title=elem("h2","entry-title");applyHighlight(title,a.title);content.append(title);
  if(a.description&&state.settings.layout!=="gallery"){
    const d=elem("p","entry-excerpt");d.textContent=a.description.slice(0,180);content.append(d);
  }
  opener.append(media,content);opener.addEventListener("click",()=>openReader(a.id));
  const footer=elem("footer","entry-footer");
  footer.append(elem("time","entry-date",relativeDate(a.date)));
  const quick=elem("div","entry-quick");
  for(const [prop,icon,titleText] of [["star",m.star?"★":"☆","Oblíbené"],["saved",m.saved?"▣":"▤","Uložit na později"]]){
    const b=elem("button",m[prop]?"on":"",icon);b.type="button";b.title=titleText;b.setAttribute("aria-label",titleText);
    b.addEventListener("click",()=>setMark(a.id,{[prop]:!mark(a.id)[prop]}));quick.append(b);
  }
  footer.append(quick);card.append(opener,footer);return card;
}
function renderFeedTree(){
  const root=$("feedTree");root.replaceChildren();
  let prev="";
  const feeds=[PRIMARY,...sources.filter(f=>!f.core).sort((a,b)=>(a.group||"").localeCompare(b.group||"","cs"))];
  for(const f of feeds){
    const group=f.group||"Bez složky";
    if(group!==prev){root.append(elem("div","feed-category",group));prev=group;}
    const b=elem("button","feed-item"+(section==="feed"&&selectedFeed===f.id?" selected":""));
    const icon=elem("span","feed-icon",f.core?"e":f.name.slice(0,1).toUpperCase());
    const name=elem("span","feed-name",f.name);name.title=f.url;
    const stat=feedStatus.get(f.id),count=elem("span","feed-count",stat?.loading?"…":stat?.error?"!":String(articleMap.get(f.id)?.length||""));
    b.append(icon,name,count);b.title=stat?.error?stat.error:f.url;
    b.addEventListener("click",()=>selectSource(f));root.append(b);
  }
}
function render(){
  applyTheme();
  const entries=allFiltered();currentList=entries;
  const count=uniqueArticles().length;
  $("allCount").textContent=String(count);
  $("unreadCount").textContent=String(uniqueArticles().filter(a=>!mark(a.id).read).length);
  $("starCount").textContent=String(uniqueArticles().filter(a=>mark(a.id).star).length);
  $("savedCount").textContent=String(uniqueArticles().filter(a=>mark(a.id).saved).length);
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("selected",b.dataset.section===section));
  renderFeedTree();
  const selected=sources.find(f=>f.id===selectedFeed);
  const titles={all:"Všechny příspěvky",unread:"Nepřečtené",starred:"Oblíbené",saved:"Číst později",feed:selected?.name||"Zdroj"};
  $("viewTitle").textContent=titles[section]||titles.all;
  $("viewSubtitle").textContent=section==="feed"?(selected?.url||""):count+" načtených položek • místní knihovna";
  $("eyebrow").textContent=section==="feed"?"VYBRANÝ KANÁL":"OSOBNÍ PŘEHLED";
  $("resultsCount").textContent=entries.length+" příspěvků odpovídá filtrům";
  const alerts=[...feedStatus.entries()].filter(([id,status])=>status.error);
  $("feedAlert").textContent=alerts.length?alerts.length+" zdroj(ů) nelze načíst; zkus otevřít konkrétní zdroj":"";
  const list=$("items");list.className="entries "+state.settings.layout;list.replaceChildren();
  for(const a of entries.slice(0,visibleLimit))list.append(renderCard(a));
  $("loadMore").hidden=visibleLimit>=entries.length;
  $("emptyState").hidden=entries.length!==0;
  $("emptyDescription").textContent=feedStatus.get(PRIMARY.id)?.loading?"Načítám hlavní RSS…":
    "Zkus změnit filtr nebo načíst jiný zdroj. Externí zdroje mohou být blokované CORS.";
  document.querySelectorAll("[data-layout]").forEach(b=>b.classList.toggle("active",b.dataset.layout===state.settings.layout));
}
function openReader(id){
  const a=uniqueArticles().find(x=>x.id===id);if(!a)return;
  activeId=id;
  if(state.settings.autoRead)setMark(id,{read:true});
  $("readerOrigin").textContent=a.source;
  $("readerDate").textContent=fmtDate(a.date)+" • "+({image:"Obrázek",article:"Článek",audio:"Audio",video:"Video"}[a.type]||"RSS");
  $("readerTitle").textContent=a.title;
  $("readerBody").textContent=a.description;
  const img=$("readerImage");
  $("readerImageWrap").hidden=!a.image;
  if(a.image){img.src=a.image;img.alt=a.title;img.onerror=()=>{$("readerImageWrap").hidden=true;};}
  else img.removeAttribute("src");
  $("readerNote").value=mark(id).note||"";
  $("readerLabels").value=mark(id).tags||"";
  const link=$("readerOriginal");link.href=a.link||"#";link.hidden=!a.link;
  refreshReaderButtons();
  $("readerOverlay").hidden=false;$("readerPanel").classList.add("open");
  $("readerPanel").setAttribute("aria-hidden","false");
  document.body.style.overflow="hidden";
}
function refreshReaderButtons(){
  const m=mark(activeId);
  $("readerStar").textContent=m.star?"★":"☆";$("readerStar").classList.toggle("on",!!m.star);
  $("readerSave").textContent=m.saved?"▣":"▤";$("readerSave").classList.toggle("on",!!m.saved);
  $("readerRead").textContent=m.read?"●":"◌";$("readerRead").classList.toggle("on",!!m.read);
}
function closeReader(){
  $("readerPanel").classList.remove("open");$("readerPanel").setAttribute("aria-hidden","true");
  $("readerOverlay").hidden=true;document.body.style.overflow="";activeId="";
}
function selectSource(f){
  section="feed";selectedFeed=f.id;visibleLimit=36;persist();closeMobileSidebar();
  $("searchInput").value="";$("mediaFilter").value="all";render();loadFeed(f);
}
function selectSection(s){section=s;selectedFeed="";visibleLimit=36;persist();closeMobileSidebar();render();}
function closeMobileSidebar(){$("sidebar").classList.remove("open");$("sidebarMask").classList.remove("open");}
function download(text,filename,mime){
  const blob=new Blob([text],{type:mime}),url=URL.createObjectURL(blob);
  const a=elem("a");a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function xmlEscape(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
function exportOPML(){
  const byGroup=new Map();
  for(const f of sources){const key=f.group||"Ostatní";if(!byGroup.has(key))byGroup.set(key,[]);byGroup.get(key).push(f);}
  let xml='<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0"><head><title>Kamdar Reader</title></head><body>\n';
  for(const [group,items] of byGroup){
    xml+='  <outline text="'+xmlEscape(group)+'" title="'+xmlEscape(group)+'">\n';
    for(const f of items)xml+='    <outline type="rss" text="'+xmlEscape(f.name)+'" title="'+xmlEscape(f.name)+'" xmlUrl="'+xmlEscape(f.core?new URL("../feed.xml",location.href).href:f.url)+'"/>\n';
    xml+='  </outline>\n';
  }
  xml+='</body></opml>';
  download(xml,"kamdar-reader-feeds.opml","application/xml;charset=utf-8");
}
function feedId(url){
  let hash=0;for(let i=0;i<url.length;i++)hash=((hash<<5)-hash+url.charCodeAt(i))|0;
  return "external-"+(hash>>>0).toString(36);
}
function addSource(url,name,group,quiet=false){
  const clean=httpUrl(url);
  if(!clean)return false;
  if(sources.some(f=>f.url===clean))return false;
  const f={id:feedId(clean),url:clean,name:(name||new URL(clean).hostname).slice(0,120),group:(group||"Ostatní").slice(0,90)};
  sources.push(f);persist();renderFeedTree();
  if(!quiet)toast("Zdroj uložen. Načtení závisí na přístupu serveru (CORS).");
  return true;
}
async function importOPML(file){
  try{
    const doc=new DOMParser().parseFromString(await file.text(),"application/xml");
    if(doc.querySelector("parsererror"))throw Error("Neplatný soubor XML");
    const body=Array.from(doc.documentElement.children).find(n=>n.localName==="body");
    if(!body)throw Error("Chybí sekce OPML body");
    let added=0;
    function walk(parent,group){
      for(const node of Array.from(parent.children)){
        if(node.localName!=="outline")continue;
        const url=node.getAttribute("xmlUrl");
        const label=node.getAttribute("title")||node.getAttribute("text")||"RSS";
        if(url){if(addSource(url,label,group||"Importované",true))added++;}
        else walk(node,label);
      }
    }
    walk(body,"");
    toast("Importováno "+added+" nových zdrojů. Externí zdroje se načítají při výběru.");
    render();
  }catch(e){toast("OPML import selhal: "+e.message);}
}
function saveSettings(){
  state.settings.theme=$("themeSelect").value;
  state.settings.autoRead=$("autoReadSelect").value==="yes";
  state.settings.layout=$("defaultLayout").value;
  state.settings.blocked=$("blockedWords").value;
  state.settings.highlight=$("highlightWords").value;
  persist();$("settingsDialog").close();render();toast("Nastavení uloženo.");
}
function openSettings(){
  $("themeSelect").value=state.settings.theme;
  $("autoReadSelect").value=state.settings.autoRead?"yes":"no";
  $("defaultLayout").value=state.settings.layout;
  $("blockedWords").value=state.settings.blocked;
  $("highlightWords").value=state.settings.highlight;
  $("settingsDialog").showModal();
}
function openFeedDialog(){$("feedDialog").showModal();}
function exportBackup(){
  download(JSON.stringify({...state,exportedAt:new Date().toISOString()},null,2),"kamdar-reader-zaloha.json","application/json");
}
async function importBackup(file){
  try{
    const data=JSON.parse(await file.text());
    if(!data||!data.settings||typeof data.marks!=="object"||!Array.isArray(data.feeds))throw Error("Nesprávný formát zálohy");
    state.settings={...PREF,...data.settings};state.marks=data.marks;state.feeds=data.feeds.filter(f=>f&&httpUrl(f.url)).slice(0,300);
    sources=[PRIMARY,...state.feeds];section="all";selectedFeed="";persist();applyTheme();render();
    toast("Záloha obnovena. Seznam zdrojů a stav článků byly načteny.");
  }catch(e){toast("Import zálohy selhal: "+e.message);}
}
function wire(){
  document.querySelectorAll("[data-section]").forEach(b=>b.addEventListener("click",()=>selectSection(b.dataset.section)));
  document.querySelectorAll("[data-layout]").forEach(b=>b.addEventListener("click",()=>{
    state.settings.layout=b.dataset.layout;persist();render();
  }));
  $("searchInput").addEventListener("input",()=>{visibleLimit=36;render();});
  $("mediaFilter").addEventListener("change",()=>{visibleLimit=36;render();});
  $("sortSelect").addEventListener("change",render);
  $("refreshButton").addEventListener("click",()=>{
    const f=section==="feed"?sources.find(f=>f.id===selectedFeed):PRIMARY;
    if(f)loadFeed(f,true);
  });
  $("markAllRead").addEventListener("click",()=>{
    const ids=allFiltered().map(a=>a.id);
    for(const id of ids)state.marks[id]={...mark(id),read:true};
    persist();render();toast("Označeno jako přečtené: "+ids.length);
  });
  $("loadMore").addEventListener("click",()=>{visibleLimit+=36;render();});
  $("clearFilters").addEventListener("click",()=>{
    $("searchInput").value="";$("mediaFilter").value="all";section="all";selectedFeed="";render();
  });
  $("settingsOpen").addEventListener("click",openSettings);
  $("settingsTop").addEventListener("click",openSettings);
  $("settingsSave").addEventListener("click",saveSettings);
  $("openAddFeed").addEventListener("click",openFeedDialog);
  $("addFeedSidebar").addEventListener("click",openFeedDialog);
  $("feedAddConfirm").addEventListener("click",()=>{
    if(addSource($("newFeedUrl").value,$("newFeedName").value,$("newFeedGroup").value)){
      $("feedDialog").close();$("newFeedUrl").value="";$("newFeedName").value="";$("newFeedGroup").value="";
    }else toast("Zkontroluj adresu nebo duplicitu kanálu.");
  });
  $("importOPML").addEventListener("click",()=>$("opmlFile").click());
  $("feedImportOPML").addEventListener("click",()=>$("opmlFile").click());
  $("opmlFile").addEventListener("change",async e=>{if(e.target.files[0])await importOPML(e.target.files[0]);e.target.value="";});
  $("exportOPML").addEventListener("click",exportOPML);
  $("exportBackup").addEventListener("click",exportBackup);
  $("importBackup").addEventListener("click",()=>$("backupFile").click());
  $("backupFile").addEventListener("change",async e=>{if(e.target.files[0])await importBackup(e.target.files[0]);e.target.value="";});
  $("readerClose").addEventListener("click",closeReader);
  $("readerOverlay").addEventListener("click",closeReader);
  $("readerStar").addEventListener("click",()=>{if(activeId)setMark(activeId,{star:!mark(activeId).star});});
  $("readerSave").addEventListener("click",()=>{if(activeId)setMark(activeId,{saved:!mark(activeId).saved});});
  $("readerRead").addEventListener("click",()=>{if(activeId)setMark(activeId,{read:!mark(activeId).read});});
  $("readerNote").addEventListener("input",()=>{if(activeId)setMark(activeId,{note:$("readerNote").value});});
  $("readerLabels").addEventListener("input",()=>{if(activeId)setMark(activeId,{tags:$("readerLabels").value});});
  $("copyArticle").addEventListener("click",async()=>{
    const a=uniqueArticles().find(x=>x.id===activeId);
    try{await navigator.clipboard.writeText(a?.link||"");toast("Odkaz zkopírován.");}
    catch{toast("Kopírování selhalo, použij původní odkaz.");}
  });
  $("shortcutsOpen").addEventListener("click",()=>{$("settingsDialog").close();$("shortcutsDialog").showModal();});
  document.querySelectorAll(".dialog-close").forEach(b=>b.addEventListener("click",()=>$(b.dataset.close).close()));
  $("menuToggle").addEventListener("click",()=>{$("sidebar").classList.add("open");$("sidebarMask").classList.add("open");});
  $("sidebarClose").addEventListener("click",closeMobileSidebar);
  $("sidebarMask").addEventListener("click",closeMobileSidebar);
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"){closeReader();closeMobileSidebar();return;}
    if(document.querySelector("dialog[open]"))return;
    if(e.target.closest("input,textarea,select,[contenteditable]"))return;
    const k=e.key.toLowerCase();
    if(k==="/"){e.preventDefault();$("searchInput").focus();return;}
    if(k==="?" ){$("shortcutsDialog").showModal();return;}
    if(k==="j"||k==="k"){e.preventDefault();focused=Math.max(0,Math.min(currentList.length-1,focused+(k==="j"?1:-1)));
      const card=Array.from($("items").children).find(c=>c.dataset.id===currentList[focused]?.id);
      if(card)card.scrollIntoView({block:"center",behavior:"smooth"});return;}
    const a=activeId?uniqueArticles().find(a=>a.id===activeId):currentList[focused];
    if(!a)return;
    if(k==="enter"||k==="o"){openReader(a.id);return;}
    if(k==="m"){setMark(a.id,{read:!mark(a.id).read});return;}
    if(k==="s"){setMark(a.id,{star:!mark(a.id).star});return;}
    if(k==="b"){setMark(a.id,{saved:!mark(a.id).saved});return;}
  });
}
function start(){
  wire();applyTheme();render();loadFeed(PRIMARY);
  if(section==="feed"&&selectedFeed!==PRIMARY.id){
    const f=sources.find(f=>f.id===selectedFeed);if(f)loadFeed(f);
  }
  if("serviceWorker" in navigator){navigator.serviceWorker.register("./sw.js").catch(()=>{});}
}
start();
