#!/usr/bin/env bash
# Macierz decyzji hooka .claude/hooks/guard-bash.sh: BLOCK (exit 2) lub ALLOW.
# Uruchom z katalogu repozytorium: scripts/agents/guard-bash.test.sh
set -uo pipefail

hook="$(git rev-parse --show-toplevel)/.claude/hooks/guard-bash.sh"
pass=0 fail=0

t() {
  local expected=$1 agent=$2; shift 2
  local cmd="$*" rc result
  jq -n --arg c "$cmd" --arg a "$agent" \
    '{tool_input:{command:$c}} + (if $a == "" then {} else {agent_type:$a} end)' | "$hook" >/dev/null 2>&1
  rc=$?
  result=$([[ $rc -eq 2 ]] && echo BLOCK || echo ALLOW)
  if [[ "$result" == "$expected" ]]; then pass=$((pass + 1)); else
    fail=$((fail + 1)); echo "FAIL expected=$expected got=$result agent=[$agent] cmd=$cmd"
  fi
}

# Główna sesja (orkiestrator)
t BLOCK "" git push --force origin x
t BLOCK "" git push -f origin x
t BLOCK "" git push origin +x
t BLOCK "" git push origin HEAD:main
t BLOCK "" git push origin main
t BLOCK "" git push origin --delete feature
t BLOCK "" git push origin :feature
t ALLOW "" git push -u origin claude/backend/issue-23
t ALLOW "" git push origin HEAD:refs/heads/claude/backend/issue-23
t ALLOW "" git push --follow-tags origin claude/x
t BLOCK "" "git fetch && git reset --hard origin/main"
t BLOCK "" git clean -fdx
t BLOCK "" pnpm prisma migrate reset --force
t BLOCK "" gh pr merge 5 --merge --admin
t ALLOW "" gh pr merge 5 --merge --match-head-commit abc
t BLOCK "" gh pr review 5 --approve
t BLOCK "" cat .env
t BLOCK "" grep KEY apps/.env.local
t BLOCK "" source .env
t ALLOW "" cat .env.example
t ALLOW "" cat .env.test.example
t BLOCK "" cat ~/.codex/config.toml
t ALLOW "" cat .codex/config.toml
t BLOCK "" gh auth token
t BLOCK "" gh api -X PUT repos/KarolR2001/Auterva/branches/main/protection --input p.json
t ALLOW "" gh api repos/KarolR2001/Auterva/branches/main/protection
t BLOCK "" gh api -X DELETE repos/KarolR2001/Auterva/git/refs/heads/x
t ALLOW "" gh api -X DELETE repos/KarolR2001/Auterva/git/refs/claims/issue/5
t ALLOW "" scripts/agents/auterva-project.sh set-status 5 Done
t ALLOW "" gh issue close 5 --reason completed
t BLOCK "" git worktree remove --force ../x
t ALLOW "" git worktree remove ../Auterva-worktrees/claude-backend-23

# Wykonawcy
t BLOCK auterva-backend gh pr merge 5 --merge
t BLOCK auterva-backend gh issue close 5
t BLOCK auterva-backend scripts/agents/auterva-project.sh set-status 5 Review
t BLOCK auterva-backend scripts/agents/auterva-project.sh claim 5 Backend b a
t BLOCK auterva-backend gh issue edit 5 --add-label needs:cr
t BLOCK auterva-backend gh project item-edit --id x
t ALLOW auterva-backend git commit -m x
t ALLOW auterva-backend git push -u origin claude/backend/issue-23
t ALLOW auterva-backend gh pr create --base main --title t --body-file b
t ALLOW auterva-frontend gh issue comment 5 --body checkpoint
t ALLOW auterva-frontend scripts/agents/auterva-project.sh queue

# Recenzent i pomocnik (odczyt)
t BLOCK auterva-reviewer git commit -m x
t BLOCK auterva-reviewer gh pr comment 5 --body x
t BLOCK auterva-reviewer gh api -X POST repos/a/b/issues/5/comments
t ALLOW auterva-reviewer git -C ../w checkout --detach abc
t ALLOW auterva-reviewer pnpm test:integration
t ALLOW auterva-reviewer "gh api graphql -f query='{viewer{login}}'"
t BLOCK auterva-scout "gh api graphql -f query='mutation{x}'"
t BLOCK auterva-scout gh api repos/a/b/issues/5/comments -f body=x
t ALLOW auterva-scout gh pr list --state open

# QA
t BLOCK auterva-qa git commit -m x
t BLOCK auterva-qa git push origin x
t ALLOW auterva-qa gh pr comment 5 --body-file r.md
t BLOCK auterva-qa gh pr merge 5
t ALLOW auterva-qa pnpm test:e2e

echo "guard-bash: pass=$pass fail=$fail"
[[ $fail -eq 0 ]]
