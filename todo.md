# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 36`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 29 | 0.4.21 |  | defect | **Show the whole nav tree on an engine without `:has()`, and fold it only where `:has()` works.** | 2 | 2 | 2 | 4 | 3 | 4 by 6 | 26.9 |
| 35 | 0.4.21 |  | defect | **Raise the contrast of the dark-mode primary button's white text and of the light-mode status badges' text to 4.5:1.** | 1 | 2 | 1 | 2 | 2 | 6 by 3 | 18.0 |
| 31 | 0.4.21 |  |  | **Delete the design-preview rules in `public/css/auth.css` that no view uses.** | 1 | 1 | 1 | 1 | 2 | code health by 2, 8 by 1 | 13.3 |
| 26 | 0.4.21 |  |  | **Add a domain glossary and the project's intended horizon to the README.** | 1 | 2 | 1 | 2 | 3 | 9 by 3, code health by 2 | 11.9 |
| 8 | 0.4.21 |  |  | **Run the visual E2E specs at viewports from a large desktop down to a small phone.** | 2 | 1 | 1 | 2 | 4 | code health by 3 | 9.0 |
| 9 | 0.4.21 |  |  | **Typecheck `e2e-tests/` in the gate.** | 1 | 1 | 1 | 1 | 3 | code health by 2 | 9.0 |
| 24 | 0.4.21 |  |  | **Retire `src/ui/shell-context.ts` and render the dashboard from `ctx.chrome`.** | 2 | 1 | 2 | 3 | 4 | code health by 3 | 9.0 |
| 17 | 0.4.21 |  |  | **Remove the icons no caller uses from `ICON_NAMES` and the sprite.** | 1 | 1 | 1 | 1 | 1 | 8 by 1, code health by 1 | 8.8 |
| 21 | 0.4.21 |  |  | **Fail the gate on a function that exceeds a size or complexity limit.** | 3 | 1 | 1 | 3 | 5 | code health by 4 | 7.2 |
| 32 | 0.4.21 | 29 |  | **Fail the gate on a stylesheet feature the browser floor lacks, unless it is guarded.** | 3 | 1 | 1 | 3 | 4 | code health by 2 | 6.0 |
| 27 | 0.4.21 |  |  | **Inset the scheduling example's lead text, shift count, alerts and call-to-action by `--pad-x`, like the bars around them.** | 1 | 2 | 1 | 2 | 1 | 9 by 2, 2 by 1 | 4.8 |
| 20 | 0.4.21 |  |  | **Redirect an anonymous hit on a session-needing flow page to sign-in, instead of a 500.** | 2 | 2 | 2 | 4 | 3 | 2 by 4 | 4.2 |
| 4 | 0.4.21 |  |  | **Refuse a permission save whose baseline no longer matches Keto, so concurrent edits are not silently lost.** | 2 | 2 | 2 | 4 | 4 | 2 by 4 | 2.8 |
| 7 | 0.4.21 |  |  | **Confirm a successful permission save, and report a partial failure instead of hiding it.** | 2 | 2 | 2 | 4 | 4 | 2 by 4 | 2.8 |
| 22 | 0.4.21 |  |  | **Offer a `users:read` holder a View row action on the users list, not Edit.** | 2 | 2 | 1 | 3 | 3 | 2 by 2 | 2.1 |
| 34 | 0.4.21 |  |  | **Serve every stylesheet and script under a content-versioned URL with a year-long immutable `Cache-Control`, so a page view downloads none of them again.** | 4 | 2 | 3 | 7 | 6 | 8 by 6, 2 by 2 | 1.8 |
| 3 | 0.4.21 |  |  | **Guard the group paths against self-lockout, or accept the gap explicitly.** | 3 | 2 | 2 | 5 | 6 | 2 by 6 | 1.4 |
| 1 | 0.4.21 |  | owner | **Publish every release to Docker Hub, and give the Hub page its short description.** | 3 | 3 | 2 | 6 | 5 | 1 by 3 | 1.3 |
| 13 | 0.4.21 |  |  | **Accept a verification code pasted with surrounding whitespace.** | 4 | 2 | 3 | 7 | 7 | 2 by 8 | 1.0 |
| 19 | 0.5.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 16 | 0.5.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 6 | 0.5.0 |  |  | **Warn at discovery when a route or nav node gates on a permission no plugin declares.** | 2 | 1 | 1 | 2 | 2 | 7 by 3, 9 by 3 | 8.0 |
| 23 | 0.5.0 |  |  | **Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.** | 3 | 1 | 2 | 4 | 5 | 1 by 4, 9 by 2, code health by 3 | 7.9 |
| 28 | 0.5.0 |  |  | **Let a plugin add entries to the profile menu through the plugin API.** | 2 | 2 | 2 | 4 | 4 | 7 by 4, 1 by 2 | 4.2 |
| 2 | 0.5.0 |  |  | **Rename the admin example plugin to a name that says what it administers.** | 3 | 1 | 2 | 4 | 6 | 9 by 3, code health by 2 | 2.6 |
| 5 | 0.5.0 |  |  | **List grants that no installed plugin declares, with a remove action.** | 2 | 2 | 2 | 4 | 4 | 2 by 3 | 2.1 |
| 14 | 0.5.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Details

