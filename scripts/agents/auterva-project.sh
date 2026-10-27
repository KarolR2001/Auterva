#!/usr/bin/env bash
# Kolejka GitHub Project #1, statusy i atomowe blokady przydziału issue.
# Opis użycia i zasady: docs/agents/GITHUB_OPERATIONS.md. Wymaga gh (scope project) i jq.
set -euo pipefail

OWNER="KarolR2001"
REPO="Auterva"
PROJECT_NUMBER=1
CLAIMS_NS="refs/claims"

die() { echo "auterva-project: $*" >&2; exit 1; }
lower() { tr "[:upper:]" "[:lower:]" <<<"$1"; }

usage() {
  cat <<'EOF'
Użycie: scripts/agents/auterva-project.sh <komenda> [argumenty]

  queue [--json]                 Elementy poza Done/Candidates według Order, z gotowością
                                 wyliczoną z otwartych blocked by, etykiet i blokad.
  ready <Backend|Frontend>       Pierwsze gotowe Re-open/To do danej roli (lub nic).
  item <issue>                   Pola Project, blokery, blokada i powiązane PR.
  set-status <issue> <status>    Ustawia Status (nazwa opcji, np. "Ready to test").
  claims                         Aktywne blokady przydziału.
  claim <issue> <Backend|Frontend> <branch> <agent> [--takeover]
                                 Atomowo zajmuje slot roli i issue (refs/claims/*).
  release <issue> <Backend|Frontend>
                                 Zwalnia blokadę issue i slot roli.
  checkpoint-path                Ścieżka lokalnego checkpointu orkiestratora Claude.
EOF
}

# --- Project ---------------------------------------------------------------

ITEMS_QUERY='query($owner:String!,$number:Int!,$cursor:String){
  user(login:$owner){ projectV2(number:$number){ id
    items(first:100, after:$cursor){
      pageInfo{ hasNextPage endCursor }
      nodes{ id
        fieldValues(first:20){ nodes{
          ... on ProjectV2ItemFieldSingleSelectValue{ name field{ ... on ProjectV2FieldCommon{ name } } }
          ... on ProjectV2ItemFieldNumberValue{ number field{ ... on ProjectV2FieldCommon{ name } } }
        } }
        content{ ... on Issue{ number title state
          labels(first:30){ nodes{ name } }
          blockedBy(first:50){ nodes{ number state } }
        } }
      } } } } }'

# Wszystkie elementy-issue jako tablica JSON z polami spłaszczonymi do nazw.
fetch_items() {
  local cursor="" page out="[]"
  while :; do
    if [[ -n "$cursor" ]]; then
      page=$(gh api graphql -f query="$ITEMS_QUERY" -f owner="$OWNER" -F number="$PROJECT_NUMBER" -f cursor="$cursor")
    else
      page=$(gh api graphql -f query="$ITEMS_QUERY" -f owner="$OWNER" -F number="$PROJECT_NUMBER")
    fi
    out=$(jq -c --argjson acc "$out" '
      $acc + [ .data.user.projectV2.items.nodes[]
        | select(.content.number != null)
        | { itemId: .id,
            number: .content.number,
            title: .content.title,
            state: .content.state,
            labels: [ .content.labels.nodes[].name ],
            openBlockers: [ .content.blockedBy.nodes[] | select(.state == "OPEN") | .number ],
            fields: ( [ .fieldValues.nodes[] | select(.field.name != null)
                        | { key: .field.name, value: (.name // .number) } ] | from_entries ) }
        | . + { status: .fields.Status, role: .fields.Role, order: .fields.Order,
                stage: .fields.Stage, priority: .fields.Priority } ]' <<<"$page")
    [[ $(jq -r '.data.user.projectV2.items.pageInfo.hasNextPage' <<<"$page") == "true" ]] || break
    cursor=$(jq -r '.data.user.projectV2.items.pageInfo.endCursor' <<<"$page")
  done
  echo "$out"
}

fetch_claims() {
  gh api "repos/$OWNER/$REPO/git/matching-refs/claims/" --jq '[.[].ref]' 2>/dev/null || echo "[]"
}

# Gotowość: Re-open/To do, issue otwarte, zero otwartych blocked by, bez needs:decision
# i bez blokady innego wykonawcy. Etykieta blocked bez otwartych zależności to sygnał
# do weryfikacji przez orkiestratora, nie dowód gotowości ani blokady.
annotate() {
  jq -c --argjson claims "$1" '
    [ .[] | select(.status != "Done" and .status != "Candidates")
      | .number as $n | . + { claimed: ($claims | index("refs/claims/issue/\($n)") != null) }
      | . + { ready: ((.status == "To do" or .status == "Re-open") and .state == "OPEN"
                      and (.openBlockers | length) == 0
                      and ((.labels | index("needs:decision")) == null)
                      and (.claimed | not)),
              staleBlockedLabel: (((.labels | index("blocked")) != null) and (.openBlockers | length) == 0) } ]
    | sort_by(.order // 9999)'
}

cmd_queue() {
  local items claims
  items=$(fetch_items); claims=$(fetch_claims)
  if [[ "${1:-}" == "--json" ]]; then annotate "$claims" <<<"$items"; return; fi
  annotate "$claims" <<<"$items" | jq -r '
    ["ORDER","ISSUE","STATUS","ROLE","READY","OPEN_BLOCKED_BY","FLAGS","TITLE"],
    ( .[] | [ (.order // "-" | tostring), "#\(.number)", .status, (.role // "-"),
              (if .ready then "yes" else "no" end),
              (if (.openBlockers|length)>0 then (.openBlockers|map("#\(.)")|join(",")) else "-" end),
              ([ (.labels[] | select(. == "blocked" or . == "needs:cr" or . == "needs:decision" or . == "needs:penpot")),
                 (if .claimed then "claimed" else empty end),
                 (if .staleBlockedLabel then "stale-blocked-label" else empty end) ] | join(",") | if . == "" then "-" else . end),
              (.title | .[0:80]) ] )
    | @tsv' | column -t -s $'\t'
}

cmd_ready() {
  local role="${1:-}"; [[ "$role" == "Backend" || "$role" == "Frontend" ]] || die "rola: Backend|Frontend"
  fetch_items | annotate "$(fetch_claims)" | jq -r --arg role "$role" '
    [ .[] | select(.role == $role and .ready) ]
    | (map(select(.status == "Re-open")) + map(select(.status == "To do")))
    | first // empty | "#\(.number)\t\(.status)\t\(.order)\t\(.title)"'
}

cmd_item() {
  local n="${1:?numer issue}"
  fetch_items | annotate "$(fetch_claims)" | jq --argjson n "$n" '.[] | select(.number == $n)
    | del(.itemId)'
  gh pr list --repo "$OWNER/$REPO" --state all --search "$n in:body" --limit 10 \
    --json number,state,isDraft,headRefName,headRefOid,labels \
    --jq '.[] | "PR #\(.number) \(.state) draft=\(.isDraft) \(.headRefName) \(.headRefOid[0:12]) [\([.labels[].name]|join(","))]"'
}

cmd_set_status() {
  local n="${1:?numer issue}" status="${2:?nazwa statusu}" fields project_id field_id option_id item_id
  fields=$(gh project field-list "$PROJECT_NUMBER" --owner "$OWNER" --format json)
  project_id=$(gh project view "$PROJECT_NUMBER" --owner "$OWNER" --format json --jq .id)
  field_id=$(jq -r '.fields[] | select(.name == "Status") | .id' <<<"$fields")
  option_id=$(jq -r --arg s "$status" '.fields[] | select(.name == "Status") | .options[] | select(.name == $s) | .id' <<<"$fields")
  [[ -n "$option_id" ]] || die "nieznany status: $status (dostępne: $(jq -r '[.fields[]|select(.name=="Status")|.options[].name]|join(", ")' <<<"$fields"))"
  item_id=$(fetch_items | jq -r --argjson n "$n" '.[] | select(.number == $n) | .itemId')
  [[ -n "$item_id" ]] || die "issue #$n nie jest elementem Project #$PROJECT_NUMBER"
  gh project item-edit --id "$item_id" --project-id "$project_id" --field-id "$field_id" \
    --single-select-option-id "$option_id" >/dev/null
  echo "#$n → $status"
}

# --- Blokady przydziału ------------------------------------------------------
# Referencje refs/claims/role/<rola> i refs/claims/issue/<n> wskazują blob z metadanymi.
# Utworzenie referencji przez API jest atomowe (422, gdy istnieje), więc dwa
# orkiestratory nie przydzielą tego samego slotu ani issue.

ref_exists() { gh api "repos/$OWNER/$REPO/git/refs/${1#refs/}" >/dev/null 2>&1; }

create_ref() {
  gh api -X POST "repos/$OWNER/$REPO/git/refs" -f ref="$1" -f sha="$2" >/dev/null 2>&1
}

delete_ref() { gh api -X DELETE "repos/$OWNER/$REPO/git/refs/${1#refs/}" >/dev/null 2>&1; }

read_ref_meta() {
  local sha
  sha=$(gh api "repos/$OWNER/$REPO/git/refs/${1#refs/}" --jq .object.sha 2>/dev/null) || return 1
  gh api "repos/$OWNER/$REPO/git/blobs/$sha" --jq .content | base64 --decode
}

cmd_claims() {
  local ref
  for ref in $(fetch_claims | jq -r '.[]'); do
    printf '%s\t%s\n' "$ref" "$(read_ref_meta "$ref" | jq -c . 2>/dev/null || echo '?')"
  done
}

cmd_claim() {
  local n="${1:?numer issue}" role="${2:?rola}" branch="${3:?branch}" agent="${4:?agent}" takeover="${5:-}"
  [[ "$role" == "Backend" || "$role" == "Frontend" ]] || die "rola: Backend|Frontend"
  local slot="$CLAIMS_NS/role/$(lower "$role")" lock="$CLAIMS_NS/issue/$n" items item others meta blob

  items=$(fetch_items)
  item=$(jq -c --argjson n "$n" '.[] | select(.number == $n)' <<<"$items")
  [[ -n "$item" ]] || die "issue #$n nie jest elementem Project"
  [[ $(jq -r .role <<<"$item") == "$role" ]] || die "#$n ma Role=$(jq -r .role <<<"$item"), nie $role"
  [[ $(jq -r '.openBlockers | length' <<<"$item") == 0 ]] || die "#$n ma otwarte blocked by: $(jq -r '.openBlockers|join(",")' <<<"$item")"

  # Limit WIP obejmuje też pracę rozpoczętą bez blokady (np. sesje Codex).
  others=$(jq -r --arg role "$role" --argjson n "$n" \
    '[ .[] | select(.role == $role and .status == "In progress" and .number != $n) | "#\(.number)" ] | join(",")' <<<"$items")
  [[ -z "$others" ]] || die "rola $role ma już In progress: $others"
  if [[ $(jq -r .status <<<"$item") == "In progress" && "$takeover" != "--takeover" ]]; then
    die "#$n jest już In progress; jawne przejęcie wymaga --takeover i komentarza przejęcia"
  fi

  meta=$(jq -cn --argjson n "$n" --arg role "$role" --arg branch "$branch" --arg agent "$agent" \
    --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '{issue:$n, role:$role, branch:$branch, agent:$agent, claimedAt:$at}')
  blob=$(gh api -X POST "repos/$OWNER/$REPO/git/blobs" -f content="$meta" -f encoding=utf-8 --jq .sha)

  if ! create_ref "$slot" "$blob"; then
    die "slot $role zajęty: $(read_ref_meta "$slot" || echo '?')"
  fi
  if ! create_ref "$lock" "$blob"; then
    delete_ref "$slot" || true
    die "issue #$n zajęte: $(read_ref_meta "$lock" || echo '?')"
  fi
  echo "claimed #$n $role $branch $agent"
}

cmd_release() {
  local n="${1:?numer issue}" role="${2:?rola}" lock slot meta
  lock="$CLAIMS_NS/issue/$n"; slot="$CLAIMS_NS/role/$(lower "$role")"
  if meta=$(read_ref_meta "$lock"); then
    [[ $(jq -r .role <<<"$meta") == "$role" ]] || die "blokada #$n należy do roli $(jq -r .role <<<"$meta")"
    delete_ref "$lock"
  fi
  if meta=$(read_ref_meta "$slot"); then
    if [[ $(jq -r .issue <<<"$meta") == "$n" ]]; then delete_ref "$slot"; fi
  fi
  echo "released #$n $role"
}

cmd_checkpoint_path() {
  local dir
  dir="$(cd "$(git rev-parse --git-common-dir)" && pwd)/auterva-checkpoints"
  mkdir -p "$dir"
  echo "$dir/claude-orchestrator.json"
}

command -v gh >/dev/null || die "brak gh"
command -v jq >/dev/null || die "brak jq"

case "${1:-}" in
  queue) shift; cmd_queue "$@" ;;
  ready) shift; cmd_ready "$@" ;;
  item) shift; cmd_item "$@" ;;
  set-status) shift; cmd_set_status "$@" ;;
  claims) shift; cmd_claims ;;
  claim) shift; cmd_claim "$@" ;;
  release) shift; cmd_release "$@" ;;
  checkpoint-path) shift; cmd_checkpoint_path ;;
  -h|--help|"") usage ;;
  *) usage; exit 2 ;;
esac
