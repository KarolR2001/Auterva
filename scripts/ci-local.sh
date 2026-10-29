#!/usr/bin/env bash
# Runs the jobs of .github/workflows/ci.yml locally while the workflow is disabled (D-29, docs/development/CI.md).
# Usage: scripts/ci-local.sh <LOCAL_PORT_BASE> <results-file>   (run from the repository root of the candidate tree)
# Resets and then stops this worktree's own fixture; E2E needs the fixed ports 3305-3307, so one run at a time.
set -uo pipefail
# Job control gives every step its own process group, so a signal can stop the whole step (and its grandchildren).
set -m
[ $# -eq 2 ] || { echo "usage: $0 <LOCAL_PORT_BASE> <results-file>" >&2; exit 2; }
PORT="$1"; OUT="$2"; LOGDIR=".local/ci-local"; FAILED=0
git ls-files --error-unmatch "$OUT" >/dev/null 2>&1 && { echo "refusing to overwrite tracked file $OUT" >&2; exit 2; }

# The candidate must be exactly HEAD: `quality` checks HEAD in a clean worktree, the other jobs check the working tree.
[ -z "$(git status --porcelain)" ] || { echo "working tree is not clean (git status --porcelain); commit, stash or remove changes first" >&2; exit 2; }

# Refuse tool versions that differ from CI instead of only recording them.
refuse() { echo "$1" >&2; exit 2; }
WANT_GITLEAKS="$(sed -n 's/^ *GITLEAKS_VERSION: *"\{0,1\}\([0-9][0-9.]*\)"\{0,1\} *$/\1/p' .github/workflows/ci.yml | head -1)"
[ -n "$WANT_GITLEAKS" ] || refuse "cannot read GITLEAKS_VERSION from .github/workflows/ci.yml"
HAVE_GITLEAKS="$(gitleaks version 2>/dev/null | head -1 | sed 's/^v//')"
[ -n "$HAVE_GITLEAKS" ] || refuse "gitleaks $WANT_GITLEAKS is missing (not installed or not in PATH)"
[ "$HAVE_GITLEAKS" = "$WANT_GITLEAKS" ] || refuse "gitleaks $HAVE_GITLEAKS found, but $WANT_GITLEAKS (GITLEAKS_VERSION in ci.yml) is required"
command -v node >/dev/null || refuse "node is missing"
WANT_NODE="$(node -p "require('./package.json').engines.node" 2>/dev/null)"
[ -n "$WANT_NODE" ] || refuse "cannot read engines.node from package.json"
[[ "$WANT_NODE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || refuse "engines.node \"$WANT_NODE\" is a semver range; an exact version is required to compare with CI"
HAVE_NODE="$(node --version | sed 's/^v//')"
[ "$HAVE_NODE" = "$WANT_NODE" ] || refuse "node $HAVE_NODE found, but $WANT_NODE (engines.node in package.json) is required"
command -v pg_dump >/dev/null || refuse "pg_dump 18 is missing (not installed or not in PATH)"
HAVE_PGDUMP="$(pg_dump --version | awk '{print $3}')"
[ "${HAVE_PGDUMP%%.*}" = "18" ] || refuse "pg_dump $HAVE_PGDUMP found, but major version 18 is required"
command -v docker >/dev/null || refuse "docker is missing (not installed or not in PATH)"
docker buildx version >/dev/null 2>&1 || refuse "docker buildx is missing or the Docker daemon is not reachable"

mkdir -p "$LOGDIR"; : > "$OUT"
export CI=true NEXT_TELEMETRY_DISABLED=1 LOCAL_PORT_BASE="$PORT"
res() { printf '%s\t%s\n' "$1" "$2" | tee -a "$OUT"; }
# Vitest and Playwright print "Tests  N passed" / "N passed"; keep that summary next to the verdict.
summary() { sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -E '^ *(Test Files|Tests) |^ *[0-9]+ (passed|failed)' | tr -s ' ' | paste -sd ';' -; }
STEP_PID=""
step() {
  local name="$1" rc; shift
  # Background + wait, so the signal trap runs at once instead of after the step.
  ( "$@" ) >"$LOGDIR/$name.log" 2>&1 &
  STEP_PID=$!; wait "$STEP_PID"; rc=$?; STEP_PID=""
  if [ "$rc" -eq 0 ]; then res "$name" "PASS $(summary "$LOGDIR/$name.log")"
  else res "$name" "FAIL ($LOGDIR/$name.log)"; FAILED=1; fi
}

QTMP=""; FIXTURE_STARTED=0
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  if [ -n "$QTMP" ]; then
    if [ -d "$QTMP/quality" ]; then
      git worktree remove --force "$QTMP/quality" >/dev/null 2>&1 || { rm -rf "$QTMP/quality"; git worktree prune >/dev/null 2>&1; }
    fi
    rm -rf "$QTMP"
  fi
  if [ "$FIXTURE_STARTED" = 1 ]; then scripts/local-fixture.sh stop >/dev/null 2>&1; fi
  git checkout -q -- next-env.d.ts 2>/dev/null
  exit "$rc"
}
# On a signal only the running step's own process group is terminated (it was started by this script).
on_signal() {
  if [ -n "$STEP_PID" ]; then kill -TERM -- "-$STEP_PID" 2>/dev/null; wait "$STEP_PID" 2>/dev/null; fi
  exit "$1"
}
trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

printf 'head\t%s\n' "$(git rev-parse HEAD)" >> "$OUT"
printf 'tools\tnode %s; gitleaks %s; pg_dump %s; docker %s\n' "$(node --version)" "$(gitleaks version 2>/dev/null)" \
  "$(pg_dump --version 2>/dev/null | awk '{print $3}')" "$(docker version --format '{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}' 2>/dev/null)" >> "$OUT"
pnpm install --frozen-lockfile >"$LOGDIR/install.log" 2>&1 || { res install FAIL; exit 1; }

# CI runs this job on a fresh checkout: use a clean detached worktree so no .env/.env.local is loaded by vitest.
quality() {
  local tmp="$QTMP/quality"
  git worktree add -q --detach "$tmp" HEAD || return 1
  ( cd "$tmp" && pnpm install --frozen-lockfile --prefer-offline &&
    DATABASE_URL=postgresql://ci@127.0.0.1:5432/validate_only pnpm exec prisma validate &&
    pnpm lint && pnpm typecheck &&
    DATABASE_URL=postgresql://ci@127.0.0.1:5432/unit_placeholder \
    BETTER_AUTH_SECRET=ci-unit-placeholder-secret-0123456789abcdef \
    BETTER_AUTH_URL=http://127.0.0.1:3305 pnpm test:unit )
  local rc=$?; git worktree remove --force "$tmp" >/dev/null 2>&1 || { rm -rf "$tmp"; git worktree prune; }; return $rc
}
QTMP="$(mktemp -d)"
step "Lint, typecheck, unit" quality

# Same steps as .github/actions/fixture, on a fresh schema: --reset drops this fixture's own schema and re-migrates.
export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"
export BOOTSTRAP_TEST_DATABASE_URL="postgresql://$(id -un)@127.0.0.1:${PORT}/auterva_bootstrap_12"
fresh_fixture() {
  pnpm exec tsx scripts/seed-local-fixture.ts --reset && pnpm exec prisma migrate deploy &&
    scripts/local-fixture.sh reset-media && scripts/local-fixture.sh seed-media
}
integration() { scripts/local-fixture.sh start && fresh_fixture && pnpm test:integration; }
# Only a fixture this run starts is stopped afterwards (set in the main shell; `step` runs in a subshell).
fixture_status="$(scripts/local-fixture.sh status 2>/dev/null || true)"
case "$fixture_status" in *"SeaweedFS running"*) ;; *) FIXTURE_STARTED=1 ;; esac
step "Integration (PostgreSQL, S3, bootstrap)" integration

# CI runs E2E on its own fresh fixture.
e2e() {
  local p
  for p in 3305 3306 3307; do lsof -iTCP:"$p" -sTCP:LISTEN -n >/dev/null && { echo "port $p busy"; return 1; }; done
  fresh_fixture && pnpm build && pnpm exec playwright install chromium && pnpm test:e2e
}
step "Build and E2E" e2e
if [ "$FIXTURE_STARTED" = 1 ]; then scripts/local-fixture.sh stop >"$LOGDIR/fixture-stop.log" 2>&1; FIXTURE_STARTED=0; fi
git checkout -q -- next-env.d.ts 2>/dev/null

step "Secret scan" gitleaks git --no-banner --redact --verbose --exit-code 1 .
step "Dependency audit" pnpm audit --prod --audit-level high
for t in web ws worker media-worker; do
  step "Container images build ($t)" docker build -q --target "$t" --tag "auterva-$t:ci" .
done
exit "$FAILED"
