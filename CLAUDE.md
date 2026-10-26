@AGENTS.md

# Claude Code w Autervie

Powyższy AGENTS.md jest nadrzędny i wspólny z Codexem; ten plik dodaje tylko mapowanie na Claude Code. Rozbieżność rozstrzyga AGENTS.md, WORKFLOW i PRD — nie ten plik.

## Role i modele

| Rola | Gdzie | Model |
|---|---|---|
| Główny orkiestrator | główna sesja, [ORCHESTRATOR](docs/agents/ORCHESTRATOR.md) | `opus` |
| Backend | `.claude/agents/auterva-backend.md` | `sonnet` |
| Frontend | `.claude/agents/auterva-frontend.md` | `sonnet` |
| Code Reviewer | `.claude/agents/auterva-reviewer.md` | `opus` |
| QA | `.claude/agents/auterva-qa.md` | `sonnet` |
| Odczyty pomocnicze | `.claude/agents/auterva-scout.md` | `haiku` |

Odpowiadają rolom Codexa z `.codex/agents/`. Zmieniając zasady roli, zaktualizuj oba pliki albo zapisz rozbieżność w issue.

## Główna sesja

- Sesja uruchomiona w tym repozytorium jest orkiestratorem tylko na polecenie użytkownika lub `/auterva-cycle`. Inne prośby wykonuj jako zwykłą pracę, z zachowaniem AGENTS.md.
- Orkiestrator nie implementuje kodu, który odbiera. Implementację deleguje do `auterva-backend`/`auterva-frontend`, recenzję do `auterva-reviewer`, odbiór do `auterva-qa` — według [kontraktu przekazania](docs/agents/CONTRACT.md).
- Merge, Done, zamknięcie issue, statusy Project i blokady przydziału wykonuje wyłącznie główna sesja: [polityka merge](docs/agents/MERGE_POLICY.md), [operacje GitHub](docs/agents/GITHUB_OPERATIONS.md). Hook `.claude/hooks/guard-bash.sh` blokuje te operacje subagentom.
- Stan odtwarzaj z GitHuba (`scripts/agents/auterva-project.sh queue`, `claims`) i lokalnego checkpointu (`scripts/agents/auterva-project.sh checkpoint-path`). Checkpoint Codexa `.git/auterva-checkpoints/current.json` czytaj, nie nadpisuj.

## Skille i MCP

- Skille projektu leżą w `.agents/skills/`; `.claude/skills/<nazwa>` to dowiązania do nich. Nowy skill dodaj do `.agents/skills/` i `skills-lock.json`, potem dowiązanie.
- Penpot MCP musi być skonfigurowany lokalnie przez użytkownika (zakres user, poza repozytorium). Brak serwera oznacza niewykonane porównanie z Penpotem, nie PASS.

## Zakazy

Bez force push, `reset --hard`, `migrate reset`, push do `main`, `--admin`, wdrożeń produkcyjnych, odczytu `.env`/tokenów i zmian zakresu MVP bez jawnej zgody właściciela produktu.
