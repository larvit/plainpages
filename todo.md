# Plainpages — implementation TODO

Build order is top → bottom; each phase is roughly independent and testable.
Conventions: **write tests first** (node --test for units, Playwright for E2E),
tear down test containers after runs, keep deps minimal, pin all versions, run
everything via Docker.

## 0. Housekeeping / primitives
- [ ] Decide JWT verify approach: `node:crypto` (RS256/ES256 via `createPublicKey({format:"jwk"})`) vs add `jose` — justify if adding.
- [ ] Cookie helpers: parse `Cookie` header, build `Set-Cookie` (HttpOnly, Secure, SameSite).
- [ ] Request context type threaded to handlers: `{ req, res, url, params, query, user|null, roles }`.
- [ ] Error templates: add 403 + 500 (404 exists).
- [ ] Config/env loader: Ory endpoints, cookie/CSRF secret, JWKS location, ports.

## 1. Building blocks — extract from `html-css-foundation/` (no Ory needed; render mock data)
- [ ] Move `styles.css` + `auth.css` into `public/css/`; reconcile with existing `style.css`.
- [ ] Lucide icon sprite → `views/partials/icons.ejs`.
- [ ] App-shell partial (sidebar + topbar + content slot).
- [ ] Nav-tree partial — recursive, header/leaf × clickable/static, counts, `aria-current`.
- [ ] Filter-bar partial — GET form (search, segmented, selects, chips, daterange, applied pills).
- [ ] Data-table partial — sortable headers, row-select, badges, kebab row actions.
- [ ] Pagination partial — rows-per-page + page numbers, query-param driven.
- [ ] Form-field partials (input/label/hint/error) + auth-card partial.
- [ ] Menu/popover + theme-switch partials (pure CSS `details`/`summary`).
- [ ] Helper `composeNav(fragments, override, roles)` → merged, permission-filtered tree.
- [ ] Helper `parseListQuery(url)` → `{ q, filters, sort, page, pageSize }`.
- [ ] Helper `paginate(total, page, pageSize)` → page model.
- [ ] Unit tests for all helpers (first).
- [ ] Replace placeholder `index` with the app-shell dashboard.

## 2. Plugin host
- [ ] `definePlugin()` + manifest types: `id`, `basePath`, `nav[]`, `routes[] {method, path, permission?, handler}`.
- [ ] Discovery: scan `plugins/`, import each `plugin.ts` default export, validate.
- [ ] Router: match method+path under `basePath`, resolve path params, run permission gate, call handler with context.
- [ ] Per-plugin view resolver (`plugins/<id>/views/*.ejs`).
- [ ] Per-plugin static serving: `plugins/<id>/public/` → `/public/<id>/`.
- [ ] `config/menu.ts` central override: reorder/rename/hide/group + branding (app name, logo, default theme).
- [ ] Wire branding into the app shell.
- [ ] Tests: discovery, routing, param matching, permission gate, nav merge + filter.

## 3. Ory stack — compose + config
- [ ] `postgres` service (pinned tag); separate DB/schema per Kratos/Keto/Hydra.
- [ ] `kratos` service (pinned) + `migrate`; identity schema (traits: email, name).
- [ ] Kratos self-service flows (login, registration, recovery, verification, settings) → return URLs at our themed pages.
- [ ] Kratos OIDC/SSO providers (Google/Microsoft/SAML) config (placeholders + secrets via env).
- [ ] Kratos session settings (cookie name, lifespan, sliding refresh).
- [ ] Kratos tokenizer template `plainpages`: claims `{ sub, email, roles }`, `ttl ≈ 10m`, `jwks_url` signer, `claims_mapper_url` (Jsonnet reading `metadata_admin.roles`).
- [ ] Generate + mount the JWT signing JWKS; document key rotation.
- [ ] `keto` service (pinned) + `migrate`; namespaces in OPL (`role`, `group`, resource permissions).
- [ ] `hydra` service (pinned) + `migrate`; issuer + login/consent URLs → our app.
- [ ] Split dev (`compose.override.yml`) vs prod (`compose.yml`) wiring; health checks + `depends_on` ordering.

## 4. Auth — identity, session JWT, guards
- [ ] Kratos public client (fetch): init/get/submit flows, `whoami`, `whoami?tokenize_as=plainpages`.
- [ ] Kratos admin client (fetch): identity CRUD + `metadata_admin` update.
- [ ] Keto client (fetch): `check`, list/expand relations, write/delete tuples.
- [ ] Render Kratos flows: fetch flow → render fields against our themed pages → POST to `flow.ui.action` (Kratos handles its CSRF), map field errors/messages.
- [ ] SSO buttons → Kratos OIDC flows.
- [ ] Login completion: read roles from Keto → write `metadata_admin` projection → tokenize → set JWT cookie.
- [ ] JWT middleware: verify signature via cached JWKS, validate `exp`/`iss`/`aud` (+clock skew), build context (user, roles).
- [ ] JWKS fetch + cache + rotation handling.
- [ ] Guards: `requireSession` (validate JWT), `can(role)` (claim, in-process), `check(relation, object)` (live Keto).
- [ ] Session re-mint on TTL expiry (re-read roles from Keto).
- [ ] Logout: revoke Kratos session + clear cookie.
- [ ] Secure cookie flags; CSRF for our own POST forms.
- [ ] Tests: JWT verify (valid/expired/bad-sig), guard behavior, login→projection→tokenize flow (Ory mocked).

## 5. Built-in admin screens (writes go only to Keto/Kratos)
- [ ] Users: list (Kratos identities) with filter/sort/pagination; create/edit/deactivate/delete; trigger recovery.
- [ ] Groups: Keto subject sets — list/create/delete + membership management.
- [ ] Roles & permissions: Keto relations — assign roles to users/groups; "effective access" view via Keto expand.
- [ ] Wire into the menu (admin section, permission-gated).
- [ ] Tests: CRUD flows (Ory mocked) + permission gating.

## 6. Hydra — OAuth2/OIDC provider (can ship after the rest)
- [ ] Login-challenge handler: authenticate via Kratos session, accept/reject.
- [ ] Consent-challenge handler: show / auto-accept first-party, grant scopes, accept/reject.
- [ ] OAuth2 client registration (admin UI or CLI).
- [ ] Tests: authorization-code login+consent happy path; token + refresh.

## 7. Example plugin (reference)
- [ ] Reference plugin (e.g. people directory or scheduling): list page fetching upstream data, a form that forwards writes upstream, permission-gated nav.
- [ ] Verify the full plugin contract end-to-end against the README.

## 8. Testing & CI
- [ ] node --test units across helpers / router / nav / auth (tests-first throughout).
- [ ] **Playwright full E2E**: login (password + mocked SSO), menu filtering by role, users/groups/permissions CRUD, a plugin page, logout.
- [ ] E2E harness: bring up the full compose stack, seed Keto roles + a test identity, **tear down after**.
- [ ] Typecheck + tests green in Docker (`docker compose run --rm web …`).

## 9. Production, security, ops
- [ ] `compose.yml` prod: Ory + Postgres, secrets via env, no source mount.
- [ ] Security headers; secure/HttpOnly/SameSite cookies; CSRF; clock-skew tolerance.
- [ ] Optional revocation denylist for instant role/session revoke.
- [ ] Structured logging / basic observability. use @larvit/log for OTLP compability - but add subtasks and stuff for supporting incoming trace id etc from a reverse-proxy etc.
- [ ] JWT signing-key rotation runbook.
- [ ] Refresh README `Layout` + drop `_(planned)_` markers as pieces land.

