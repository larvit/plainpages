#!/usr/bin/env bash
# The full CI gate (todo §8): typecheck → unit tests → every E2E suite, each against a FRESH stack
# that is always torn down. One reproducible command — run it locally or wire it into your CI
# service. Docker-only (it drives `docker compose`; node/npm/tsc run inside containers, never the host).
#
#   bash scripts/ci.sh
#
# Exits non-zero on the first failure. Each E2E suite OWNS a clean stack — never point two suites at
# one backend (auth-refresh revokes the admin's sessions; full-flow writes users/groups/roles to Keto).
set -euo pipefail
cd "$(dirname "$0")/.."

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

# Pins that MUST move in lockstep: a browser/runner mismatch yields confusing E2E failures.
step "Playwright pin lockstep (Dockerfile.e2e image == e2e/package.json @playwright/test)"
# `|| true` so a no-match doesn't trip `set -e`/`pipefail` before the explicit check below can report.
img=$(grep -oE 'playwright:v[0-9.]+' Dockerfile.e2e | grep -oE '[0-9.]+$' || true)
pkg=$(grep -oE '"@playwright/test": "[0-9.]+"' e2e/package.json | grep -oE '[0-9.]+' || true)
[ -n "$img" ] && [ "$img" = "$pkg" ] || { echo "Playwright pin mismatch/unreadable: image v$img vs @playwright/test $pkg"; exit 1; }
echo "ok ($img)"

step "Typecheck"
docker compose run --rm --no-deps web npm run typecheck

step "Unit tests"
units=$(docker compose run --rm --no-deps web npm test 2>&1) || { echo "$units"; exit 1; }
echo "$units" | grep -E '^. (tests|pass|fail) ' || true
# Sanity floor: catch a glob that matches too few files (a full empty glob already exits non-zero above).
count=$(echo "$units" | grep -oE 'tests [0-9]+' | grep -oE '[0-9]+' | head -1 || true)
[ "${count:-0}" -ge 50 ] || { echo "only ${count:-0} unit tests ran — test glob broken?"; exit 1; }

# Run one E2E suite against its OWN named stack, then always tear it down (even on failure). The
# per-suite project name keeps a flaky teardown from leaking containers/volumes into the next suite.
e2e() {
  step "E2E: $1"
  local proj="plainpages-e2e-$(basename "$1" .yml | tr '.' '-')" # dots aren't valid in a compose project name
  local rc=0
  docker compose -p "$proj" -f compose.yml -f "$1" run --build --rm e2e || rc=$?
  docker compose -p "$proj" -f compose.yml -f "$1" down -v >/dev/null 2>&1 || true
  [ "$rc" -eq 0 ] || { echo "E2E suite $1 failed (exit $rc)"; exit "$rc"; }
}

e2e compose.e2e.yml        # visual / design-system parity (Ory-free)
e2e compose.e2e-auth.yml   # token timeout + silent re-mint
e2e compose.e2e-oauth.yml  # OAuth2 login + consent
e2e compose.e2e-full.yml   # full browser flow: login (password + SSO), menu, CRUD, plugin, logout

step "ALL GREEN"
