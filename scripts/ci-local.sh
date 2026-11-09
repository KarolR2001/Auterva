#!/usr/bin/env bash
# Runs the jobs of .github/workflows/ci.yml locally while the workflow is disabled (D-29, docs/development/CI.md).
# Usage: scripts/ci-local.sh <LOCAL_PORT_BASE> <results-file>   (run from the repository root of the candidate tree)
# Resets and then stops this worktree's own fixture; E2E uses ports derived from the base (base+12..14) and a slot semaphore.
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
  # </dev/null: a background step reading stdin would get SIGTTIN under job control and stop the whole run.
  ( "$@" ) </dev/null >"$LOGDIR/$name.log" 2>&1 &
  STEP_PID=$!; wait "$STEP_PID"; rc=$?; STEP_PID=""
  if [ "$rc" -eq 0 ]; then res "$name" "PASS $(summary "$LOGDIR/$name.log")"
  else res "$name" "FAIL ($LOGDIR/$name.log)"; FAILED=1; fi
}

# E2E ports come from this worktree's LOCAL_PORT_BASE (base+12..14: production build, dev server, trusted ingress). Inside one base frame the fixture uses base..+7, +10/+11 (dev HTTP/WS)
# and +101, +104..+107 (SeaweedFS gRPC), so +12..14 is free in every role frame (executor base, reviewer base+20, QA base+40)., so
# runs of different worktrees never collide on ports (#264). playwright.config.ts reads them from E2E_PORT, E2E_DEV_PORT and
# E2E_TRUSTED_PORT. Other spots with 3305 (BETTER_AUTH_URL placeholders in the unit step, ci.yml, .env of the fixture) are
# values, not listeners.
E2E_PORTS=$((PORT + 12)); E2E_PORT_LIST="$E2E_PORTS $((PORT + 13)) $((PORT + 14))"
[ "$((PORT + 14))" -le 65535 ] || refuse "LOCAL_PORT_BASE $PORT leaves no room for the E2E ports (base+12..14 must be <= 65535)"
export E2E_PORT="$E2E_PORTS" E2E_DEV_PORT="$((PORT + 13))" E2E_TRUSTED_PORT="$((PORT + 14))"

