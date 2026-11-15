import test from "node:test";
import assert from "node:assert/strict";
import {downloadVerifiedImage,MediaDownloadError,hasImageSignature,
  validateImageType,createImageDownloadLimiter,IMAGE_LIMIT,
  type ImageTransport} from "../apps/api/src/media-download.js";
import type {Resolver} from "../apps/worker/src/safe-fetch.js";

const png=Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLTTAAAAABJRU5ErkJggg==",
  "base64");
const publicResolver:Resolver=async()=>[{address:"8.8.8.8",family:4}];
const ok:ImageTransport=async()=>({
  status:200,headers:{"content-type":"image/png","content-length":String(png.length)},
  body:png
});
test("media downloader returns actual image, HTTPS URL and pinned DNS address",async()=>{
  const got:string[]=[];
  const image=await downloadVerifiedImage(
    "https://images.example.org/sample.png#fragment",publicResolver,
    async target=>{
      assert.equal(target.address,"8.8.8.8");
      assert.equal(target.url.hostname,"images.example.org");
      got.push(target.url.href);
      return ok(target);
    });
  assert.equal(image.mimeType,"image/png");
  assert.equal(image.finalUrl,"https://images.example.org/sample.png");
  assert.equal(got.length,1);
  assert.deepEqual(image.body,png);
});
test("reject non-HTTPS, private IP and DNS rebinding",async()=>{
  await assert.rejects(downloadVerifiedImage("http://images.example.org/a.png",
    publicResolver,ok),MediaDownloadError);
  await assert.rejects(downloadVerifiedImage("https://localhost/a.png",
    publicResolver,ok),MediaDownloadError);
  await assert.rejects(downloadVerifiedImage("https://127.0.0.1/a.png",
    publicResolver,ok),MediaDownloadError);
  await assert.rejects(downloadVerifiedImage("https://images.example.org/a.png",
    async()=>[{address:"10.1.2.3",family:4}],ok),MediaDownloadError);
  await assert.rejects(downloadVerifiedImage("https://images.example.org/a.png",
    async()=>[{address:"8.8.8.8",family:4},{address:"192.168.1.1",family:4}],ok),
    MediaDownloadError);
});
test("each redirect is independently checked; private and downgraded targets are rejected",async()=>{
  let calls=0;
  const redirect:ImageTransport=async()=>{
    calls++;
    return {status:302,headers:{location:"https://intranet.local/secret"},body:Buffer.alloc(0)};
  };
  await assert.rejects(downloadVerifiedImage("https://images.example.org/a.png",
    publicResolver,redirect),MediaDownloadError);
  assert.equal(calls,1);
  await assert.rejects(downloadVerifiedImage("https://images.example.org/a.png",
    publicResolver,async()=>({
      status:302,headers:{location:"http://example.org/other.png"},body:Buffer.alloc(0)
    })),MediaDownloadError);
});
test("redirect chain preserves public validation and is bounded",async()=>{
  let seen=0;
  const response=await downloadVerifiedImage("https://images.example.org/a.png",
    publicResolver,async target=>{
      if(seen++===0)return {status:302,
        headers:{location:"/b.png"},body:Buffer.alloc(0)};
      assert.equal(target.url.pathname,"/b.png");
      return ok(target);
    });
  assert.equal(response.body.byteLength,png.length);
  assert.equal(seen,2);
  await assert.rejects(downloadVerifiedImage("https://images.example.org/a.png",
    publicResolver,async target=>({
      status:302,headers:{location:"/next-"+Math.random()+".png"},
      body:Buffer.alloc(0)
    })),/Too many image redirects/);
});
test("MIME, encoded content, file signature and size are strictly checked",async()=>{
  assert.equal(validateImageType("image/png;charset=utf-8"),"image/png");
  assert.throws(()=>validateImageType("image/svg+xml"),MediaDownloadError);
  assert.equal(hasImageSignature(png,"image/png"),true);
  const checks=[
    {status:200,headers:{"content-type":"text/html"},body:Buffer.from("<html>")},
    {status:200,headers:{"content-type":"image/png"},body:Buffer.from("<script>")},
    {status:200,headers:{"content-type":"image/png","content-length":String(IMAGE_LIMIT+1)},body:png},
    {status:200,headers:{"content-type":"image/png","content-encoding":"gzip"},body:png},
    {status:200,headers:{"content-type":"image/png"},body:Buffer.alloc(IMAGE_LIMIT+1)}
  ];
  for(const sample of checks){
    await assert.rejects(downloadVerifiedImage("https://images.example.org/a.png",
      publicResolver,async()=>sample as ReturnType<ImageTransport> extends Promise<infer R>?R:never));
  }
});
test("rate limits apply per user and globally and count attempted downloads",()=>{
  let now=0;
  const reserve=createImageDownloadLimiter(()=>now);
  const a=reserve("first");
  const b=reserve("first");
  assert.throws(()=>reserve("first"),e=>e instanceof MediaDownloadError&&e.status===429);
  a();a();b();
  for(let i=0;i<38;i++)reserve("first")();
  assert.throws(()=>reserve("first"),/rate limit/i);
  now=15*60_000+1;
  reserve("first")();
  const busy=[...Array(8)].map((_,i)=>reserve("other"+i));
  assert.throws(()=>reserve("extra"),/rate limit/i);
  for(const release of busy)release();
});
