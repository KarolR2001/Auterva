# Orkiestrator Autervy w Claude Code

Główna sesja Claude Code (`opus`) koordynuje role z [WORKFLOW](../development/WORKFLOW.md): przydziela pracę, wykonuje CR, kieruje QA, scala i zamyka issue. Ten dokument opisuje wyłącznie sposób wykonania tego workflow w Claude Code; zasady statusów, CR, QA i Done pozostają w WORKFLOW, [quality gates](../quality-gates.md) i [AGENTS.md](../../AGENTS.md).

Powiązane: [kontrakt przekazania](CONTRACT.md) · [polityka merge](MERGE_POLICY.md) · [operacje GitHub](GITHUB_OPERATIONS.md).

## Zasady orkiestratora

- Jedyny koordynator przydziałów, statusów Project, blokad, merge i Done. Subagenci zwracają raporty; hook `.claude/hooks/guard-bash.sh` blokuje im operacje orkiestratora.
- Najwyżej jedno aktywne issue Backend i jedno Frontend (In progress), łącznie z pracą prowadzoną przez Codexa. Review/Ready to test/Test nie zajmują slotu.
- Każdy wykonawca dostaje jedno issue, własny branch i worktree. Po zakończeniu orkiestrator sam wybiera następne zadanie.
- Orkiestrator ustala kontrakt API/danych i jednego właściciela wspólnych plików (manifest, lockfile, migracje, `src/generated`, wspólne typy i komponenty) przed równoległą pracą.
- Orkiestrator nie implementuje zmian, które sam odbiera. Jeśli musi poprawić coś osobiście (np. konflikt integracji), ten fragment ocenia `auterva-reviewer` w osobnym przebiegu, a raport to wskazuje.
- Decyzje właściciela produktu (etykieta `needs:decision`, zmiana zakresu, wydatki, wdrożenie, zmiana ochrony gałęzi, destrukcyjna migracja) — zatrzymaj zależną pracę i zapytaj użytkownika. Nie pytaj ponownie o decyzje zapisane w PRD, wymaganiach, ADR, kontraktach lub komentarzach właściciela.

## Cykl (`/auterva-cycle`)

### 1. Odtworzenie stanu

1. `git fetch origin` w głównym checkoutcie (bez pull/reset cudzych worktree).
2. `scripts/agents/auterva-project.sh queue` i `claims`; otwarte PR: `gh pr list --state open`; PR z `needs:cr`.
3. Lokalny checkpoint: `scripts/agents/auterva-project.sh checkpoint-path` → odczytaj, jeśli istnieje. Checkpoint Codexa `.git/auterva-checkpoints/current.json` tylko czytaj.
4. Uzgodnij rozbieżności (status vs PR vs raporty vs blokady). Nieaktualny checkpoint nie wygrywa z GitHubem.

### 2. Współistnienie z Codexem

- Issue w In progress bez blokady `refs/claims/issue/N` traktuj jako prowadzone przez inną sesję (zwykle Codex); zajmuje slot roli.
- Nie przejmuj takiego issue bez polecenia użytkownika albo jednoznacznego porzucenia (checkpoint w issue, brak aktywności i zgoda użytkownika). Przejęcie: komentarz z rolą i branchem, `claim … --takeover`, kontynuacja na istniejącym branchu.
- Nie edytuj worktree, branchy ani usług Codexa. Własne worktree Claude: `../Auterva-worktrees/claude-<rola>-<N>`, branche `claude/<rola>/issue-N`.

### 3. Priorytet działań w cyklu

Najpierw domykaj, potem zaczynaj:

1. **Test z QA: PASS dla aktualnego SHA** → [polityka merge](MERGE_POLICY.md): merge, kontrole integracji na `main`, Done, zamknięcie, zwolnienie worktree.
2. **Review / PR z `needs:cr`** → CR (sekcja 5).
3. **Ready to test** → `auterva-qa` (sekcja 6).
4. **Re-open** → ten sam branch, `auterva-backend`/`auterva-frontend` z uwagami CR/QA.
5. **Nowe To do** dla wolnego slotu roli: `scripts/agents/auterva-project.sh ready <Rola>`, potem weryfikacja gotowości (sekcja 4).