# The machine is shared, so E2E runs queue on a semaphore of AUTERVA_E2E_SLOTS slots (default 2): directories e2e.slots/<n>
# in the git common dir (shared by all worktrees), taken with the atomic `mkdir` (macOS has no flock). While
# .git/e2e-priority is fresh (< 120 min) the last slot is reserved for AUTERVA_E2E_PRIORITY=1 runs (orchestrator candidates).
E2E_COMMON="$(git rev-parse --git-common-dir)"
E2E_SLOTS_DIR="$E2E_COMMON/e2e.slots"; E2E_PRIORITY_FILE="$E2E_COMMON/e2e-priority"
E2E_SLOTS="${AUTERVA_E2E_SLOTS:-2}"
case "$E2E_SLOTS" in ''|*[!0-9]*|0) refuse "AUTERVA_E2E_SLOTS must be a positive integer";; esac
E2E_LOCK_TIMEOUT="${AUTERVA_E2E_LOCK_TIMEOUT:-1800}"; E2E_LOCK_POLL="${AUTERVA_E2E_LOCK_POLL:-5}"
E2E_SLOT=""        # directory of the slot this run holds
E2E_STARTED=0
lockmsg() { printf '%s\n' "$1" | tee -a "$LOGDIR/e2e-lock.log" >&2; }
# PID of a slot taken by ci-local: only a numeric `pid` file counts. A hand-made slot (`echo <name> > owner`) has no PID.
slot_pid() { local p; p="$(cat "$1/pid" 2>/dev/null)"; case "$p" in ''|*[!0-9]*) ;; *) printf '%s' "$p";; esac; }
slot_desc() { local p; p="$(slot_pid "$1")"; if [ -n "$p" ]; then printf "process %s" "$p"; else printf "manual owner %s" "$(cat "$1/owner" 2>/dev/null)"; fi; }
# Abandoned = its PID no longer exists; without a PID only by age: 40 min with an `owner` file, 1 minute for a bare directory.
# $2 is the PID read once by the caller (empty without a PID file).
slot_is_abandoned() {
  if [ -n "$2" ]; then ! kill -0 "$2" 2>/dev/null; return; fi
  local age=1; [ -f "$1/owner" ] && age=40
  [ -n "$(find "$1" -maxdepth 0 -mmin +"$age" 2>/dev/null)" ]
}
# Removes an abandoned slot. Returns 0 only when it removed exactly the slot that was judged abandoned.
take_over_abandoned_slot() {
  local slot="$1" pid="$2" moved="$1.stale.$$"
  rm -rf "$moved"
  # Atomic rename: of several runners that see the abandoned slot, one wins. $moved never exists, so mv cannot nest.
  mv "$slot" "$moved" 2>/dev/null || return 1
  if [ "$(cat "$moved/pid" 2>/dev/null)" = "$pid" ]; then rm -rf "$moved"; return 0; fi
  # Not the slot we checked (retaken in between): put it back, but only into an empty place.
  [ -e "$slot" ] || mv "$moved" "$slot" 2>/dev/null || true
  return 1
}
priority_window() { [ -n "$(find "$E2E_PRIORITY_FILE" -maxdepth 0 -mmin -120 2>/dev/null)" ]; }
# Tries the allowed slots once; sets E2E_SLOT and returns 0 on success.
try_take_slot() {
  local limit="$E2E_SLOTS" n slot pid order=""
  if [ "${AUTERVA_E2E_PRIORITY:-}" = 1 ]; then for ((n = E2E_SLOTS - 1; n >= 0; n--)); do order="$order $n"; done
  else
    if [ "$E2E_SLOTS" -gt 1 ] && priority_window; then limit=$((E2E_SLOTS - 1)); fi
    for ((n = 0; n < limit; n++)); do order="$order $n"; done
  fi
  mkdir -p "$E2E_SLOTS_DIR"
  for n in $order; do
    slot="$E2E_SLOTS_DIR/$n"
    if mkdir "$slot" 2>/dev/null; then echo "$$" > "$slot/pid"; echo "ci-local $$ ($PWD)" > "$slot/owner"; E2E_SLOT="$slot"; return 0; fi
    pid="$(slot_pid "$slot")"   # read once; the same value is judged and later compared
    if slot_is_abandoned "$slot" "$pid" && take_over_abandoned_slot "$slot" "$pid"; then
      if [ -n "$pid" ]; then lockmsg "taking over stale E2E slot $n of finished process $pid"; else lockmsg "taking over abandoned manual E2E slot $n (older than its age limit)"; fi
      if mkdir "$slot" 2>/dev/null; then echo "$$" > "$slot/pid"; echo "ci-local $$ ($PWD)" > "$slot/owner"; E2E_SLOT="$slot"; return 0; fi
    fi
  done
  return 1
}
acquire_e2e_slot() {
  local waited=0 n holders
  # The caller already holds a global E2E lock (the pre-#264 manual protocol): do not wait on the semaphore.
  if [ "${AUTERVA_E2E_LOCK_HELD:-}" = 1 ]; then lockmsg "E2E lock held by the caller (AUTERVA_E2E_LOCK_HELD=1); not taking a slot"; return 0; fi
  while :; do
    try_take_slot && { lockmsg "took E2E slot ${E2E_SLOT##*/} of $E2E_SLOTS (ports $E2E_PORT_LIST)"; return 0; }
    holders=""; for ((n = 0; n < E2E_SLOTS; n++)); do [ -d "$E2E_SLOTS_DIR/$n" ] && holders="$holders $n:$(slot_desc "$E2E_SLOTS_DIR/$n")"; done
    if [ "$waited" -ge "$E2E_LOCK_TIMEOUT" ]; then lockmsg "timed out after ${waited}s waiting for an E2E slot (held by:$holders)"; return 1; fi
    if [ $((waited % 60)) -eq 0 ]; then lockmsg "waiting for an E2E slot of $E2E_SLOTS (held by:$holders); timeout ${E2E_LOCK_TIMEOUT}s"; fi
    sleep "$E2E_LOCK_POLL" & wait $!; waited=$((waited + E2E_LOCK_POLL))
  done
}
# Something outside this run (a manual `pnpm test:e2e` with the same E2E_PORT) can still hold our ports: wait for it too.
wait_e2e_ports() {
  local waited=0 p busy
  while :; do
    busy=""
    for p in $E2E_PORT_LIST; do lsof -iTCP:"$p" -sTCP:LISTEN -n >/dev/null 2>&1 && busy="$busy $p"; done
    [ -z "$busy" ] && return 0
    if [ "$waited" -ge "$E2E_LOCK_TIMEOUT" ]; then lockmsg "timed out after ${waited}s waiting for E2E ports to free up (busy:$busy)"; return 1; fi
    if [ $((waited % 60)) -eq 0 ]; then lockmsg "waiting for E2E ports held by another process (busy:$busy); timeout ${E2E_LOCK_TIMEOUT}s"; fi
    sleep "$E2E_LOCK_POLL" & wait $!; waited=$((waited + E2E_LOCK_POLL))
  done
}
release_e2e_slot() {
  # Only the owner removes the slot.
  if [ -n "$E2E_SLOT" ] && [ "$(slot_pid "$E2E_SLOT")" = "$$" ]; then rm -rf "$E2E_SLOT"; fi
  E2E_SLOT=""
}
# True when the process runs inside this worktree (its cwd is below $PWD): its own fixture, Playwright servers and their orphans.
WORKTREE_REAL="$(pwd -P)"   # lsof reports real paths (e.g. /private/var on macOS)
owned_here() {
  local cwd; cwd="$(lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  case "$cwd" in "$WORKTREE_REAL"|"$WORKTREE_REAL"/*|"$PWD"|"$PWD"/*) return 0;; esac
  return 1
}
# Early check, before any step: a port of the fixture or of E2E that a process of ANOTHER worktree (or an unrelated service)
# holds would otherwise surface as an obscure failure much later. Listeners of this worktree itself are fine.
precheck_ports() {
  local p pid cwd off offs="0 1 2 3 4 5 6 7 101 104 105 106 107 12 13 14"
  for off in $offs; do
    p=$((PORT + off))
    for pid in $(lsof -tiTCP:"$p" -sTCP:LISTEN -n 2>/dev/null | sort -u); do
      owned_here "$pid" && continue
      cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
      refuse "port $p (LOCAL_PORT_BASE $PORT + $off) is held by process $pid ($(ps -o comm= -p "$pid" 2>/dev/null | head -1), cwd ${cwd:-unknown}), not by this worktree; stop it or use another LOCAL_PORT_BASE (agent frames are base, base+20, base+40; keep frames >= 30 apart)"
    done
  done
}
# The E2E ports were free when the step started, so listeners on them that run in this worktree are Playwright's servers or
# their orphans: stop those only (never a process of another worktree), by process group, then wait and kill.
stop_e2e_servers() {
  local p pid g groups="" pids="" self_group i alive
  self_group="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')"
  # Playwright starts each web server detached (own process group, with children), so collect the groups of the
  # listeners now, before anything closes its socket.
  for p in $E2E_PORT_LIST; do
    for pid in $(lsof -tiTCP:"$p" -sTCP:LISTEN -n 2>/dev/null | sort -u); do
      owned_here "$pid" || continue
      pids="$pids $pid"
      g="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
      [ -n "$g" ] && [ "$g" != "$self_group" ] && [ "$g" -gt 1 ] && groups="$groups $g"
    done
  done
  [ -n "$pids" ] || return 0
  for g in $(printf '%s\n' $groups | sort -u); do kill -TERM -- "-$g" 2>/dev/null; done
  for pid in $pids; do kill -TERM "$pid" 2>/dev/null; done
  # A server that already closed its socket can still be shutting down: wait for the listed processes, then kill them.
  for ((i = 0; i < 10; i++)); do
    alive=""; for pid in $pids; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ -z "$alive" ] && return 0
    sleep 0.5
  done
  for g in $(printf '%s\n' $groups | sort -u); do kill -KILL -- "-$g" 2>/dev/null; done
  for pid in $pids; do kill -KILL "$pid" 2>/dev/null; done
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
  if [ "$E2E_STARTED" = 1 ]; then stop_e2e_servers; E2E_STARTED=0; fi
  release_e2e_slot
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
precheck_ports
pnpm install --frozen-lockfile >"$LOGDIR/install.log" 2>&1 || { res install FAIL; exit 1; }
# pnpm skips postinstall (which runs prisma generate) when the lockfile is unchanged, so a new schema would leave a stale client.
GEN_URL=postgresql://ci@127.0.0.1:5432/generate_only
DATABASE_URL="$GEN_URL" pnpm exec prisma generate >>"$LOGDIR/install.log" 2>&1 </dev/null || { res "prisma generate" FAIL; exit 1; }

