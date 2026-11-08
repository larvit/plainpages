# CI/CD

Gitea Actions (`.gitea/workflows/`) runs the pipeline; the test job runs
[`ci.sh`](../README.md#the-full-gate-one-command) — the exact gate you run locally:

| Workflow | Trigger | Does |
| --- | --- | --- |
| `ci.yml` | push, any branch except `main` | the full gate (`bash ci.sh`, a no-op on a docs-only branch), then build + push the app image |
| `release.yml` | push of a `vX.Y.Z` tag, or manual | check the tag against `HOST_API_VERSION`, re-tag that commit's image as `X.Y.Z`, `X.Y`, `latest` (plus `X` once major ≥ 1), sync those tags to Docker Hub; a second job publishes the Hub overview, and runs alone on a manual trigger |
| `mirror.yml` | push to `main` or any tag, or manual | force-push `main` + tags (pruning deleted ones) to the [GitHub mirror](https://github.com/larvit/plainpages) |
| `registry-cleanup.yml` | nightly cron, or manual | delete registry images that are neither release-tagged nor a branch head |
| `renovate.yml` | nightly cron, or manual | open dependency-update PRs, automerge them once the gate is green, then cut a release tag for what merged |

`main` is not re-tested on push — its commits are meant to arrive already green from a
gated branch, so the status check to gate a merge on is `CI / full-gate (push)`.

**Merge gate on `main`** (Gitea branch protection + repo merge settings, set via the API —
no repo files involved): direct pushes are blocked, changes land via PR only, the
`CI / full-gate (push)` status must be green (admins included), and the only merge style is
**fast-forward-only** — history stays linear and `main`'s head is the exact commit hash of
the merged branch, which is why the branch's push-triggered status carries over.

**Container images** — after a green gate, `ci.yml` builds the app image and pushes it as
`gitea.larvit.se/larvit/plainpages:<full commit hash>`. Because merges are fast-forward-only, the
image for any `main` commit already exists from that commit's branch gate — build once, promote by
re-tagging. The build runs inside the required gate, so a missing/expired token or a registry outage
blocks **all** merges until restored; use a non-expiring token or track its expiry. Hash tags
accumulate one image per gated push, so nightly `registry-cleanup.yml` prunes them
([`registry-cleanup/select-versions.ts`](../registry-cleanup/select-versions.ts) defines what survives). Don't add a
pattern-based org cleanup rule for this package — its age/count heuristics can't see branch heads or
release tags and would delete images the workflow protects.

**Releases** — pushing a semver git tag (`git tag v1.2.3 && git push origin v1.2.3`) runs
`release.yml`, which pulls that commit's hash image and re-tags it `1.2.3`, `1.2`, `latest` and —
once the major reaches `1` — `1`; nothing is rebuilt, so the released image is byte-identical to the
gated one. While the major is `0` the bare-major tag is skipped, because a `0.x` minor is a contract
break and a moving `:0` would carry one. It fails loud if no
hash image exists — release tags must point at a commit that went through the gate. The same four
tags sync to [Docker Hub](https://hub.docker.com/r/larvit/plainpages), releases only.

The [contract check](../README.md#contract-versioning) guards the tag before anything is published, refusing one
whose `major.minor` disagrees with `HOST_API_VERSION` and naming the value to set.

**The Docker Hub overview** is published by a separate `publish-overview` job from
[`release-tooling/dockerhub-overview.md.tmpl`](../release-tooling/dockerhub-overview.md.tmpl), with
`{{VERSION}}` rendered to the release, so the Plainpages tag it tells adopters to pull cannot go
stale. The same job sets the page's short description. Its sidecar pins are Renovate-managed and gated against this repo's own compose files, so the
quick start stays a topology CI has actually run.
It is its own job for two reasons: the images are already pushed and irreversible by then, so a Hub
outage leaves the promotion green and the images untouched; and the page has its own door — run the
workflow manually with an `overview_version` input to republish it without cutting a release. That
input goes through the same contract check as a tag: a non-semver value, or one whose `major.minor`
disagrees with the tree being published, is refused. It uses
the same `DOCKERHUB_TOKEN` the image push uses, which is why that token needs the **delete** scope.

**GitHub mirror** — [github.com/larvit/plainpages](https://github.com/larvit/plainpages) is
read-only; after every merge `mirror.yml` force-pushes `main` and all tags, overwriting any drift.
Tags go with `--prune`, so deleting one here deletes it there on the next run, and a tag *created* on
GitHub is swept away — cut releases on Gitea, never on the mirror. Branches other than `main` match
no refspec and are left alone.

**Dependency updates** — `renovate.yml` runs [Renovate](https://docs.renovatebot.com) nightly
(self-hosted, this repo only) against [`renovate.json`](../renovate.json), bumping npm deps, Docker base
images, Gitea action versions, and the image tags pinned inside workflow `run:` steps (a custom regex
manager, so nothing pinned drifts unmanaged). Version-locked sets move together in one PR — the Ory
images, and the Playwright runner + its browser image — and every bump keeps the **exact semver pin**
exact. Each PR runs the normal gate on its `renovate/*` branch and automerges once
`CI / full-gate (push)` is green; only a red gate needs a human.

**Auto-release on dependency updates** — a second job in `renovate.yml` (`auto-release`) cuts **one**
`vX.Y.Z` tag per run covering the renovate-bot commits merged to `main` since the last tag, and
**skips** when the tip isn't a Renovate commit, nothing new merged, or nothing that merged carried a
trailer — a dependency update that cannot reach the app releases nothing. Renovate stamps a
`Release-Bump: <updateType>` trailer onto the updates that reach a running Plainpages — the rules in
[`renovate.json`](../renovate.json) name them — and
[`release-tooling/next-version.ts`](../release-tooling/next-version.ts) turns the highest one into the next
version; pre-1.0 it never auto-crosses into `1.0.0`. Because the contract version *is* the release
version, an update big enough to reach a **minor** stops the job rather than tagging: bump
`HOST_API_VERSION` in a PR, merge, then tag by hand. Pre-1.0 that covers a dependency *major*, since
`nextVersion` shifts it down to a `0.x` minor. `updateType` rates the *dependency's* own jump,
so the trailer is an allowlist: an update outside those rules carries none and rides the next patch
release instead of escalating it. It is **tag-only**: the tag hands off to
`release.yml`, and is pushed with renovate-bot's PAT so that workflow actually fires (a tag pushed by
the built-in Actions token wouldn't trigger it). `HOST_API_VERSION` is never touched here.

### One-time CI setup

| Actions var / secret | Value |
| --- | --- |
| `DOCKER_REGISTRY_USER` (var) + `DOCKER_REGISTRY_TOKEN` (secret) | A Gitea account with package write in the `larvit` org, and its access token with `read:package` + `write:package`. Reused by `registry-cleanup.yml`. |
| `DOCKERHUB_USER` (var) + `DOCKERHUB_TOKEN` (secret) | The public `larvit/plainpages` Docker Hub repo, and a **read/write/delete** token **scoped to that repository** (an org access token, or one on a dedicated account — an account-wide PAT reaches every repo under it, and delete is destructive). Delete is what publishing the overview needs; pushing images alone would not. |
| `MIRROR_GITHUB_TOKEN` (secret) | A fine-grained PAT (Contents: read & write) for a GitHub machine account with write access to the mirror. Its `main` must not block force-pushes and must carry no tag protection, which would reject the prune. |
| `RENOVATE_TOKEN` (secret) | The shared `renovate@larvit.se` bot's Gitea PAT, with write access to this repo. |
| `RENOVATE_GITHUB_TOKEN` (secret) | A **scopeless** (read-only) github.com PAT, so Renovate's lookups of github.com-hosted deps run authenticated instead of tripping the anonymous 60-req/hour limit. |

Gitea rejects secret names prefixed `GITEA_`/`GITHUB_`. Each job fails loud until its secret exists.
The container package is **org-owned**, so it lists under `larvit/-/packages` — link it to the repo's
Packages tab once: `POST /api/v1/packages/larvit/container/plainpages/-/link/plainpages`.

**The runner** — register one
[act_runner](https://docs.gitea.com/usage/actions/act-runner) in host mode labelled `docker-host`
(`labels: ["docker-host:host"]`) on a machine with Docker Engine + Compose, git, and Node +
github.com access. Runs must **never overlap** — the e2e stacks use fixed compose project names, the
devstack suite uses host networking, and the workflows share the Docker daemon's registry login — so
keep exactly one runner at capacity 1, with host ports 3000/4433 free.
