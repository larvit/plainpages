# Plainpages — implementation TODO

Build order is top → bottom; each phase is roughly independent and testable.
Conventions: **write tests first** (node --test for units, Playwright for E2E),
tear down test containers after runs, keep deps minimal, pin all versions, run
everything via Docker.

> **North-star / MVP.** Done = a developer can **clone, run one command, get a
> working register/login, and start hacking on their own plugin** — no manual key
> generation, no hand-edited Ory config, no DB setup. Everything below serves that;
> the one-command bootstrap (§3) and the example plugin (§7) are what make the MVP
> real. Hydra/SSO are explicitly *post-MVP*.

## 0. Housekeeping / primitives
- [x] Decide JWT verify approach: `node:crypto` (RS256/ES256 via `createPublicKey({format:"jwk"})`) vs add `jose` — justify if adding. → `node:crypto` (no new dep); `src/jwt.ts` verifies JWS signatures.
- [x] Cookie helpers: parse `Cookie` header, build `Set-Cookie` (HttpOnly, Secure, SameSite). → `src/cookie.ts` (`parseCookies`/`serializeCookie`); stdlib-only, injection/pollution-safe.
- [x] Request context type threaded to handlers: `{ req, res, url, params, query, user|null, roles }`. → `src/context.ts` (`RequestContext` + `buildContext`); `roles` mirror `user.roles`, the §2 router/§4 JWT middleware supply `params`/`user`.
- [x] Error templates: add 403 + 500 (404 exists). → `views/403.ejs` + `views/500.ejs`; 500 wired into `app.ts` error handler (HTML, plain-text fallback).
- [x] Config/env loader: Ory endpoints, cookie/CSRF secret, JWKS location, ports. → `src/config.ts` (`loadConfig`); validated at boot, dev defaults for clean-clone, prod requires real secrets; wired into `server.ts`.
- [x] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues. → Both: no bugs/security issues. Addressed: wired `buildContext` into `app.ts`; graceful SIGTERM/SIGINT shutdown; EJS template caching in prod. Deferred `core/`/`shell/` split (premature for an 8-file scaffold; revisit at §2/§4).
- [x] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff. → Tightened comments across `src/*.ts`, Dockerfile, and trimmed verbose/duplicated prose in README; tests + typecheck green.
- [x] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us. → Merged related cases across jwt/cookie/app/context/config tests (59 → 42), every assertion preserved; typecheck + tests green.

### 0.1 Extra input from human
- [x] Remove all usage of NODE_ENV - add a new core principle to the project that the app should at all times be unaware of what environment it is running in. Configuration should be explicit, like "disable email" or "cache templates". → Dropped NODE_ENV everywhere; added **environment-agnostic** principle (AGENTS.md §4 + README). Behaviour is now explicit toggles: `CACHE_TEMPLATES`, `REQUIRE_SECURE_SECRETS` (parsed/validated in `config.ts`, wired via `server.ts`); compose files set them per deployment. `app.ts` no longer reads `process.env`.

