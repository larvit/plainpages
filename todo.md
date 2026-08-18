# Primary todo

## Unfinnished work

- [ ] Add a way to configure plugins directly when installing. **Decided: the manifest declares it, not an `.env`** — a declared schema is validatable at boot, so a missing or mistyped setting fails loud and named the way a stray `package.json` now does, and the picker/docs can be generated from the declaration. Open: where the operator *supplies* the values (env var per key, a `config/` file, or both), and whether a secret may be declared at all.
- [ ] Rename the plugin "admin" to something less generic, like "auth-admin" or "users-groups-admin".
- [ ] Guard the group paths against self-lockout, or accept them explicitly. The self-revoke guard covers only your own *direct* grants on the Users screen; unticking a permission on a group you belong to, removing yourself from that group, or deleting it can all still strip your own effective access with no warning. Recorded in AGENTS.md as a known gap — the robust fix is a "last effective holder" check, which needs a reverse Keto query.
- [ ] The permission picker has no concurrency baseline, so two operators editing the same user/group silently discard each other's change. Sketch: post the rendered set as a hidden baseline; if it no longer matches Keto, re-render with "this changed while you had the page open" rather than applying.
- [ ] A grant whose plugin was uninstalled is invisible and unremovable in the GUI. `grantDiff` deliberately never revokes an undeclared name, but nothing *shows* it either — so it can't be audited or cleaned, and reinstalling that plugin silently reactivates access nobody remembers granting. Sketch: a read-only "held, but no installed plugin offers this" list with a remove action.
- [ ] A plugin may gate a route on a permission it never declares — declaring stays optional on purpose. The cost is a dead end: the picker is built from declarations only, so that route is ungrantable from the GUI with no boot error and a permanent 403 as the operator's only clue. Sketch: a discovery *warning* (not an error) naming the gated-but-undeclared permission.
- [ ] Saving permissions gives no confirmation, and a partial failure is silent. `applyGrants` loops writes then deletes with no transaction, so a Keto error midway leaves a half-applied set behind the generic error page; and a successful save is indistinguishable from "nothing changed". The `alert alert-pos` pattern the recovery-code banner uses is already available.
- [ ] In Playwright tests, try different resolutions and sizes, from BIG desktop down to tiny phone.
- [ ] Decide whether `e2e-tests/` should be typechecked. It is outside `tsconfig.include`, so the gate never checks its most logic-bearing file (`console-guard.ts`). Including it needs the DOM lib and `@playwright/test` present wherever `npm run typecheck` runs, which today is the `web` image that installs neither.
- [ ] Decide whether Playwright's `workers` should be pinned. Unset, it sizes the pool from `os.cpus()`, which reports the host's cores regardless of a container CPU quota — and with `retries: 0` a starved runner turns a slow test straight into a red gate. Fine on the current act_runner; revisit if CI ever runs constrained.
- [ ] Record the browser floor Plainpages requires, and whether the fallback is the contract or a courtesy. The stylesheet needs `:has()` (Dec 2023); the menus need the popover API (Safari 17) and CSS anchor positioning for placement (newer still, and unguarded — the `@supports` test covers popover only). An iPadOS 16 tablet, capped at Safari 16, therefore gets panels flowing inline rather than working menus. Either state a supported floor or accept the fallback for those devices; nobody has rendered that path on real hardware.
- [ ] Decide whether the profile dropdown still earns a dropdown. It holds one item, Sign out, behind a click, and its "Signed in as X" head repeats what the trigger already shows.
- [ ] Trim whitespace around the verification code — a copy+pasted code from the email fails, today as a browser `pattern` refusal rather than a Kratos rejection, now carrying a digits-only hint so that refusal isn't bare. The paste still fails. **Own session.** No zero-JS fix exists: `pattern` is rejective and cannot transform, so loosening it only lets the untrimmed value through. The real fix is a host-side proxy of the flow POST, which is feasible and half-built — `submitFlow` (`src/auth/kratos-public.ts:132`) already relays cookies and normalises a 422 `redirect_browser_to`, and has no callers outside tests. CSRF improves rather than breaks: the host already writes Kratos' cookie onto its own origin (`src/auth/routes.ts:77`), so the POST becomes same-origin, and `form-action 'self'` could finally join the CSP. Two risks: one `flow.ui.action` serves all five flows, so this rewrites the sign-in path, not just code entry; and Go's nosurf checks Referer only over https, which no test here covers. **Check first:** `kratos-admin.ts:75` returns a `recovery_link` alongside the code — if the stock courier mail carries one (unverified), a template change fixes the UX with no host code. Code entry has no E2E coverage today either way.
- [ ] Guard against the double-clicked submit, without client-side JavaScript. A non-technical user clicks a button twice when nothing happens fast enough, so a second identical POST is an expected event, not misuse — today it creates two users, mints two recovery codes, or registers two OAuth2 clients. Constraints: HTML/CSS only, and it must not break an action that is *legitimately* repeatable. Sketch: a CSS-only affordance so the second click has nothing to hit, paired with the host recognising a duplicate on the server — same session, route and payload within a short window — then logging and dropping it. Open questions: what identifies "the same submission" (a one-time token minted into each rendered form beats hashing the payload, and the CSRF plumbing already mints per-request tokens), the window length, where the record lives given the app is stateless, and how a plugin declares a route repeatable.
- [ ] Decide the caching contract for rendered pages. Responses carry `Vary: Accept-Language` but nothing sets `Cache-Control`, so a shared cache has no instruction and a signed-in page is not marked `private`. Either set the headers deliberately (public cacheable, gated `private, no-store`) or record in AGENTS.md that the reverse proxy owns this.
- [ ] Decide whether the single generic Keto `Resource` namespace should become per-domain namespaces (`Shift`, `Document`, …), as Ory's own examples model it. One global `Resource` bucket is the project's own "no catch-all names" rule applied to namespaces. A design question, not a naming one.
- [ ] Decide what `ICON_NAMES` (`src/ui/icons.ts`) actually is. `i-chart`, `i-copy`, `i-download` and `i-sliders` have no caller anywhere — so either they go, or the comment should say the palette is curated and may carry an id ahead of its first use. Not cosmetic: the sprite is inlined into every page, and the rule decides whether a future removal is routine cleanup or a plugin-facing regression.
- [ ] Decide (once) whether the CSRF token staying unbound to `sub`/session is accepted. `src/auth/csrf.ts` signs `<nonce>.<HMAC(secret, nonce)>` with no session binding, so any validly-signed token passes for any user — an attacker who can write cookies on the origin can fix a token they know. Standard for unbound signed double-submit and plausibly fine behind `SameSite=Lax` + HSTS. Accepted ⇒ record it in AGENTS.md and README → Security model; not accepted ⇒ bind the nonce to `sub`.
- [ ] Verify the documented Docker commands on macOS and fix whatever misbehaves — **macOS is a supported dev host**, but nothing here has been run on one. Two suspects, both from the `--user "$(id -u):$(id -g)"` idiom: a macOS `id -g` is `20`, which is `dialout` inside the noble image rather than a user group, and Docker Desktop remaps bind-mount ownership in its own VM layer. The same question covers rootless Docker, where README already says to *drop* the flag.

