// buildAuthRoutes registers only the endpoints the wired clients support — a missing client
// means the path isn't in the table at all (the host then 404s). The endpoints' behaviour is
// covered end-to-end through the app in src/http/app.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTH_FLOWS } from "./flow-view.ts";
import type { HydraAdmin } from "./hydra-admin.ts";
import type { KetoClient } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import type { KratosPublic } from "./kratos-public.ts";
import { DEFAULT_MENU } from "../ui/menu-config.ts";
import { type AuthRouteDeps, buildAuthRoutes } from "./routes.ts";

// Assembly never calls the clients, so identity-only stubs suffice.
const hydra = {} as unknown as HydraAdmin;
const keto = {} as unknown as KetoClient;
const kratos = {} as unknown as KratosPublic;
const kratosAdmin = {} as unknown as KratosAdmin;
const deps = (wired: Partial<AuthRouteDeps>): AuthRouteDeps =>
  ({ hydra: undefined, keto: undefined, kratos: undefined, kratosAdmin: undefined, menu: DEFAULT_MENU, secureCookies: false, ...wired });

const keys = (routes: { method: string; path: string }[]): string[] => routes.map((r) => `${r.method} ${r.path}`).sort();

test("nothing wired ⇒ only the flow-error sink exists", () => {
  assert.deepEqual(keys(buildAuthRoutes(deps({}))), ["GET /error"]);
});

test("kratos wired ⇒ the themed flow pages + POST /logout; no OAuth2, no /auth/complete", () => {
  const got = keys(buildAuthRoutes(deps({ kratos })));
  assert.deepEqual(got, keys([
    ...Object.keys(AUTH_FLOWS).map((path) => ({ method: "GET", path })),
    { method: "GET", path: "/error" },
    { method: "POST", path: "/logout" },
  ]));
});

test("hydra alone ⇒ only RP-initiated logout of the OAuth2 group (login/consent need kratos)", () => {
  assert.deepEqual(keys(buildAuthRoutes(deps({ hydra }))), ["GET /error", "GET /oauth2/logout"]);
});

test("everything wired ⇒ the full group: OAuth2 challenges, consent GET+POST, /auth/complete", () => {
  const got = keys(buildAuthRoutes(deps({ hydra, keto, kratos, kratosAdmin })));
  for (const key of ["GET /auth/complete", "GET /login", "GET /oauth2/consent", "GET /oauth2/login", "GET /oauth2/logout", "POST /logout", "POST /oauth2/consent"]) {
    assert.ok(got.includes(key), key);
  }
});
