# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 74`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 72 | 0.6.0 |  |  | **Delete a group's grants and parent memberships when its last member leaves, by group delete or by removing the member, so re-creating the name restores none.** | 2 | 2 | 2 | 4 | 3 | 2 by 4 | 4.2 |
| 14 | 0.6.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |
| 67 | 0.6.0 |  |  | **Group `src/auth`'s modules into one subfolder per concern, with `bootstrap.ts` staying at `src/auth/bootstrap.ts`.** | 3 | 1 | 2 | 4 | 6 | code health by 4 | 1.0 |
| 19 | 0.7.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 73 | 0.7.0 |  | owner | **Reach the comprehension floor: make the request pipeline in `src/http/app.ts` and the locale and EJS-locals plumbing readable one unit at a time, so every dimension mean reaches 7.0.** | 3 | 1 | 2 | 4 | 7 | code health by 7 | 0.9 |

## Renamed

- 0.4.21 renamed to 0.5.0
- 0.4.22 renamed to 0.5.0

## Details

### 72. Delete a group's grants and parent memberships when its last member leaves, by group delete or by removing the member, so re-creating the name restores none.

In `examples/plugins/auth-admin/admin-groups.ts` a group exists exactly while it has a
`Group:<name>#members` tuple. Two paths empty a group but keep its other tuples, so re-creating the
name silently hands every new member the old permissions and parent memberships:

1. `groupsDelete` of a group that is a parent's only member: the parent ceases to exist but keeps
   its `Permission:*#granted@Group:<parent>#members` grants and its memberships in grandparents.
2. `groupsRemoveMember` removing a group's last member, which today is a lone `deleteTuple`.

Fix both in one `transactTuples` with the removal: when the removal leaves a group with no members,
add its grants and the tuples naming it as a member of other groups to the delete. The cascade is
transitive: a grandparent emptied by its parent vanishing is the same bug one level up. The walk
stops at a group that keeps any member, so a nesting cycle (`groupsAddMember` refuses only a
self-nest) ends it. An emptied group grants nobody, so the cascade cannot change what
`lostToSelf` computes. Test it with nesting two levels deep and with a cycle.

When it ships, rewrite the comment at `groupsDelete` that points here, and the CHANGELOG entry "The
admin example removes a deleted group from the groups it was nested in", which then says a parent
left with no members no longer exists as a group. `lostToSelf`, in this file, is a place the seats
found hard; if the change touches it, make it easier to read.

### 14. Drop a double-clicked duplicate submit, with no client-side JavaScript.

A second identical POST is expected from a non-technical user, and today creates two
users, mints two recovery codes, or registers two OAuth2 clients. It must not break a legitimately
repeatable action. Sketch: a CSS-only affordance so the second click has nothing to hit, plus the
host recognising a duplicate (same session, route and payload within a short window), logging and
dropping it. Open: what identifies "the same submission" (a one-time token minted into each form
beats hashing the payload), the window, where the record lives given the host is stateless, and how
a plugin declares a route repeatable.

### 67. Group `src/auth`'s modules into one subfolder per concern, with `bootstrap.ts` staying at `src/auth/bootstrap.ts`.

`src/auth` holds 19 modules over several concerns: the per-request session path (`jwt*`, `jwks`,
`denylist`, `csrf`, `gate`, `guards`), the Ory clients (`kratos-*`, `keto-client`, `hydra-admin`,
`fetch-timeout`), the sign-in flows and their views (`routes`, `login`, `flow-view`), the OAuth2
provider (`oauth-*`), and the one-shot CLIs (`bootstrap`, `gen-jwks`). Pick folders a reader can
name, and update the folder list in `docs/decisions.md` → "`src/` is grouped by concern". Leave
`bootstrap.ts` in place, per "`bootstrap.ts` stays under `src/auth/`". Plugins import only the
barrel, so only `src/plugin-host/plugin-api.ts`'s paths change for them. Update the README file
map. Make `src/auth` easier to navigate, a place the seats found hard.

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 73. Reach the comprehension floor: make the request pipeline in `src/http/app.ts` and the locale and EJS-locals plumbing readable one unit at a time, so every dimension mean reaches 7.0.

The scoring run on PR #247 at 7e8bdd9 gave means Navigation 7.50, Locality 6.63, Shape 6.88, Self-sufficiency 6.88, Overall 7.13. Locality is the lowest. Item 67 covers the `src/auth` folder, so this item leaves it out.

Places the seats named, to make easier to read:
- `src/http/app.ts:67` `createApp`: about 130 lines of closures that refer to each other, and `switchBase` reads `builtinRoutes`, which is declared later; all four seats named it.
- `src/http/app.ts:263` `prepareRequest` and `src/http/context.ts:97` `buildContext`: chrome is memoized lazily in both, and an untyped `shared` bag feeds the context, so a new context field touches about five declarations.
- `src/http/app.ts:202` `Host`: restates the options and locals a third time.
- `src/i18n/locale.ts:81` `chosenLocale`: recovers "was a locale requested" from `localeHref("/") === "/"`, so its name hides the mechanism.
- `views/partials/data-table.ejs:74`, `views/partials/menu.ejs:22` and `views/partials/filter-bar.ejs:26`: EJS locals leak into includes, defended by explicit null options.
- `src/server.ts:25` `delete process.env["PLUGIN_DB_SECRET"]`: a load-bearing order rule in a top-level script.
- `public/css/styles.css:81`: the dark and light token mapping is written three times.
- `src/auth/routes.ts:58` `flowFailure`: Kratos statuses that no comment in the file explains.

Aim: a reader of one unit should not need the other units open beside it. Re-run the scoring run when it ships.
