/* Kamdar Reader: public app shell only. Never store API responses or remote media. */
const NAME="kr-app-shell-v1";
const PRECACHE=__PRECACHE_URLS__;
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(NAME).then(cache=>cache.addAll(PRECACHE))
    .then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key.startsWith("kr-app-shell-")&&key!==NAME)
      .map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  // No API endpoints or third-party files ever enter the Cache API.
  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;
  if(req.mode==="navigate"){
    event.respondWith(fetch(req).catch(async()=>{
      const cache=await caches.open(NAME);
      return await cache.match("/index.html") ||
        new Response("Offline aplikace není zatím uložená.",{status:503});
    }));
    return;
  }
  if(!PRECACHE.includes(url.pathname))return;
  event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
});
