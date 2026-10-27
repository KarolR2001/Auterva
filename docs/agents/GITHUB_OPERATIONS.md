# Operacje GitHub Project i blokady przydziału

Repozytorium `KarolR2001/Auterva`, [Project #1](https://github.com/users/KarolR2001/projects/1). Pola, statusy i widoki opisuje [WORKFLOW](../development/WORKFLOW.md#pola-i-widoki); dostęp [GITHUB_ACCESS](../development/GITHUB_ACCESS.md). Narzędzie: `gh` z zakresem `project` (`gh auth refresh -h github.com -s project`, gdy brakuje). GitHub MCP nie obsługuje Projects.

## Skrypt

`scripts/agents/auterva-project.sh` rozwiązuje ID projektu, pól i opcji po nazwach przy każdym wywołaniu — nie zapisuj ID w instrukcjach.

| Komenda | Zastosowanie |
|---|---|
| `queue` / `queue --json` | Elementy poza Done/Candidates według Order: status, rola, otwarte `blocked by`, etykiety, blokada, wyliczone `READY` |
| `ready Backend\|Frontend` | Pierwsze gotowe Re-open, potem To do roli |
| `item N` | Pola, blokery, blokada i PR wspominające issue |
| `set-status N "<Status>"` | Zmiana statusu (wyłącznie orkiestrator) |
| `claims` | Aktywne blokady z metadanymi |
| `claim N Rola branch agent [--takeover]` | Atomowe zajęcie slotu roli i issue (wyłącznie orkiestrator) |
| `release N Rola` | Zwolnienie blokady (wyłącznie orkiestrator) |
| `checkpoint-path` | Ścieżka lokalnego checkpointu Claude w `.git/auterva-checkpoints/` |

`READY=yes` oznacza: status Re-open/To do, issue otwarte, zero otwartych `blocked by`, brak `needs:decision`, brak blokady. To filtr wstępny — orkiestrator nadal weryfikuje decyzje, kontrakty, istniejące PR i wcześniejsze przejęcia. Flaga `stale-blocked-label` wskazuje etykietę `blocked` bez otwartych zależności do sprawdzenia i usunięcia.

## Blokady przydziału

Komentarz i status nie są atomowe — dwa orkiestratory (np. lokalny i w chmurze) mogłyby przejąć to samo issue. Blokada wykorzystuje atomowe tworzenie referencji Git przez API GitHub (drugie utworzenie zwraca `422`):

- `refs/claims/role/backend`, `refs/claims/role/frontend` — slot WIP roli (najwyżej jedno aktywne issue);
- `refs/claims/issue/<N>` — jeden wykonawca issue.

Referencje wskazują blob JSON `{issue, role, branch, agent, claimedAt}` i nie są pobierane przez zwykły `git fetch`. `claim` odmawia także, gdy rola ma In progress bez blokady (np. sesja Codex) lub issue ma otwarte `blocked by`. Blokadę zwalnia się po przekazaniu do Review albo po zapisaniu checkpointu i powrocie issue do To do. Porzuconą blokadę (brak aktywności, checkpoint w issue) usuwa orkiestrator po sprawdzeniu, z komentarzem w issue.

Sesje Codex mogą używać tych samych komend, aby uczestniczyć w blokadzie; dopóki tego nie robią, ich In progress liczy się do limitu roli.

## Typowe operacje

```bash
# Etykiety (wspólne dla issue i PR)
gh issue edit N --add-label needs:cr
gh pr edit P --add-label needs:cr
gh issue edit N --remove-label blocked

# Zależności blocked by (GraphQL)
gh api graphql -f query='{repository(owner:"KarolR2001",name:"Auterva"){issue(number:N){blockedBy(first:50){nodes{number state}}}}}'

# Raporty
gh pr comment P --body-file <plik>
gh issue comment N --body "…link do punktu synchronizacji…"

# PR otwarte do CR
gh pr list --state open --label needs:cr
```

Zasady treści: zaczynaj od wyniku lub problemu, ścieżki względem repozytorium, bez lokalnych ścieżek, nazw komputera, sekretów i zbędnych identyfikatorów sesji; head/base SHA raz w punkcie synchronizacji.

## Widoki

[Workflow](https://github.com/users/KarolR2001/projects/1) · [CR — Orchestrator](https://github.com/users/KarolR2001/projects/1/views/11) · [PR z needs:cr](https://github.com/KarolR2001/Auterva/pulls?q=is%3Apr+is%3Aopen+label%3Aneeds%3Acr). Statusy i etykiety nie uruchamiają agentów — robi to cykl orkiestratora.
