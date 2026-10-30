# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 28`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 9 | 0.4.21 |  | question | **Decide whether the gate typechecks `e2e-tests/`.** | 1 | 1 | 1 | 1 | 3 | code health by 2 | 9.0 |
| 10 | 0.4.21 |  | question | **Decide whether Playwright's `workers` is pinned.** | 1 | 1 | 1 | 1 | 1 | code health by 1 | 7.2 |
| 11 | 0.4.21 |  | question | **Record the browser floor Plainpages supports, and whether the fallback below it is a contract or a courtesy.** | 1 | 1 | 1 | 1 | 2 | 2 by 2, 1 by 1 | 4.3 |
| 15 | 0.4.21 |  | question | **Decide who owns `Cache-Control` for rendered pages: the host or the reverse proxy.** | 1 | 1 | 1 | 1 | 2 | 8 by 3 | 4.0 |
| 19 | 0.4.21 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 12 | 0.4.21 |  | question | **Decide whether the one-item profile dropdown stays a dropdown.** | 1 | 1 | 1 | 1 | 2 | 2 by 2 | 2.8 |
| 18 | 0.4.21 |  | question | **Decide whether the CSRF token stays unbound to the session.** | 1 | 1 | 1 | 1 | 2 |  | 0.0 |
| 26 | 0.4.21 |  |  | **Add a domain glossary and the project's intended horizon to the README.** | 1 | 2 | 1 | 2 | 3 | 9 by 3, code health by 2 | 11.9 |
| 8 | 0.4.21 |  |  | **Run the visual E2E specs at viewports from a large desktop down to a small phone.** | 2 | 1 | 1 | 2 | 4 | code health by 3 | 9.0 |
| 24 | 0.4.21 |  |  | **Retire `src/ui/shell-context.ts` and render the dashboard from `ctx.chrome`.** | 2 | 1 | 2 | 3 | 4 | code health by 3 | 9.0 |
| 17 | 0.4.21 |  |  | **Remove the icons no caller uses from `ICON_NAMES` and the sprite.** | 1 | 1 | 1 | 1 | 1 | 8 by 1, code health by 1 | 8.8 |
| 21 | 0.4.21 |  |  | **Fail the gate on a function that exceeds a size or complexity limit.** | 3 | 1 | 1 | 3 | 5 | code health by 4 | 7.2 |
| 27 | 0.4.21 |  |  | **Inset the scheduling example's lead text, shift count, alerts and call-to-action by `--pad-x`, like the bars around them.** | 1 | 2 | 1 | 2 | 1 | 9 by 2, 2 by 1 | 4.8 |
| 25 | 0.4.21 |  |  | **Point the views' references to `docs/plugin-contract.md` at the README.** | 1 | 2 | 1 | 2 | 1 | 9 by 3 | 4.6 |
| 20 | 0.4.21 |  |  | **Redirect an anonymous hit on a session-needing flow page to sign-in, instead of a 500.** | 2 | 2 | 2 | 4 | 3 | 2 by 4 | 4.2 |
| 4 | 0.4.21 |  |  | **Refuse a permission save whose baseline no longer matches Keto, so concurrent edits are not silently lost.** | 2 | 2 | 2 | 4 | 4 | 2 by 4 | 2.8 |
| 7 | 0.4.21 |  |  | **Confirm a successful permission save, and report a partial failure instead of hiding it.** | 2 | 2 | 2 | 4 | 4 | 2 by 4 | 2.8 |
| 22 | 0.4.21 |  |  | **Offer a `users:read` holder a View row action on the users list, not Edit.** | 2 | 2 | 1 | 3 | 3 | 2 by 2 | 2.1 |
| 3 | 0.4.21 |  |  | **Guard the group paths against self-lockout, or accept the gap explicitly.** | 3 | 2 | 2 | 5 | 6 | 2 by 6 | 1.4 |
| 1 | 0.4.21 |  | owner | **Publish every release to Docker Hub, and give the Hub page its short description.** | 3 | 3 | 2 | 6 | 5 | 1 by 3 | 1.3 |
| 13 | 0.4.21 |  |  | **Accept a verification code pasted with surrounding whitespace.** | 4 | 2 | 3 | 7 | 7 | 2 by 8 | 1.0 |
| 16 | 0.5.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 6 | 0.5.0 |  |  | **Warn at discovery when a route or nav node gates on a permission no plugin declares.** | 2 | 1 | 1 | 2 | 2 | 7 by 3, 9 by 3 | 8.0 |
| 23 | 0.5.0 |  |  | **Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.** | 3 | 1 | 2 | 4 | 5 | 1 by 4, 9 by 2, code health by 3 | 7.9 |
| 2 | 0.5.0 |  |  | **Rename the admin example plugin to a name that says what it administers.** | 3 | 1 | 2 | 4 | 6 | 9 by 3, code health by 2 | 2.6 |
| 5 | 0.5.0 |  |  | **List grants that no installed plugin declares, with a remove action.** | 2 | 2 | 2 | 4 | 4 | 2 by 3 | 2.1 |
| 14 | 0.5.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Details

