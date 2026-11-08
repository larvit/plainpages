# Decisions

"Goal N" is README → Goals. "Code health" is the goal every project shares: the code is easy to
understand and change safely.

## `src/` is grouped by concern, and the core ships no domain screens

2026-06-24, the maintainer. Code health and goal 3. Valid while each concern folder stays one a
reader can name.

The folders are `http/`, `auth/`, `i18n/`, `plugin-host/`, `ui/`, and `test-tooling/` (modules only
tests import), with `server.ts`, `config.ts`, `logger.ts` and the topology-guard `*.test.ts` at the
root. Tests are co-located. Add a new module to the folder owning its concern. Even the admin GUI
is a drop-in plugin (`examples/plugins/auth-admin/`).

## Plugins and config import the host only through the two barrels

2026-08-17, the maintainer. Goal 7. Valid while plugin authors typecheck against a host tree rather
than a published package.

`@plainpages/plugin-api` → `plugin-api/index.ts` → `src/plugin-host/plugin-api.ts`, and
`#menu-config` → `src/ui/menu-config.ts`; never a relative `../../src/*` path. These two barrels are
the whole contract surface, so don't "fix" either back to a relative path.

## The Ory client types are contract-visible through the barrel

2026-07-02, the maintainer. Goal 7. Valid while plugins get Ory admin clients through `ctx.system`.

`@plainpages/plugin-api` re-exports `KratosAdmin`, `KetoClient`, `HydraAdmin`, their DTOs and their
error classes. Changing those shapes needs a major `apiVersion` bump, not a free refactor.

## The barrel is a package, so a plugin folder may carry its own `package.json`

2026-08-17, the maintainer. Goal 7. Valid while plugins may depend on npm packages (README → Plugin
dependencies).

The Dockerfile links the barrel into `/node_modules`, above every plugin scope. Never let a copy
reach a plugin's own `node_modules`: two instances of the barrel break `instanceof` across the
boundary. `plugin-api.test.ts` guards this by asserting both paths reach one module.

## Plugin storage hands over credentials, not a client

2026-08-18, the maintainer. Goals 3 and 7. Valid while the host stays stateless (AGENTS.md →
priority 2).

README → Plugin storage describes the contract. The host takes `postgres` only to run the
provisioning DDL, and `storage-provisioning.ts` is the only module importing it. `storage.ts`
beside it stays pure, so `web` never loads a driver. `src/postgres.test.ts` guards both halves,
because one value imported from the wrong module breaks this invisibly. The driver is never
re-exported through the barrel, so no driver shape enters the contract.

Three properties hold the design together, so don't trade one away in isolation:

- Passwords are `HMAC-SHA256(PLUGIN_DB_SECRET, id)` rather than stored, which keeps the host
  stateless. Whoever holds that secret holds every plugin database, so it ranks with the DB password
  itself.
- The provisioning DSN reaches `bootstrap` only (`src/compose.test.ts` guards the split).
- Provisioning never drops anything, so uninstalling a plugin cannot destroy data; boot logs the
  orphans instead.

Because the host's copy sits in the ambient `/node_modules`, a plugin can `import "postgres"`
without declaring it. That is incidental, not a packaging promise: a plugin must still depend on its
own driver.

## Plugin settings are declared, not discovered

2026-08-23, the maintainer. Goals 7 and 10. Valid while settings reach plugins through the
environment (README → Plugin settings).

`settings.ts` is pure and takes the env as an argument, so the whole matrix unit-tests without a
stack. Four rules carry the design:

- The prefix is `PLUGIN_SETTING_`, never bare `PLUGIN_`: a plugin id `db` with key `url` would
  otherwise name the host's own `PLUGIN_DB_URL`.
- Keys are camelCase, so the `camelCase → SNAKE_CASE` mapping is total and no two keys collide.
  `findConflicts` (`plugin-host/conflicts.ts`) catches the residual cross-plugin collision.
- `required` and `default` are mutually exclusive. That lets `SettingsOf` type a declared key as
  present rather than `T | undefined`, so no plugin author casts.
- A secret's value reaches the plugin but never a log, an error or `ctx.declaredSettings`, not even
  as a mask or a length.

An author mistake is refused at discovery, a bad operator value refuses the boot, and a stray
`PLUGIN_SETTING_` variable only warns, as an orphan database does.

## The trust boundary is the `web` process, not the plugin