# CI runs this job on a fresh checkout: use a clean detached worktree so no .env/.env.local is loaded by vitest.
quality() {
  local tmp="$QTMP/quality"
  git worktree add -q --detach "$tmp" HEAD || return 1
  ( cd "$tmp" && pnpm install --frozen-lockfile --prefer-offline &&
    DATABASE_URL="$GEN_URL" pnpm exec prisma generate &&
    DATABASE_URL=postgresql://ci@127.0.0.1:5432/validate_only pnpm exec prisma validate &&
    pnpm lint && pnpm typecheck &&
    DATABASE_URL=postgresql://ci@127.0.0.1:5432/unit_placeholder \
    BETTER_AUTH_SECRET=ci-unit-placeholder-secret-0123456789abcdef \
    BETTER_AUTH_URL=http://127.0.0.1:3305 pnpm test:unit )
  local rc=$?; git worktree remove --force "$tmp" >/dev/null 2>&1 || { rm -rf "$tmp"; git worktree prune; }; return $rc
}
QTMP="$(mktemp -d)" || refuse "cannot create a temporary directory (mktemp -d failed)"
[ -d "$QTMP" ] || refuse "temporary directory $QTMP does not exist"
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
  for p in $E2E_PORT_LIST; do lsof -iTCP:"$p" -sTCP:LISTEN -n >/dev/null && { echo "port $p busy"; return 1; }; done
  fresh_fixture && pnpm build && pnpm exec playwright install chromium && pnpm test:e2e
}
rm -f "$LOGDIR/e2e-lock.log"
if acquire_e2e_slot && wait_e2e_ports; then
  E2E_STARTED=1; step "Build and E2E" e2e; stop_e2e_servers; E2E_STARTED=0; release_e2e_slot
else release_e2e_slot; res "Build and E2E" "FAIL (E2E slot or ports not available: $LOGDIR/e2e-lock.log)"; FAILED=1; fi
if [ "$FIXTURE_STARTED" = 1 ]; then scripts/local-fixture.sh stop >"$LOGDIR/fixture-stop.log" 2>&1; FIXTURE_STARTED=0; fi
git checkout -q -- next-env.d.ts 2>/dev/null

step "Secret scan" gitleaks git --no-banner --redact --verbose --exit-code 1 .
step "Dependency audit" pnpm audit --prod --audit-level high
for t in web ws worker media-worker; do
  step "Container images build ($t)" docker build -q --target "$t" --tag "auterva-$t:ci" .
done
exit "$FAILED"