### 11. Record the browser floor Plainpages supports, and whether the fallback below it is a contract or a courtesy.

The stylesheet needs `:has()` (Dec 2023); the menus need the popover API (Safari 17) and CSS anchor
positioning for placement, which is newer and unguarded, since the `@supports` test covers popover
only. An iPadOS 16 tablet gets panels flowing inline rather than working menus. Nobody has rendered
that path on real hardware.

### 15. Decide who owns `Cache-Control` for rendered pages: the host or the reverse proxy.

Responses carry `Vary: Accept-Language` but no `Cache-Control`, so a signed-in page is not marked
`private`. Either set the headers (public cacheable, gated `private, no-store`) or record in AGENTS.md
that the reverse proxy owns this.

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 12. Decide whether the one-item profile dropdown stays a dropdown.

It holds Sign out behind a click, and its "Signed in as X" head repeats what the trigger shows.

### 18. Decide whether the CSRF token stays unbound to the session.

`src/auth/csrf.ts` signs `<nonce>.<HMAC(secret, nonce)>` with no session binding, so any validly
signed token passes for any user: an attacker who can write cookies on the origin can fix a token
they know. Standard for unbound signed double-submit, and plausibly fine behind `SameSite=Lax` and
HSTS. Accepted → record it in AGENTS.md and README → Security model; not accepted → bind the nonce to
`sub`.

### 26. Add a domain glossary and the project's intended horizon to the README.

Glossary: host, manifest, chrome, nav fragment, permission token, system plugin, denylist. Also the
expected plugin count, since per-plugin dependency isolation prices N dependency trees on disk and
in RSS.

### 24. Retire `src/ui/shell-context.ts` and render the dashboard from `ctx.chrome`.

`ShellModel`/`buildShellContext` has one consumer, the dashboard, and duplicates `PageChrome` on
almost every field. Keep `shellUser` as the shared primitive.

### 17. Remove the icons no caller uses from `ICON_NAMES` and the sprite.

`i-chart`, `i-copy` and `i-download` have no caller, and the sprite is inlined into every page.
AGENTS.md → "`ICON_NAMES` is a host-owned registry" already makes this routine cleanup.

### 21. Fail the gate on a function that exceeds a size or complexity limit.

Only `tsc --strict` runs today. A new tool is a new dependency, so justify it.

### 27. Inset the scheduling example's lead text, shift count, alerts and call-to-action by `--pad-x`, like the bars around them.

They sit flush against the content pane's edge while the filter bar, table and pager sit 12px in.
The fix belongs in `examples/plugins/scheduling/public/scheduling.css`; check each page in a browser.

### 25. Point the views' references to `docs/plugin-contract.md` at the README.

`examples/plugins/scheduling/views/shifts.ejs` still cites it.

### 20. Redirect an anonymous hit on a session-needing flow page to sign-in, instead of a 500.

`flowPage` (`src/auth/routes.ts`) rethrows a 401, which Kratos answers to a settings-flow init with no
session. `/settings` stays `public`, since recovery lands there with a Kratos session but no app JWT;
a 401 should redirect to `/login` with the page as `return_to`. Add the missing E2E.

### 4. Refuse a permission save whose baseline no longer matches Keto, so concurrent edits are not silently lost.

