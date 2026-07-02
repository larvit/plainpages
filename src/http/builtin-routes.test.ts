// Internal route-table matching: exact path, a GET route also answering HEAD (like the plugin
// router), method-distinct entries on the same path.
import { test } from "node:test";
import assert from "node:assert/strict";
import { type BuiltinRoute, matchBuiltinRoute } from "./builtin-routes.ts";

const entry = (method: "GET" | "POST", path: string): BuiltinRoute => ({ handler: () => null, method, path });

test("matches exact path + method; GET also answers HEAD", () => {
  const get = entry("GET", "/error");
  const post = entry("POST", "/logout");
  const routes = [get, post];
  assert.equal(matchBuiltinRoute(routes, "GET", "/error"), get);
  assert.equal(matchBuiltinRoute(routes, "HEAD", "/error"), get);
  assert.equal(matchBuiltinRoute(routes, "POST", "/logout"), post);
  assert.equal(matchBuiltinRoute(routes, "GET", "/logout"), undefined, "a POST route does not answer GET");
  assert.equal(matchBuiltinRoute(routes, "HEAD", "/logout"), undefined, "a POST route does not answer HEAD");
  assert.equal(matchBuiltinRoute(routes, "POST", "/error"), undefined, "a GET route does not answer POST");
  assert.equal(matchBuiltinRoute(routes, "GET", "/nope"), undefined);
  assert.equal(matchBuiltinRoute(routes, "GET", "/error/sub"), undefined, "exact path, no prefix matching");
});

test("the same path may carry method-distinct entries (consent screen GET + decision POST)", () => {
  const screen = entry("GET", "/oauth2/consent");
  const decision = entry("POST", "/oauth2/consent");
  const routes = [screen, decision];
  assert.equal(matchBuiltinRoute(routes, "GET", "/oauth2/consent"), screen);
  assert.equal(matchBuiltinRoute(routes, "POST", "/oauth2/consent"), decision);
});
