import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { test } from "node:test";
import { buildContext, type RequestContext, type User } from "./context.ts";
import { can, check, GuardError, requireSession } from "./guards.ts";
import type { KetoClient, RelationTuple } from "./keto-client.ts";

function ctxFor(user: User | null): RequestContext {
  const req = new IncomingMessage(new Socket());
  req.url = "/";
  return buildContext(req, new ServerResponse(req), { user });
}

const alice: User = { email: "a@b.c", id: "u1", roles: ["admin", "scheduling:read"] };

test("requireSession returns the user, or throws GuardError(401)→/login when anonymous", () => {
  assert.equal(requireSession(ctxFor(alice)), alice);

  assert.throws(() => requireSession(ctxFor(null)), (err: unknown) => {
    assert.ok(err instanceof GuardError);
    assert.equal(err.status, 401);
    assert.equal(err.location, "/login"); // app.ts turns this into a 303 to sign in
    return true;
  });
});

test("can reads a coarse role from the JWT claims; anonymous has none", () => {
  assert.equal(can(ctxFor(alice), "admin"), true);
  assert.equal(can(ctxFor(alice), "billing:write"), false);
  assert.equal(can(ctxFor(null), "admin"), false);
});

test("check asks Keto with the current user as subject; anonymous is denied without a call", async () => {
  let asked: RelationTuple | undefined;
  const keto = {
    check: async (tuple: RelationTuple) => { asked = tuple; return true; },
  } as unknown as KetoClient;
  const tuple = { namespace: "Resource", object: "doc1", relation: "view" };

  assert.equal(await check(keto, ctxFor(alice), tuple), true);
  assert.deepEqual(asked, { ...tuple, subject_id: "user:u1" }); // subject is the signed-in user

  asked = undefined;
  assert.equal(await check(keto, ctxFor(null), tuple), false); // fail-closed, no Keto call
  assert.equal(asked, undefined);
});
