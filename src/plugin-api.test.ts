// The plugin author barrel (§7): the stable surface a plugin imports. Guards that the value exports
// stay present — removing one is a breaking contract change. The types resolve via typecheck (the
// reference plugin imports them from here).
import assert from "node:assert/strict";
import test from "node:test";
import * as api from "./plugin-api.ts";

test("plugin-api re-exports the stable author value surface", () => {
  for (const name of ["definePlugin", "can", "check", "GuardError", "requireSession", "parseListQuery", "readFormBody", "CSRF_FIELD", "tracedFetch", "Log", "safeUrl"]) {
    assert.ok(name in api && api[name as keyof typeof api] !== undefined, `missing export: ${name}`);
  }
  assert.equal(typeof api.definePlugin, "function");
  assert.equal(typeof api.tracedFetch, "function"); // the request-trace-aware fetch a plugin uses for upstream calls
  assert.equal(api.safeUrl("javascript:alert(1)"), "#"); // the URL sanitiser for rendering untrusted hrefs
  assert.equal(api.definePlugin({ apiVersion: "1.0.0" }).apiVersion, "1.0.0"); // identity helper works through the barrel
});
