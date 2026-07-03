- [x] Organize the files in src in to folders so it is easier to understand the structure of the code.
- [x] Move docs/plugin-contract.md into README.md and remove the docs folder.
- [x] The plugins/scheduling is an example and shouldn't be committed to the plugins directory since that should be empty to be able to be mounted in via docker or other means for the users/develoeprs using this application/framework. Put it in the examples folder instead.
- [x] The config folder should be empty and the current settings in the menu.ts should be the fallback default. IF a menu.ts where to appear in that folder, it should override the default settings with whatever is in it. The idea is the folder should be empty by default and you mount it in your docker container with your config.
- [x] Make the internal admin pages for users groups etc into a plugin instead in the examples folder and remove them from the internal source. Add a part in the quick start about copying this plugin into the plugins folder to enable GUI user- and group admining.
- [x] CI/CD - Test on push to any branch except main. (`.gitea/workflows/ci.yml` runs `bash ci.sh`; the one-time act_runner setup it needs is documented in README → CI/CD.)
- [x] CI/CD - Require PR to main and don't allow merge if tests does not pass. Only allow linear history and history that leaves the last commit hash on main the exact same as on the branch we just merged in. (Gitea branch protection on main + fast-forward-only merge style, set via API; documented in README → CI/CD.)
- [x] CI/CD - Sync up to github after every successful merge to main, URL: git@github.com:larvit/plainpages.git - also note the true home top of the README. Force push to github, it should only ever be a mirror of the gitea.larvit.se repository. (`.gitea/workflows/mirror.yml` force-pushes main + tags over HTTPS with a dedicated account's PAT in the `MIRROR_GITHUB_TOKEN` secret; setup documented in README → CI/CD.)
- [ ] CI/CD - Build docker images as part of the requirements to be able to merge to main. Push them with the git commit hash as docker tag. Push to container registry at Gitea.
- [ ] CI/CD - Re-tag docker images from git hash to semver when a semver git tag is pushed.
- [ ] CI/CD - Require human to make docker hub account - sync docker images to docker hub after each deploy build.
- [ ] CI/CD - Setup renovate bot.
- [ ] Add an e2e test for the admin plugin's OAuth2-clients (Hydra) screen. The full-flow e2e suite runs without Hydra (compose.full.yml), so /admin/clients register/detail/delete is only unit-covered (src/http/app.test.ts); wire Hydra into an e2e stack and drive the screen in the browser.
- [ ] Build and publish docker image as CI/CD.
- [ ] Add i18n support.

## Architectural review findings (2026-07-02)

Prioritized. Overall verdict: architecture is sound (contract-first plugin API, functional core/imperative shell, strong test seams); these are refinements.

- [x] **HIGH — Split `handleRequest` in `src/http/app.ts` (~380 lines).** It mixes the request pipeline with inline implementations of ~10 built-in endpoints (Kratos flows, /oauth2/*, /auth/complete, /logout, /, /dashboard, 404/405). Extract each endpoint into a named handler (auth/OAuth2 group → `src/auth/` route module) with the same `(req, res, ctx)` shape plugin routes use; reduce `handleRequest` to pipeline → internal route table → `sendResult`.
- [ ] **MEDIUM — Add complexity/method-size static analysis to the CI gate.** Only `tsc --strict` today; a size/complexity rule would have caught the `app.ts` growth. Also when wiring CI/CD: keep the merge gate fast (typecheck + units + Ory-free `visual` suite; heavy e2e suites required-but-separate) and make the pipeline the only path to a published image (build once at tag, promote).
- [ ] **MEDIUM — De-duplicate `examples/plugins/admin/admin-groups.ts` and `admin-roles.ts` (~80% identical).** Same "Keto membership object admin" concept twice; extract a parameterized helper keyed on `{ namespace, base, labels, columns }`, leave roles' effective-access view as the only delta. Matters extra because this is the reference plugin people copy.
- [ ] **MEDIUM→LOW — Add a list-page view-model helper in `src/ui/`.** Every list screen (users, groups, roles, shifts) hand-rewrites the same ~40 lines bridging `parseListQuery`/`paginate` to the EJS partials; at minimum a `buildPaginationModel(page, hrefFor)` block.
- [ ] **LOW→MEDIUM — Retire `src/ui/shell-context.ts`.** `ShellModel`/`buildShellContext` has one consumer left (dashboard) and duplicates `PageChrome` on almost every field, incl. identical brand-assembly in `chrome.ts` and `shell-context.ts`. Fold the dashboard onto `ctx.chrome` + title/breadcrumbs; keep `shellUser` as the shared primitive.
- [ ] **LOW — Fix stale doc references to removed `docs/plugin-contract.md`** in `views/index.ejs` (user-visible dashboard text; also links /scheduling as if pre-installed) and `examples/plugins/scheduling/views/shifts.ejs`.
- [ ] **LOW — Decide (once) on a `ctx.system` facade.** `#plugin-api` exposes raw Ory client shapes, so an Ory client refactor is a major `apiVersion` bump. AGENTS.md accepts this; revisit only if external plugin authors appear. Record the decision.
- [ ] **LOW — README/AGENTS.md gaps:** state the intended lifetime/horizon explicitly, add a short domain glossary (host, manifest, chrome, nav fragment, permission token, system plugin, denylist…), and note the expected plugin-author population (first-party vs external) to justify the versioning machinery.