Niezależne działania uruchamiaj równolegle w tle (np. Backend implementuje, Reviewer ocenia PR Frontendu, QA odbiera inny PR). Nie uruchamiaj dwóch wykonawców tej samej roli ani dwóch implementacji jednego issue.

### 4. Przydział nowego issue

1. Weryfikacja gotowości — wynik `ready` skryptu to filtr, nie dowód:
   - otwarte `blocked by` = 0 (GraphQL, nie etykieta); etykietę `blocked` bez otwartych zależności usuń dopiero po sprawdzeniu, że zależności są Done i zintegrowane;
   - brak `needs:decision`, zapisane decyzje D-xx dotyczące zakresu, istniejące kontrakty w `docs/contracts/`;
   - brak otwartego PR lub wcześniejszego przejęcia (komentarze, branch `codex/*`/`claude/*`, blokada);
   - `needs:penpot`: zadanie Frontendu przygotowuje makietę — wymaga działającego Penpot MCP i wyznaczenia jednego edytora Penpota.
2. `scripts/agents/auterva-project.sh claim <N> <Rola> claude/<rola>/issue-N auterva-<rola>`. Odmowa = ktoś inny ma slot/issue; nie obchodź jej.
3. Worktree: `git worktree add -b claude/<rola>/issue-N ../Auterva-worktrees/claude-<rola>-N origin/main`; zainstaluj zależności z lockfile (`pnpm install --frozen-lockfile`) w tym worktree.
4. Komentarz przejęcia w issue (rola, branch, krótki plan, właściciele wspólnych plików), następnie `set-status <N> "In progress"`.
5. Uruchom subagenta w tle z briefem z [CONTRACT](CONTRACT.md#brief-dla-wykonawcy).
6. Po raporcie wykonawcy: sprawdź PR, `Refs #N`, punkt synchronizacji i wyniki bramek. Dodaj `needs:cr` do issue i PR, `set-status <N> Review`, `release <N> <Rola>`, usuń worktree tylko, jeśli jest czysty i wypchnięty (branch zostaje). Slot jest wolny — wróć do kroku 3.

Gdy brak gotowych zadań roli, zapisz w checkpoincie konkretne blokery (issue → otwarte zależności lub decyzja) zamiast zaczynać niezatwierdzony zakres.

### 5. Code Review

1. Zapisz rozpoczęcie CR w PR z head SHA i base SHA.
2. Worktree recenzenta: `../Auterva-worktrees/claude-reviewer-N` (detached na head SHA). Uruchom `auterva-reviewer` z briefem bez własnych wniosków o kodzie.
3. Równolegle sam przejrzyj diff i powiązany kod (WORKFLOW → „CR głównego orkiestratora”). Zestaw ustalenia; każdą uwagę blokującą recenzenta zweryfikuj w kodzie — odrzuć niepotwierdzone, potwierdzone zachowaj z lokalizacją.
4. Opublikuj raport CR (format z CONTRACT) w PR, link w issue. Usuń `needs:cr`.
   - `CR: PASS` → `set-status Ready to test`.
   - `CR: CHANGES_REQUESTED` → `set-status Re-open`; poprawkę wykonuje ten sam branch (sekcja 3, punkt 4).
   - `CR: BLOCKED` → status bez zmian, etykieta `blocked` lub `needs:decision` z przyczyną.
5. Nowy commit w PR unieważnia CR i QA — ponów CR dla nowego SHA.

### 6. QA

1. Tylko dla aktualnego `CR: PASS` z tym samym head SHA. `set-status Test`, komentarz rozpoczęcia.
2. Worktree QA `../Auterva-worktrees/claude-qa-N` (detached na head SHA), porty i baza według [CONTRACT](CONTRACT.md#porty-i-dane).
3. `auterva-qa` publikuje raport w PR. `QA: PASS` → issue zostaje w Test do integracji. `QA: FAIL` → `set-status Re-open` z linkiem. `QA: BLOCKED` → przyczyna środowiska; nie Re-open, jeśli to nie błąd implementacji.

### 7. Po każdym zakończonym kroku

Ponownie odczytaj kolejkę i przydziel następne gotowe issue dla wolnych slotów. Po zamknięciu ostatniego issue danego Stage wykonaj `SYSTEM REVIEW` całego kodu (WORKFLOW → „Przegląd całego kodu”) z pomocą `auterva-reviewer`.

### 8. Checkpoint

Na końcu cyklu, przed kompakcją kontekstu i przed zakończeniem sesji zapisz JSON w ścieżce z `checkpoint-path`:

```json
{
  "updatedAt": "UTC",
  "main": "<sha origin/main>",
  "active": [{ "issue": 0, "role": "Backend", "status": "In progress", "branch": "claude/backend/issue-0",
               "worktree": "<lokalna ścieżka>", "head": "<sha>", "pr": 0, "portBase": 0, "agent": "auterva-backend" }],
  "reviews": [{ "issue": 0, "pr": 0, "head": "<sha>", "base": "<sha>", "cr": "PASS|CHANGES_REQUESTED|BLOCKED", "link": "<url>" }],
  "qa": [{ "issue": 0, "pr": 0, "head": "<sha>", "result": "PASS|FAIL|BLOCKED", "link": "<url>" }],
  "blockers": ["#N: otwarte #A, #B", "#M: needs:decision D-xx"],
  "codex": "issue/sloty prowadzone przez Codex",
  "next": ["kolejny krok"]
}
```

Lokalny checkpoint może zawierać ścieżki worktree; publiczne komentarze nie. Każdy stan da się odtworzyć bez checkpointu z GitHuba (statusy, `refs/claims/*`, punkty synchronizacji w PR) — checkpoint jedynie przyspiesza wznowienie.

## Uruchamianie

| Tryb | Jak | Ograniczenia |
|---|---|---|
| Jeden cykl | `claude` w katalogu repozytorium, potem `/auterva-cycle` | Mac włączony, sesja otwarta |
| Praca ciągła w sesji | `/loop /auterva-cycle` (tempo dobiera orkiestrator) | Kończy się z sesją; subagenci budzą orkiestratora po zakończeniu |
| Harmonogram lokalny | launchd/cron z `claude -p "/auterva-cycle"` | Wymaga jawnej listy uprawnień dla trybu bez interakcji; nie skonfigurowano — decyzja właściciela |
| Bez włączonego Maca | Claude Code on the web / zadania harmonogramu w chmurze (`/schedule`) albo GitHub Actions `anthropics/claude-code-action` | Patrz niżej |

### Praca bez włączonego Maca — propozycja

Lokalna sesja Claude Code nie działa, gdy Mac jest wyłączony. Wykonanie w chmurze wymaga osobnej infrastruktury:

- **Zadanie harmonogramu Claude Code w chmurze** klonuje repozytorium i wczytuje zatwierdzone `CLAUDE.md`, `.claude/settings.json`, agentów i skille. Wymaga połączenia GitHub (Claude GitHub App), środowiska z dostępem do sieci i skryptem przygotowania (Node 24, pnpm, PostgreSQL, przeglądarki Playwright) oraz zmiennych testowych bez danych produkcyjnych. Nie widzi lokalnych checkpointów `.git/…`, worktree Codexa ani lokalnego Penpot MCP — stan odtwarza z GitHuba, a blokady `refs/claims/*` chronią przed kolizją z sesjami lokalnymi.
- **GitHub Actions** z `anthropics/claude-code-action` wymaga sekretu `ANTHROPIC_API_KEY` lub `CLAUDE_CODE_OAUTH_TOKEN`, Claude GitHub App i minut Actions w prywatnym repozytorium; harmonogram działa tylko z gałęzi domyślnej.
- Rekomendacja: najpierw tryb lokalny z `/loop`. Po #10 (CI i środowiska) uruchomić w chmurze cykl ograniczony do kolejki, CR i synchronizacji statusów; QA z Penpotem i PWA pozostawić lokalnie do czasu udostępnienia Penpot MCP jako zdalnego konektora. Konfiguracja chmury, sekrety i koszty wymagają decyzji właściciela produktu.
