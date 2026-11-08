# todo

## Scoring

`Score = 100 * V / (2**S + 8)`

`Bar = 1`

`Next ID = 72`

## Items

| ID | Release | Blocked by | Exempt | Item | L | E | I | R | S | Moves | Score |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 63 | 0.5.0 |  |  | **Correct the stale and false comments and docs the comprehension seats flagged, so each states what the code does today.** | 2 | 2 | 1 | 3 | 3 | code health by 3, 9 by 2 | 15.4 |
| 68 | 0.5.0 |  |  | **Make `serveHome` and `serveDashboard` return their result to the request pipeline, as every other stage does, instead of sending it themselves.** | 2 | 1 | 3 | 4 | 3 | code health by 3 | 13.5 |
| 66 | 0.5.0 |  |  | **Make `src/auth/bootstrap.ts` read its settings through `src/config.ts` and call Kratos and Keto through their client modules.** | 2 | 1 | 3 | 4 | 4 | code health by 3 | 9.0 |
| 70 | 0.5.0 |  |  | **Give the duplicated paging loop, Link-header parser and `FieldConfig` type one home each, and rename `buildPluginChrome` to `buildPageChrome`.** | 2 | 1 | 1 | 2 | 3 | code health by 2 | 9.0 |
| 71 | 0.5.0 |  |  | **Delete, with a group, every membership tuple in another group that names it, so re-creating the name restores no nested membership.** | 1 | 2 | 2 | 3 | 2 | 2 by 3 | 4.2 |
| 19 | 0.6.0 |  | question | **Run the documented Docker commands on macOS and fix whatever misbehaves.** | 2 | 2 | 1 | 3 | 3 | 1 by 3 | 3.3 |
| 16 | 0.6.0 |  | question | **Decide whether the single Keto `Resource` namespace splits into per-domain namespaces.** | 3 | 2 | 3 | 6 | 6 | 7 by 2 | 0.5 |
| 65 | 0.6.0 |  |  | **Export `KetoError` from `@plainpages/plugin-api`, so a plugin can tell a Keto failure apart with `instanceof`.** | 1 | 2 | 1 | 2 | 1 | 7 by 3, 1 by 1 | 6.7 |
| 67 | 0.6.0 |  |  | **Group `src/auth`'s modules into one subfolder per concern, with `bootstrap.ts` staying at `src/auth/bootstrap.ts`.** | 3 | 1 | 2 | 4 | 6 | code health by 4 | 4.0 |
| 14 | 0.6.0 |  |  | **Drop a double-clicked duplicate submit, with no client-side JavaScript.** | 4 | 2 | 3 | 7 | 7 | 2 by 7, 1 by 4 | 1.4 |

## Renamed

- 0.4.21 renamed to 0.5.0
- 0.4.22 renamed to 0.5.0

## Details

### 63. Correct the stale and false comments and docs the comprehension seats flagged, so each states what the code does today.

Prose only; no behaviour changes. Make each listed place easier to read, since the seats named
most of them.

- `src/auth/login.ts:43` and `README.md` ~L1367 name an admin "Effective access" view that doesn't
  exist.
- `src/plugin-host/router.ts:4` header says specificity is order-independent; `matchRoute` sorts by
  `:param` count only, so a tie (`/a/:x/b` against `/a/b/:y`) falls to discovery order.
- `ci.sh:9` ("users/groups/roles") and `examples/plugins/scheduling/plugin.ts:37` ("Roles", and
  `<id>:<action>` where the rule is `<resource>:<action>`) use words the project doesn't have.
- `src/plugin-host/system.ts:1-2` calls "the built-in admin screens" the reference consumer; they
  are the `auth-admin` example plugin.
- `examples/plugins/auth-admin/admin-groups.ts:18` says a Keto page; the call is Kratos
  `listIdentities`.
- `compose.yml` ~L166 says consent comes next; `src/auth/oauth-consent.ts` implements it.
- `src/auth/jwt.ts:6-7`: "Signature only — adds claim checks…" lacks its subject (the caller,
  `jwt-middleware.ts`, adds them).
