# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 56`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 55 | 0.4.21 |  | security | **Keep a URL config value out of the boot error that rejects it.** | 1 | 1 | 4 | 5 | 2 |  | 0.0 |
| 19 | 0.5.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 16 | 0.5.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 48 | 0.5.0 |  |  | **Correct the Keto tuple in the `login.ts` and `bootstrap.ts` comments to the `granted` relation the code writes.** | 1 | 1 | 1 | 1 | 1 | code health by 4 | 28.7 |
| 51 | 0.5.0 |  |  | **Move the test-only tooling out of the runtime folders `src/ui/` and `src/http/`, and keep the README file map true.** | 2 | 1 | 1 | 2 | 3 | code health by 4 | 18.0 |
| 52 | 0.5.0 | 51 |  | **Make `positive` in `stylesheet-floor.ts` readable without tracing it by hand, and state why a custom property's value is checked.** | 2 | 1 | 1 | 2 | 3 | code health by 5 | 22.5 |
| 53 | 0.5.0 |  |  | **Say at `codeFlowSubmit` which branches of `flowFailure` can fire there.** | 1 | 1 | 1 | 1 | 1 | code health by 3 | 21.6 |
| 49 | 0.5.0 |  |  | **Render the admin's "group already exists" refusal from the catalog, in every locale.** | 1 | 2 | 1 | 2 | 1 | code health by 2 | 14.4 |
| 6 | 0.5.0 |  |  | **Warn at discovery when a route or nav node gates on a permission no plugin declares.** | 2 | 1 | 1 | 2 | 2 | 7 by 3, 9 by 3 | 8.0 |
| 23 | 0.5.0 |  |  | **Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.** | 3 | 1 | 2 | 4 | 5 | 1 by 4, 9 by 2, code health by 3 | 7.9 |
| 43 | 0.5.0 |  |  | **Let a plugin version the scripts and other `/public/` files its own markup links, so they are cached as immutable too.** | 2 | 2 | 1 | 3 | 3 | 8 by 3, 7 by 2 | 5.0 |
| 47 | 0.5.0 |  |  | **Refuse the plugin id `error`, and make the drift guard cover the `/error` mount.** | 1 | 1 | 2 | 2 | 1 | 7 by 3 | 4.9 |
| 28 | 0.5.0 |  |  | **Let a plugin add entries to the profile menu through the plugin API.** | 2 | 2 | 2 | 4 | 4 | 7 by 4, 1 by 2 | 4.2 |
| 50 | 0.5.0 |  |  | **Split `handleRequest` into named stages, so each fits the 50-line limit and the stage order is written once.** | 3 | 1 | 3 | 5 | 7 | code health by 7 | 3.7 |
| 54 | 0.5.0 |  |  | **List the `setting` conflict kind in the README's Conflict rules table.** | 1 | 1 | 1 | 1 | 1 | 9 by 2 | 3.1 |
| 2 | 0.5.0 |  |  | **Rename the admin example plugin to a name that says what it administers.** | 3 | 1 | 2 | 4 | 6 | 9 by 3, code health by 2 | 2.6 |
| 5 | 0.5.0 |  |  | **List grants that no installed plugin declares, with a remove action.** | 2 | 2 | 2 | 4 | 4 | 2 by 3 | 2.1 |
| 41 | 0.5.0 |  |  | **Apply a permission save as one Keto call, so it cannot stop part-way.** | 2 | 2 | 2 | 4 | 3 | 2 by 2 | 2.1 |
| 14 | 0.5.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Details

### 55. Keep a URL config value out of the boot error that rejects it.

`readOptionalUrl` and `readUrl` in `src/config.ts` throw `config: ${key} is not a valid URL: ${value}`,
so a malformed value reaches the boot error and the log. A DSN whose password breaks parsing, such as
`postgres://admin:pa/ss@db:5432/plugins`, leaks that password. The keys that can carry credentials:
`PLUGIN_DB_URL` (`readCredentiallessUrl` refuses userinfo only after `readOptionalUrl` has parsed it,
so a pasted admin DSN that fails to parse is echoed), and `OTLP_ENDPOINT`, whose collector URL may
embed basic-auth userinfo. The other URL keys, `APP_URL`, `HYDRA_ADMIN_URL`, `JWKS_URL`,
`KETO_READ_URL`, `KETO_WRITE_URL`, `KRATOS_ADMIN_URL` and `KRATOS_PUBLIC_URL`, pass through the same
two readers, so the fix covers them too. Name the variable and what it accepts, never the value, and
add a test per credential-bearing key. The other readers in `config.ts` echo only non-credential
values. `PLUGIN_DB_ADMIN_URL` isn't read in `config.ts`: `bootstrap.ts` hands it straight to
`postgres()`. Check whether the driver echoes a malformed one.

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 16. Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.

Ory's own examples model `Shift`, `Document` and so on. One global `Resource` bucket is the
project's "no catch-all names" rule applied to namespaces.

### 48. Correct the Keto tuple in the `login.ts` and `bootstrap.ts` comments to the `granted` relation the code writes.

`login.ts:40` and `bootstrap.ts:31` write `Permission:<name>#members@user:<id>`; the code, the OPL
file and the README use `granted`, and `members` is the Group relation. Raised by every comprehension
seat that read them.

### 51. Move the test-only tooling out of the runtime folders `src/ui/` and `src/http/`, and keep the README file map true.

`src/ui/stylesheet-floor.ts` imports a devDependency and only its test uses it; `src/http/app-harness.ts`
is a test fixture. Both sit beside runtime modules, and the README file map omits them. Seats also
named `src/http/builtin-routes.ts`, which holds no routes.

### 52. Make `positive` in `stylesheet-floor.ts` readable without tracing it by hand, and state why a custom property's value is checked.

Most scoring seats named `positive` (`:119`) with `walk` and `property` as opaque. Split it
into named steps, say in the header that an unsupported value in a custom property blanks every
`var()` that reads it, and keep the README's "Two browser floors" pointing here. It is the home of
the 3am answer.

### 53. Say at `codeFlowSubmit` which branches of `flowFailure` can fire there.

`submitFlow` throws only on a 5xx, so on the submit path only the 503 branch can fire; three seats
found that by opening a second file.

### 49. Render the admin's "group already exists" refusal from the catalog, in every locale.

`examples/plugins/admin/admin-groups.ts` returns the English string "A group with that name already
exists." where AGENTS.md puts every user-visible string in a catalog (`admin/i18n/en-US.ts`, then
`sv-SE.ts`).

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

### 47. Refuse the plugin id `error`, and make the drift guard cover the `/error` mount.

`/error` is Kratos' error sink (`src/auth/routes.ts`), and plugin routes resolve before built-ins, so
a plugin with id `error` and a `/` route shadows it. Add `error` to `RESERVED_PLUGIN_IDS` and to the
mount list in `plugin.test.ts`'s drift guard, whose comment claims every built-in is derived.

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
