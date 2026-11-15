import test from "node:test";
import assert from "node:assert/strict";
import {parseOpml} from "../apps/worker/src/opml.js";

test("OPML imports nested folders and deduplicates subscriptions",()=>{
  const raw='<opml version="2.0"><body><outline text="News"><outline title="Tech" text="Tech"><outline type="rss" text="Alpha" xmlUrl="https://example.org/rss?x=1&amp;y=2"/></outline></outline><outline text="Copy" xmlUrl="https://example.org/rss?x=1&amp;y=2"/></body></opml>';
  const result=parseOpml(raw);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].folders,["News","Tech"]);
  assert.equal(result[0].title,"Alpha");
});
test("37 feeds remain 37 after import and preserve categories",()=>{
  const outlines=Array.from({length:37},(_,i)=>'<outline type="rss" text="Feed'+i+'" xmlUrl="https://example.org/feed/'+i+'"/>').join("");
  const result=parseOpml('<opml><body><outline text="Imports">'+outlines+'</outline></body></opml>');
  assert.equal(result.length,37);
  assert.ok(result.every(x=>x.folders[0]==="Imports"));
});
test("reject malicious OPML entities",()=>{
  assert.throws(()=>parseOpml('<!DOCTYPE opml [<!ENTITY x SYSTEM "file:///etc/passwd">]><opml/>'));
});
