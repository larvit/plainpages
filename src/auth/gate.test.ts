import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "../http/context.ts";
import { allows, gatesSet } from "./gate.ts";

const holder: User = { email: "holder@example.test", id: "01a06091-ba9f-765f-abf4-b5144c314bc7", permissions: ["x:read"] };
const stranger: User = { email: "stranger@example.test", id: "01a06091-baa3-7b4d-810a-c9ee7e559d98", permissions: [] };

test("allows: ungated and public are open to anyone; session needs a user; permission needs the token", () => {
  assert.equal(allows({}, null), true);
  assert.equal(allows({ public: true }, null), true);

  assert.equal(allows({ session: true }, null), false);
  assert.equal(allows({ session: true }, stranger), true); // signed in is the whole gate — no grant

  assert.equal(allows({ permission: "x:read" }, null), false);
  assert.equal(allows({ permission: "x:read" }, stranger), false);
  assert.equal(allows({ permission: "x:read" }, holder), true);
});

test("gatesSet names the gates a declaration sets, so discovery can refuse more than one", () => {
  assert.deepEqual(gatesSet({}), []);
  assert.deepEqual(gatesSet({ session: true }), ["session"]);
  assert.deepEqual(gatesSet({ permission: "x:read", public: true }), ["public", "permission"]);
  assert.deepEqual(gatesSet({ permission: "x:read", public: true, session: true }), ["public", "session", "permission"]);
  // `false` is not a gate — only a set one counts, so { session: false } is an ungated route.
  assert.deepEqual(gatesSet({ public: false, session: false }), []);
});
