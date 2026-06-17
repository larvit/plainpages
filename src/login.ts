// Login completion (todo §4): turn a fresh Kratos session into our locally-verifiable
// session JWT — the one moment Ory is on the path (README: Login → session JWT):
//   1. whoami(cookie)            → the identity (id, email); no active session ⇒ null
//   2. read roles from Keto      → the source of truth for the `roles` claim
//   3. project onto metadata_public (admin API) so the tokenizer's mapper can read them
//   4. whoami(tokenize_as)       → the signed JWT { sub, email, roles }, stored as our cookie
// Order matters: the projection is written before tokenizing, because the claims mapper
// reads only the identity, never Keto.
import { serializeCookie, type CookieOptions } from "./cookie.ts";
import type { KetoClient } from "./keto-client.ts";
import type { KratosAdmin } from "./kratos-admin.ts";
import type { KratosPublic } from "./kratos-public.ts";

// Our session cookie — the signed JWT the hot path verifies in-process. Distinct from
// Kratos' own `plainpages_session` cookie (the long-lived login the JWT is re-minted off).
export const SESSION_COOKIE = "plainpages_jwt";

// Mirrors kratos.yml session.lifespan (30d) so the cookie survives browser restarts; the
// JWT inside is short-lived (~10m) and re-minted by the §4 middleware on expiry.
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
  roles: string[];
}

// The coarse roles Keto grants a subject directly: `Role:<name>#members@user:<id>`. Returns
// the de-duped, sorted role names (the tuple `object`). One logical read, paged defensively.
// Group→role inheritance lands with the Groups screen (§5); MVP grants are direct.
export async function readRoles(keto: KetoClient, identityId: string): Promise<string[]> {
  const subject_id = `user:${identityId}`;
  const roles = new Set<string>();
  let pageToken: string | undefined;
  do {
    const page = await keto.listRelations({ namespace: "Role", relation: "members", subject_id, ...(pageToken ? { pageToken } : {}) });
    for (const t of page.tuples) roles.add(t.object);
    pageToken = page.nextPageToken ?? undefined;
  } while (pageToken);
  return [...roles].sort();
}

export async function completeLogin(deps: LoginDeps, cookie: string | undefined): Promise<CompletedLogin | null> {
  const session = await deps.kratosPublic.whoami(cookie ? { cookie } : {});
  if (!session?.identity) return null;
  const identityId = session.identity.id;
  const emailTrait = session.identity.traits?.["email"];
  const email = typeof emailTrait === "string" ? emailTrait : null;

  const roles = await readRoles(deps.keto, identityId);
  await deps.kratosAdmin.updateMetadataPublic(identityId, { roles });

  const tokenized = await deps.kratosPublic.whoami({ ...(cookie ? { cookie } : {}), tokenizeAs: TOKENIZE_AS });
  const jwt = tokenized?.tokenized;
  if (!jwt) throw new Error("login completion: Kratos tokenizer returned no JWT");

  return { email, identityId, jwt, roles };
}

// Build the Set-Cookie for our session JWT. HttpOnly + SameSite=Lax by default; `secure` is
// supplied by the caller (off in dev http; the §9 cookie hardening toggles it on for prod).
export function sessionCookie(jwt: string, options: { secure?: boolean } = {}): string {
  const opts: CookieOptions = { httpOnly: true, maxAge: COOKIE_MAX_AGE, path: "/", sameSite: "Lax", ...(options.secure ? { secure: true } : {}) };
  return serializeCookie(SESSION_COOKIE, jwt, opts);
}
