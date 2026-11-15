import test from "node:test";
import assert from "node:assert/strict";
import { canonicalFeedUrl,addFeedSchema,entryStateSchema,cursorSchema } from "../packages/shared/src/schemas.js";

test("canonical URL drops fragment and normalizes host",()=>{
  assert.equal(canonicalFeedUrl("https://Example.COM/feed.xml#old"),"https://example.com/feed.xml");
});
test("reject credentials in RSS URL",()=>{
  assert.throws(()=>canonicalFeedUrl("https://alice:secret@example.com/rss"));
});
test("reject non-HTTP protocols",()=>{
  assert.equal(addFeedSchema.safeParse({url:"file:///etc/passwd"}).success,false);
  assert.equal(addFeedSchema.safeParse({url:"ftp://example.com/rss"}).success,false);
});
test("reject empty state update",()=>{
  assert.equal(entryStateSchema.safeParse({}).success,false);
  assert.equal(entryStateSchema.safeParse({starred:true}).success,true);
});
test("limit bounded to 100",()=>{
  assert.equal(cursorSchema.safeParse({limit:"101"}).success,false);
  assert.equal(cursorSchema.parse({limit:"25"}).limit,25);
});
