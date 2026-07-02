import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { test } from "node:test";
import { buildContext, type User } from "./context.ts";
import { createLogger } from "../logger.ts";

// A req/res pair without a live server — enough to build and inspect a context.
function reqRes(url?: string): { req: IncomingMessage; res: ServerResponse } {
  const req = new IncomingMessage(new Socket());
  if (url !== undefined) req.url = url;
  req.method = "GET";
  return { req, res: new ServerResponse(req) };
}

test("buildContext parses the URL, exposes query, and defaults to an anonymous user", () => {
  const { req, res } = reqRes("/users?q=ann&page=2");
  const ctx = buildContext(req, res);
  assert.equal(ctx.req, req);
  assert.equal(ctx.res, res);
  assert.equal(ctx.url.pathname, "/users");
  assert.equal(ctx.query, ctx.url.searchParams); // same instance, not a copy
  assert.equal(ctx.query.get("q"), "ann");
  assert.equal(ctx.query.get("page"), "2");
  assert.equal(ctx.user, null);
  assert.deepEqual(ctx.roles, []);
  assert.deepEqual(ctx.params, {});
});

test("buildContext threads path params supplied by the router", () => {
  const { req, res } = reqRes("/users/42");
  const ctx = buildContext(req, res, { params: { id: "42" } });
  assert.equal(ctx.params.id, "42");
});

test("buildContext threads the user and derives roles from it", () => {
  const { req, res } = reqRes("/");
  const user: User = { email: "a@b.c", id: "u1", roles: ["admin", "editor"] };
  const ctx = buildContext(req, res, { user });
  assert.equal(ctx.user, user);
  assert.equal(ctx.roles, user.roles); // same reference, never a divergent copy — buildContext is the only writer
});

test("buildContext defaults a missing request URL to /", () => {
  const { req, res } = reqRes();
  assert.equal(buildContext(req, res).url.pathname, "/");
});

test("buildContext exposes ctx.system only when the host supplies it (else undefined)", () => {
  const { req, res } = reqRes("/admin/users");
  assert.equal(buildContext(req, res).system, undefined); // absent by default — a plugin must degrade
  const revoke = (): void => {};
  const system = { revoke };
  assert.equal(buildContext(req, res, { system }).system, system); // threaded through unchanged
});

test("buildContext provides a logger: a silent default, or the host's request logger", () => {
  const { req, res } = reqRes("/");
  assert.equal(typeof buildContext(req, res).log.info, "function"); // always present (silent default)
  const log = createLogger({ level: "none" });
  assert.equal(buildContext(req, res, { log }).log, log); // host's request logger threads through
});
