#!/usr/bin/env bash
# PreToolUse(Bash): blokuje operacje destrukcyjne dla wszystkich oraz operacje
# orkiestratora dla subagentów. Zasady: docs/agents/ORCHESTRATOR.md, MERGE_POLICY.md.
# Wyjście 2 + komunikat na stderr odrzuca komendę. Nie jest to granica bezpieczeństwa
# — uzupełnia uprawnienia z .claude/settings.json.
set -uo pipefail

input=$(cat)
cmd=$(jq -r '.tool_input.command // ""' <<<"$input")
agent=$(jq -r '.agent_type // ""' <<<"$input")

block() {
  echo "Zablokowane przez .claude/hooks/guard-bash.sh: $1" >&2
  exit 2
}

has() { grep -Eq -- "$1" <<<"$cmd"; }

# --- Wszyscy, także główna sesja ---------------------------------------------
has 'git[[:space:]]+push[^;&|]*(--force|--force-with-lease|--mirror|[[:space:]]-[a-zA-Z]*f([[:space:]]|$)|[[:space:]]\+[^[:space:]]+)' \
  && block "force push jest zakazany"
has 'git[[:space:]]+push[^;&|]*(--delete|[[:space:]]-d([[:space:]]|$)|[[:space:]]:[^[:space:]]+)' \
  && block "usuwanie zdalnych gałęzi przez push wymaga zgody właściciela"
has 'git[[:space:]]+push[^;&|]*[[:space:]]([^[:space:]]*:)?(refs/heads/)?main([[:space:]]|$)' \
  && block "bezpośredni push do main jest zakazany; scalaj przez PR"
has 'git[[:space:]]+reset[^;&|]*--hard' && block "git reset --hard jest zakazany"
has 'git[[:space:]]+clean[[:space:]]+-[a-zA-Z]*f' && block "git clean -f jest zakazany"
has 'git[[:space:]]+branch[^;&|]*[[:space:]]-D([[:space:]]|$)' && block "git branch -D wymaga zgody właściciela"
has 'git[[:space:]]+worktree[[:space:]]+remove[^;&|]*(--force|[[:space:]]-f([[:space:]]|$))' \
  && block "wymuszone usunięcie worktree może skasować cudzą pracę"
has 'prisma[^;&|]*migrate[[:space:]]+reset|prisma[^;&|]*db[[:space:]]+push[^;&|]*(--force-reset|--accept-data-loss)' \
  && block "destrukcyjna operacja Prisma wymaga zgody właściciela"
has 'gh[[:space:]]+pr[[:space:]]+merge[^;&|]*--admin' && block "merge z --admin obchodzi zabezpieczenia"
has 'gh[[:space:]]+pr[[:space:]]+review[^;&|]*(--approve|[[:space:]]-a([[:space:]]|$))' \
  && block "wspólne konto nie wystawia formalnego Approve; użyj raportu CR"
has 'gh[[:space:]]+repo[[:space:]]+(delete|archive|edit[^;&|]*--visibility)' && block "operacja na repozytorium wymaga zgody właściciela"
has 'gh[[:space:]]+api[^;&|]*(branches/[^[:space:]]*/protection|rulesets)' \
  && has '(-X|--method)[[:space:]]*(POST|PUT|PATCH|DELETE)|[[:space:]](-f|-F|--field|--raw-field|--input)[[:space:]]' \
  && block "zmiana ochrony gałęzi wymaga zgody właściciela"
has 'gh[[:space:]]+api[^;&|]*(-X|--method)[[:space:]]*DELETE' && ! has 'git/refs/claims/' \
  && block "DELETE przez API wymaga zgody właściciela"
has '(vercel|netlify)[^;&|]*--prod|fly(ctl)?[[:space:]]+deploy|railway[[:space:]]+up' \
  && block "wdrożenie wymaga jawnej zgody właściciela"
has '(cat|less|more|head|tail|bat|grep|rg|sed|awk|cp|scp|base64|xxd|strings|source|\.)[[:space:]]([^;&|]*[[:space:]/])?\.env(\.(local|development|production|staging|test)(\.local)?)?([[:space:];&|]|$)' \
  && block "odczyt plików .env jest zakazany; używaj fixture i .env.example"
has '\.codex/auth\.json|(~|\$HOME|/Users/[^/[:space:]]+)/\.codex/config\.toml|\.config/gh/hosts\.yml|gh[[:space:]]+auth[[:space:]]+token' \
  && block "odczyt danych uwierzytelniających jest zakazany"

# --- Subagenci: operacje zarezerwowane dla orkiestratora --------------------------
[[ -z "$agent" ]] && exit 0

has 'gh[[:space:]]+pr[[:space:]]+(merge|close|reopen|ready[^;&|]*--undo)' && block "merge/zamknięcie PR wykonuje orkiestrator"
has 'gh[[:space:]]+issue[[:space:]]+(close|reopen|create|delete|transfer|pin|lock)' && block "operacje na issue wykonuje orkiestrator"
has 'gh[[:space:]]+issue[[:space:]]+edit|gh[[:space:]]+pr[[:space:]]+edit[^;&|]*(--add-label|--remove-label)|gh[[:space:]]+label' \
  && block "etykiety i pola issue ustawia orkiestrator"
has 'gh[[:space:]]+project[[:space:]]+(item-edit|item-add|item-archive|item-delete|field-|edit|close|delete|link|unlink)' \
  && block "statusy Project ustawia orkiestrator"
has 'auterva-project\.sh[[:space:]]+(set-status|claim|release)' && block "statusy i blokady ustawia orkiestrator"
has 'gh[[:space:]]+api[[:space:]]+graphql[^;&|]*mutation' && block "mutacje GraphQL wykonuje orkiestrator"

case "$agent" in
  auterva-reviewer|auterva-scout|Explore|Plan)
    has 'git[[:space:]]+(commit|push|merge|rebase|cherry-pick|revert|tag|stash[[:space:]]+(drop|clear))' \
      && block "rola $agent jest wyłącznie odczytowa"
    has 'gh[[:space:]]+(pr|issue)[[:space:]]+(create|comment|edit|review)' && block "rola $agent nie publikuje w GitHubie"
    has 'gh[[:space:]]+api[^;&|]*(-X|--method)[[:space:]]*(POST|PATCH|PUT|DELETE)' && block "rola $agent nie zapisuje przez API"
    has 'gh[[:space:]]+api[[:space:]]+[^g][^;&|]*[[:space:]](-f|-F|--field|--raw-field|--input)[[:space:]]' \
      && block "rola $agent nie zapisuje przez API"
    ;;
  auterva-qa)
    has 'git[[:space:]]+(commit|push|merge|rebase|cherry-pick|revert|tag)' && block "QA nie zmienia kodu ani historii"
    has 'gh[[:space:]]+pr[[:space:]]+(create|edit|review)' && block "QA publikuje wyłącznie raport komentarzem"
    has 'gh[[:space:]]+api[^;&|]*(-X|--method)[[:space:]]*(POST|PATCH|PUT|DELETE)' && block "QA nie zapisuje przez API"
    ;;
esac

exit 0