2026-08-19, the maintainer. Goal 7. Valid while plugins are operator-installed code, not third-party
uploads.

Per-plugin databases and roles bound accidents, not hostile plugins: `PLUGIN_DB_SECRET` is in
`web`'s environment during `onBoot`, and a plugin already holds `ctx.system`'s Ory admin clients. So
cross-plugin DB isolation is containment, and README says so. This follows AGENTS.md → priority 7:
crash-isolation is a non-goal.

`server.ts` still deletes the secret from `process.env` right after `loadConfig`, before discovery
imports any plugin module. That ordering is the whole point: move the line earlier if anything,
never later.

## `ory/postgres/init/init.sql` is the only home for the Ory databases' ACL

2026-08-19, the maintainer. Code health. Valid while Ory's databases are created by Postgres' first
init.

Don't re-assert the `REVOKE CONNECT` from `bootstrap`. `REVOKE` only warns when the caller doesn't
own the database, so under the least-privilege provisioning account the README recommends it would
report success while changing nothing. It also hard-fails whenever `PLUGIN_DB_ADMIN_URL` names a
server with no `kratos`. The script runs only on first init, so a revoke added to it later never
reaches a volume that already exists: `docker compose down -v` is the dev remedy, and a deployed
install needs a migration.

## `bootstrap.ts` stays under `src/auth/`

2026-08-19, the maintainer. Code health. Valid until a third seeding concern lands.

It provisions plugin databases as well as seeding Ory, but it is the one-shot service's entrypoint,
not an auth module. Moving it to `src/bootstrap.ts` would edit `compose.yml`, five e2e compose files
and `src/compose.test.ts` for a rename.

## `BootContext.storage` keeps all six credential fields, and there is no `onShutdown` hook

2026-08-19, the maintainer. Goal 7. Valid while no plugin needs an orderly drain of its pools.

Removing any field from the context costs a major bump, so all six stay. Adding one costs only a
minor, so the context otherwise gains a field only when a plugin needs it. Pools handed to a plugin
are reaped on process exit.

## `config/` is a plain dir with no `package.json` of its own

2026-07-01, the maintainer. Goal 7. Valid while an operator's menu override needs no dependencies.

With a `package.json` there, `#menu-config` resolves against it instead and boot fails loud. If the
override ever needs dependencies, `config/` needs the package treatment `plugins/` has.

## A plugin `package.json` without `"type": "module"` is refused, not warned

2026-08-18, the maintainer. Goal 7. Valid while nothing is installed in the wild.

Refusing is the safe direction: refuse→warn relaxes freely, while warn→refuse breaks installed
plugins. Allowing it would cost only a warning and a re-parse per file, not a break: Node detects
module syntax, so even a `.js` helper loads. The cost of refusing is that an operator on a read-only
third-party mount cannot apply the remedy.

## `examples/` mirrors the drop-in mount dirs

2026-07-01, the maintainer. Goal 9. Valid while the examples are meant to be copied in unchanged.

`examples/plugins/<id>/` copies to `plugins/<id>/`, and `examples/config/menu.ts` to
`config/menu.ts`. Both mirrors are in `tsconfig.include` and resolve the host through the barrels,
so each typechecks in place and copies across unchanged. Never commit real plugins or config into
the root mount dirs: they ship empty.

## `ctx.chrome` is lazily memoized, never built unconditionally

2026-06-23, the maintainer. Goal 8. Valid while the public landing (`/`) renders without I/O.

Don't make it unconditional or move it into the base request context: it protects the I/O-free hot
path on the public, bot-hit landing.

## A plugin-owned render always runs on that plugin's context

2026-08-03, the maintainer. Goal 7. Valid while each plugin has its own translator.

The landing slots (`home`, `dashboard`) and an `onRequest` short-circuit build their context with
`contextFor(pluginId)`, exactly as a plugin route does. Otherwise `ctx.t` is the core translator and
the plugin's own keys render as bare keys on the pages it owns.

## Email is delegated to Kratos

2026-06-23, the maintainer. Goal 3. Valid while Kratos owns the recovery and verification flows.

`web` never touches SMTP. Mail is customized through Kratos' `courier.template_override_path`.

## The vocabulary is `User` → `Group` → `Permission`, and there is no `Role`

2026-08-03, the maintainer. Code health. Valid while Keto holds no namespace of its own.

