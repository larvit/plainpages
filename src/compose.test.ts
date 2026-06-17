// Guards the dev/prod compose split + stack ordering (§3): every image is pinned to an
// exact version (AGENTS.md), long-running Ory services carry readiness healthchecks so
// `depends_on: service_healthy` works, the web app waits for the services it talks to
// (kratos + keto, per config.ts), prod publishes no internal Ory ports while dev exposes
// the ones a browser must reach, and the visual E2E stays Ory-free. Real boot is verified
// by running the stack; this catches edits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const compose = read("compose.yml");
const override = read("compose.override.yml");
const e2e = read("compose.e2e.yml");

// compose.yml lists web first, postgres second — slice the web service block.
const webBlock = compose.slice(compose.indexOf("\n  web:"), compose.indexOf("\n  postgres:"));

test("every image is pinned to an exact version, never a floating tag", () => {
  // One scan over all compose files (postgres, the three Ory pairs, mailpit); web/e2e build.
  const images = [...[compose, override, e2e].join("\n").matchAll(/image:\s*(\S+)/g)].map((m) => m[1]!);
  assert.ok(images.length >= 8, "scans the pinned images");
  for (const img of images) {
    assert.match(img.split(":").at(-1)!, /^v?\d+\.\d+/, `${img} pins a version-like tag`);
    assert.doesNotMatch(img, /latest|edge|[\^~*]/, `${img} is exact, not floating`);
  }
});

test("each Ory service and its migrate sidecar share one pinned version", () => {
  for (const svc of ["hydra", "keto", "kratos"]) {
    const tags = [...compose.matchAll(new RegExp(`image:\\s*oryd/${svc}:(\\S+)`, "g"))].map((m) => m[1]);
    assert.equal(tags.length, 2, `${svc} + ${svc}-migrate both present`);
    assert.equal(tags[0], tags[1], `${svc} server + migrate pinned to the same version`);
  }
});

test("long-running Ory services declare readiness healthchecks", () => {
  for (const [svc, port] of [["kratos", 4433], ["keto", 4466], ["hydra", 4444]] as const)
    assert.match(compose, new RegExp(`wget[^\\n]*:${port}/health/ready`),
      `${svc} probes :${port}/health/ready`);
});

test("web waits for kratos and keto to be healthy before starting", () => {
  assert.match(webBlock, /depends_on:/, "web declares dependencies");
  for (const svc of ["kratos", "keto"])
    assert.match(webBlock, new RegExp(`${svc}:\\s*\\n\\s*condition:\\s*service_healthy`),
      `web waits for ${svc} healthy`);
});

test("prod base publishes no internal Ory ports; dev exposes the host-facing ones", () => {
  for (const p of [4433, 4434, 4444, 4445, 4466, 4467])
    assert.ok(!compose.includes(`${p}:${p}`), `base does not publish :${p}`);
  // Browser completes Kratos flows at kratos public (kratos.yml base_url 127.0.0.1:4433)
  // and OAuth2 at hydra public — both reachable on the host only in dev.
  assert.match(override, /"4433:4433"/, "dev publishes kratos public");
  assert.match(override, /"4444:4444"/, "dev publishes hydra public");
});

test("a one-shot bootstrap seeds the stack before web starts", () => {
  // §3 MVP bar: `bootstrap` runs after kratos+keto are healthy, seeds the admin +
  // JWKS, then exits; web waits for it to complete. Live seeding is boot-verified.
  const boot = compose.slice(compose.indexOf("\n  bootstrap:"));
  assert.match(boot, /node src\/bootstrap\.ts/, "bootstrap runs the seed script");
  for (const svc of ["kratos", "keto"])
    assert.match(boot, new RegExp(`${svc}:\\s*\\n\\s*condition:\\s*service_healthy`),
      `bootstrap waits for ${svc} healthy`);
  // Generates the JWKS into the committed tokenizer dir if absent → needs it writable (no :ro).
  assert.match(boot, /\.\/ory\/kratos\/tokenizer:\/etc\/config\/kratos\/tokenizer(?!:ro)/,
    "bootstrap mounts the tokenizer dir read-write");
  assert.match(webBlock, /bootstrap:\s*\n\s*condition:\s*service_completed_successfully/,
    "web waits for bootstrap to finish");
});

test("the visual E2E does not drag in the Ory stack", () => {
  // web's Ory deps are reset for E2E (the dashboard is mock data — no Ory needed).
  assert.match(e2e, /depends_on:\s*!reset\b/, "E2E resets web's depends_on");
});
