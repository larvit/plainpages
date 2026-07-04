# Plainpages

A self-hostable foundation for server-rendered web apps — public or gated pages from a
zero-JS design system, with a config-driven menu and auth/permissions (Ory) baked in.
Every domain feature is a drop-in plugin folder; the app is stateless, no build step.

**Source, docs & issues: <https://gitea.larvit.se/larvit/plainpages>**
([GitHub mirror](https://github.com/larvit/plainpages))

## Tags

`X.Y.Z` · `X.Y` · `X` · `latest` — each is a release promoted from a CI-gated build.
Pin the exact `X.Y.Z` you deploy.

## Quick start

This image is the Plainpages web app plus its one-shot bootstrap seeder. It runs
alongside Ory Kratos, Keto, Hydra and Postgres, all wired by the repo's compose files:

```bash
git clone https://gitea.larvit.se/larvit/plainpages.git
cd plainpages
docker compose up -d
```

Open <http://localhost:3000> and sign in as `admin@plainpages.local` / `admin`.
(The dev stack builds the image locally and live-reloads.)

To deploy this published image instead of building, add an override and run the
production stack:

```yaml
# compose.image.yml
services:
  bootstrap:
    image: larvit/plainpages:0.0.2
    pull_policy: missing
  web:
    image: larvit/plainpages:0.0.2
    pull_policy: missing
```

```bash
CSRF_SECRET=<long random> docker compose -f compose.yml -f compose.image.yml up -d
```

Production expects https and real secrets (`CSRF_SECRET`, `POSTGRES_USER`/`PASSWORD`,
a fresh JWT signing key) — see the repo README → Production & deployment.

## Configuration

Every behaviour is an explicit env toggle read at boot — no `NODE_ENV`. The common ones:

| Var | Default | What |
| --- | --- | --- |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@plainpages.local` / `admin` | the seeded first admin (bootstrap service) |
| `APP_URL` | unset | canonical public URL; off-host visitors are redirected to it |
| `CACHE_TEMPLATES` | `false` | cache compiled templates (`true` in prod) |
| `CSRF_SECRET` | dev throwaway | signs the CSRF token — set a real one in prod |
| `KRATOS_*` / `KETO_*` / `HYDRA_*` URLs | compose defaults | the Ory sidecar endpoints |
| `LOG_FORMAT` / `LOG_LEVEL` | `text` / `info` | `json` for structured prod logs |
| `OTLP_ENDPOINT` | unset | export logs + traces to an OpenTelemetry Collector |
| `REQUIRE_SECURE_SECRETS` | `false` | `true` ⇒ refuse to boot on a missing/throwaway `CSRF_SECRET` |
| `SECURE_COOKIES` | `false` | mark cookies `Secure` (`true` behind https) |

Full list (JWT/JWKS, timeouts, instant revoke): repo README → Configuration.

## Your first plugin

Everything domain-specific is a plugin folder. Create `plugins/hello/plugin.ts`:

```ts
import { definePlugin } from "#plugin-api";

export default definePlugin({
  apiVersion: "1.0.0",
  nav: [{ href: "/hello", id: "hello", label: "Hello", public: true }],
  routes: [
    { method: "GET", path: "/", public: true, handler: () => ({ html: "<h1>Hello</h1>" }) },
  ],
});
```

Restart (`docker compose restart web`) and visit <http://localhost:3000/hello>. Views,
forms, permissions, and the runnable reference plugin: repo README → Building plugins.
