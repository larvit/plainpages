# Admin — the system-administration plugin

The Users / Groups / Roles / OAuth2-clients screens for running Plainpages itself. These used to be
built into the core; they now ship as a **drop-in example plugin** so a fresh clone has no admin GUI
until you opt in. Copy this folder into `plugins/` (it keeps the id and mount path `admin`, so the
screens live at `/admin/*`) and restart:

```bash
cp -r examples/plugins/admin plugins/admin
docker compose restart web
```

The seeded `admin@plainpages.local` already holds the `admin` role, so the section appears in the
menu and the screens work immediately.

## What it demonstrates — a *system* plugin

Most plugins fetch their data from an upstream service of their own (see the [scheduling
reference](../scheduling/README.md)). The admin screens instead administer **Plainpages' own identity
stack**, so they use the privileged **`ctx.system`** surface the host exposes to a system plugin:

- **`ctx.system.kratosAdmin`** — create/edit/deactivate/delete Kratos identities (Users).
- **`ctx.system.keto`** — read/write the Keto relationship graph (Groups, Roles).
- **`ctx.system.hydra`** — register/list/delete Ory Hydra OAuth2 clients.
- **`ctx.system.revoke(sub)`** — the optional instant-revoke hook: a deactivate/delete or a
  user's role change kills that subject's live tokens at once instead of waiting out the JWT TTL.

`ctx.system` is populated only when the host wired those services (the dev stack wires Kratos + Keto,
and Hydra when configured). Where a capability is absent the screen degrades to a themed 503 rather
than crashing — see `admin-shared.ts`. Everything else is an ordinary plugin: folder-discovered,
gated per route by `permission: "admin"`, rendering the core building blocks in `views/`.

## Layout

- `plugin.ts` — the manifest: the gated Admin nav fragment, the `admin` permission token, and the
  route table — one thin handler per method+path, all gated by `permission: "admin"`.
- `admin-users.ts` · `admin-groups.ts` · `admin-roles.ts` · `admin-clients.ts` — each a set of pure
  view-model builders (unit-tested in the matching `*.test.ts`) plus thin per-route handlers keyed on
  `ctx.params` (the host extracts `:id`/`:name`), sharing a small `withX` wrapper that resolves the
  admin gate + the needed `ctx.system` clients once.
- `admin-shared.ts` — the shared gate (`requireAdmin`), CSRF form reader (`guardedForm`), confirm
  model, nav fragment, and the not-found / unavailable helpers.
- `views/` — the screens' EJS, plus the admin-specific body partials under `views/partials/`. They
  `include()` the core building-block partials (shell, data-table, filter-bar, field, …).

The four screens hold **no state** — everything lives in Ory. Handlers are thin, so their builders
unit-test as pure functions with no host; the HTTP routing/gate/CSRF is covered in
`src/http/app.test.ts` (which mounts this plugin) and end-to-end in `e2e-tests/full-flow.spec.ts`.
