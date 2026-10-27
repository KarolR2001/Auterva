#!/usr/bin/env bash
set -euo pipefail

repo_dir="$(cd "$(dirname "$0")/.." && pwd)"
local_dir="$repo_dir/.local/fixture-9"
bin_dir="$repo_dir/.local/bin"
port_base="${LOCAL_PORT_BASE:-15450}"
if ! [[ "$port_base" =~ ^[0-9]+$ ]] || (( port_base < 1024 || port_base > 65000 )); then
  echo "LOCAL_PORT_BASE must be an integer between 1024 and 65000" >&2
  exit 2
fi
pg_port=$port_base
s3_port=$((port_base + 1))
smtp_port=$((port_base + 2))
mail_ui_port=$((port_base + 3))
master_port=$((port_base + 4))
volume_port=$((port_base + 5))
filer_port=$((port_base + 6))
admin_port=$((port_base + 7))
db_name="auterva_fixture_9"

require_local_tools() {
  for tool in node curl tar shasum initdb pg_ctl pg_isready createdb psql lsof; do
    command -v "$tool" >/dev/null || { echo "Missing prerequisite: $tool" >&2; exit 2; }
  done
}

download_checked() {
  local url="$1" name="$2" digest="$3" binary="$4"
  mkdir -p "$repo_dir/.local/downloads" "$bin_dir"
  if [[ ! -x "$bin_dir/$binary" ]]; then
    curl --fail --location --silent --show-error "$url" -o "$repo_dir/.local/downloads/$name"
    (cd "$repo_dir/.local/downloads" && printf '%s  %s\n' "$digest" "$name" | shasum -a 256 -c -)
    tar -xzf "$repo_dir/.local/downloads/$name" -C "$bin_dir" "$binary"
    chmod 700 "$bin_dir/$binary"
  fi
}

install_tools() {
  require_local_tools
  if [[ "$(uname -s)/$(uname -m)" != "Darwin/arm64" ]]; then
    echo "Pinned local binaries currently target macOS arm64; install compatible SeaweedFS 4.49 and Mailpit 1.32.0 into .local/bin." >&2
    exit 2
  fi
  download_checked "https://github.com/seaweedfs/seaweedfs/releases/download/4.49/darwin_arm64.tar.gz" \
    "darwin_arm64.tar.gz" "ca708ea2b91c278a5678c16376b472162df2ccda54ecff72c7b53aaa6fb4af48" weed
  download_checked "https://github.com/axllent/mailpit/releases/download/v1.32.0/mailpit-darwin-arm64.tar.gz" \
    "mailpit-darwin-arm64.tar.gz" "23709bd727f20da2290de6a2a40c4685c48a3127586d77370efd1a3a595f9ef6" mailpit
}

owned_process() {
  local name="$1" pid_file="$local_dir/$1.pid" pid
  [[ -f "$pid_file" ]] || return 1
  pid="$(cat "$pid_file")"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -F "$bin_dir/$name" >/dev/null
}

stop_process() {
  local name="$1" pid_file="$local_dir/$1.pid"
  if owned_process "$name"; then kill "$(cat "$pid_file")"; fi
  if [[ -f "$pid_file" ]]; then rm "$pid_file"; fi
}

