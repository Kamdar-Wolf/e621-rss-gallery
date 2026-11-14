import test from "node:test";
import assert from "node:assert/strict";
import {parseFeed} from "../apps/worker/src/parser.js";

test("RSS: guid, date, enclosures, MediaRSS and description",()=>{
const feed=`<?xml version="1.0"?><rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
<title>Demo</title>
<item><guid>guid-1</guid><link>https://example.org/a</link><title>Photo &amp; Cat</title><pubDate>Fri, 13 Nov 2026 12:00:00 GMT</pubDate>
<description>&lt;p&gt;hello &amp;amp; bye&lt;/p&gt;</description><media:thumbnail url="https://example.org/a.jpg"/>
<enclosure url="https://example.org/b.mp4" type="video/mp4"/></item></channel></rss>`;
const f=parseFeed(feed);
assert.equal(f.title,"Demo");
assert.equal(f.entries.length,1);
assert.equal(f.entries[0].guid,"guid-1");
assert.equal(f.entries[0].media[0].type,"video");
assert.equal(f.entries[0].media[1].type,"image");
assert.equal(f.entries[0].summary,"hello & bye");
assert.equal(f.entries[0].publishedAt?.toISOString(),"2026-11-13T12:00:00.000Z");
});
test("Atom: summary XHTML-escaped image extraction and links",()=>{
const feed=`<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom demo</title>
<entry><id>tag:example.org,2026:1</id><title>Post</title><link rel="alternate" href="https://example.org/post/1"/>
<updated>2026-11-13T12:00:00Z</updated><author><name>Example artist</name></author>
<content type="html">&lt;p&gt;&lt;img src="https://example.org/preview.jpg"/&gt;&lt;/p&gt;</content>
</entry></feed>`;
const f=parseFeed(feed);
assert.equal(f.entries.length,1);
assert.equal(f.entries[0].author,"Example artist");
assert.equal(f.entries[0].media[0].url,"https://example.org/preview.jpg");
});
test("JSON Feed: content and attachments",()=>{
const f=parseFeed(JSON.stringify({version:"https://jsonfeed.org/version/1.1",title:"J",items:[
{id:"g2",url:"https://example.org/2",title:"Song",date_published:"2026-11-13T12:00:00Z",attachments:[{url:"https://example.org/audio.mp3",mime_type:"audio/mpeg"}]}
]}),"application/feed+json");
assert.equal(f.entries[0].mediaType,"audio");
});
test("DTD, invalid XML and unknown data are rejected",()=>{
assert.throws(()=>parseFeed('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'));
assert.throws(()=>parseFeed("<rss><channel>"));
assert.throws(()=>parseFeed("<html><body>Not RSS</body></html>"));
});
test("entries with no link and no guid are skipped",()=>{
const f=parseFeed('<rss><channel><title>X</title><item><title>No id</title></item></channel></rss>');
assert.equal(f.entries.length,0);
});
