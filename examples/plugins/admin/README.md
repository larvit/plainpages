# Admin — the system-administration plugin

The Users / Groups / OAuth2-clients screens for running Plainpages itself. These used to be
built into the core; they now ship as a **drop-in example plugin** so a fresh clone has no admin GUI
until you opt in. Copy this folder into `plugins/` (it keeps the id and mount path `admin`, so the
screens live at `/admin/*`) and restart:

```bash
cp -r examples/plugins/admin plugins/admin
docker compose restart web
```

The bootstrap grants the seeded `admin@plainpages.local` every permission this plugin declares, so the
section appears in the menu and the screens work immediately.

Every string it renders comes from its own catalogs (`i18n/en-US.ts`, `i18n/sv-SE.ts`) — the nav
labels included, which are catalog keys in `admin-shared.ts`. Each pure view-model builder takes an
optional `t`; the handlers pass `ctx.t`, and the default is the plugin's own English so a unit test
reads in words rather than keys. (README → [Languages](../../../README.md#languages-i18n).)

## What it demonstrates — a *system* plugin

Most plugins fetch their data from an upstream service of their own (see the [scheduling
reference](../scheduling/README.md)). The admin screens instead administer **Plainpages' own identity
stack**, so they use the privileged **`ctx.system`** surface the host exposes to a system plugin:

- **`ctx.system.kratosAdmin`** — create/edit/deactivate/delete Kratos identities (Users).
- **`ctx.system.keto`** — read/write the Keto relationship graph (group membership, permission grants).
- **`ctx.system.hydra`** — register/list/delete Ory Hydra OAuth2 clients.
- **`ctx.system.revoke(sub)`** — the optional instant-revoke hook: a deactivate/delete or a
  user's permission change kills that subject's live tokens at once instead of waiting out the JWT TTL.

`ctx.system` is populated only when the host wired those services (the dev stack wires Kratos + Keto,
and Hydra when configured). Where a capability is absent the screen degrades to a themed 503 rather
than crashing — see `admin-shared.ts`. Everything else is an ordinary plugin: folder-discovered,
gated per route by its screen's `<resource>:<action>` permission, rendering the core building blocks
in `views/`.

Each screen is its own resource — `users`, `groups`, `oauth2-clients` — and each splits into `:read`
and `:write`, so a helpdesk account can be given `users:read` alone. The nav is filtered by the same
permissions: holding none of the three hides the Admin section entirely.

There is **no Permissions screen**. Permission names are declared in plugin code, not created in a
GUI, so the host's catalog (`ctx.declaredPermissions`) is the fixed list — and holding one is a
property of a user or a group, edited as a checkbox list on those two screens (`admin-grants.ts`).

## Layout

- `plugin.ts` — the manifest: the Admin nav fragment, the eight permissions the plugin declares, and
  the route table — one thin handler per method+path, gated via `adminPermission(resource, method)`
  so a GET needs `:read` and a POST `:write`.
- `admin-grants.ts` — the permission picker and the grant diff, shared by the Users and Groups
  screens: what a submitted checkbox set grants and revokes, against the host's declared catalog.
- `admin-users.ts` · `admin-groups.ts` · `admin-clients.ts` — each a set of pure
  view-model builders (unit-tested in the matching `*.test.ts`) plus thin per-route handlers keyed on
  `ctx.params` (the host extracts `:id`/`:name`), sharing a small `withX` wrapper that resolves the
  screen's permission gate + the needed `ctx.system` clients once.
- `admin-shared.ts` — the permission naming (`adminPermission`), the shared gate
  (`requirePermission`), CSRF form reader (`guardedForm`), confirm
  model, nav fragment, and the not-found / unavailable helpers.
- `views/` — the screens' EJS, plus the admin-specific body partials under `views/partials/`. They
  `include()` the core building-block partials (shell, data-table, filter-bar, field, …).

The four screens hold **no state** — everything lives in Ory. Handlers are thin, so their builders
unit-test as pure functions with no host; the HTTP routing/gate/CSRF is covered in
`src/http/app.test.ts` (which mounts this plugin) and end-to-end in `e2e-tests/full-flow.spec.ts`.