Sketch: post the rendered set as a hidden baseline; when it no longer matches Keto, re-render with
"this changed while you had the page open" rather than applying.

### 7. Confirm a successful permission save, and report a partial failure instead of hiding it.

`applyGrants` loops writes then deletes with no transaction, so a Keto error midway leaves a
half-applied set behind the generic error page. The `alert alert-pos` pattern of the recovery-code
banner is available.

### 22. Offer a `users:read` holder a View row action on the users list, not Edit.

The pencil opens the read-only detail page, so it is harmless, but the label contradicts what the
reader can do. Needs `canWrite` threaded into `listTable`, a `common.view` core catalog key and an
`i-eye` icon.

### 3. Guard the group paths against self-lockout, or accept the gap explicitly.

The self-revoke guard covers only your own direct grants on the Users screen. Unticking a permission
on a group you belong to, leaving that group, or deleting it can still strip your own access with no
warning. AGENTS.md records this as a known gap. The robust fix is a "last effective holder" check,
which needs a reverse Keto query.

### 1. Publish every release to Docker Hub, and give the Hub page its short description.

Hub's newest tag is 0.4.0, while git has v0.4.1 onwards, and the overview still says 0.4.0. No
`release.yml` run exists for the tags auto-release pushes as `renovate-bot`; find out why Gitea
doesn't fire `push: tags` for them, fix it, and backfill the missing tags. fejkdata did this
(`../fejkdata`, commits `51d924a` and `34c8234`), and two parts port directly: a one-line
description riding the existing PATCH as its `description` field, and a unit test that the
description opens a README sentence and every command the overview shows appears in the README.
fejkdata also syncs the page on any push to `main`, with its own token in an environment only `main`
may use; decide whether that fits here, where `{{VERSION}}` must render a released tag.

### 13. Accept a verification code pasted with surrounding whitespace.

A pasted code fails the browser's `pattern` check. No zero-JS fix exists: `pattern`
cannot transform, so loosening it only lets the untrimmed value through to Kratos. **Check first:**
`kratos-admin.ts` returns a `recovery_link` alongside the code; if the stock courier mail can carry
one, a template change fixes this with no host code. Otherwise proxy the flow POST through the host:
`submitFlow` (`src/auth/kratos-public.ts`) already relays cookies and normalises a 422
`redirect_browser_to`, and has no callers outside tests. CSRF improves, since the POST becomes
same-origin and `form-action 'self'` can join the CSP. Risks: one `flow.ui.action` serves all five
flows, so this rewrites the sign-in path; and Go's nosurf checks Referer only over https, which no
test covers. Code entry has no E2E coverage today.

### 16. Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.

Ory's own examples model `Shift`, `Document` and so on. One global `Resource` bucket is the
project's "no catch-all names" rule applied to namespaces.

### 6. Warn at discovery when a route or nav node gates on a permission no plugin declares.

Declaring stays optional on purpose, but the picker is built from declarations only, so such a route
is ungrantable from the GUI and answers a permanent 403. A warning, not an error.

### 23. Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.

Every list screen bridges `parseListQuery`/`paginate` to the partials by hand. At minimum a
`buildPaginationModel(page, hrefFor)`. Exported through the barrel, so it is contract surface.

### 2. Rename the admin example plugin to a name that says what it administers.

Candidates: `auth-admin`, `users-groups-admin`. The id is also the mount path, so the compose files,
E2E stacks and README move with it.

### 5. List grants that no installed plugin declares, with a remove action.

`grantDiff` never revokes an undeclared name, and nothing shows one either, so it can't be audited or
cleaned, and reinstalling its plugin silently reactivates access nobody remembers granting.

### 14. Drop a double-clicked duplicate submit, with no client-side JavaScript.

A second identical POST is expected from a non-technical user, and today creates two
users, mints two recovery codes, or registers two OAuth2 clients. It must not break a legitimately
repeatable action. Sketch: a CSS-only affordance so the second click has nothing to hit, plus the
host recognising a duplicate (same session, route and payload within a short window), logging and
dropping it. Open: what identifies "the same submission" (a one-time token minted into each form
beats hashing the payload), the window, where the record lives given the host is stateless, and how
a plugin declares a route repeatable.
