# Changelog

The release version **is** the plugin contract version (`HOST_API_VERSION`), so a minor is a
contract break: a plugin's `apiVersion` must match the host's `major.minor` or discovery refuses it
at boot. Entries start at 0.3.0.

## 0.4.0

**Breaking.** Set `apiVersion: "0.4.0"`. The app shell no longer bounds the content column, so a page
that relied on filling it scrolls the document instead.

### The document scrolls

`.app` was a `100dvh` box with `overflow: hidden`, so a page was only reachable below the fold if its
own wrapper was a flex child with `overflow-y: auto`. `.table-wrap` and `.shell-auth` were; nothing
else was, and a long page in `.form-page` clipped everything past the window in every engine.

Now the shell is `min-height: 100dvh` and the document scrolls. The sidebar is `position: sticky` at
full height and the topbar sticks with it, so both stay put as the page flows. Keyboard paging and
back/forward scroll restoration work without a page doing anything.

### A bounded frame is `fill: true`, and the page says what fills it

A page whose whole point is a frame — a board of full-height columns, a table whose header must stay
put — passes `fill: true` to the shell. `.app-fill` restores the previous model: the viewport is the
page, and a region inside it scrolls.

The two halves are split on purpose. The shell bounds the content column, because the height is the
shell's to give and a page computing it would have to know the topbar's own. The page marks the
element that takes that height with `.scroll-region`, because only the page knows its own tree — a
host rule keyed on a component would work for a table held directly by the content slot and silently
clip one nested any deeper. `data-table` takes `scrollRegion: true`, which puts the class on its own wrapper.

### Upgrading a plugin

1. Set `apiVersion: "0.4.0"`.
2. A page that scrolled the whole window needs no change — it now scrolls the document. A
   `data-table` on it keeps working, but its header stops sticking; see step 4.
3. A page holding a region that filled the content column passes `fill: true` to the shell, puts
   `.scroll-region` on that region, and makes every wrapper between it and the content slot a flex
   column (`display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0`). Miss a wrapper and
   the region grows instead of scrolling, so the frame scrolls in its place — the scrollbar moving off
   the region onto the whole content column is the tell.
4. A table whose header must stay put passes `scrollRegion: true` to `data-table` on such a page.
   `examples/plugins/scheduling` shows the whole chain on its shifts list.

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