- `src/ui/chrome.ts` ~L69 and ~L143 use `/admin/users` as example paths; admin lives at
  `/auth-admin/users`.
- `README.md` ~L350 says a tuple naming an undeclared permission "gates nothing"; declaring stays
  optional, so a plugin may gate on it. `examples/plugins/auth-admin/README.md:49` says six
  permissions; `plugin.ts` declares seven.
- `examples/plugins/auth-admin/views/partials/group-detail-body.ejs:2-7` documents member
  `kind:"identity"` where the model says `"user"`, and omits the `canWrite` and `permissions`
  locals.
- `src/auth/bootstrap.ts:1-8` header lists the JWKS, admin and Keto steps, not the plugin-storage
  step.
- The custom-property `unset` footgun is stated only in `src/test-tooling/stylesheet-floor.ts:10-12`;
  say it beside the tokens at `public/css/styles.css:9-23`, where an author writes one.

### 68. Make `serveHome` and `serveDashboard` return their result to the request pipeline, as every other stage does, instead of sending it themselves.

In `src/http/app.ts`, both (~L143-169) call `sendResult` with the owning plugin's renderer and
return `null` when a plugin owns the slot, and return a `RouteResult` otherwise, so a reader of
`handleRequest` (~L183) and `prepareRequest` (~L274) meets two return conventions. Return the
result with whatever names its renderer and let the one send stage render it. Make
`prepareRequest` and `handleRequest` easier to read, places the seats found hard. The 19-field
`Host` bag is left alone: no checkable target for it came out of the scoring run.

### 66. Make `src/auth/bootstrap.ts` read its settings through `src/config.ts` and call Kratos and Keto through their client modules.

`seedAdminAndPermissions` (~L221-233) reads `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `KETO_WRITE_URL`,
`KRATOS_ADMIN_URL` and `APP_URL` from the environment with its own defaults, which repeat
`src/config.ts` (~L170-186) beside its "loaded once" promise. `seedAdmin` (~L86) and
`findIdentityId` call Kratos and Keto with raw `fetch` where `createKratosAdmin` (`createIdentity`,
`listIdentities` with `credentialsIdentifier`) and `createKetoClient` (`writeTuple`) exist. Check
that `loadConfig` doesn't demand settings the one-shot service lacks; else reuse its readers. The
seed stays idempotent (a Kratos 409 still means an existing admin). Make the `bootstrap.ts` header
easier to read, a place the seats found hard.

### 70. Give the duplicated paging loop, Link-header parser and `FieldConfig` type one home each, and rename `buildPluginChrome` to `buildPageChrome`.

- `pagedTuples` (`examples/plugins/auth-admin/admin-groups.ts` ~L246) and `heldPermissions`
  (`admin-grants.ts` ~L38) each hand-write the Keto page-token loop; let `heldPermissions` use the
  one loop.
- `nextPageToken` is copied in `src/auth/kratos-admin.ts` ~L46 and `src/auth/hydra-admin.ts` ~L106.
- `FieldConfig` lives in `admin-users.ts`, and `admin-groups.ts` and `admin-clients.ts` import it
  from there; move it to `admin-shared.ts`.
- `buildPluginChrome` (`src/ui/chrome.ts:55`) builds the chrome for every page, core pages
  included; rename it, its test and the README ~L1027 mention. Make `buildPluginChrome` easier to
  read, a place the seats found hard.

### 71. Delete, with a group, every membership tuple in another group that names it, so re-creating the name restores no nested membership.

Groups nest: a parent holds `Group:<parent>#members` with `subject_set` `Group:<child>#members`.
`groupsDelete` in `examples/plugins/auth-admin/admin-groups.ts` drops the child's own member tuples
and held grants, but not those parent tuples, so a group re-created with the deleted name is back
in every parent, the orphan class its comment already guards against for grants. List them with
`pagedTuples` filtered on `subject_set` (`namespace: GROUP_NS`, `object: name`, `relation: MEMBERS`)
and add them to the same `transactTuples` delete; extend the comment to say so.

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
