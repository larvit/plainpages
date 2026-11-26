# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 75`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 67 | 0.6.0 |  |  | **Group `src/auth`'s modules into one subfolder per concern, with `bootstrap.ts` staying at `src/auth/bootstrap.ts`.** | 3 | 1 | 2 | 4 | 6 | code health by 4 | 4.0 |
| 74 | 0.6.0 |  | owner | **Indent the TypeScript, CSS and shell source with hard tabs, as the tabs principle asks, and have `.editorconfig` and `AGENTS.md` say so.** | 3 | 1 | 1 | 3 | 7 | code health by 4 | 2.1 |
| 14 | 0.6.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |
| 19 | 0.7.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 73 | 0.7.0 |  | owner | **Reach the comprehension floor: make the request pipeline in `src/http/app.ts` and the locale and EJS-locals plumbing readable one unit at a time, so every dimension mean reaches 7.0.** | 3 | 1 | 2 | 4 | 7 | code health by 7 | 3.7 |

## Renamed

- 0.4.21 renamed to 0.5.0
- 0.4.22 renamed to 0.5.0

## Details

### 67. Group `src/auth`'s modules into one subfolder per concern, with `bootstrap.ts` staying at `src/auth/bootstrap.ts`.

`src/auth` holds 19 modules over several concerns: the per-request session path (`jwt*`, `jwks`,
`denylist`, `csrf`, `gate`, `guards`), the Ory clients (`kratos-*`, `keto-client`, `hydra-admin`,
`fetch-timeout`), the sign-in flows and their views (`routes`, `login`, `flow-view`), the OAuth2
provider (`oauth-*`), and the one-shot CLIs (`bootstrap`, `gen-jwks`). Pick folders a reader can
name, and update the folder list in `docs/decisions.md` → "`src/` is grouped by concern". Leave
`bootstrap.ts` in place, per "`bootstrap.ts` stays under `src/auth/`". Plugins import only the
barrel, so only `src/plugin-host/plugin-api.ts`'s paths change for them. Update the README file
map. Make `src/auth` easier to navigate, a place the seats found hard.

Touches:

- `src/auth/csrf.ts`
- `src/auth/csrf.test.ts`
- `src/auth/denylist.ts`
- `src/auth/denylist.test.ts`
- `src/auth/fetch-timeout.ts`
- `src/auth/fetch-timeout.test.ts`
- `src/auth/flow-view.ts`
- `src/auth/flow-view.test.ts`
- `src/auth/gate.ts`
- `src/auth/gate.test.ts`
- `src/auth/gen-jwks.ts`
- `src/auth/gen-jwks.test.ts`
- `src/auth/guards.ts`
- `src/auth/guards.test.ts`
- `src/auth/hydra-admin.ts`
- `src/auth/hydra-admin.test.ts`
- `src/auth/jwks.ts`
- `src/auth/jwks.test.ts`
- `src/auth/jwt-middleware.ts`
- `src/auth/jwt-middleware.test.ts`
- `src/auth/jwt.ts`
- `src/auth/jwt.test.ts`
- `src/auth/keto-client.ts`
- `src/auth/keto-client.test.ts`
- `src/auth/kratos-admin.ts`
- `src/auth/kratos-admin.test.ts`
- `src/auth/kratos-public.ts`
- `src/auth/kratos-public.test.ts`
- `src/auth/link-header.ts`
- `src/auth/link-header.test.ts`
- `src/auth/login.ts`
- `src/auth/login.test.ts`
- `src/auth/oauth-consent.ts`
- `src/auth/oauth-consent.test.ts`
- `src/auth/oauth-login.ts`
- `src/auth/oauth-login.test.ts`
- `src/auth/routes.ts`
- `src/auth/routes.test.ts`
- `src/auth/bootstrap.ts`: lines 7-18 (small)
- `src/auth/bootstrap.test.ts`: lines 5-13 (small)
- `src/plugin-host/plugin-api.ts`: lines 16-18 (small), lines 38-38 (small), lines 44-49 (small)
- `src/plugin-host/plugin.ts`: lines 7-7 (small)
- `src/plugin-host/plugin.test.ts`: lines 15-15 (small)
- `src/plugin-host/discovery.ts`: lines 10-10 (small)
- `src/plugin-host/system.ts`: lines 9-11 (small)
- `src/http/app.ts`: lines 9-32 (small)
- `src/http/app.test.ts`: lines 1-17 (small)
- `src/http/app-admin.test.ts`: lines 1-20 (small)
- `src/http/app-auth.test.ts`: lines 1-13 (small)
- `src/http/app-i18n.test.ts`: lines 1-14 (small)
- `src/http/app-plugins.test.ts`: lines 1-18 (small)
- `src/http/builtin-route.ts`: lines 4-4 (small)
- `src/ui/chrome.ts`: lines 5-5 (small)
- `src/ui/nav.ts`: lines 6-6 (small)
- `src/test-tooling/app-harness.ts`: lines 1-11 (small)
- `src/server.ts`: lines 3-14 (small)
- `src/function-limits.test.ts`: lines 17-20 (small)
- `src/postgres.test.ts`: lines 46-46 (small)
- `README.md`: `## Project layout`, `## Users, groups & permissions` (small), `## Building blocks` (small), `### Instant revoke: the optional denylist` (small), `### OAuth2 provider (Hydra)` (small), `## JWT signing key & rotation` (small), `### Scheduled rotation` (small), `### Emergency rotation (key compromise)` (small)
- `package.json`: lines 14-14 (small)
- `compose.yml`: lines 130-130 (small), lines 161-161 (small)

