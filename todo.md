# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 58`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 51 | 0.5.0 |  |  | **Move the test-only tooling out of the runtime folders `src/ui/` and `src/http/`, and keep the README file map true.** | 2 | 1 | 1 | 2 | 3 | code health by 4 | 18.0 |
| 52 | 0.5.0 | 51 |  | **Make `positive` in `stylesheet-floor.ts` readable without tracing it by hand, and state why a custom property's value is checked.** | 2 | 1 | 1 | 2 | 3 | code health by 5 | 22.5 |
| 6 | 0.5.0 |  |  | **Warn at discovery when a route or nav node gates on a permission no plugin declares.** | 2 | 1 | 1 | 2 | 2 | 7 by 3, 9 by 3 | 8.0 |
| 23 | 0.5.0 |  |  | **Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.** | 3 | 1 | 2 | 4 | 5 | 1 by 4, 9 by 2, code health by 3 | 7.9 |
| 43 | 0.5.0 |  |  | **Let a plugin version the scripts and other `/public/` files its own markup links, so they are cached as immutable too.** | 2 | 2 | 1 | 3 | 3 | 8 by 3, 7 by 2 | 5.0 |
| 57 | 0.5.0 |  | owner | **Put the caller's IP, user agent and host on every request's span and `request` log line, under OpenTelemetry's HTTP semantic conventions, reading the IP through a proxy only where configuration names it trusted.** | 2 | 2 | 2 | 4 | 3 | 1 by 3 | 3.3 |
| 19 | 0.6.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 16 | 0.6.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 28 | 0.6.0 |  |  | **Let a plugin add entries to the profile menu through the plugin API.** | 2 | 2 | 2 | 4 | 4 | 7 by 4, 1 by 2 | 4.2 |
| 50 | 0.6.0 |  |  | **Split `handleRequest` into named stages, so each fits the 50-line limit and the stage order is written once.** | 3 | 1 | 3 | 5 | 7 | code health by 7 | 3.7 |
| 54 | 0.6.0 |  |  | **List the `setting` conflict kind in the README's Conflict rules table.** | 1 | 1 | 1 | 1 | 1 | 9 by 2 | 3.1 |
| 2 | 0.6.0 |  |  | **Rename the admin example plugin to a name that says what it administers.** | 3 | 1 | 2 | 4 | 6 | 9 by 3, code health by 2 | 2.6 |
| 5 | 0.6.0 |  |  | **List grants that no installed plugin declares, with a remove action.** | 2 | 2 | 2 | 4 | 4 | 2 by 3 | 2.1 |
| 41 | 0.6.0 |  |  | **Apply a permission save as one Keto call, so it cannot stop part-way.** | 2 | 2 | 2 | 4 | 3 | 2 by 2 | 2.1 |
| 14 | 0.6.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Renamed

- 0.4.21 renamed to 0.5.0
- 0.4.22 renamed to 0.5.0

## Details

### 51. Move the test-only tooling out of the runtime folders `src/ui/` and `src/http/`, and keep the README file map true.

`src/ui/stylesheet-floor.ts` imports a devDependency and only its test uses it; `src/http/app-harness.ts`
is a test fixture. Both sit beside runtime modules, and the README file map omits them. Seats also
named `src/http/builtin-routes.ts`, which holds no routes.

### 52. Make `positive` in `stylesheet-floor.ts` readable without tracing it by hand, and state why a custom property's value is checked.

Most scoring seats named `positive` (`:119`) with `walk` and `property` as opaque. Split it
into named steps, say in the header that an unsupported value in a custom property blanks every
`var()` that reads it, and keep the README's "Two browser floors" pointing here. It is the home of
the 3am answer.

### 6. Warn at discovery when a route or nav node gates on a permission no plugin declares.

Declaring stays optional on purpose, but the picker is built from declarations only, so such a route
is ungrantable from the GUI and answers a permanent 403. A warning, not an error.

### 23. Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.

Every list screen bridges `parseListQuery`/`paginate` to the partials by hand. At minimum a
`buildPaginationModel(page, hrefFor)`. Exported through the barrel, so it is contract surface.

### 43. Let a plugin version the scripts and other `/public/` files its own markup links, so they are cached as immutable too.

