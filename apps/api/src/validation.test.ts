import test from "node:test";
import assert from "node:assert/strict";
import {isPublicIp,normalizeFeedUrl} from "./validation.js";
test("blocks known local IPv4 and IPv6",()=>{
  for(const ip of ["127.0.0.1","10.1.2.3","172.16.1.2","192.168.2.3","169.254.169.254","::1","fc00::1","fe80::1"]){
    assert.equal(isPublicIp(ip),false,ip);
  }
});
test("accepts public addresses",()=>{
  assert.equal(isPublicIp("8.8.8.8"),true);
  assert.equal(isPublicIp("2001:4860:4860::8888"),true);
});
test("URL validation blocks non-http, credentials and private hosts",()=>{
  for(const url of ["file:///etc/passwd","http://localhost/rss","http://127.0.0.1","https://10.1.1.1/rss","https://user:pass@example.com/rss"]){
    assert.throws(()=>normalizeFeedUrl(url),undefined,url);
  }
  assert.equal(normalizeFeedUrl("https://www.example.com/rss#fragment"),"https://www.example.com/rss");
});
