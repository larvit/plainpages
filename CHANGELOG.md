# Changelog

The release version **is** the plugin contract version (`HOST_API_VERSION`), so a minor is a
contract break: a plugin's `apiVersion` must match the host's `major.minor` or discovery refuses it
at boot. Entries start at 0.3.0.

## Unreleased

### Every page carries a smaller icon sprite

The inlined sprite no longer holds `i-chart`, `i-copy` and `i-download`, which nothing in the host or
the example plugins referenced. A plugin that referenced one renders a blank icon until the host registers it again.

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
