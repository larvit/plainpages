#!/usr/bin/env bash
# The full CI gate: typecheck → unit tests → every E2E suite, each against a FRESH stack
# that is always torn down. One reproducible command — run it locally or wire it into your CI
# service. Docker-only (it drives `docker compose`; node/npm/tsc run inside containers, never the host).
#
#   bash ci.sh
#
# Exits non-zero on the first failure. Each E2E suite OWNS a clean stack — never point two suites at
# one backend (auth-refresh revokes the admin's sessions; full-flow writes users/groups/roles to Keto).
set -euo pipefail
cd "$(dirname "$0")"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

# Docs-only fast path: nothing but *.md changed since main, so there is nothing here to break.
# The working tree counts too — a dirty tree carrying real code must never skip. Anything
# undeterminable (no git, no reachable main, no merge-base) falls through to the gate, never a skip.
# --no-renames on both channels: rename detection names only the destination, so `git mv src/app.ts
# notes.md` reads as a lone *.md — under --porcelain as one `R src/app.ts -> notes.md` line still
# ending in .md after cut -c4- — and the gate would skip over a source file that is gone.
docs_only() {
	local base changed
	git rev-parse --git-dir >/dev/null 2>&1 || return 1
	git fetch --no-tags --quiet origin +refs/heads/main:refs/remotes/origin/main 2>/dev/null || true
	base=$(git merge-base refs/remotes/origin/main HEAD 2>/dev/null) || return 1
	changed=$(
		{ git diff --name-only --no-renames "$base" HEAD \
			&& git status --porcelain --no-renames --untracked-files=all | cut -c4-; } 2>/dev/null
	) || return 1
	[ -n "$changed" ] || return 1
	! printf '%s\n' "$changed" | grep -qvE '\.md$'
}

if docs_only; then
	step "Only *.md changed since main — nothing to test, skipping the gate"
	exit 0
fi

# Pins that MUST move in lockstep: a browser/runner mismatch yields confusing E2E failures.
step "Playwright pin lockstep (e2e-tests/Dockerfile image == e2e-tests/package.json @playwright/test)"
# `|| true` so a no-match doesn't trip `set -e`/`pipefail` before the explicit check below can report.
img=$(grep -oE 'playwright:v[0-9.]+' e2e-tests/Dockerfile | grep -oE '[0-9.]+$' || true)
pkg=$(grep -oE '"@playwright/test": "[0-9.]+"' e2e-tests/package.json | grep -oE '[0-9.]+' || true)
[ -n "$img" ] && [ "$img" = "$pkg" ] || { echo "Playwright pin mismatch/unreadable: image v$img vs @playwright/test $pkg"; exit 1; }
echo "ok ($img)"

# Explicit rebuild: without it a stale web image from a previous branch supplies node_modules
# (the source is bind-mounted but deps are baked in), so a dep bump gets typechecked/tested
# against the OLD packages. Cheap when deps are unchanged (npm ci layer is cache-keyed).
step "Build web image"
docker compose build web

step "Typecheck"
docker compose run --rm --no-deps web npm run typecheck

step "Unit tests"
units=$(docker compose run --rm --no-deps web npm test 2>&1) || { echo "$units"; exit 1; }
echo "$units" | grep -E '^. (tests|pass|fail) ' || true
# Sanity floor: catch a glob that matches too few files (a full empty glob already exits non-zero above).
count=$(echo "$units" | grep -oE 'tests [0-9]+' | grep -oE '[0-9]+' | head -1 || true)
[ "${count:-0}" -ge 50 ] || { echo "only ${count:-0} unit tests ran — test glob broken?"; exit 1; }

# Plugin storage against a real Postgres. The step above runs --no-deps, so this suite's integration
# test skips there — and it is the only thing proving the DDL actually grants what it claims, rather
# than that the SQL text is the text we wrote. `node --test` counts a skip, so the floor won't catch it.
step "Plugin storage (real Postgres)"
# Own project name, like every E2E suite below: the default project is the DEV stack, so a bare
# `down -v` here would delete the operator's pgdata — Ory identities and every plugin database.
# --wait, because initdb on a cold volume outlasts the suite's connect timeout.
storage_rc=0
storage_proj=plainpages-storage
docker compose -p "$storage_proj" up -d --wait postgres >/dev/null
storage_out=$(docker compose -p "$storage_proj" run --rm --no-deps \
	-e PLUGIN_DB_ADMIN_URL=postgres://${POSTGRES_USER:-ory}:${POSTGRES_PASSWORD:-ory}@postgres:5432/ory \
	web node --test src/plugin-host/storage.test.ts 2>&1) || storage_rc=$?
docker compose -p "$storage_proj" down -v >/dev/null 2>&1 || true
echo "$storage_out" | grep -E '^. (tests|pass|fail|skipped) ' || true
[ "$storage_rc" -eq 0 ] || { echo "$storage_out"; echo "plugin storage integration tests failed (exit $storage_rc)"; exit "$storage_rc"; }
# A skip here exits 0 and proves nothing — the same trap the unit floor above guards against.
echo "$storage_out" | grep -qE '^. skipped 0$' || { echo "storage integration test skipped — PLUGIN_DB_ADMIN_URL not wired through"; exit 1; }

# Run one E2E suite against its OWN named stack, then always tear it down (even on failure). The
# per-suite project name keeps a flaky teardown from leaking containers/volumes into the next suite.
# --user: the runner writes screenshots + the report into the checkout, so they must belong to
# whoever ran the gate — root-owned output needs sudo to delete, and a dev box may have none.
e2e() {
  step "E2E: $1"
  local proj="plainpages-e2e-$(basename "$1" .yml | tr '.' '-')" # dots aren't valid in a compose project name
  local rc=0
  docker compose -p "$proj" -f compose.yml -f "$1" run --user "$(id -u):$(id -g)" --build --rm e2e || rc=$?
  docker compose -p "$proj" -f compose.yml -f "$1" down -v >/dev/null 2>&1 || true
  [ "$rc" -eq 0 ] || { echo "E2E suite $1 failed (exit $rc)"; exit "$rc"; }
}

e2e e2e-tests/compose.visual.yml    # visual / design-system parity (Ory-free)
e2e e2e-tests/compose.auth.yml      # token timeout + silent re-mint
e2e e2e-tests/compose.oauth.yml     # OAuth2 login + consent
e2e e2e-tests/compose.full.yml      # full browser flow: login (password + SSO), menu, CRUD, plugin, logout

# Dev-stack login regression — runs against the PLAIN `docker compose up` topology (base + override)
# with the runner on the HOST network, so it can't use the shared e2e() helper (which merges only
# compose.yml + the suite). Needs host networking + the host ports 3000/4433 free (Linux CI).
step "E2E: e2e-tests/compose.devstack.yml (dev-stack login: localhost works + 127.0.0.1 canonicalised)"
devstack_files=(-f compose.yml -f compose.override.yml -f e2e-tests/compose.devstack.yml)
rc=0
docker compose -p plainpages-e2e-devstack "${devstack_files[@]}" run --user "$(id -u):$(id -g)" --build --rm e2e || rc=$?
docker compose -p plainpages-e2e-devstack "${devstack_files[@]}" down -v >/dev/null 2>&1 || true
[ "$rc" -eq 0 ] || { echo "E2E suite e2e-tests/compose.devstack.yml failed (exit $rc)"; exit "$rc"; }

step "ALL GREEN"