Keto ships no namespaces: all four in `ory/keto/namespaces.keto.ts` are ours. A permission is one
operation ("read shifts"). A role is a bundle, which here is just a group with several grants, and
groups nest. Ory's own "permission" (the `Resource` `permits`: view, edit, delete) is the separate
per-row tier.

## A permission name is always `<resource>:<action>`, enforced at discovery

2026-08-05, the maintainer. Goal 7. Valid while permissions are named by plugin authors.

Examples: `scheduling:read`, `users:write`. A bare word names who someone is (a role), and roles are
groups here. `shapeError` checks every route, nav and profile-menu `permission`, and every declared
name, with `isValidPermissionName` (`plugin-host/plugin.ts`). A bad name refuses the boot like any
other manifest rule. The check is not left to the admin GUI, which an operator removes by not
copying it in.

## Permission names are authored in plugin code; only grants live in Keto

2026-08-05, the maintainer. Goal 2. Valid while the admin screens offer only declared names.

The host collects every installed plugin's declarations into one catalog (`declaredPermissions` →
`ctx.declaredPermissions`), and that catalog is the list the admin screens offer. Hence there is no
Permissions admin screen: nothing in a GUI invents a name, and holding one is a property of a user
or group, edited as a checkbox list there. A Keto tuple naming something no installed plugin
declares is not offered as a checkbox, and is never revoked by an unrelated save: the picker only
speaks for what it showed. A plugin may still gate on such a name, so it can be live. The user's or
group's page lists such a direct grant separately, each with its own Remove button.

## A permission's `<resource>` is global, not plugin-scoped

2026-08-05, the maintainer. Goal 7. Valid while cross-plugin sharing of permissions is wanted.

Hence `oauth2-clients`, not `clients`. Users are the host's, and plugins share them. The cost is
that collision-freedom is a convention rather than structural; the alternative penalizes the
sharing case.

## Declaring a permission stays optional

2026-08-05, the maintainer. Goal 7. Valid while plugins may share a permission.

Mandatory declaration would let `findConflicts` see every overlap, but it would then warn on exactly
the legitimate sharing case. Shape is enforced; declaration is not.

## `ADMIN_PERMISSIONS` defaults to empty, and an unusable value is dropped with a warning

2026-08-05, the maintainer. Goal 10. Valid while `bootstrap` is the only writer of grants.

Fail-loud belongs at the manifest boundary, where a developer authored the mistake. `bootstrap`
gates `web`, so refusing operator env would take the whole stack down;
`e2e-tests/compose.auth.yml` seeds a bad value to prove the container survives one.

The seed is a function of what `bootstrap` discovers, so a plugin dropped in after first boot needs
`docker compose up -d`, not `restart web`. `bootstrap`'s matching `./plugins` mount belongs in
`compose.override.yml` and nowhere else. In the base file it would desynchronise prod and collide
with the e2e stacks, which bind individual plugins inside `/app/plugins`: a nested mount into a
read-only parent is EROFS, and the container never starts.

## `actionForMethod` is plugin-local and stays out of `@plainpages/plugin-api`

2026-08-05, the maintainer. Code health. Valid while route tables name their permission per route.

Inside the auth-admin example it keeps the route table and the in-handler guard deriving from one
function, so 29 routes × 2 gate sites cannot drift. Generalised, it would make authorization a
function of the transport verb, and a route table must answer "what does this need?" on its own.

## A gate is one of `public`, `session` or `permission`, named exactly once

2026-09-02, the maintainer. Goal 7. Valid while routes and nav nodes are declared in plugin
manifests.

A route or nav node names exactly one gate. Discovery refuses none, two, and a flag spelled anything
but `true`, so a forgotten gate fails the boot rather than publishing a page. `src/auth/gate.ts` is
the one home of the rule that the plugin router, the host's own route table and the menu all read.
The rule binds manifests only; the comment on `allows` says why a node without a gate passes it.

`session` exists because a plugin whose data is the visitor's own (their upstream account, their own
tokens) has no distinction a permission could name. The alternative, granting every newly
registered user a permission, couples the identity lifecycle to a Keto write that nothing retries
when it fails. A page scoped to "mine" joins on `ctx.user.id`, never the email: an address is
user-changeable and can be reassigned to someone who would then inherit the previous holder's rows.

## The reference plugin's two shift pages duplicate a view model and markup

2026-09-02, the maintainer. Goal 9. Valid while `examples/plugins/scheduling` stays a teaching
artifact rather than a maintained product.

Each page then reads top to bottom on its own, and an example rarely changes, so the two copies cost
little.

