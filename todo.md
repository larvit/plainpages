# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 73`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 19 | 0.6.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 16 | 0.6.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 65 | 0.6.0 |  |  | **Export `KetoError` from `@plainpages/plugin-api`, so a plugin can tell a Keto failure apart with `instanceof`.** | 1 | 2 | 1 | 2 | 1 | 7 by 3, 1 by 1 | 6.7 |
| 72 | 0.6.0 |  |  | **Delete a group's grants and parent memberships when its last member leaves, by group delete or by removing the member, so re-creating the name restores none.** | 2 | 2 | 2 | 4 | 3 | 2 by 4 | 4.2 |
| 67 | 0.6.0 |  |  | **Group `src/auth`'s modules into one subfolder per concern, with `bootstrap.ts` staying at `src/auth/bootstrap.ts`.** | 3 | 1 | 2 | 4 | 6 | code health by 4 | 4.0 |
| 14 | 0.6.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Renamed

- 0.4.21 renamed to 0.5.0
- 0.4.22 renamed to 0.5.0

## Details

### 19. Run the documented Docker commands on macOS and fix whatever misbehaves.

Needs a Mac. Two suspects, both from `--user "$(id -u):$(id -g)"`: a macOS `id -g` is `20`, which is
`dialout` inside the noble image, and Docker Desktop remaps bind-mount ownership in its VM.

### 16. Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.

Ory's own examples model `Shift`, `Document` and so on. One global `Resource` bucket is the
project's "no catch-all names" rule applied to namespaces.

### 65. Export `KetoError` from `@plainpages/plugin-api`, so a plugin can tell a Keto failure apart with `instanceof`.

`src/plugin-host/plugin-api.ts` ~L47-48 exports `KratosError` and `HydraError`, but not `KetoError`
(`src/auth/keto-client.ts:43`), though `ctx.system.keto` throws it. The barrel is the contract
surface, so this adds to the plugin API: it ships in a minor, and `HOST_API_VERSION` must read
`0.6.0` when 0.6.0 is tagged (AGENTS.md → Rules). Adding is safe for installed plugins; removing it
later would take a major.

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

### 67. Group `src/auth`'s modules into one subfolder per concern, with `bootstrap.ts` staying at `src/auth/bootstrap.ts`.

`src/auth` holds 19 modules over several concerns: the per-request session path (`jwt*`, `jwks`,
`denylist`, `csrf`, `gate`, `guards`), the Ory clients (`kratos-*`, `keto-client`, `hydra-admin`,
`fetch-timeout`), the sign-in flows and their views (`routes`, `login`, `flow-view`), the OAuth2
provider (`oauth-*`), and the one-shot CLIs (`bootstrap`, `gen-jwks`). Pick folders a reader can
name, and update the folder list in `docs/decisions.md` → "`src/` is grouped by concern". Leave
`bootstrap.ts` in place, per "`bootstrap.ts` stays under `src/auth/`". Plugins import only the
barrel, so only `src/plugin-host/plugin-api.ts`'s paths change for them. Update the README file
map. Make `src/auth` easier to navigate, a place the seats found hard.

### 14. Drop a double-clicked duplicate submit, with no client-side JavaScript.

A second identical POST is expected from a non-technical user, and today creates two
users, mints two recovery codes, or registers two OAuth2 clients. It must not break a legitimately
repeatable action. Sketch: a CSS-only affordance so the second click has nothing to hit, plus the
host recognising a duplicate (same session, route and payload within a short window), logging and
dropping it. Open: what identifies "the same submission" (a one-time token minted into each form
beats hashing the payload), the window, where the record lives given the host is stateless, and how
a plugin declares a route repeatable.
