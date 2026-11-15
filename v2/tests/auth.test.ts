import test from "node:test";
import assert from "node:assert/strict";
import {makePasswordHash,verifyPassword,validateHandle} from "../apps/api/src/auth.js";

test("password hashing is salted and rejects wrong credentials",()=>{
  const password="strong password for CI only 2026";
  const first=makePasswordHash(password),second=makePasswordHash(password);
  assert.notEqual(first,second);
  assert.equal(verifyPassword(password,first),true);
  assert.equal(verifyPassword("incorrect password",first),false);
  assert.equal(verifyPassword(password,"unknown:hash"),false);
  assert.throws(()=>makePasswordHash("short"));
});
test("handles are normalized and constrained",()=>{
  assert.equal(validateHandle("Alice_2026"),"alice_2026");
  for(const bad of ["ab","a b","@example","../../etc","",null,99])
    assert.equal(validateHandle(bad),null);
});
