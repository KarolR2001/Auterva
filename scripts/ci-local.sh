#!/usr/bin/env bash
# Runs the jobs of .github/workflows/ci.yml locally while the workflow is disabled (D-29, docs/development/CI.md).
# Usage: scripts/ci-local.sh <LOCAL_PORT_BASE> <results-file>   (run from the repository root of the candidate tree)
set -uo pipefail
[ $# -eq 2 ] || { echo "usage: $0 <LOCAL_PORT_BASE> <results-file>" >&2; exit 2; }
PORT="$1"; OUT="$2"; LOGDIR=".local/ci-local"
mkdir -p "$LOGDIR"; : > "$OUT"
export CI=true NEXT_TELEMETRY_DISABLED=1 LOCAL_PORT_BASE="$PORT"
res() { printf '%s\t%s\n' "$1" "$2" | tee -a "$OUT"; }
step() { local name="$1"; shift; ( "$@" ) >"$LOGDIR/$name.log" 2>&1 && res "$name" PASS || res "$name" "FAIL ($LOGDIR/$name.log)"; }

printf 'head\t%s\n' "$(git rev-parse HEAD)" >> "$OUT"
pnpm install --frozen-lockfile >"$LOGDIR/install.log" 2>&1 || { res install FAIL; exit 1; }

# Placeholders exactly as in ci.yml; unit tests never read .env here.
quality() {
  DATABASE_URL=postgresql://ci@127.0.0.1:5432/validate_only pnpm exec prisma validate &&
  pnpm lint && pnpm typecheck &&
  DATABASE_URL=postgresql://ci@127.0.0.1:5432/unit_placeholder \
  BETTER_AUTH_SECRET=ci-unit-placeholder-secret-0123456789abcdef \
  BETTER_AUTH_URL=http://127.0.0.1:3305 pnpm test:unit
}
step "Lint, typecheck, unit" quality

# Same steps as .github/actions/fixture.
export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"
export BOOTSTRAP_TEST_DATABASE_URL="postgresql://$(id -un)@127.0.0.1:${PORT}/auterva_bootstrap_12"
integration() {
  scripts/local-fixture.sh start && pnpm exec prisma migrate deploy &&
  pnpm exec tsx scripts/seed-local-fixture.ts && scripts/local-fixture.sh seed-media &&
  pnpm test:integration
}
step "Integration (PostgreSQL, S3, bootstrap)" integration

# CI runs E2E on its own fresh fixture: reset to the seed state first. E2E uses the fixed ports 3305-3307.
e2e() {
  local p
  for p in 3305 3306 3307; do lsof -iTCP:"$p" -sTCP:LISTEN -n >/dev/null && { echo "port $p busy"; return 1; }; done
  pnpm exec tsx scripts/seed-local-fixture.ts --reset && scripts/local-fixture.sh seed-media &&
  pnpm build && pnpm exec playwright install chromium && pnpm test:e2e
}
step "Build and E2E" e2e
scripts/local-fixture.sh stop >"$LOGDIR/fixture-stop.log" 2>&1
git checkout -q -- next-env.d.ts 2>/dev/null

step "Secret scan" gitleaks git --no-banner --redact --verbose --exit-code 1 .
step "Dependency audit" pnpm audit --prod --audit-level high
for t in web ws worker media-worker; do
  step "Container images build ($t)" docker build -q --target "$t" --tag "auterva-$t:ci" .
done
printf 'platform\t%s\n' "$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}' 2>/dev/null)" >> "$OUT"
