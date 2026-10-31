import { generateKeyPairSync, sign, type JsonWebKey } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { createApp } from "./app.ts";
import type { HydraAdmin } from "../auth/hydra-admin.ts";
import type { KetoClient, RelationTuple, SubjectSet } from "../auth/keto-client.ts";
import type { KratosAdmin } from "../auth/kratos-admin.ts";
import type { FlowType, KratosPublic } from "../auth/kratos-public.ts";
import { SESSION_COOKIE } from "../auth/login.ts";
import type { Plugin } from "../plugin-host/plugin.ts";

// A session JWT signed with a throwaway test key; `staticJwks([ecJwk])` is the matching verify side.
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
export const ecJwk: JsonWebKey = { ...(ec.publicKey.export({ format: "jwk" }) as JsonWebKey), alg: "ES256", kid: "test-kid" };
const b64url = (i: Buffer | string): string => Buffer.from(i).toString("base64url");
export function mintJwt(payload: Record<string, unknown>): string {
  const input = `${b64url(JSON.stringify({ alg: "ES256", kid: "test-kid", typ: "JWT" }))}.${b64url(JSON.stringify(payload))}`;
  return `${input}.${b64url(sign("SHA256", Buffer.from(input), { dsaEncoding: "ieee-p1363", key: ec.privateKey }))}`;
}
// A session cookie carrying `permissions`, valid for 10 min — the auth most tests need to reach a gated page.
export const session = (permissions: string[] = []): string =>
  `${SESSION_COOKIE}=${mintJwt({ email: "a@b.c", exp: Math.floor(Date.now() / 1000) + 600, permissions, sub: "u1" })}`;

export async function startApp(t: TestContext, plugins: Plugin[], pluginsDir?: string): Promise<string> {
  const app = createApp(pluginsDir ? { plugins, pluginsDir } : { plugins });
  await new Promise<void>((r) => app.listen(0, r));
  t.after(() => app.close());
  return `http://localhost:${(app.address() as AddressInfo).port}`;
}

export function mockKratos(getFlow: KratosPublic["getFlow"]): KratosPublic {
  return {
    createLogoutFlow: async () => null,
    getFlow,
    initBrowserFlow: async (_t: FlowType) => ({ flow: { id: "new1", ui: { action: "", method: "post", nodes: [] } }, setCookie: ["csrf_token=abc; Path=/; HttpOnly"] }),
    submitFlow: async () => { throw new Error("unused"); },
    whoami: async () => null,
  };
}

export const stubAdmin = (over: Partial<KratosAdmin>): KratosAdmin => ({
  createIdentity: async () => { throw new Error("unused"); },
  createRecoveryCode: async () => ({ code: "000000", link: "http://kratos/recover" }),
  deleteIdentity: async () => {},
  getIdentity: async () => null,
  listIdentities: async () => ({ identities: [], nextPageToken: null }),
  updateIdentity: async () => { throw new Error("unused"); },
  updateMetadataPublic: async () => ({ id: "x" }),
  ...over,
});
const sameSet = (a?: SubjectSet, b?: SubjectSet): boolean =>
  (!a && !b) || (!!a && !!b && a.namespace === b.namespace && a.object === b.object && a.relation === b.relation);
export const matchesTuple = (t: RelationTuple, f: Partial<RelationTuple>): boolean =>
  (f.namespace === undefined || t.namespace === f.namespace) &&
  (f.object === undefined || t.object === f.object) &&
  (f.relation === undefined || t.relation === f.relation) &&
  (f.subject_id === undefined || t.subject_id === f.subject_id) &&
  (f.subject_set === undefined || sameSet(t.subject_set, f.subject_set));
// A stateful in-memory KetoClient over a tuple array (writes mutate it); used by login + the admin screens.
export const fakeKeto = (tuples: RelationTuple[] = [], over: Partial<KetoClient> = {}): KetoClient => ({
  check: async () => false,
  deleteTuple: async (f) => { for (let i = tuples.length - 1; i >= 0; i--) if (matchesTuple(tuples[i]!, f)) tuples.splice(i, 1); },
  expand: async () => ({ type: "leaf" }),
  listRelations: async (q = {}) => ({ nextPageToken: null, tuples: tuples.filter((t) => matchesTuple(t, q)) }),
  writeTuple: async (tp) => { if (!tuples.some((t) => matchesTuple(t, tp) && sameSet(t.subject_set, tp.subject_set))) tuples.push(tp); },
  ...over,
});
export const withWhoami = (whoami: KratosPublic["whoami"]): KratosPublic => ({ ...mockKratos(async () => { throw new Error("unused"); }), whoami });

// OAuth2 login challenge: another app logs in *through* us; Hydra hands the browser here.
export const stubHydra = (over: Partial<HydraAdmin> = {}): HydraAdmin => ({
  acceptConsentRequest: async () => ({ redirect: "http://127.0.0.1:4444/oauth2/auth?consent_verifier=v" }),
  acceptLoginRequest: async () => ({ redirect: "http://127.0.0.1:4444/oauth2/auth?login_verifier=v" }),
  acceptLogoutRequest: async () => ({ redirect: "http://acme.example/post-logout" }),
  createClient: async (c) => ({ ...c, client_id: "c1", client_secret: "s3cr3t" }),
  deleteClient: async () => {},
  getClient: async () => null,
  getConsentRequest: async () => ({ challenge: "cons1", client: { client_name: "Acme Reports" }, requested_scope: ["openid", "profile"], skip: false, subject: OAUTH_SUBJECT }),
  getLoginRequest: async () => ({ challenge: "chal1", skip: false, subject: "" }),
  listClients: async () => ({ clients: [], nextPageToken: null }),
  rejectConsentRequest: async () => ({ redirect: "http://acme.example/cb?error=access_denied" }),
  rejectLoginRequest: async () => { throw new Error("unused"); },
  ...over,
});
export const OAUTH_SUBJECT = "01902d5e-7b6c-7e3a-9f21-3c8d1e0a4b55";