## A `:read`-only holder is never shown a write affordance

2026-08-05, the maintainer. Goal 2. Valid while the admin GUI splits `:read` from `:write`.

The list and detail models carry `canWrite`, and the views drop create, save, delete, add and
remove. The permission picker still renders, disabled, because seeing who holds what is the point
of `:read`. A write-intent GET (a create form, a delete-confirm page) is the exception to
`actionForMethod` and gates on `:write`.

Three guards go with it:

- You cannot revoke your own direct grants, since undoing that self-lockout needs a `curl` against
  Keto.
- A permission held through a group renders ticked but disabled, because unticked would state the
  opposite of the truth.
- Unticking a permission on a group you are in, removing yourself (or a nested group you are in)
  from its members, or deleting the group is refused when you would lose a permission you don't hold
  directly. Undoing that self-lockout would need a `curl` against Keto too.

## `users:write` and `groups:write` each amount to full administrative access

2026-08-05, the maintainer. Goal 2. Valid while the admin GUI splits its write permissions by
resource.

`groups:write` adds you to any group, including one holding every permission; `users:write` mints a
recovery code for any account. The containment the split buys is real on the read half only:
`users:read` is a safe helpdesk grant. Don't let the per-resource naming imply otherwise in docs.

## The CSRF token is unbound to the session

2026-10-30, the maintainer. Goal 5. Valid while the session cookie stays `SameSite=Lax` or stricter.

Leaving the token unbound is the usual cost of a signed double-submit token (`src/auth/csrf.ts`;
README → Security model). `SameSite=Lax` and HSTS cover that cost.

## Plainpages says "user" everywhere, where Ory says "identity"

2026-08-05, the maintainer. Code health. Valid while Kratos' wire shape names the DTO `Identity`.

House style, not a renamed concept. The single exception is the `Identity` DTO in
`src/auth/kratos-admin.ts`, which mirrors Kratos' wire shape: don't rename it.

## The locale lives in the URL, never in a cookie

2026-08-03, the maintainer. Goal 5. Valid while a page's language should show in its address.

The host resolves the locale from `?locale=sv-SE`, then `Accept-Language`, then `en-US`. When the
URL asked for a locale, the host carries it onto the links it renders. A cookie would make a page's
language invisible in its address and unshareable; the cost is that a plugin wraps its own hrefs.
Matching is exact on a full tag (`sv-FI` ≠ `sv-SE`), except that a lone language from
`Accept-Language` takes the first regional catalog for it.

## The core building blocks carry the locale, so a plugin doesn't have to

2026-08-03, the maintainer. Goal 1. Valid while the locale lives in the URL.

The shell, `pagination`, `filter-bar`, `data-table`, `auth-card`, `flow-body`, `field` and `menu`
wrap every href in `localeHref`. Nav and sign-in are wrapped in `chrome.ts`. The two GET forms carry
the locale as a hidden `locale` input, since a GET submit replaces the whole query string.

A form's `action` counts as a link: sign-out, consent and auth-card forms carry the locale too, or
picking a language and then saving anything drops back to `Accept-Language`. The obligation stays on
the building block, never on each call site. `ctx.localeHref` remains for hrefs a plugin's own
markup emits. The one round-trip that cannot carry the locale is the Kratos sign-in POST, to an
absolute off-site URL.

## `locale` and the i18n view locals are reserved by the host

2026-08-03, the maintainer. Goal 7. Valid while the locale lives in the URL.

`locale` is in `parseListQuery`'s reserved set, so a localized list page doesn't hand a plugin a
phantom `locale` filter. The view locals `t`, `locale`, `locales`, `localeHref`, `localeParam`,
`localeSwitch`, `dir` and `assetHref` are merged after a handler's `data`, so a collision loses the
key instead of breaking the shell.

## Catalogs are checked at boot, not at render

2026-08-03, the maintainer. Goal 7. Valid while catalogs are TypeScript modules loaded at boot.

Every locale is compared against its set's `en-US`: keys, string-vs-plural kind, and the plural
categories `Intl.PluralRules` requires. A mismatch stops startup. A plugin may ship fewer locales
than the host, with its strings falling back to `en-US` per key, but never one the host lacks.

## `locales/` at the repo root is a drop-in mount

2026-08-03, the maintainer. Goal 7. Valid while adding a language must not require forking the
image.

