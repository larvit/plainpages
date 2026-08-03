// Login completion: turn a fresh Kratos session into our locally-verifiable
// session JWT — the one moment Ory is on the path (README: Login → session JWT):
//   1. whoami(cookie)            → the identity (id, email); no active session ⇒ null
//   2. read permissions from Keto      → the source of truth for the `permissions` claim
//   3. project onto metadata_public (admin API) so the tokenizer's mapper can read them
//   4. whoami(tokenize_as)       → the signed JWT { sub, email, permissions }, stored as our cookie
// Order matters: the projection is written before tokenizing, because the claims mapper
// reads only the identity, never Keto.
import type { SessionIdentity } from "../http/context.ts";
import { serializeCookie, type CookieOptions } from "../http/cookie.ts";
import { currentLog } from "../logger.ts";
import type { KetoClient } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import type { KratosPublic } from "./kratos-public.ts";

// Our session cookie — the signed JWT the hot path verifies in-process. Distinct from
// Kratos' own `plainpages_session` cookie (the long-lived login the JWT is re-minted off).
export const SESSION_COOKIE = "plainpages_jwt";

// Mirrors kratos.yml session.lifespan (30d) so the cookie survives browser restarts; the
// JWT inside is short-lived (~10m) and re-minted on expiry by the hot path (remintSession).
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

// The tokenizer template (kratos.yml session.whoami.tokenizer.templates.plainpages).
const TOKENIZE_AS = "plainpages";

export interface LoginDeps {
  keto: KetoClient;
  kratosAdmin: KratosAdmin;
  kratosPublic: KratosPublic;
}

export interface CompletedLogin {
  email: string | null;
  identityId: string;
  jwt: string;
  permissions: string[];
}

// The coarse permissions a user holds — directly (`Permission:<name>#members@identity:<id>`) or transitively via a
// group that is a member of the permission. Enumerates the defined permissions (the distinct objects in the Permission
// namespace) and asks Keto to resolve each membership, so a permission granted to a group reaches the JWT —
// matching the OPL model and the admin "Effective access" view. At login/refresh only, never per
// request; permission count is small, so the per-permission checks are cheap and run in parallel.
export async function readPermissions(keto: KetoClient, identityId: string): Promise<string[]> {
  const subject_id = `identity:${identityId}`;
  const names = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await keto.listRelations({ namespace: "Permission", relation: "granted", ...(pageToken ? { pageToken } : {}) });
    for (const t of page.tuples) names.add(t.object);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  const permissions = [...names];
  const held = await Promise.all(permissions.map((object) => keto.check({ namespace: "Permission", object, relation: "granted", subject_id })));
  return permissions.filter((_, i) => held[i]).sort();
}

export async function completeLogin(deps: LoginDeps, cookie: string | undefined): Promise<CompletedLogin | null> {
  const session = await deps.kratosPublic.whoami(cookie ? { cookie } : {});
  if (!session?.identity) return null;
  const identityId = session.identity.id;
  const emailTrait = session.identity.traits?.["email"];
  const email = typeof emailTrait === "string" ? emailTrait : null;

  const permissions = await readPermissions(deps.keto, identityId);
  await deps.kratosAdmin.updateMetadataPublic(identityId, { permissions });

  const tokenized = await deps.kratosPublic.whoami({ ...(cookie ? { cookie } : {}), tokenizeAs: TOKENIZE_AS });
  const jwt = tokenized?.tokenized;
  if (!jwt) throw new Error("login completion: Kratos tokenizer returned no JWT");

  currentLog()?.info("session minted", { permissions: permissions.join(","), sub: identityId }); // login or TTL re-mint
  return { email, identityId, jwt, permissions };
}

export interface Reminted {
  setCookie: string; // a fresh JWT cookie on success, else a cookie that clears the stale one
  identity: SessionIdentity | null;
}

// Re-mint the session JWT on TTL expiry — "stay signed in" (README): the ~10m token lapsed but
// the long-lived Kratos session may still be live. A live session ⇒ re-read permissions from Keto,
// re-tokenize, fresh cookie + the refreshed user (the one moment authz recomputes). A dead
// session ⇒ a cookie that *clears* the stale JWT, so later requests fall straight through to
// anonymous instead of re-hitting Ory on every one.
export async function remintSession(deps: LoginDeps, cookie: string | undefined, options: { secure?: boolean } = {}): Promise<Reminted> {
  const completed = await completeLogin(deps, cookie);
  if (!completed) return { setCookie: clearSessionCookie(options), identity: null };
  return { setCookie: sessionCookie(completed.jwt, options), identity: { email: completed.email ?? "", id: completed.identityId, permissions: completed.permissions } };
}

// Build the Set-Cookie for our session JWT. HttpOnly + SameSite=Lax by default; `secure` is
// supplied by the caller (off in dev http; the cookie hardening toggles it on for prod).
export function sessionCookie(jwt: string, options: { secure?: boolean } = {}): string {
  const opts: CookieOptions = { httpOnly: true, maxAge: COOKIE_MAX_AGE, path: "/", sameSite: "Lax", ...(options.secure ? { secure: true } : {}) };
  return serializeCookie(SESSION_COOKIE, jwt, opts);
}

// Expire our session cookie (Max-Age=0), with the same attributes sessionCookie sets so the
// browser deletes the right one.
export function clearSessionCookie(options: { secure?: boolean } = {}): string {
  const opts: CookieOptions = { httpOnly: true, maxAge: 0, path: "/", sameSite: "Lax", ...(options.secure ? { secure: true } : {}) };
  return serializeCookie(SESSION_COOKIE, "", opts);
}
