# Scheduling — the reference plugin

A worked example of the [plugin contract](../../docs/plugin-contract.md). Copy this folder, rename
it (the folder name becomes the plugin id and mount path), and point it at your own backend.

What it demonstrates:

- **A list page that fetches upstream data** — `GET /scheduling/shifts` calls the upstream REST
  service and renders the rows with the core building blocks (`shifts.ejs` → app shell, filter-bar,
  data-table). Search round-trips the URL; zero-JS.
- **A form that forwards a write upstream** — `GET /scheduling/shifts/new` renders the form,
  `POST /scheduling/shifts` CSRF-verifies it (`ctx.verifyCsrf`) and forwards the create upstream,
  then POST-redirect-GET. The form body lives in the plugin's own `views/partials/shift-form.ejs`,
  reusing the core `field` partial.
- **Permission-gated nav** — the "Shifts" nav leaf and routes are gated on `scheduling:read` /
  `scheduling:write`; the whole "Scheduling" section is invisible to anyone without the grant.

The plugin holds **no state** — data lives upstream (README → *Stateless*). Handlers are thin and
`fetch` is injectable, so they unit-test as pure functions (`shifts.test.ts`).

## Upstream

Set `SCHEDULING_UPSTREAM` to your backend's base URL (it must expose `GET /shifts` and
`POST /shifts`). The dev compose points it at a tiny in-memory mock (`examples/shifts-upstream/`)
so `docker compose up` shows the plugin working out of the box.

## Granting access

A user sees Scheduling once they hold the `scheduling:read` role in Keto (and `scheduling:write`
to create). The one-command bootstrap grants both to the demo admin, so the seeded
`admin@plainpages.local` can use it immediately.
