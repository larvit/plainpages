# Changelog

The release version **is** the plugin contract version (`HOST_API_VERSION`), so a minor is a
contract break: a plugin's `apiVersion` must match the host's `major.minor` or discovery refuses it
at boot. Entries start at 0.3.0.

## Unreleased

### Plugin contract 0.5: set `apiVersion` to `"0.5.0"`

The host's contract version is now 0.5.0, so discovery refuses a plugin whose `apiVersion` is still
`0.4.x`. Change the literal in each plugin's manifest when you upgrade, and add `assetHref` to any
`RequestContext` your tests build by hand: `assetHref: (href) => href`.

### The `request` log line renames `method`, `path`, `status` and `ms`, and gains the caller, site and route

Update dashboards and log queries: the `request` line and the request span now use OpenTelemetry's
HTTP names. `method`, `path` and `status` become `http.request.method`, `url.path` and
`http.response.status_code`. `ms` is gone: latency is the span's duration, so it needs
`OTLP_ENDPOINT`. New are `http.route` (when a route matched), `server.address` (the `Host`),
`user_agent.original` and `client.address`. A plugin's own lines for a request carry them too,
except the status.

`client.address` is the socket's peer. Set `TRUSTED_PROXIES` (comma-separated IPs or CIDR ranges) to
the proxies in front of the host and it follows `X-Forwarded-For`; a bad entry refuses the boot.
README → Observability says which ranges to list. The log now holds callers' IPs and user agents,
which are personal data: say so in your privacy policy.

### `buildPaginationModel` builds the pagination partial's model

Call `buildPaginationModel(page, hrefFor, { label?, pageSizes?, pageParam?, pageSizeParam? })` from
`@plainpages/plugin-api` in place of mapping `paginate()`'s result to `partials/pagination` by hand.
`hrefFor(n)` is your list's URL on page n, and the rows-per-page form carries the same list state as
the links. A list that renamed its params in `parseListQuery` passes the same names here.

### A plugin can add links to the profile menu

Declare `profileMenu: [{ href, label, icon?, …gate }]` in the manifest. Each entry names exactly one
gate like a nav node, and shows above Sign out to a signed-in visitor who passes it. Discovery
refuses an entry with no `href` or no gate.

### A plugin can version its own `/public/` files

Wrap the href of a script, image or other file your own markup links in `assetHref("/public/<id>/…")` in a view,
or `ctx.assetHref(…)` in a handler. The href gets the file's content hash, and the browser caches the
file for a year instead of revalidating it every five minutes.

### Discovery warns when a gate names a permission no plugin declares

A route or nav node that gates on a permission no installed plugin declares now logs a boot warning
naming the plugin and the permission. The admin screens offer only declared permissions, so nobody can
be granted such a gate from them. Add the name to the plugin's `permissions` to silence the warning.

### Discovery refuses a plugin with the id `error`

`/error` is the page Kratos sends a failed self-service flow to, and a plugin named `error` would
shadow it. Discovery now refuses that id at boot, like the other reserved ids. Rename such a plugin's
folder before upgrading.

### The admin's "group already exists" refusal is translated

Creating a group whose name is taken shows the refusal in the page's language, not always in English.

### A malformed URL variable's boot error no longer prints the value

When a URL variable such as `PLUGIN_DB_URL`, `PLUGIN_DB_ADMIN_URL` or `OTLP_ENDPOINT` can't be parsed,
the boot error names the variable and not its value, so a DSN whose password breaks parsing doesn't
put the password in the log.

### A secret plugin setting's bad value stays out of the boot error

When a `secret` setting's value fails validation, the boot error no longer prints it, so a malformed
DSN doesn't put its password in the log.

### The admin's recovery-code notice links to the recovery flow the code belongs to

After an admin generates a recovery code for a user, the notice asks them to send the user both the
code and its link. The link opens the recovery flow the code belongs to, where the user enters it.
Before, the notice linked a new recovery flow at its email step, which doesn't accept the code.

### A verification or recovery code pasted with whitespace around it is accepted

The code field on the verification and recovery pages takes a code with spaces or tabs around it.
Pasting a code from an email often adds them, and before, the browser refused the code. Those two
forms now post to Plainpages, which trims the code and passes the form on to Kratos at
`KRATOS_PUBLIC_URL`. A visitor who picked a language now keeps it through both flows.

### A filter shows its selected and focused choice in browsers without `:has()`

On Chromium below 105, Firefox below 121 and Safari below 15.4, a filter's segments and chips now show
their native radio or checkbox, which marks the selected choice and takes the keyboard focus ring.
Before, they showed neither. Newer browsers look as before.

### The tests fail on a stylesheet feature the browser floor lacks

