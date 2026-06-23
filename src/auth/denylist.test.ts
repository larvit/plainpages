import assert from "node:assert/strict";
import { test } from "node:test";
import { createDenylist } from "./denylist.ts";

test("createDenylist: revokes a subject's pre-revoke tokens, lets a fresh re-login through", () => {
  let clock = 1000;
  const dl = createDenylist({ now: () => clock, ttlSec: 600 });

  // An un-revoked subject is never revoked.
  assert.equal(dl.isRevoked("u1", 990), false);

  // Revoke at t=1000. A token minted at/before the revoke is rejected; one minted after passes
  // (a fresh re-login, whose JWT already reflects the new Keto state).
  dl.revoke("u1");
  assert.equal(dl.isRevoked("u1", 990), true); // before
  assert.equal(dl.isRevoked("u1", 1000), true); // exactly at the revoke instant
  assert.equal(dl.isRevoked("u1", 1001), false); // after → fresh token, not revoked
  assert.equal(dl.isRevoked("u2", 990), false); // a different subject is unaffected

  // A missing iat fails closed (better to force a re-mint than honour a maybe-revoked token).
  assert.equal(dl.isRevoked("u1", undefined), true);
});

test("createDenylist: a later revoke advances the cutoff; entries self-evict after the TTL", () => {
  let clock = 1000;
  const dl = createDenylist({ now: () => clock, ttlSec: 600 });

  dl.revoke("u1"); // cutoff = 1000
  clock = 1500;
  dl.revoke("u1"); // cutoff advances to 1500
  assert.equal(dl.isRevoked("u1", 1400), true); // minted before the latest revoke
  assert.equal(dl.isRevoked("u1", 1600), false); // minted after

  // Past the TTL the entry is gone — any pre-revoke token has long since expired anyway.
  clock = 1500 + 601;
  assert.equal(dl.isRevoked("u1", 1400), false);
});