## 1. Building blocks — extract from `html-css-foundation/` (no Ory needed; render mock data)
- [x] Move `styles.css` + `auth.css` into `public/css/`; remove existing `style.css`. → `git mv` from `html-css-foundation/` into `public/css/`; dropped the placeholder `style.css`; views + tests now reference `styles.css`; foundation mockups repointed to `../public/css/`.
- [x] Lucide icon sprite from `lucide-static` (dep added) → `views/partials/icons.ejs`; serve/inline only the icons used. → `src/icons.ts` (id→lucide map + `buildIconSprite`) generates a hidden `<symbol>` sprite of the 31 icons the mockups reference, paths sourced from pinned lucide-static; `icons.test.ts` guards provenance + only-used. Stale image rebuilt (lucide-static was missing). Wiring into the app shell is the next item.
- [x] App-shell partial (sidebar + topbar + content slot). → `views/partials/shell.ejs`: full document wrapping `.app` → sidebar (brand + `nav` slot + theme/profile footer) · `.scrim` · `.content` (`.topbar` + `body` slot); reuses the mockup's classes (styled by `styles.css`), inlines the icon sprite. Slots `nav`/`actions`/`body` are HTML locals, `title`/`brand`/`user`/`breadcrumbs` text; defaults render standalone. `shell.test.ts` covers landmarks, slots, escaping, defaults. Not yet routed (that's "replace placeholder index").
- [x] Nav-tree partial — recursive, header/leaf × clickable/static, counts, `aria-current`. → `views/partials/nav-tree.ejs`: data-driven, self-including. Node `{ label, href?, icon?, count?, current?, open?, children? }`; header (children → `.nav-disc` toggle + sibling `.nav-children`) vs leaf (spacer), clickable (`<a>`) vs static (`<span>`), orthogonal. Renders into the shell's `nav` slot. `nav-tree.test.ts` covers the full matrix + counts/icons/aria-current/escaping/empty.
- [x] Filter-bar partial — GET form (search, segmented, selects, chips, daterange, applied pills). → `views/partials/filter-bar.ejs`: data-driven `<form method="get">` (server-side, zero-JS). `rows: Control[][]`, `type ∈ search|segmented|select|chips|daterange|spacer`, each reflecting current value (checked/selected); plus applied `pills` (+ remove links, Clear all) and Reset/Apply actions. Columns/“more filters” menus deferred to the menu/popover item. `filter-bar.test.ts` covers every type + value reflection + pills + defaults.
- [x] Data-table partial — sortable headers, row-select, badges, kebab row actions. → `views/partials/data-table.ejs`: data-driven, zero-JS. `columns` ({ label, sortable, sort, href, className }) render sort as `<a class="th-sort">` + `aria-sort` (links, not the mockup's inert buttons); `selectable`/`actions` toggle the check/kebab columns. `rows` carry typed `cells` (string | text+class | user/avatar | badge tone | raw html) + kebab `actions` (link or danger button, separators). `data-table.test.ts` covers the matrix + minimal/empty defaults.
- [x] Pagination partial — rows-per-page + page numbers, query-param driven. → `views/partials/pagination.ejs`: data-driven, zero-JS. `summary {from,to,total}`, rows-per-page GET `<form>` (select + submit, `hidden[]` carries list state), `pages: {label,href?,current?,ellipsis?}[]` (links; current/ellipsis inert), `prev`/`next` (href ⇒ link, omit ⇒ disabled). Reuses the mockup's `.pager` CSS, no changes. `pagination.test.ts` covers the matrix + value reflection + empty defaults.
- [x] Form-field partials (input/label/hint/error) + auth-card partial. → `views/partials/field.ejs`: data-driven `.field` — label (+ inline `link`/`Optional`), optional icon input (`has-ico`), `hint`, server-driven `error` (string | {text} | {html}) wiring `aria-invalid` + `aria-describedby`; added one CSS rule `.field.has-error .field-error{display:flex}` so a rendered field shows its own error. `views/partials/auth-card.ejs`: the `<form class="auth-card">` shell — head (back/title/sub), optional `sso` providers (text logo or icon, link or button) + divider, `body` slot (fields + submit), `alt` footer. `field.test.ts`/`auth-card.test.ts` cover the matrix + escaping + defaults.
- [x] Menu/popover + theme-switch partials (pure CSS `details`/`summary`). → `views/partials/menu.ejs`: data-driven `<details>` popover — `trigger` (icon/text/raw-html, `class:""` ⇒ bare kebab), `align`/`up` positioning, `width`; `items` = head · sep · link/button (icon, danger) · check-`group` (the columns/“more filters” menus filter-bar deferred here). `views/partials/theme-switch.ejs`: Light/Auto/Dark radiogroup with the fixed `theme-light/auto/dark` ids `styles.css` keys its `:has()` swaps off. Added `.menu-pop.up` (replaces the mockup's inline up-positioning); `shell.ejs` now reuses both partials. `menu.test.ts`/`theme-switch.test.ts` cover the matrix + escaping + defaults.
- [x] Helper `composeNav(fragments, override, roles)` → merged, permission-filtered tree. → `src/nav.ts`: pure, I/O-free. Flattens plugin fragments, applies the central override (rename → group → order → hide, all keyed by node `id`), then role-filters — a node shows iff it has no `permission` or `roles` includes it; a gated header drops its whole subtree, an emptied pure header is dropped. Emits clean nodes (no `id`/`permission`, absent fields omitted) ready for `nav-tree.ejs`. Filter runs last so everything above is per-deployment. `NavNode`/`NavOverride`/`NavGroupSpec` types exported; `nav.test.ts` covers merge/filter/empties/override matrix.
- [x] Helper `parseListQuery(url)` → `{ q, filters, sort, page, pageSize }`. → `src/list-query.ts`: pure, never throws; inverse of the filter-bar GET form + sort/pagination links. Accepts `URL`/`URLSearchParams`/string. `q` trimmed; `filters` = every non-reserved param as `string[]` (multi-value chips kept, empties dropped); `sort` = `{field,dir}` with `-field` ⇒ desc (lone `-`/empty ⇒ null); `page` a positive int (else 1); `pageSize` defaults 25, clamped to [1, max 100]. Reserved names + page-size bounds overridable via options. `list-query.test.ts` covers the full/default/clamp/custom-name matrix.
- [x] Helper `paginate(total, page, pageSize)` → page model. → `src/paginate.ts`: pure, URL-free math feeding `pagination.ejs`; caller maps page numbers → hrefs. Returns `{ from, to, page, pageCount, pageSize, prev, next, total, pages }`. Inputs clamped/guarded (page pinned to [1,pageCount], total/pageSize coerced to sane ints, empty list ⇒ 1 page / 0–0). `pages` = first/last `boundaries` + `siblings`-wide window around current, sorted/deduped, with ellipsis for gaps >1 (a lone hole is shown, not collapsed); `siblings`/`boundaries` overridable. `paginate.test.ts` covers model/clamp/empty/windowing.
- [x] Replace placeholder `index` with the app-shell dashboard. → `/` now renders a real app-shell "People" list. `src/dashboard.ts` (pure `buildDashboardModel(url, roles)`) wires the §1 helpers end-to-end: `parseListQuery` → filter (q/status/team) + sort + `paginate` over a 30-row mock dataset → `composeNav`; builds the filter-bar/data-table/pagination/shell configs with canonical, state-preserving links. `views/index.ejs` composes the partials around the shell by capturing each `include()` (EJS returns the string) into a slot. Filtering/sorting/paging all round-trip the URL, zero-JS. Removed the dead `partials/header.ejs`. `dashboard.test.ts` covers default/search/sort/paginate; `app.test.ts` asserts the live page + URL filtering. Mock data + demo profile stand in until §2/§4.
- [x] Check the full system in Playwright and make screenshots and compare to the static original design in html-css-foundation to make sure we're showing the correct graphics. → Dockerized Playwright (official image, browsers preinstalled — no host Node/browsers): `e2e/` (config + `visual.spec.ts`), `Dockerfile.e2e`, `compose.e2e.yml` run the suite against the live `web` service. 6 parallel tests: screenshots live (default/sorted+filtered/dark/mobile) **and** the foundation mockups (App Shell + Auth) → `e2e/artifacts/` (git-ignored); asserts the live DOM computes the **same** design-system styles as the mockup for the shared components (`.sidebar/.topbar/.brand/.btn-primary/.theme-switch/.filters/.pager`), every icon `<use>` resolves, sort/search round-trip the URL, the CSS theme switch flips the palette, and mobile hides the sidebar off-canvas. Verified visually: live dashboard matches the mockup design (light + dark); diffs are data only. All green.
- [x] Go over all HTML and CSS and make adjust it to be as sematic as we can, css classes, ids html elements and all, then add semantic DOM as a priority in this project. → Added **Semantic, accessible DOM** as core principle (AGENTS.md §5 + README). Fixes: page title is now the page `<h1>` (shell + mockup), a focus-revealed skip link to `#main-content`, data-table identifier cell is `<th scope="row">` (CSS styles tbody `th`), error pages got descriptive headings (code retained). Tests-first: shell/data-table specs assert the new markup; typecheck + 75 units + 6 E2E green.

### 1.1 Extra input from human
- [x] Add to principles that we should have full E2E coverage in the Playwright tests - make sure they can run in parallel to get up some speed. → Added **Full, parallel E2E** core principle (AGENTS.md §6 + README): every user-facing flow gets a Playwright test shipped with it, tests stay side-effect-free so the suite runs `fullyParallel` (already set; verified 7 tests / 7 workers). Led by example: added E2E coverage for the 404 page (the one user-facing gap). Fixed the documented run command to `--build` (the runner bakes in `e2e/`, so spec edits were silently ignored without it).

## 2. Plugin host
- [x] **Specify the plugin contract** (big job, do first — it's the product's main API surface). Write it down as the authoritative reference: the full manifest shape; the `RequestContext` handed to handlers and what's guaranteed stable; **contract versioning** (a `apiVersion`/`engines`-style field so a plugin declares the host it targets, and the host refuses or warns on mismatch); **conflict rules** (two plugins claiming the same `basePath`, nav slot, or `permission` name → defined, loud resolution, not last-write-wins); the **local dev/test story** (how an author runs + tests one plugin in isolation against the host). Audience is experienced devs: optimise for a powerful, predictable, clearly-documented API. Crash-isolation (a bad plugin can't take down the host) is a *nice-to-have*, not a blocker — fail loud at boot/discovery over sandboxing at runtime. It is a target that plugins should be able to overload as much as possible. Hooks on actions in the system is not bad either, if it is possible. → `src/plugin.ts` is the typed, machine-readable contract (single source of truth: manifest `Plugin`, `Route`/`RouteResult`/`RouteHandler`, `PermissionDecl`, `PluginHooks`, `definePlugin()`, `HOST_API_VERSION`) plus the pure rules the §2 host enforces — `checkApiVersion` (semver via `parseSemver`/official regex, no dep: same major+minor→ok, older minor→warn, newer minor/major-mismatch/malformed→refuse) and `findConflicts` (id/basePath-overlap/route = error, duplicate nav-id = error, shared permission token = warn; never last-write-wins). `docs/plugin-contract.md` is the prose reference (anatomy, manifest fields, handler/RouteResult, `RequestContext` stability guarantee, nav/permission namespacing, versioning, conflicts, hooks, dev/test story). README links it + example gained `apiVersion`. Tests-first (`plugin.test.ts`); typecheck + 80 units green. Discovery/router/view-resolver/static stay as the next §2 items that wire this to FS+HTTP.
- [ ] Discovery: scan `plugins/`, import each `plugin.ts` default export, validate.
- [ ] Router: match method+path under `basePath`, resolve path params, run permission gate, call handler with context.
- [ ] Per-plugin view resolver (`plugins/<id>/views/*.ejs`).
- [ ] Per-plugin static serving: `plugins/<id>/public/` → `/public/<id>/`.
- [ ] `config/menu.ts` central override: reorder/rename/hide/group + branding (app name, logo, default theme).
- [ ] Wire branding into the app shell.
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

## 3. Ory stack — compose + config
- [ ] `postgres` service (pinned tag); separate DB/schema per Kratos/Keto/Hydra.
- [ ] `kratos` service (pinned) + `migrate`; identity schema (traits: email, name).
- [ ] Kratos self-service flows (login, registration, recovery, verification, settings) → return URLs at our themed pages.
- [ ] Kratos OIDC/SSO providers (Google/Microsoft/SAML) config (secrets via env). **None enabled by default** — a clean clone runs password-only; a provider activates purely by supplying its env creds.
- [ ] Kratos session settings (cookie name, lifespan, sliding refresh).
- [ ] Kratos tokenizer template `plainpages`: claims `{ sub, email, roles }`, `ttl ≈ 10m`, `jwks_url` signer, `claims_mapper_url` (Jsonnet reading `metadata_admin.roles`).
- [ ] Generate + mount the JWT signing JWKS; document key rotation.
- [ ] `keto` service (pinned) + `migrate`; namespaces in OPL (`role`, `group`, resource permissions).
- [ ] `hydra` service (pinned) + `migrate`; issuer + login/consent URLs → our app.
- [ ] Split dev (`compose.override.yml`) vs prod (`compose.yml`) wiring; health checks + `depends_on` ordering.
- [ ] **One-command bootstrap** (the MVP bar): `docker compose up` brings up web + all Ory services + Postgres with *zero* manual prep. Commit working default Ory configs; auto-run migrations on first boot; auto-generate the JWKS signing key if absent; seed an admin identity + its Keto roles + a demo password (`admin`/`admin`) idempotently. Land an `OPL`/namespace bootstrap so Keto answers checks out of the box.
- [ ] First-run banner / log line printing the login URL + seeded admin creds, with a clear "change these before production" warning.
- [ ] Document the *only* things that can't be auto-generated: third-party **SSO provider** client id/secret (optional — password login works without them) and **production secrets** (real cookie/CSRF secret + signing key, supplied via env, replacing the dev throwaways). Everything else must work from a clean clone.
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

## 4. Auth — identity, session JWT, guards
- [ ] Kratos public client (fetch): init/get/submit flows, `whoami`, `whoami?tokenize_as=plainpages`.
- [ ] Kratos admin client (fetch): identity CRUD + `metadata_admin` update.
- [ ] Keto client (fetch): `check`, list/expand relations, write/delete tuples.
- [ ] Render Kratos flows: fetch flow → render fields against our themed pages → POST to `flow.ui.action` (Kratos handles its CSRF), map field errors/messages.
- [ ] SSO buttons → Kratos OIDC flows. **Render per configured provider only**: derive the list from Kratos' enabled OIDC providers (no creds ⇒ no button); hide the whole SSO section when none are configured. No code change needed to add/remove a provider — config only.
- [ ] Login completion: read roles from Keto → write `metadata_admin` projection → tokenize → set JWT cookie.
- [ ] JWT middleware: verify signature via cached JWKS, validate `exp`/`iss`/`aud` (+clock skew), build context (user, roles).
- [ ] JWKS fetch + cache + rotation handling.
- [ ] Guards: `requireSession` (validate JWT), `can(role)` (claim, in-process), `check(relation, object)` (live Keto).
- [ ] Session re-mint on TTL expiry (re-read roles from Keto).
- [ ] Logout: revoke Kratos session + clear cookie.
- [ ] Secure cookie flags; CSRF for our own POST forms.
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

## 5. Built-in admin screens (writes go only to Keto/Kratos)
- [ ] Users: list (Kratos identities) with filter/sort/pagination; create/edit/deactivate/delete; trigger recovery.
- [ ] Groups: Keto subject sets — list/create/delete + membership management.
- [ ] Roles & permissions: Keto relations — assign roles to users/groups; "effective access" view via Keto expand.
- [ ] Wire into the menu (admin section, permission-gated).
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

## 6. Hydra — OAuth2/OIDC provider (can ship after the rest)
- [ ] Login-challenge handler: authenticate via Kratos session, accept/reject.
- [ ] Consent-challenge handler: show / auto-accept first-party, grant scopes, accept/reject.
- [ ] OAuth2 client registration (admin UI or CLI).
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

## 7. Example plugin (reference)
- [ ] Reference plugin (e.g. people directory or scheduling): list page fetching upstream data, a form that forwards writes upstream, permission-gated nav.
- [ ] Verify the full plugin contract end-to-end against the README.
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

## 8. Testing & CI
- [ ] node --test units across helpers / router / nav / auth (tests-first throughout).
- [ ] **Playwright full E2E**: login (password + mocked SSO), menu filtering by role, users/groups/permissions CRUD, a plugin page, logout.
- [ ] E2E harness: bring up the full compose stack, seed Keto roles + a test identity, **tear down after**.
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

## 9. Production, security, ops
- [ ] `compose.yml` prod: Ory + Postgres, secrets via env, no source mount.
- [ ] Security headers; secure/HttpOnly/SameSite cookies; CSRF; clock-skew tolerance.
- [ ] Optional revocation denylist for instant role/session revoke.
- [ ] Structured logging / basic observability. use @larvit/log for OTLP compability - but add subtasks and stuff for supporting incoming trace id etc from a reverse-proxy etc.
- [ ] JWT signing-key rotation runbook.
- [ ] Refresh README `Layout` + drop `_(planned)_` markers as pieces land.
- [ ] Run the architecture _and_ the stability reviewer agents on the _whole_ project, not just the latest changes, and address their issues.
- [ ] Go over all comments in the code and the README and try to make it shorter and more information dense. Remove not strictly needed stuff.
- [ ] Go over all tests and combine/unify ones that cover the same stuff or are very related and could be combined in a good way. Remove tests that aren't helping, we only want tests that are actually helpful to us.

