# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 43`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 42 | 0.4.21 |  |  | **Lower the reading cost of the files a chunk reads most before its first commit.** | 2 | 2 | 1 | 3 | 4 | code health by 3, 9 by 2 | 10.3 |
| 3 | 0.4.21 |  |  | **Guard the group paths against self-lockout, or accept the gap explicitly.** | 3 | 2 | 2 | 5 | 6 | 2 by 6 | 1.4 |
| 40 | 0.4.21 |  |  | **Show a `users:read` holder "View user" as the user page's heading and breadcrumb, not "Edit user".** | 1 | 2 | 1 | 2 | 2 | 2 by 1 | 1.4 |
| 1 | 0.4.21 |  | owner | **Publish every release to Docker Hub, and give the Hub page its short description.** | 3 | 3 | 2 | 6 | 5 | 1 by 3 | 1.3 |
| 32 | 0.4.21 |  |  | **Fail the gate on a stylesheet feature the browser floor lacks, unless it is guarded.** | 4 | 2 | 2 | 6 | 7 | code health by 2 | 1.1 |
| 13 | 0.4.21 |  |  | **Accept a verification code pasted with surrounding whitespace.** | 4 | 2 | 3 | 7 | 7 | 2 by 8 | 1.0 |
| 19 | 0.5.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 16 | 0.5.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 6 | 0.5.0 |  |  | **Warn at discovery when a route or nav node gates on a permission no plugin declares.** | 2 | 1 | 1 | 2 | 2 | 7 by 3, 9 by 3 | 8.0 |
| 23 | 0.5.0 |  |  | **Give list pages one view-model helper from query to pagination, instead of ~40 hand-written lines each.** | 3 | 1 | 2 | 4 | 5 | 1 by 4, 9 by 2, code health by 3 | 7.9 |
| 28 | 0.5.0 |  |  | **Let a plugin add entries to the profile menu through the plugin API.** | 2 | 2 | 2 | 4 | 4 | 7 by 4, 1 by 2 | 4.2 |
| 2 | 0.5.0 |  |  | **Rename the admin example plugin to a name that says what it administers.** | 3 | 1 | 2 | 4 | 6 | 9 by 3, code health by 2 | 2.6 |
| 5 | 0.5.0 |  |  | **List grants that no installed plugin declares, with a remove action.** | 2 | 2 | 2 | 4 | 4 | 2 by 3 | 2.1 |
| 41 | 0.5.0 |  |  | **Apply a permission save as one Keto call, so it cannot stop part-way.** | 2 | 2 | 2 | 4 | 3 | 2 by 2 | 2.1 |
| 14 | 0.5.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Details

### 42. Lower the reading cost of the files a chunk reads most before its first commit.

`reading-cost` (`docs/reading-cost.md`) reports the figure rising: the last 5 chunks' median is
98975 new input tokens before their first commit, the 5 before them 80251. Read most over the last
5 chunks (opens and searches): `README.md` 27, `todo.md` 24, `src/http/app.test.ts` 10,
`examples/plugins/admin/admin-users.ts` 8, `e2e-tests/full-flow.spec.ts` 7, `ci.sh` 5,
`CHANGELOG.md` 4, `e2e-tests/visual.spec.ts` 3, `examples/plugins/admin/admin-groups.ts` 3,
`examples/plugins/admin/admin-users.test.ts` 3. Make the most-read files cheaper to find one's way
in, such as splitting `src/http/app.test.ts` by concern, and run `reading-cost --reset` in the chunk
that ships this.

### 3. Guard the group paths against self-lockout, or accept the gap explicitly.

The self-revoke guard covers only your own direct grants on the Users screen. Unticking a permission
on a group you belong to, leaving that group, or deleting it can still strip your own access with no
warning. AGENTS.md records this as a known gap. The robust fix is a "last effective holder" check,
which needs a reverse Keto query.

### 40. Show a `users:read` holder "View user" as the user page's heading and breadcrumb, not "Edit user".

The users list now says View for a read-only holder, but the page it opens still titles itself
`admin.users.edit` ("Edit user") with an "Edit" breadcrumb. `buildUserFormModel` in
`examples/plugins/admin/admin-users.ts` already receives `canWrite`; the two admin catalog keys it
needs are new.

### 1. Publish every release to Docker Hub, and give the Hub page its short description.

Hub's newest tag is 0.4.0, while git has v0.4.1 onwards, and the overview still says 0.4.0. No
`release.yml` run exists for the tags auto-release pushes as `renovate-bot`; find out why Gitea
doesn't fire `push: tags` for them, fix it, and backfill the missing tags. fejkdata did this
(`../fejkdata`, commits `51d924a` and `34c8234`), and two parts port directly: a one-line
description riding the existing PATCH as its `description` field, and a unit test that the
description opens a README sentence and every command the overview shows appears in the README.
fejkdata also syncs the page on any push to `main`, with its own token in an environment only `main`
may use; decide whether that fits here, where `{{VERSION}}` must render a released tag.

### 32. Fail the gate on a stylesheet feature the browser floor lacks, unless it is guarded.

Nothing checks README → "Two browser floors", and no E2E engine is old enough to show a break.
Lint every stylesheet, the examples' included, against Chromium 87, Safari 15 and Firefox 115, and
allow a feature only inside an `@supports` that guards it.

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