### Architectural review findings (2026-07-02)

Prioritized. Overall verdict: architecture is sound; these are refinements.

- [ ] **MEDIUM — Add complexity/method-size static analysis to the CI gate.** Only `tsc --strict` today; a size/complexity rule would have caught the `app.ts` growth.
- [ ] **LOW — The users list offers a pencil "Edit" row action to a `users:read` holder.** The link is harmless (it opens the read-only detail page), but the label contradicts what the reader can do. Needs `canWrite` threaded into `listTable` plus a `common.view` core catalog key and an `i-eye` entry in `ICON_NAMES`.
- [ ] **MEDIUM→LOW — Add a list-page view-model helper in `src/ui/`.** Every list screen hand-rewrites the same ~40 lines bridging `parseListQuery`/`paginate` to the EJS partials; at minimum a `buildPaginationModel(page, hrefFor)` block.
- [ ] **LOW→MEDIUM — Retire `src/ui/shell-context.ts`.** `ShellModel`/`buildShellContext` has one consumer left (dashboard) and duplicates `PageChrome` on almost every field. Fold the dashboard onto `ctx.chrome` + title/breadcrumbs; keep `shellUser` as the shared primitive.
- [ ] **LOW — Fix stale doc references to removed `docs/plugin-contract.md`** in `views/index.ejs` (user-visible dashboard text; also links /scheduling as if pre-installed) and `examples/plugins/scheduling/views/shifts.ejs`.
- [ ] **LOW — Decide (once) on a `ctx.system` facade.** `@plainpages/plugin-api` exposes raw Ory client shapes, so an Ory client refactor is a major `apiVersion` bump. AGENTS.md accepts this; revisit only if external plugin authors appear.
- [ ] **LOW — README/AGENTS.md gaps:** state the intended lifetime/horizon explicitly, add a short domain glossary (host, manifest, chrome, nav fragment, permission token, system plugin, denylist…), and note the expected plugin-author population and plugin count — per-plugin dependency isolation prices N dependency trees on disk and in RSS, and that number is what says whether the trade needs revisiting (build-time dedupe for baked images stays open).