### 29. Show the whole nav tree on an engine without `:has()`, and fold it only where `:has()` works.

README → "Two browser floors": Chromium 87 must reach every page. `public/css/styles.css` hides
`.nav-children` and only a `:has()` rule reveals them, so below Chromium 105 (webOS TV 22 and 23)
no nested entry can be reached. Hide the children only inside `@supports selector(:has(a))`. The
theme switch is inert there too, since every theme rule is a `:has()`: hide it under the same guard.

### 35. Raise the contrast of the dark-mode primary button's white text and of the light-mode status badges' text to 4.5:1.

Measured in `public/css/styles.css`: white text on the dark-mode primary button (`--d-accent`
`#6ba0e8`) is 2.69:1, and the text of the light-mode pos, warn and info badges on their backgrounds 4.17, 4.40 and 4.48:1. WCAG AA
needs 4.5:1 for normal text.

### 31. Delete the design-preview rules in `public/css/auth.css` that no view uses.

`.auth-view`, the `:target` screen switch, `.tpl-*`, the `fstate`/`rstate` radios and the
forgot/register alerts match nothing in `views/` or `examples/`.

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

### 32. Fail the gate on a stylesheet feature the browser floor lacks, unless it is guarded.

Nothing checks README → "Two browser floors", and no E2E engine is old enough to show a break.
Lint every stylesheet, the examples' included, against Chromium 87, Safari 15 and Firefox 115, and
allow a feature only inside an `@supports` that guards it.

### 27. Inset the scheduling example's lead text, shift count, alerts and call-to-action by `--pad-x`, like the bars around them.

They sit flush against the content pane's edge while the filter bar, table and pager sit 12px in.
The fix belongs in `examples/plugins/scheduling/public/scheduling.css`; check each page in a browser.

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

### 34. Serve every stylesheet and script under a content-versioned URL with a year-long immutable `Cache-Control`, so a page view downloads none of them again.

`serveStatic` (`src/http/static.ts`) sends only `content-length` and `content-type`, so every page
view downloads `styles.css`, `auth.css` and each plugin's stylesheet again: about 50 kB on a plugin's
issue page, seconds per page over GPRS. Firefox can paint the page unstyled meanwhile, when an
extension forces layout early.

- A versioned URL carries a hash of the file's content, as `?v=<hash>` or in the path, and answers
  `Cache-Control: public, max-age=31536000, immutable`. A release changes the hash, so it still
  reaches every browser at once.
- An unversioned `/public/` URL answers a short `max-age` with revalidation: `ETag` or
  `Last-Modified`, and 304 on `If-None-Match` or `If-Modified-Since`, for GET and HEAD.
- Every `/public/` href the host renders comes out versioned: the shell's `<link>`s and favicon,
  the error pages (`views/403.ejs`, `404`, `500`, `503`, `error`), `views/oauth-consent.ejs`, and
  the `styles` hrefs a plugin passes to `views/partials/shell.ejs`.
- **Recommended: the host versions a plugin's hrefs itself.** A plugin names its asset once, as
  today, and the shell adds the version to any `/public/` href. A helper would make every plugin
  author remember to call it, and adds to the barrel.
- **Contract:** `views/partials/*.ejs` are contract surface (AGENTS.md → Rules). Host-side
  versioning keeps the `styles` option and its meaning, and an unversioned href keeps working, so
  no minor bump of `HOST_API_VERSION` is needed and 0.4.21 holds. A helper exported through
  `@plainpages/plugin-api` would add to the contract and need 0.5.0.
- Pages stay `private, no-store` (`src/http/app.ts`); the static branch returns before that header
  is set.

Tests first, with expected values from this item: `src/http` unit tests for both header sets and the
304s, and an E2E test that a repeat page view fetches no stylesheet again. State the choice once in a
comment in `static.ts`, and in a sentence where the README tells plugin authors and operators about
assets. Requested by plainpages-plugin-fastjira, whose own item waits on the release that ships this.

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

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 16. Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.

Ory's own examples model `Shift`, `Document` and so on. One global `Resource` bucket is the
project's "no catch-all names" rule applied to namespaces.

### 6. Warn at discovery when a route or nav node gates on a permission no plugin declares.

Declaring stays optional on purpose, but the picker is built from declarations only, so such a route
is ungrantable from the GUI and answers a permanent 403. A warning, not an error.

### 23. Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.

Every list screen bridges `parseListQuery`/`paginate` to the partials by hand. At minimum a
`buildPaginationModel(page, hrefFor)`. Exported through the barrel, so it is contract surface.

### 28. Let a plugin add entries to the profile menu through the plugin API.

The profile dropdown stays a dropdown: Sign out is its only entry today, and it will gain more.
`views/partials/shell.ejs` hand-rolls it (AGENTS.md → UI, the dropdown rule), so the entries need a
manifest field that discovery checks, gated like a nav node.

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