Like `plugins/` and `config/`: `locales/<tag>.ts` for the core, `locales/plugins/<id>/<tag>.ts` for
a plugin. A new tag adds a language; an existing one replaces that catalog wholesale. The shipped
`en-US` stays the parity baseline even when the mount replaces it, so a mounted catalog is checked
rather than trusted. One compared only against itself would boot green with the whole UI rendering
keys.

## The language picker is on every page, POST-rendered ones included

2026-08-04, the maintainer. Goal 2. Valid while the picker is expected on literally every page; if
that softens, hiding it after a POST is simpler.

A POST-rendered URL often answers no GET (`POST /auth-admin/users/:id/recovery`), so the host resolves
the picker's target (`app.ts` → `switchBase`): this path when it answers GET, else the same-origin
Referer, else `/`. The accepted cost: switching language there leaves that POST's own result behind.

## An unknown translation key renders as itself

2026-08-03, the maintainer. Goal 7. Valid while labels may be either a key or plain text.

That single rule lets a nav label, branding, or a menu `rename` be either a key or plain text,
without a second field or a migration. Don't "fix" it into a loud failure: a manifest with plain
labels must keep working.

## `t()` returns raw text, and the view escapes it

2026-08-03, the maintainer. Code health. Valid while views escape with `<%= %>`.

Messages go through `<%= %>` like any other value. One carrying markup uses `<%- %>`, and then its
`{{vars}}` are escaped at the call site. Don't move escaping into `t()`: every other value in a view
would become the odd one out.

## RTL is out of scope until there is a real use case

2026-08-04, the maintainer. Goal 6. Valid while no deployment needs an RTL language.

`textDirection` sets `<html dir>` because that is free and correct, but the stylesheet keeps
physical `left` and `right` properties. A genuine RTL locale needs those moved to logical ones
first.

## A dropdown is a `<button popovertarget>` and a `[popover]`, never a `<details>`

2026-08-05, the maintainer. Goals 4 and 6. Valid while the popover API is the only zero-JS way to
dismiss on an outside click.

The browser owns open and close, and the panel sits in the top layer, so a row kebab is not clipped
by `.table-wrap`'s `overflow`. Four rules hold it together:

- The panel carries `position-anchor: auto`: a bare `anchor()` resolves to nothing in all three
  engines.
- The panel stays the trigger's next sibling inside the `.menu` wrapper, which the open-state style
  and the old-browser fallback both read.
- The partial requires a caller-named `id` and fails loud without one, since that is the
  `popovertarget` idref. Never generate one: nondeterministic HTML forecloses caching.
- Neither `aria-expanded` nor `aria-haspopup` is written. Every engine maintains the first itself on
  a declarative `popovertarget` invoker, so a hand-written one replaces a live state with a static
  lie. The second would promise `role="menu"` semantics these panels don't implement.

That `aria-expanded` guarantee is the declarative attribute's alone: open a panel from script and no
engine applies it, so "enhancing" one of these triggers would cost it its accessibility. `<details>`
stays where it means disclosure rather than popup: the nav tree. `shell.ejs` hand-rolls the same
block for the profile menu, and its comment says why. Keep the two in step.

## The document is the one scroller

2026-09-09, the maintainer. Goal 4. Valid while AGENTS.md → priority 1 holds that a page is a
document.

`.app` is `min-height: 100dvh`. `.nav`'s `overflow-y: auto` and `.side-footer`'s `flex: 0 0 auto`
are not leftovers of a bounded frame: they make the off-canvas panel usable with a long tree.
`#nav-toggle` is `position: fixed` because a label click focuses it, and a browser scrolls a focused
element into view.

## `ICON_NAMES` is a host-owned registry, not a plugin contract

2026-08-05, the maintainer. Goal 7. Valid while the `every icon <use> resolves` e2e test guards the
nav.

`src/ui/icons.ts` is deliberately not re-exported from `@plainpages/plugin-api`. The palette may
narrow when the last reference to an id goes, and a plugin needing one gets it re-registered in the
same change. The accepted cost: an unknown sprite id renders blank instead of failing loud.

## Dependencies install to `/node_modules`, above `WORKDIR /app`

2026-08-05, the maintainer. Code health. Valid while dev bind-mounts the checkout at `/app`.

Node resolves upward, so dev's `.:/app` bind mount has nothing to shadow. A volume at
`/app/node_modules` would not do: the daemon creates a mount destination as root whatever `--user`
says, leaving a root-owned dir in the checkout. Nothing may sit at that path, since it silently
shadows `/node_modules`; `src/compose.test.ts` guards the compose files, and `.dockerignore` the
image.

