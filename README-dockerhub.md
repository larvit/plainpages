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
alongside its Ory sidecars (Kratos, Keto) and Postgres — and it **ships their config**,
so there is nothing to clone. In an empty directory, save this as `compose.yml`:

```yaml
services:
  web:
    image: larvit/plainpages:0.0.2
    ports:
      - "3000:3000"
    environment:
      APP_URL: http://localhost:3000
    depends_on:
      bootstrap:
        condition: service_completed_successfully
      kratos:
        condition: service_healthy
      keto:
        condition: service_healthy
    volumes:
      - ./ory/kratos/tokenizer:/etc/config/kratos/tokenizer:ro
      - ./plugins:/app/plugins
    restart: unless-stopped

  # One-shot, idempotent seed: signing key if absent + the admin@plainpages.local / admin user.
  bootstrap:
    image: larvit/plainpages:0.0.2
    command: node src/auth/bootstrap.ts
    depends_on:
      kratos:
        condition: service_healthy
      keto:
        condition: service_healthy
    volumes:
      - ./ory/kratos/tokenizer:/etc/config/kratos/tokenizer
      - ./plugins:/app/plugins:ro
    restart: "on-failure:5"

  postgres:
    image: postgres:18.4-alpine3.23
    environment:
      POSTGRES_DB: ory
      POSTGRES_PASSWORD: ory
      POSTGRES_USER: ory
    volumes:
      - ./ory/postgres/init:/docker-entrypoint-initdb.d:ro
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ory -d ory"]
      interval: 5s
      timeout: 5s
      retries: 10
    restart: unless-stopped

  kratos-migrate:
    image: oryd/kratos:v26.2.0
    command: -c /etc/config/kratos/kratos.yml migrate sql -e --yes
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DSN: postgres://ory:ory@postgres:5432/kratos?sslmode=disable
    volumes:
      - ./ory/kratos:/etc/config/kratos:ro
    restart: on-failure

  kratos:
    image: oryd/kratos:v26.2.0
    command: serve -c /etc/config/kratos/kratos.yml --watch-courier
    ports:
      - "4433:4433" # the login form POSTs straight to Kratos from the browser
    depends_on:
      kratos-migrate:
        condition: service_completed_successfully
    environment:
      DSN: postgres://ory:ory@postgres:5432/kratos?sslmode=disable
    volumes:
      - ./ory/kratos:/etc/config/kratos:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4433/health/ready"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped

  keto-migrate:
    image: oryd/keto:v26.2.0
    command: -c /etc/config/keto/keto.yml migrate up -y
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DSN: postgres://ory:ory@postgres:5432/keto?sslmode=disable
    volumes:
      - ./ory/keto:/etc/config/keto:ro
    restart: on-failure

  keto:
    image: oryd/keto:v26.2.0
    command: serve -c /etc/config/keto/keto.yml
    depends_on:
      keto-migrate:
        condition: service_completed_successfully
    environment:
      DSN: postgres://ory:ory@postgres:5432/keto?sslmode=disable
    volumes:
      - ./ory/keto:/etc/config/keto:ro
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:4466/health/ready"]
      interval: 5s
      timeout: 5s
      retries: 20
    restart: unless-stopped

  # Catches Kratos' recovery/verification emails — UI on http://localhost:8025
  mailpit:
    image: axllent/mailpit:v1.30.1
    ports:
      - "8025:8025"
    restart: unless-stopped

volumes:
  pgdata:
```

Extract the Ory config the image ships, then start:

```bash
docker run --rm larvit/plainpages:0.0.2 tar -cf - ory | tar -xf -
mkdir -p plugins
docker compose up -d
```

Open <http://localhost:3000> and sign in as `admin@plainpages.local` / `admin`.

This quick start runs http-on-localhost with dev-throwaway secrets, and omits Hydra (the
OAuth2 provider — only needed when other apps log in *through* Plainpages). For
production — https, real secrets (`CSRF_SECRET`, Postgres credentials, a fresh JWT
signing key), Hydra — see the repo README → Production & deployment.

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

Everything domain-specific is a plugin folder — the compose above mounts `./plugins`
into the app. Create `plugins/hello/plugin.ts`:

```ts
import { definePlugin } from "#plugin-api";

export default definePlugin({
  apiVersion: "1.0.0",
  nav: [{ href: "/hello", id: "hello", label: "Hello", public: true }],
  routes: [
    { method: "GET", path: "/", public: true, handler: () => ({ html: "<h1>Hello from my plugin</h1>" }) },
  ],
});
```

Restart (`docker compose restart web`) and visit <http://localhost:3000/hello>. Views,
forms, permissions, and the runnable reference plugin: repo README → Building plugins.
