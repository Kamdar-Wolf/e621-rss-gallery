import test from "node:test";
import assert from "node:assert/strict";
import {normalizeFeed} from "./normalize.js";

test("RSS 2.0 MediaRSS with enclosure and multiple items",()=>{
  const xml=`<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <title>Sample</title><item><guid>a-1</guid><title>First</title><link>https://example.com/a</link>
  <pubDate>Fri, 13 Nov 2026 09:00:00 GMT</pubDate><media:thumbnail url="https://example.com/a.jpg"/>
  </item><item><guid>a-2</guid><title>Second</title><enclosure url="https://example.com/b.mp3" type="audio/mpeg" /></item>
  </channel></rss>`;
  const f=normalizeFeed(xml,"https://example.com/rss");
  assert.equal(f.title,"Sample");
  assert.equal(f.entries.length,2);
  assert.equal(f.entries[0]!.guid,"a-1");
  assert.equal(f.entries[0]!.imageUrl,"https://example.com/a.jpg");
  assert.equal(f.entries[0]!.mediaType,"image");
  assert.equal(f.entries[1]!.mediaType,"audio");
});
test("Atom extracts html thumbnails from entries",()=>{
  const xml=`<feed xmlns="http://www.w3.org/2005/Atom"><title>e621</title><entry><id>tag:e621,2026:123</id>
    <title>A picture</title><link rel="alternate" href="https://e621.net/posts/123"/>
    <updated>2026-11-13T01:00:00Z</updated><content type="html">&lt;img src="https://static1.e621.net/img.jpg" /&gt;</content>
    </entry></feed>`;
  const f=normalizeFeed(xml,"https://e621.net/posts.atom");
  assert.equal(f.entries[0]!.imageUrl,"https://static1.e621.net/img.jpg");
  assert.equal(f.entries[0]!.mediaType,"image");
});
test("JSON Feed accepts entries and valid media",()=>{
  const f=normalizeFeed(JSON.stringify({version:"https://jsonfeed.org/version/1.1",title:"JSON",items:[
    {id:"one",url:"https://site.example/a",title:"Hello",image:"https://site.example/a.png",date_published:"2026-11-13T12:00:00Z"}
  ]}),"https://site.example/feed.json");
  assert.equal(f.title,"JSON");assert.equal(f.entries[0]!.guid,"one");
  assert.equal(f.entries[0]!.mediaType,"image");
});
test("rejects malformed XML and unknown feeds",()=>{
  assert.throws(()=>normalizeFeed("<rss><broken>","https://example.com/rss"));
  assert.throws(()=>normalizeFeed("<html></html>","https://example.com/rss"));
});