## A container whose output a human then edits or deletes runs as the invoking user

2026-08-05, the maintainer. Code health. Valid while a dev box may lack `sudo`.

That means `--user "$(id -u):$(id -g)"` for the E2E runner (artifacts) and a lockfile edit;
otherwise the output is root-owned. It is not universal: `bootstrap` writes `jwks.json` as root when
it is absent on first boot. The committed dev key makes that rare, and when it happens the rotation
runbook's host-side `>` needs the file re-owned first. That exception is valid while the dev key
ships committed.

Three consequences:

- `e2e-tests/artifacts/` is tracked (`.gitkeep`), since an absent bind-mount source is
  daemon-created as root and that uid then cannot write it (README → Upgrading).
- The runner image sets `HOME=/tmp`, since an arbitrary uid has no passwd entry and would land on an
  unwritable `/`.
- Rootless Docker wants the flag dropped, container root already being the invoking user.

Baking a `USER` into the image does not work: the image's `pwuser` is 1001, and no fixed uid matches
every host. `src/compose.test.ts` guards every documented command, and `src/ci-gate.test.ts` the
gate's own.

## Anything the browser logs fails the E2E test that provoked it

2026-08-05, the maintainer. Goal 4. Valid while pages ship no JavaScript of their own.

Every spec takes its `test` from `e2e-tests/console-guard.ts`, which fails a test on a console error
or warning, or an uncaught exception, on any page it opened. A zero-JS app has nothing to say in the
console, so the bar is zero rather than a curated tolerance list. The two exceptions are narrow: a
module-level allowance for the COOP header Chromium drops (the e2e stacks serve plain http over
container hostnames), and `allowConsole(re)` for a test whose own page provokes a message on
purpose.

`src/e2e-console-guard.test.ts` locks the wiring in the unit gate, since a spec importing `test`
straight from Playwright, or minting a page with a raw `newPage()` instead of `watchedPage()`, would
run unwatched and green. The accepted cost: a page outliving its test can log late and fail the
next one.

## The Ory-free specs run in all three engines; the Ory-backed ones stay on Chromium

2026-08-05, the maintainer. Goal 4. Valid while the Ory-backed specs share one backend.

`visual.spec.ts` and `language.spec.ts` are side-effect-free, so parallel runs don't collide, and a
console message only appears in the engine that renders the page (`ORY_FREE` in
`e2e-tests/playwright.config.ts`). The rest write users, groups and sessions to one shared backend,
so widening them means a stack per engine.

## The docs-only CI skip is `*.md` anywhere in the tree

2026-08-05, the maintainer. Code health. Valid while no markdown file is rendered or executed.

Both git channels in `ci.sh`'s `docs_only()` pass `--no-renames`: rename detection names only the
destination, so `git mv src/app.ts notes.md` would otherwise read as docs and skip the gate over a
source file that was gone. `src/ci-gate.test.ts` locks the flags as a text guard, since the test
image ships neither `git` nor `bash`.

Because a `.md` change skips the gate, the Docker Hub overview is
`release-tooling/dockerhub-overview.md.tmpl`. A release reads it and a unit test guards it, so under
a `.md` name a broken `{{VERSION}}` would merge with that guard skipped.

`README.md` is the one markdown file tests read, so a README-only change skips them. That leaves two
gaps:

- An `apiVersion` sample in the README can go stale unchecked by
  `release-tooling/contract-version.test.ts`. Accepted, because the README's samples are
  illustrative; the copies authors build from (`examples/`, `views/`, the template) are gated.
- A README-only change that drops a command the Hub page shows fails only the next gated change, in
  `release-tooling/dockerhub-overview.test.ts`.

## CI docker logins share the runner host's Docker config

2026-07-04, the maintainer. Code health. Valid while releases keep a single-maintainer cadence; if
these races start costing re-runs, serialize the workflows with a `concurrency` group.

The act_runner is host-mode, so `docker login` and `logout` in the workflows mutate one shared
`~/.docker/config.json`. Concurrent jobs can race: one job's logout can 401 another's push, and the
recovery is a re-run. Tokens sit in that file between login and logout. In the same class,
concurrent runs share the workspace dir, so `ci.sh`'s web-image build races another run's container
creation on the `<project>-web` tag.
