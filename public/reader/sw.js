/* Kamdar Reader PWA cache; offline UI + recently visited feed and thumbnails. */
const VERSION="kamdar-reader-1";
const SHELL=["./","./index.html","./reader.css","./reader.js","./icon.svg","./manifest.webmanifest","../feed.xml"];
self.addEventListener("install",event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(asset=>cache.add(asset)));
    await self.skipWaiting();
  })());
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith("kamdar-reader-")&&key!==VERSION)await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch",event=>{
  const req=event.request;
  if(req.method!=="GET")return;
  const url=new URL(req.url);
  if(url.origin!==self.location.origin)return;
  if(!url.pathname.startsWith("/e621-rss-gallery/"))return;
  const isFeed=url.pathname.endsWith("/feed.xml");
  if(isFeed||req.mode==="navigate"){
    event.respondWith((async()=>{
      const cache=await caches.open(VERSION);
      try{
        const response=await fetch(req);
        if(response.ok)await cache.put(req,response.clone());
        return response;
      }catch{
        return await cache.match(req)||await cache.match("./")||Response.error();
      }
    })());
  }else{
    event.respondWith((async()=>{
      const cache=await caches.open(VERSION);
      const cached=await cache.match(req);
      if(cached)return cached;
      try{
        const response=await fetch(req);
        if(response.ok)event.waitUntil(cache.put(req,response.clone()));
        return response;
      }catch{return Response.error();}
    })());
  }
});
