# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 60`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 59 | 0.5.0 |  |  | **Lower the reading cost of the files a chunk reads most before its first commit.** | 2 | 2 | 1 | 3 | 4 | code health by 3 | 9.0 |
| 2 | 0.5.0 |  |  | **Rename the admin example plugin to a name that says what it administers.** | 3 | 1 | 2 | 4 | 6 | 9 by 3, code health by 2 | 2.6 |
| 5 | 0.5.0 |  |  | **List grants that no installed plugin declares, with a remove action.** | 2 | 2 | 2 | 4 | 4 | 2 by 3 | 2.1 |
| 41 | 0.5.0 |  |  | **Apply a permission save as one Keto call, so it cannot stop part-way.** | 2 | 2 | 2 | 4 | 3 | 2 by 2 | 2.1 |
| 58 | 0.5.0 |  | owner | **Let an operator hide a plugin's profile-menu entry from `config/menu.ts`.** | 2 | 2 | 2 | 4 | 4 | 7 by 3 | 2.0 |
| 19 | 0.6.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 16 | 0.6.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 14 | 0.6.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Renamed

- 0.4.21 renamed to 0.5.0
- 0.4.22 renamed to 0.5.0

## Details

### 59. Lower the reading cost of the files a chunk reads most before its first commit.

`reading-cost` reports a rise: the last 5 chunks' median is 87251 new input tokens before their
first commit, the 5 before them 70583. The files the last 5 chunks read most: `todo.md` 34 times,
`README.md` 24, `src/plugin-host/plugin.ts` 11, `src/plugin-host/plugin.test.ts` 10, `AGENTS.md` 6.
Cut or split what a chunk reads without needing it, then run `reading-cost --reset`.

### 2. Rename the admin example plugin to a name that says what it administers.

The new name is `auth-admin`, chosen by the maintainer. The id is also the mount path, so the compose files,
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

### 58. Let an operator hide a plugin's profile-menu entry from `config/menu.ts`.

A manifest's `profileMenu` entries have no `id`, and the central override (`NavOverride` in
`src/ui/nav.ts`) targets sidebar nav nodes only, so hiding or renaming one means forking the plugin,
though README → The menu system promises hide and rename for menu items. The fix gives an entry an optional
`id`, unique across plugins through a `findConflicts` kind like `nav-id`, and applies `hide` and
`rename` to it in `profileLinks` (`src/ui/chrome.ts`). The alternative is a decision recording
profile entries as plugin-only, with README saying so. The human chose to keep it in 0.5.0.

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 16. Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.

Ory's own examples model `Shift`, `Document` and so on. One global `Resource` bucket is the
project's "no catch-all names" rule applied to namespaces.

### 14. Drop a double-clicked duplicate submit, with no client-side JavaScript.

A second identical POST is expected from a non-technical user, and today creates two
users, mints two recovery codes, or registers two OAuth2 clients. It must not break a legitimately
repeatable action. Sketch: a CSS-only affordance so the second click has nothing to hit, plus the
host recognising a duplicate (same session, route and payload within a short window), logging and
dropping it. Open: what identifies "the same submission" (a one-time token minted into each form
beats hashing the payload), the window, where the record lives given the host is stateless, and how
a plugin declares a route repeatable.
