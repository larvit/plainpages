// Config loaded once from the environment at boot (todo §0): Ory endpoints, cookie/CSRF
// secrets, JWKS location, listen port, behaviour toggles. Fail-loud — a bad value, a
// missing enforced secret, a bad URL, or an out-of-range port throws here, never at
// request time.
//
// Environment-agnostic (AGENTS.md): the app never asks "which environment am I?". Every
// behaviour that used to ride on NODE_ENV is its own explicit toggle — `CACHE_TEMPLATES`,
// `REQUIRE_SECURE_SECRETS`. Clean-clone (README): every value has a working dev default,
// so `docker compose up` runs with zero config; a hardened deploy sets the toggles it wants.

export interface Config {
  cacheTemplates: boolean;
  cookieSecret: string;
  csrfSecret: string;
  jwksUrl: string;
  jwtAudience: string | undefined;
  jwtIssuer: string | undefined;
  ketoReadUrl: string;
  ketoWriteUrl: string;
  kratosAdminUrl: string;
  kratosPublicUrl: string;
  port: number;
  secureCookies: boolean;
}

type Env = Record<string, string | undefined>;

// A secret: free to use a dev throwaway by default; when REQUIRE_SECURE_SECRETS is on it
// must be supplied and must not be the throwaway (README: real secrets replace dev ones).
function readSecret(env: Env, key: string, devDefault: string, requireSecure: boolean): string {
  const value = env[key];
  if (!requireSecure) return value || devDefault;
  if (!value) throw new Error(`config: ${key} must be set when REQUIRE_SECURE_SECRETS=true`);
  if (value === devDefault) throw new Error(`config: ${key} must not be the dev throwaway when REQUIRE_SECURE_SECRETS=true`);
  return value;
}

// An explicit boolean toggle: only "true"/"false"; a typo fails at boot, never silently.
function readBool(env: Env, key: string, devDefault: boolean): boolean {
  const value = env[key];
  if (value === undefined) return devDefault;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`config: ${key} must be "true" or "false", got "${value}"`);
}

// An optional pinned value: present only when set non-empty. Unset ⇒ the matching claim
// check is skipped (clean clone — the dev tokenizer sets no iss/aud; §4 verifier).
function readOptional(env: Env, key: string): string | undefined {
  return env[key] || undefined;
}

// An absolute URL: defaults to the Ory service; validated so a typo fails at boot.
function readUrl(env: Env, key: string, devDefault: string): string {
  const value = env[key] ?? devDefault;
  try {
    new URL(value);
  } catch {
    throw new Error(`config: ${key} is not a valid URL: ${value}`);
  }
  return value;
}

function readPort(env: Env): number {
  const raw = env["PORT"];
  if (raw === undefined) return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`config: PORT must be an integer 1–65535, got "${raw}"`);
  }
  return port;
}

export function loadConfig(env: Env = process.env): Config {
  const requireSecure = readBool(env, "REQUIRE_SECURE_SECRETS", false);
  return {
    cacheTemplates: readBool(env, "CACHE_TEMPLATES", false),
    cookieSecret: readSecret(env, "COOKIE_SECRET", "dev-insecure-cookie-secret", requireSecure),
    csrfSecret: readSecret(env, "CSRF_SECRET", "dev-insecure-csrf-secret", requireSecure),
    // §4 verifier reads the same key the Kratos tokenizer signs with (kratos.yml jwks_url).
    // Kratos doesn't republish it over HTTP, so default to a file:// of the tokenizer JWKS
    // mounted into web (compose.yml). Prod overrides with a real key (README: rotation).
    jwksUrl: readUrl(env, "JWKS_URL", "file:///etc/config/kratos/tokenizer/jwks.json"),
    // Optional, off by default: pin the session-JWT issuer/audience for a hardened deploy.
    jwtAudience: readOptional(env, "JWT_AUDIENCE"),
    jwtIssuer: readOptional(env, "JWT_ISSUER"),
    ketoReadUrl: readUrl(env, "KETO_READ_URL", "http://keto:4466"),
    ketoWriteUrl: readUrl(env, "KETO_WRITE_URL", "http://keto:4467"),
    kratosAdminUrl: readUrl(env, "KRATOS_ADMIN_URL", "http://kratos:4434"),
    kratosPublicUrl: readUrl(env, "KRATOS_PUBLIC_URL", "http://kratos:4433"),
    port: readPort(env),
    // Set Secure on our session/CSRF cookies. Off by default (dev runs http); prod (https) sets it.
    secureCookies: readBool(env, "SECURE_COOKIES", false),
  };
}
