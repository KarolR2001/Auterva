#!/usr/bin/env bash
# Runs the jobs of .github/workflows/ci.yml locally while the workflow is disabled (D-29, docs/development/CI.md).
# Usage: scripts/ci-local.sh <LOCAL_PORT_BASE> <results-file>   (run from the repository root of the candidate tree)
# Resets and then stops this worktree's own fixture; E2E needs the fixed ports 3305-3307, so one run at a time.
set -uo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <LOCAL_PORT_BASE> <results-file>" >&2; exit 2; }
PORT="$1"; OUT="$2"; LOGDIR=".local/ci-local"; FAILED=0
git ls-files --error-unmatch "$OUT" >/dev/null 2>&1 && { echo "refusing to overwrite tracked file $OUT" >&2; exit 2; }
git diff --quiet -- next-env.d.ts || { echo "next-env.d.ts has local changes; commit or restore them first" >&2; exit 2; }
mkdir -p "$LOGDIR"; : > "$OUT"
export CI=true NEXT_TELEMETRY_DISABLED=1 LOCAL_PORT_BASE="$PORT"
res() { printf '%s\t%s\n' "$1" "$2" | tee -a "$OUT"; }
# Vitest and Playwright print "Tests  N passed" / "N passed"; keep that summary next to the verdict.
summary() { sed 's/\x1b\[[0-9;]*m//g' "$1" | grep -E '^ *(Test Files|Tests) |^ *[0-9]+ (passed|failed)' | tr -s ' ' | paste -sd ';' -; }
step() {
  local name="$1"; shift
  if ( "$@" ) >"$LOGDIR/$name.log" 2>&1; then res "$name" "PASS $(summary "$LOGDIR/$name.log")"
  else res "$name" "FAIL ($LOGDIR/$name.log)"; FAILED=1; fi
}

printf 'head\t%s\n' "$(git rev-parse HEAD)" >> "$OUT"
printf 'tools\tnode %s; gitleaks %s; pg_dump %s; docker %s\n' "$(node --version)" "$(gitleaks version 2>/dev/null)" \
  "$(pg_dump --version 2>/dev/null | awk '{print $NF}')" "$(docker version --format '{{.Server.Version}} {{.Server.Os}}/{{.Server.Arch}}' 2>/dev/null)" >> "$OUT"
pnpm install --frozen-lockfile >"$LOGDIR/install.log" 2>&1 || { res install FAIL; exit 1; }

# CI runs this job on a fresh checkout: use a clean detached worktree so no .env/.env.local is loaded by vitest.
quality() {
  local tmp; tmp="$(mktemp -d)/quality"
  git worktree add -q --detach "$tmp" HEAD || return 1
  ( cd "$tmp" && pnpm install --frozen-lockfile --prefer-offline &&
    DATABASE_URL=postgresql://ci@127.0.0.1:5432/validate_only pnpm exec prisma validate &&
    pnpm lint && pnpm typecheck &&
    DATABASE_URL=postgresql://ci@127.0.0.1:5432/unit_placeholder \
    BETTER_AUTH_SECRET=ci-unit-placeholder-secret-0123456789abcdef \
    BETTER_AUTH_URL=http://127.0.0.1:3305 pnpm test:unit )
  local rc=$?; git worktree remove --force "$tmp"; return $rc
}
step "Lint, typecheck, unit" quality

# Same steps as .github/actions/fixture, on a fresh schema: --reset drops this fixture's own schema and re-migrates.
export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"
export BOOTSTRAP_TEST_DATABASE_URL="postgresql://$(id -un)@127.0.0.1:${PORT}/auterva_bootstrap_12"
fresh_fixture() {
  pnpm exec tsx scripts/seed-local-fixture.ts --reset && pnpm exec prisma migrate deploy && scripts/local-fixture.sh seed-media
}
integration() { scripts/local-fixture.sh start && fresh_fixture && pnpm test:integration; }
step "Integration (PostgreSQL, S3, bootstrap)" integration

# CI runs E2E on its own fresh fixture.
e2e() {
  local p
  for p in 3305 3306 3307; do lsof -iTCP:"$p" -sTCP:LISTEN -n >/dev/null && { echo "port $p busy"; return 1; }; done
  fresh_fixture && pnpm build && pnpm exec playwright install chromium && pnpm test:e2e
}
step "Build and E2E" e2e
scripts/local-fixture.sh stop >"$LOGDIR/fixture-stop.log" 2>&1
git checkout -q -- next-env.d.ts 2>/dev/null

step "Secret scan" gitleaks git --no-banner --redact --verbose --exit-code 1 .
step "Dependency audit" pnpm audit --prod --audit-level high
for t in web ws worker media-worker; do
  step "Container images build ($t)" docker build -q --target "$t" --tag "auterva-$t:ci" .
done
exit "$FAILED"