## Finnished work

- [x] Refuse a stray `package.json`/`node_modules` in `config/` by name, as plugin folders already are.
- [x] Let Renovate reach the example plugins' manifests (`ignorePaths` overrides `config:recommended`).
- [x] The seeded admin is granted each permission once — `seedPermissions` dedupes and the grant PUT is idempotent.
- [x] Run the E2E runner as the invoking user so its artifacts aren't root-owned.
- [x] Install node_modules above `WORKDIR /app` so no mount leaves a root-owned dir in the checkout.
- [x] Enforce `<resource>:<action>` permission names at discovery; split `admin` per screen.
- [x] Make the declared-permission catalog the fixed list; delete the Permissions screen, move granting onto Users and Groups.
- [x] Fail a Playwright test on any browser console warning, error or uncaught exception, in every engine.
- [x] Skip the CI gate when only markdown changed.
- [x] Replace the `<details>` popup menus with the Popover API so an outside click dismisses them.
- [x] Organize the files in src into folders.
- [x] Move docs/plugin-contract.md into README.md and remove the docs folder.
- [x] Move the scheduling example out of `plugins/` into `examples/`.
- [x] Make `config/` an empty drop-in mount with the defaults as fallback.
- [x] Turn the built-in admin pages into a drop-in example plugin.
- [x] CI/CD — test on push to any branch except main.
- [x] CI/CD — require a PR to main, gated on a green build, fast-forward-only.
- [x] CI/CD — force-push mirror to GitHub after every merge to main.
- [x] CI/CD — build and push the app image, tagged with the commit hash, as part of the gate.
- [x] CI/CD — re-tag the hash image to semver on a `vX.Y.Z` tag.
- [x] CI/CD — sync released tags to Docker Hub.
- [x] Write README-dockerhub.md for the Docker Hub overview.
- [x] CI/CD — set up the Renovate bot.
- [x] CI/CD — give Renovate a read-only `GITHUB_COM_TOKEN` so github.com lookups aren't rate-limited.
- [x] CI/CD — auto-release on Renovate updates, versioned from the `Release-Bump:` trailer.
- [x] Add an e2e test for the admin plugin's OAuth2-clients (Hydra) screen.
- [x] Document the auth security model in the README.
- [x] Add i18n support.
- [x] Settle the identity-vs-user vocabulary.
- [x] Use one uniform verb per action in the English UI (sign in / sign out / create account).
- [x] Remove the dead "Profile" link from the sidebar profile menu.
- [x] Remove the unspecified "Settings"/"Preferences" cog from the sidebar footer.
- [x] **HIGH — Split `handleRequest` in `src/http/app.ts`** — extract the built-in endpoints into named handlers on an internal route table.