The host versions every `/public/` href it renders (`src/http/static.ts`): the shell's stylesheets,
favicon and logo, and a plugin's `styles`. A file a plugin's own markup links, such as fastjira's
`board-drag.js`, keeps an unversioned URL and is revalidated every five minutes. Offering a way —
`assetHref` documented as a view local, a `ctx.assetHref`, or a `scripts` slot in the shell — adds to
the plugin API, hence a minor. Pick one with the plugin authors' panel, then document it in README →
Reserved view locals.

### 57. Put the caller's IP, user agent and host on every request's span and `request` log line, under OpenTelemetry's HTTP semantic conventions, reading the IP through a proxy only where configuration names it trusted.

Today the `request` line and span in `src/http/app.ts` carry only method, path, status and `ms`, so
a dashboard can't filter requests by site or tell one caller from another. Add `server.address`
(the `Host`), `user_agent.original`, `client.address` and `http.route` where a route matched, and
rename the four fields already there to their convention names (`http.request.method`, `url.path`,
`http.response.status_code`, and the span's own duration for `ms`). Every plugin gains them with no
code of its own.

`client.address` is the socket's peer unless a new setting, such as `TRUSTED_PROXIES`, lists that
peer. Only then does the host take the address `X-Forwarded-For` names (goal 10: an explicit
choice). Trusting the header from anyone would let a caller write any IP into the logs.

A caller's IP and user agent are personal data, so the README says the host logs them, and a
deployment's privacy policy must say so too. bender-infra's Requests dashboard (its todo.md item
117) reads these names, and fastjira (its item 161) is the first plugin to send them.

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 16. Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.

Ory's own examples model `Shift`, `Document` and so on. One global `Resource` bucket is the
project's "no catch-all names" rule applied to namespaces.

### 28. Let a plugin add entries to the profile menu through the plugin API.

The profile dropdown stays a dropdown: Sign out is its only entry today, and it will gain more.
`views/partials/shell.ejs` hand-rolls it (AGENTS.md → UI, the dropdown rule), so the entries need a
manifest field that discovery checks, gated like a nav node.

### 50. Split `handleRequest` into named stages, so each fits the 50-line limit and the stage order is written once.

The hardest place in all eight scoring seats of PR #200: `src/http/app.ts` `handleRequest` is about
165 lines at complexity 43, in `createApp`'s closure, and the order of its stages (headers, static,
canonical host, locale, session, CSRF, contexts, hooks, dispatch) is carried by comments only. Remove
it from `grandfathered` in `src/function-limits.test.ts`. Behaviour must not change; `app-*.test.ts`
is the net. Ships alone (R 5).

### 54. List the `setting` conflict kind in the README's Conflict rules table.

`findConflicts` (`plugin.ts`) emits `kind: "setting"` at `error` level and the table in README →
Conflict rules omits it.

### 2. Rename the admin example plugin to a name that says what it administers.

Candidates: `auth-admin`, `users-groups-admin`. The id is also the mount path, so the compose files,
E2E stacks and README move with it.

### 5. List grants that no installed plugin declares, with a remove action.

`grantDiff` never revokes an undeclared name, and nothing shows one either, so it can't be audited or
cleaned, and reinstalling its plugin silently reactivates access nobody remembers granting.

### 41. Apply a permission save as one Keto call, so it cannot stop part-way.

`applyGrants` writes and deletes one tuple per request and reports a partial save when one fails.
**Check first:** Keto documents `PATCH /admin/relation-tuples`, which should apply a list of inserts
and deletes in one transaction; confirm that against the Keto version `ory/` pins. If so, add the
call to `KetoClient`, which is contract surface (`@plainpages/plugin-api`) and so needs 0.5.0, and the
partial-failure path in the admin example can go.

### 14. Drop a double-clicked duplicate submit, with no client-side JavaScript.

A second identical POST is expected from a non-technical user, and today creates two
users, mints two recovery codes, or registers two OAuth2 clients. It must not break a legitimately
repeatable action. Sketch: a CSS-only affordance so the second click has nothing to hit, plus the
host recognising a duplicate (same session, route and payload within a short window), logging and
dropping it. Open: what identifies "the same submission" (a one-time token minted into each form
beats hashing the payload), the window, where the record lives given the host is stateless, and how
a plugin declares a route repeatable.
