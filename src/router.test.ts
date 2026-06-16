import assert from "node:assert/strict";
import { test } from "node:test";
import type { Plugin, Route } from "./plugin.ts";
import { allowedMethods, isAuthorized, matchRoute } from "./router.ts";

const noop: Route["handler"] = () => ({ html: "x" });

// Minimal discovered Plugin — only id + routes matter to the router.
function plugin(id: string, routes: Route[]): Plugin {
  return { apiVersion: "1.0.0", id, routes };
}

test("matchRoute matches method + full path under /<id>, resolves params, HEAD falls back to GET", () => {
  const plugins = [
    plugin("scheduling", [
      { handler: noop, method: "GET", path: "/shifts" },
      { handler: noop, method: "GET", path: "/shifts/:id" },
      { handler: noop, method: "POST", path: "/shifts" },
    ]),
  ];
  assert.equal(matchRoute(plugins, "GET", "/scheduling/shifts")?.route.method, "GET");
  assert.deepEqual(matchRoute(plugins, "GET", "/scheduling/shifts/42")?.params, { id: "42" });
  assert.equal(matchRoute(plugins, "POST", "/scheduling/shifts")?.route.method, "POST");
  // HEAD is answered by the GET route; PUT (no route) and an unknown path miss.
  assert.equal(matchRoute(plugins, "HEAD", "/scheduling/shifts")?.route.method, "GET");
  assert.equal(matchRoute(plugins, "PUT", "/scheduling/shifts"), null);
  assert.equal(matchRoute(plugins, "GET", "/scheduling/missing"), null);
});

test("matchRoute decodes percent-encoded params and rejects malformed encoding", () => {
  const plugins = [plugin("users", [{ handler: noop, method: "GET", path: "/:id" }])];
  assert.deepEqual(matchRoute(plugins, "GET", "/users/john%40doe")?.params, { id: "john@doe" });
  assert.equal(matchRoute(plugins, "GET", "/users/%ZZ"), null);
});

test("matchRoute prefers the most specific (fewest-param) pattern over a param catch-all", () => {
  const plugins = [
    plugin("users", [
      { handler: noop, method: "GET", path: "/:id" }, // declared first, still loses to the literal
      { handler: noop, method: "GET", path: "/new" },
    ]),
  ];
  assert.equal(matchRoute(plugins, "GET", "/users/new")?.route.path, "/new");
  assert.equal(matchRoute(plugins, "GET", "/users/123")?.route.path, "/:id");
});

test("allowedMethods lists methods at a path (GET implies HEAD); empty when the path is unknown", () => {
  const plugins = [
    plugin("x", [
      { handler: noop, method: "GET", path: "/a" },
      { handler: noop, method: "POST", path: "/a" },
    ]),
  ];
  assert.deepEqual(allowedMethods(plugins, "/x/a"), ["GET", "HEAD", "POST"]);
  assert.deepEqual(allowedMethods(plugins, "/x/missing"), []);
});

test("isAuthorized: open routes pass; gated routes require the role token", () => {
  const open: Route = { handler: noop, method: "GET", path: "/" };
  const gated: Route = { handler: noop, method: "GET", path: "/", permission: "x:read" };
  assert.equal(isAuthorized(open, []), true);
  assert.equal(isAuthorized(gated, []), false);
  assert.equal(isAuthorized(gated, ["x:read"]), true);
  assert.equal(isAuthorized(gated, ["other"]), false);
});
