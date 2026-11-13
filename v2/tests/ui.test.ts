import test from "node:test";
import assert from "node:assert/strict";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {App} from "../apps/web/src/App.js";

test("password sign-in renders without embedding a secret",()=>{
  const html=renderToStaticMarkup(createElement(App));
  assert.match(html,/Kamdar Reader 2\.0/i);
  assert.match(html,/Uživatelské jméno/);
  assert.match(html,/Heslo/);
  assert.match(html,/type="password"/);
  assert.doesNotMatch(html,/test_only_random_very_long_token_123456789123/);
});