make_local_config() {
  mkdir -p "$local_dir/log" "$local_dir/storage" "$local_dir/config"
  chmod 700 "$local_dir" "$local_dir/storage"
  if [[ ! -f "$local_dir/s3.json" ]]; then
    node - "$local_dir/s3.json" "$local_dir/secrets.env" <<'NODE'
const { randomBytes } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const [configPath, envPath] = process.argv.slice(2);
const key = randomBytes(10).toString("hex");
const secret = randomBytes(32).toString("hex");
writeFileSync(configPath, JSON.stringify({ identities: [{ name: "fixture", credentials: [{ accessKey: key, secretKey: secret }], actions: ["Admin", "Read", "List", "Write"] }] }), { mode: 0o600 });
writeFileSync(envPath, `S3_ACCESS_KEY_ID=${key}\nS3_SECRET_ACCESS_KEY=${secret}\n`, { mode: 0o600 });
NODE
  fi
  if [[ ! -f "$local_dir/config/security.toml" ]]; then
    node - "$local_dir/config/security.toml" <<'NODE'
const { randomBytes } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const key = () => randomBytes(32).toString("hex");
writeFileSync(process.argv[2], `[jwt.signing]\nkey = "${key()}"\n[jwt.signing.read]\nkey = "${key()}"\n[jwt.filer_signing]\nkey = "${key()}"\n[jwt.filer_signing.read]\nkey = "${key()}"\n`, { mode: 0o600 });
NODE
  fi
  if [[ ! -f "$repo_dir/.env" ]]; then
    # Local fixture only; neither file is tracked by Git.
    cat > "$repo_dir/.env" <<EOF
DATABASE_URL=postgresql://$(id -un)@127.0.0.1:$pg_port/$db_name
BETTER_AUTH_SECRET=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("base64url"))')
BETTER_AUTH_URL=http://127.0.0.1:3305
WS_PORT=3312
AUTERVA_FIXTURE=1
S3_ENDPOINT=http://127.0.0.1:$s3_port
S3_BUCKET=auterva-fixture-media
SMTP_HOST=127.0.0.1
SMTP_PORT=$smtp_port
MAILPIT_URL=http://127.0.0.1:$mail_ui_port
EOF
    chmod 600 "$repo_dir/.env"
  elif ! grep -Fxq "DATABASE_URL=postgresql://$(id -un)@127.0.0.1:$pg_port/$db_name" "$repo_dir/.env" \
    || ! grep -Fxq 'AUTERVA_FIXTURE=1' "$repo_dir/.env"; then
    echo "Existing .env does not belong to this local fixture and port; refusing to start." >&2
    exit 2
  fi
}

refuse_foreign_listener() {
  local port="$1" owner="$2" expected="" listener
  if [[ "$owner" == postgres ]]; then
    [[ -f "$local_dir/pg/postmaster.pid" ]] && expected="$(head -1 "$local_dir/pg/postmaster.pid")"
  elif owned_process "$owner"; then
    expected="$(cat "$local_dir/$owner.pid")"
  fi
  for listener in $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    if [[ -z "$expected" || "$listener" != "$expected" ]]; then
      echo "Port $port is occupied by a service outside this fixture; refusing to start." >&2
      exit 2
    fi
  done
}