### 74. Indent the TypeScript, CSS and shell source with hard tabs, as the tabs principle asks, and have `.editorconfig` and `AGENTS.md` say so.

The tabs principle (`~/.claude/principles/technical-principles.md`) says to indent with hard tabs by default, and a project's own setting wins. A survey on 2026-11-26 found this project's source space-indented with no setting that records a reason. The maintainer asked for tabs in the source. A spelling of a format, such as a Markdown or JSON fixture, a test's expected text or a spec example, stays as it is.

Convert the leading whitespace of each source line, one tab for each indent step. Leave alone a line inside a template literal, a heredoc or a string whose indentation is the string's content; a test that fails on the change shows one missed. Land the conversion in one commit with no other change, list it in `.git-blame-ignore-revs`, and merge it when no other chunk is open, since every open branch conflicts with it. Where a check fails on a tab, such as a formatter or linter setting, change that setting in the same commit.

Add an `.editorconfig` with `indent_style = tab` for the source files and `indent_style = space` for `*.md`, `*.json` and `*.yml`, and say "tab indent" where `AGENTS.md` names the indentation.

Touches:

- `.editorconfig`
- `.git-blame-ignore-revs`
- `AGENTS.md`
- `src`

### 14. Drop a double-clicked duplicate submit, with no client-side JavaScript.

A second identical POST is expected from a non-technical user, and today creates two
users, mints two recovery codes, or registers two OAuth2 clients. It must not break a legitimately
repeatable action. Sketch: a CSS-only affordance so the second click has nothing to hit, plus the
host recognising a duplicate (same session, route and payload within a short window), logging and
dropping it. Open: what identifies "the same submission" (a one-time token minted into each form
beats hashing the payload), the window, where the record lives given the host is stateless, and how
a plugin declares a route repeatable.

Touches:

- `src/http/app.ts`: `answerPluginRoute`, `answerBuiltinRoute`, `prepareRequest`, `requestCsrf`
- `src/plugin-host/plugin.ts`: `Route` (small)
- `src/auth/csrf.ts`
- `public/css/styles.css`: lines 323-340 (small)
- `README.md`: `### Routes & handlers`

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 73. Reach the comprehension floor: make the request pipeline in `src/http/app.ts` and the locale and EJS-locals plumbing readable one unit at a time, so every dimension mean reaches 7.0.

The scoring run on branch filing-tabs at f3c41e4 gave means Navigation 7.38, Locality 6.50, Shape 7.00, Self-sufficiency 6.38, Overall 6.88. Self-sufficiency is the lowest, then Locality. Item 67 covers the `src/auth` folder, so this item leaves it out.

Places the seats named, to make easier to read:
- `src/auth/routes.ts:58` `flowFailure`: Kratos statuses and branch order whose reasons sit outside the file; three seats named it.
- `src/http/app.ts:67` `createApp` and `src/http/app.ts:263` `prepareRequest`: a 130-line closure, a lazy chrome that spreading the context triggers, and a `csrf.setCookie()` that each page-emitting stage repeats by hand.
- `src/http/app.ts:202` `Host`: restates the options and locals a third time.
- `src/ui/nav.ts:122` `toRenderNode` and `src/ui/chrome.ts:160` `markCurrent`: labels are translated twice, and nodes are mutated in place on the strength of a comment.
- `views/partials/data-table.ejs:74`, `views/partials/menu.ejs:22` and `views/partials/filter-bar.ejs:26`: EJS locals leak into includes, defended by explicit null options.
- `src/server.ts:25` `delete process.env["PLUGIN_DB_SECRET"]`: a load-bearing order rule, repeated in `src/auth/bootstrap.ts:140`.
- `src/test-tooling/stylesheet-floor.ts:74` `walk`: a regex CSS parser that doesn't say what it deliberately misses.
- `examples/plugins/auth-admin/admin-groups.ts:438` `withEmptiedGroups` and `:274` `lostToSelf`: the group-emptying walk and the self-lockout rule, each spread over several helpers.

Aim: a reader of one unit should not need the other units open beside it. Re-run the scoring run when it ships.
