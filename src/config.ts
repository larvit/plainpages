// Config loaded once from the environment at boot (todo §0): Ory endpoints, the
// cookie/CSRF secrets, the JWKS location, and the listen port. Fail-loud — a missing
// production secret, a bad URL, or an out-of-range port throws here, before the server
// starts, never at request time.
//
// Clean-clone philosophy (README): every value has a working dev default so `docker
// compose up` runs with zero config; in production only the secrets must be supplied
// (the dev throwaways are refused), everything else still defaults to the Ory services.

export interface Config {
  cookieSecret: string;
  csrfSecret: string;
  jwksUrl: string;
  ketoReadUrl: string;
  ketoWriteUrl: string;
  kratosAdminUrl: string;
  kratosPublicUrl: string;
  port: number;
}

type Env = Record<string, string | undefined>;

// A secret: free to use a dev throwaway locally; in production it must be supplied and
// must not be the throwaway (README: real secrets replace the dev ones).
function readSecret(env: Env, key: string, devDefault: string, production: boolean): string {
  const value = env[key];
  if (!production) return value || devDefault;
  if (!value) throw new Error(`config: ${key} must be set in production`);
  if (value === devDefault) throw new Error(`config: ${key} must not be the dev throwaway in production`);
  return value;
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
  const production = env["NODE_ENV"] === "production";
  return {
    cookieSecret: readSecret(env, "COOKIE_SECRET", "dev-insecure-cookie-secret", production),
    csrfSecret: readSecret(env, "CSRF_SECRET", "dev-insecure-csrf-secret", production),
    jwksUrl: readUrl(env, "JWKS_URL", "http://kratos:4433/.well-known/jwks.json"),
    ketoReadUrl: readUrl(env, "KETO_READ_URL", "http://keto:4466"),
    ketoWriteUrl: readUrl(env, "KETO_WRITE_URL", "http://keto:4467"),
    kratosAdminUrl: readUrl(env, "KRATOS_ADMIN_URL", "http://kratos:4434"),
    kratosPublicUrl: readUrl(env, "KRATOS_PUBLIC_URL", "http://kratos:4433"),
    port: readPort(env),
  };
}