start_services() {
  install_tools
  make_local_config
  if [[ ! -f "$local_dir/pg/PG_VERSION" ]]; then
    initdb -D "$local_dir/pg" -U "$(id -un)" -A trust --no-instructions >/dev/null
  fi
  refuse_foreign_listener "$pg_port" postgres
  for port in "$s3_port" "$master_port" "$volume_port" "$filer_port" "$admin_port" \
      "$((port_base + 101))" "$((port_base + 104))" "$((port_base + 105))" \
      "$((port_base + 106))" "$((port_base + 107))"; do
    refuse_foreign_listener "$port" weed
  done
  refuse_foreign_listener "$smtp_port" mailpit
  refuse_foreign_listener "$mail_ui_port" mailpit
  if ! pg_ctl -D "$local_dir/pg" status >/dev/null 2>&1; then
    pg_ctl -D "$local_dir/pg" -l "$local_dir/log/postgres.log" \
      -o "-h 127.0.0.1 -p $pg_port -k $local_dir" start >/dev/null
  fi
  if [[ "$(psql -h 127.0.0.1 -p "$pg_port" -U "$(id -un)" -d postgres -Atc 'SHOW data_directory')" != "$local_dir/pg" ]]; then
    echo "PostgreSQL port does not belong to this fixture; refusing to continue." >&2
    exit 2
  fi
  # Marker used by seed --reset to confirm it talks to this worktree's cluster.
  printf '%s\n' "$pg_port" > "$local_dir/pg.port"
  if [[ "$(psql -h 127.0.0.1 -p "$pg_port" -U "$(id -un)" -d postgres -Atc "SELECT 1 FROM pg_database WHERE datname='$db_name'")" != "1" ]]; then
    createdb -h 127.0.0.1 -p "$pg_port" -U "$(id -un)" "$db_name"
  fi
  if ! owned_process weed; then
    nohup env -u DEBUG "$bin_dir/weed" -config_dir="$local_dir/config" mini -dir="$local_dir/storage" -ip=127.0.0.1 -ip.bind=127.0.0.1 \
      -master.port="$master_port" -master.port.grpc="$((port_base + 104))" \
      -volume.port="$volume_port" -volume.port.grpc="$((port_base + 105))" \
      -filer.port="$filer_port" -filer.port.grpc="$((port_base + 106))" \
      -s3.port="$s3_port" -s3.port.grpc="$((port_base + 101))" \
      -admin.port="$admin_port" -admin.port.grpc="$((port_base + 107))" -admin.port.legacy=0 -admin.ui=false \
      -webdav=false -s3.port.iceberg=0 -s3.port.lance=0 -s3.iam=false \
      -s3.config="$local_dir/s3.json" -bucket=auterva-fixture-media \
      >"$local_dir/log/weed.log" 2>&1 &
    echo "$!" > "$local_dir/weed.pid"
  fi
  if ! owned_process mailpit; then
    nohup "$bin_dir/mailpit" --database "$local_dir/mailpit.db" --listen "127.0.0.1:$mail_ui_port" \
      --smtp "127.0.0.1:$smtp_port" --smtp-allowed-recipients '.*@example\.test$' \
      --disable-version-check --block-remote-css-and-fonts --allowed-hosts 127.0.0.1,localhost \
      >"$local_dir/log/mailpit.log" 2>&1 &
    echo "$!" > "$local_dir/mailpit.pid"
  fi
  for _ in {1..30}; do
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$s3_port/" || true)" == "403" ]] \
      && curl --fail --silent "http://127.0.0.1:$mail_ui_port/api/v1/messages" >/dev/null \
      && curl --fail --silent "http://127.0.0.1:$master_port/dir/assign?collection=auterva-fixture-media" | grep -q '"fid"'; then
      echo "Local PostgreSQL, private S3 fixture and Mailpit ready on loopback."
      return
    fi
    sleep 1
  done
  echo "Fixture services did not become ready; inspect .local/fixture-9/log without publishing secrets." >&2
  exit 1
}

seed_media() {
  [[ -f "$local_dir/secrets.env" ]] || { echo "Start the fixture first." >&2; exit 2; }
  # This file is generated locally with mode 0600 and is never committed.
  source "$local_dir/secrets.env"
  local image="$repo_dir/design/assets/generated/demo-v07/demo-v07-front-3q-480w.webp"
  local vehicle url status
  for vehicle in 21 22 24; do
    url="http://127.0.0.1:$s3_port/auterva-fixture-media/fixtures/90000000-0000-4000-8000-$(printf '%012d' "$vehicle")/cover.webp"
    status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --aws-sigv4 'aws:amz:us-east-1:s3' --user "$S3_ACCESS_KEY_ID:$S3_SECRET_ACCESS_KEY" \
      --upload-file "$image" "$url")"
    [[ "$status" == "200" ]] || { echo "Signed media upload failed ($status)." >&2; exit 1; }
    status="$(curl --silent --output /dev/null --write-out '%{http_code}' "$url")"
    [[ "$status" == "403" ]] || { echo "Media is not private ($status)." >&2; exit 1; }
  done
  status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:$filer_port/buckets/auterva-fixture-media/fixtures/90000000-0000-4000-8000-000000000021/cover.webp")"
  [[ "$status" == "401" ]] || { echo "Direct filer read bypasses S3 authentication ($status)." >&2; exit 1; }
  echo "Three fixture covers uploaded; unsigned S3 and filer reads denied."
}

case "${1:-}" in
  install) install_tools ;;
  start) start_services ;;
  seed-media) seed_media ;;
  status)
    pg_isready -h 127.0.0.1 -p "$pg_port"
    owned_process weed && echo "SeaweedFS running on loopback" || echo "SeaweedFS stopped"
    owned_process mailpit && echo "Mailpit running on loopback" || echo "Mailpit stopped"
    ;;
  stop)
    stop_process mailpit
    stop_process weed
    if [[ -f "$local_dir/pg/PG_VERSION" ]]; then pg_ctl -D "$local_dir/pg" stop >/dev/null || true; fi
    ;;
  *) echo "Usage: scripts/local-fixture.sh install|start|seed-media|status|stop" >&2; exit 2 ;;
esac