`npm test` checks every stylesheet in `public/`, `examples/` and `plugins/` against Chromium 87,
Safari 15 and Firefox 115: a feature one of them lacks fails it unless an `@supports` around it
names that feature. Mount a plugin in `plugins/<id>/` to check its stylesheets. Pages render as
before in every browser.

### Every release reaches Docker Hub, and the Hub page has a short description

Releases 0.4.1 to 0.4.20 were tagged in git but never published to Docker Hub or as semver tags in
the Gitea registry; they are now, and every later release is. The Hub page gains a one-line
description.

### The admin example stops an administrator locking themselves out through a group

On the Groups screen, unticking a permission on a group you are in, removing yourself (or a nested
group you are in) from its members, or deleting the group is refused when it would take away a
permission you don't hold directly. The page names the permissions, and another administrator can
make the change. The check errs towards refusing: it also refuses when you would keep the permission
through another group, or keep your membership another way.

### The admin example titles a read-only user page "View user"

A holder of `users:read` without `users:write` sees the user page titled "View user", with a "View"
breadcrumb, instead of "Edit user".

### Browsers cache stylesheets instead of downloading them on every page

Every `/public/` URL the host renders carries `?v=<hash of the file>` and is cached for a year as
immutable: the shell's stylesheets, favicon and logo, the `styles` a plugin passes to the shell, and
the stylesheets of the standalone error and consent pages. A changed file gets a new hash, so
browsers fetch it at once. A plugin names its stylesheets exactly as before. Any other `/public/` URL, such as a script
a plugin's own markup links, is cached for five minutes, then revalidated with `ETag` or
`Last-Modified`. A cache or CDN in front of Plainpages may now store `/public/` responses.

### A language chosen on a sign-in link no longer drops an absolute return target

`/login?return_to=<absolute URL>&locale=sv-SE` passed the visitor to the dashboard after sign-in and
dropped the OAuth2 login challenge in `return_to`. The target now reaches Kratos, and the chosen
language is lost across that round-trip instead.

### The admin example refuses a permission save made from an out-of-date page

Two administrators editing one user's or group's permissions no longer overwrite each other. The
form carries a token for the grants it showed. A save that would change something, made after those
grants changed, is refused with "These permissions changed while you had the page open", and the page
shows the current grants. A POST with no token is refused the same way, so a script posting to
`/admin/users/:id/permissions` or `/admin/groups/:name/permissions` must first read the token from the
page's `baseline` field.

### The admin example confirms a permission save and reports a partial one

A save now lands on the page with "Permissions saved." If the permission service fails midway, the
page says the save stopped part-way instead of showing the generic error page. On a user, the
changes that landed still reach the user's live sessions at once when the revocation denylist is on.

### A read-only holder sees View, not Edit, on the admin example's users list

A holder of `users:read` without `users:write` gets a "View" row action with an eye icon. The admin
example's catalogs gain `admin.grants.partial`, `admin.grants.saved`, `admin.grants.stale` and
`admin.users.view`, so a translated catalog mounted under `locales/plugins/admin/` must add them.

### Every page carries a smaller icon sprite

`i-chart`, `i-copy` and `i-download` are gone from the inlined icon sprite, so a plugin that
referenced one now renders a blank icon. Nothing in the host or the example plugins used them. Pick
another id from `views/partials/icons.ejs`, or inline your own SVG.

### The README defines its terms and states its intended scale

A new Glossary defines host, plugin, manifest, chrome, nav fragment, permission name, system plugin
and denylist. Plugin dependencies also states the scale Plainpages is sized for: a handful of plugins
per deployment.

### The mobile nav stays reachable on engines without `:has()`

At 860px and narrower, an engine without `:has()` (Chromium below 105, such as webOS TV 22 and 23,
and Firefox below 121) hid the sidebar off-canvas with no way to open it, so the pages the nav links
to could not be reached. Now the sidebar moves off-canvas, behind the hamburger, only where `:has()`
works. Elsewhere it stays in the flow above the content and the hamburger is hidden.

### The whole nav tree shows on engines without `:has()`

On an engine without `:has()` (Chromium below 105, such as webOS TV 22 and 23, and Firefox below 121)
every nested nav entry was hidden with nothing to open it. Now the tree folds only where `:has()`
works and stays fully open elsewhere, with its toggles hidden. The theme switch, which also needs
`:has()`, is hidden there.

### Button and badge text meets 4.5:1 contrast

The primary button and the current page button take their text colour from the new `--on-accent`
token: white in light mode, near-black in dark mode, where white on the accent was 2.7:1. The
light-mode success, warning and info badge text is darker. A plugin that overrides `--accent` or
`--l-accent` should set `--l-on-accent` and `--d-on-accent` to match.

### Unused auth stylesheet rules are gone

