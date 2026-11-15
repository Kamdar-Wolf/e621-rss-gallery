import test from "node:test";
import assert from "node:assert/strict";
import {checkDestination,verifyAddresses,resolvePublicUrl,FeedFetchError} from "../apps/worker/src/safe-fetch.js";

const forbidden=[
  "http://localhost/feed","http://internal.local/rss","http://127.0.0.1/secret",
  "http://169.254.169.254/latest","http://[::1]/secret",
  "file:///etc/passwd","https://user:pass@example.org/feed",
  "http://example.com:8080/feed","http://service/feed","http://example.test/feed"
];
test("reject malformed/internal/unsafe destinations",()=>{
  for(const url of forbidden)assert.throws(()=>checkDestination(url),FeedFetchError,url);
});
test("reject DNS records pointing at private, link-local, mapped and reserved ranges",()=>{
  for(const ip of ["127.0.0.1","192.168.1.9","10.0.0.1","169.254.169.254",
    "100.64.0.1","0.0.0.0","::1","fc00::1","fe80::1","::ffff:127.0.0.1","2001:db8::1","64:ff9b::a9fe:a9fe"]){
    assert.throws(()=>verifyAddresses([{address:ip,family:ip.includes(":")?6:4}]),FeedFetchError,ip);
  }
});
test("reject mixed DNS results even if first address is public",()=>{
  assert.throws(()=>verifyAddresses([
    {address:"8.8.8.8",family:4},{address:"192.168.4.1",family:4}]));
});
test("public destination accepts domain and pins verified address",async()=>{
  const result=await resolvePublicUrl("https://EXAMPLE.org/feed#fragment",
    async ()=>[{address:"8.8.8.8",family:4}]);
  assert.equal(result.address,"8.8.8.8");
  assert.equal(result.url.toString(),"https://example.org/feed");
});