`public/css/auth.css` no longer holds the `.auth-view` screen switch, `.tpl-*` preview controls,
`.forgot-alert`, `.register-alert`, `.remember` and `.auth-foot`; no core view used them. A plugin
view that did must carry its own rules.

### Colours render on engines without `oklch()`

The theme palette in `public/css/styles.css` is hex, not `oklch()`. On an engine older than
Chromium 111 (Tizen 2024, webOS TV 24) `var(--accent)` was invalid, so the primary button was white
text on no background. A plugin that sets a colour custom property, such as `--accent` or `--l-accent`,
should use hex, `rgb()` or `hsl()` too.

### One horizontal inset across the content pane

The topbar, filter bar, pager, form page and empty-table message inset their content by `--pad-x`
(12px), as table cells do, instead of 16px. A plugin that overrides `--pad-x` now moves all of them
together.

### Pages are not kept by a shared cache

Every page and JSON response now carries `Cache-Control: private, no-store`, so a cache or reverse
proxy in front of Plainpages can't store a signed-in page and serve it to the next visitor. A route
whose page is the same for everyone can still set its own `cache-control` through
`RouteResult.headers`; assets are unchanged.

## 0.4.0

**Breaking.** Set `apiVersion: "0.4.0"`. The app shell no longer bounds the content column, so a page
that relied on filling it scrolls the document instead.

### The document scrolls, and the chrome scrolls with it

`.app` was a `100dvh` box with `overflow: hidden`, so a page was only reachable below the fold if its
own wrapper was a flex child with `overflow-y: auto`. `.table-wrap` and `.shell-auth` were; nothing
else was, and a long page in `.form-page` clipped everything past the window in every engine.

Now the shell is `min-height: 100dvh` and nothing bounds the viewport. The sidebar and topbar scroll
with the page, and keyboard paging, back/forward scroll restoration and find-in-page work without a
page doing anything.

The sticky `thead` on `data-table` goes with it: a header only sticks to a scrollport that moves, and
there is no longer one. A plugin that wants a full-height pane owns that in its own stylesheet; the
shell offers no opt-out, per the simplicity priority in `AGENTS.md`.

### Upgrading a plugin

1. Set `apiVersion: "0.4.0"`.
2. A page that scrolled the whole window needs no change — it now scrolls the document.
3. A page holding a region that filled the content column (`flex: 1 1 auto; min-height: 0` with its
   own `overflow`) no longer gets a bounded column to fill, so that region grows and the page scrolls.
   Either let it, or give the region its own height in the plugin's stylesheet.
4. A `data-table` no longer scrolls its rows in a bounded region: the page scrolls, and the header
   scrolls with it.

The sidebar stretches the whole document, so on a long page its footer — theme, language, profile and
**Sign out** — sits at the end of that page rather than the bottom of the screen.

## 0.3.0

**Breaking.** Set `apiVersion: "0.3.0"`, and name a gate on every route and nav node.

### A session is a gate of its own

`session: true` takes any signed-in user, with no grant to hold — for a page whose data is the
visitor's own (their upstream account, their own tokens), where there is no distinction a permission
could name. An anonymous visitor is bounced to `/login` with the page as `return_to`, exactly as a
permission gate does.

Every route and nav node now names **exactly one** of `public: true`, `session: true` or
`permission: "<resource>:<action>"`, and a gate is spelled `true`:

- Naming **none** is refused. It used to mean public, so a forgotten gate published a page; it now
  fails the boot instead.
- Naming **two** is refused, as before.
- Spelling one anything but `true` is refused — `public: false` and `session: "yes"` both set no gate
  while reading as if they set one.

A section header gates nothing itself, so it takes `public: true` and lets each child decide; the
host still drops a header whose children all filtered out.

`Gate` is exported from `@plainpages/plugin-api`, and `Route` and `NavNode` extend it.

### Filter bars take a multi-select

The `filter-bar` partial gains a `multiselect` control — the same checkboxes on the same query
parameter as `chips`, but behind a button once the list is too long to lay on the bar. Config is
`{ name, legend?, note?, value?, options }`, and the panel says what a capped list left out.

### Fixed

- An identity carrying no email no longer yields a session at all. Login used to mint a JWT for one,
  which every later request then rejected as anonymous — leaving the browser holding a dead cookie
  and no way to tell why.

### Dependencies

- Node 24.20.0.

### Upgrading a plugin

1. Set `apiVersion: "0.3.0"`.
2. Give every route and nav node a gate. Anything that relied on omitting one was public — say
   `public: true` outright.

A page that scopes rows to the signed-in visitor should join on `ctx.user.id`. An email address is
user-changeable and can be reassigned to someone else, who would then inherit the previous holder's
rows. The reference plugin's new `/scheduling/mine` page shows the shape.
