# Polityka merge

Orkiestrator scala PR seryjnie, jeden naraz, wyłącznie gdy wszystkie warunki są spełnione dla **tego samego head SHA**. Komentarz PASS jest zapisem oceny, nie techniczną gwarancją — warunki sprawdzasz przed każdym merge.

## Stan zabezpieczeń (bootstrap)

- Ochrona `main` i rulesets: prywatne repozytorium bez GitHub Pro zwraca `403` ([GITHUB_ACCESS](../development/GITHUB_ACCESS.md)). Nie da się technicznie wymusić wymaganych checks ani reviews.
- Zdalne CI nie istnieje do czasu [#10](https://github.com/KarolR2001/Auterva/issues/10). Brak checks to `not-run`, nie PASS.
- Wspólne konto: raporty CR/QA nie są formalnym Approve. Nie używaj `gh pr review --approve`.

Do czasu #10 obowiązuje **tryb bootstrap**: lokalne kontrole integracji orkiestratora zastępują zdalne CI, a ich wyniki trafiają do raportu integracji. Po integracji #10 orkiestrator ponownie sprawdza możliwość ochrony gałęzi i włącza dostępne wymagane checks; od tego momentu merge wymaga ich zielonego wyniku dla head SHA.

## Warunki przed merge

1. `git fetch origin`; PR otwarty, nie draft, base `main`, opis zawiera `Refs #N` i nie zawiera `Closes/Fixes/Resolves #N`.
2. Aktualny head SHA PR = SHA z raportu `CR: PASS` = SHA z raportu `QA: PASS`. Inny SHA → ponowny CR/QA.
3. Issue w statusie Test, brak `needs:cr`, `blocked`, `needs:decision`, brak otwartych uwag blokujących i otwartych `blocked by`.
4. Zgodność z `main`: jeśli `origin/main` zmienił się od sprawdzonego base SHA, w worktree integracji orkiestratora (`../Auterva-worktrees/claude-orchestrator-N`, detached) wykonaj `git merge --no-ff --no-commit <head>` na aktualnym `origin/main` i:
   - konflikt → Re-open do wykonawcy (wykonawca integruje `main` u siebie; nowy SHA wymaga CR/QA);
   - brak konfliktu → bramki integracji poniżej na kandydacie; zmiana dotykająca tych samych modułów co nowe commity `main` wymaga ponownej oceny CR zakresu wspólnego.
5. Bramki integracji (tryb bootstrap) na kandydacie scalenia, adekwatnie do zmiany, z własnym `LOCAL_PORT_BASE`: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:integration` (PostgreSQL), `pnpm build`, E2E zmienionych przepływów; dla migracji — pusta i zasiedlona baza. Każda niewykonana obowiązkowa bramka blokuje merge.
6. Zdalne checks (po #10): `gh pr checks <PR>` — wszystkie wymagane zielone dla head SHA.

## Merge

```bash
gh pr merge <PR> --merge --match-head-commit <head-sha>
```

- Metoda: merge commit (spójna z historią repozytorium). Bez `--admin`, `--auto` przed spełnieniem warunków, squash/rebase przepisującego SHA odebranego przez QA, bez force push i push do `main`.
- Branch nie jest usuwany automatycznie; usuń go dopiero po Done, jeśli nie ma otwartych zależności.

## Po merge

1. `git fetch origin`; zapisz SHA merge na `origin/main`.
2. Kontrole integracji na `main` (świeży detached worktree na SHA merge): co najmniej typecheck, testy zmienionych modułów i integracja na PostgreSQL; pełny zestaw dla auth/hostów/DB/cache. Zdalne checks na `main`, gdy istnieją.
3. Wynik negatywny: nie ustawiaj Done; utwórz bug lub revert przez nowy PR (nigdy reset/force push) i poinformuj właściciela.
4. Wynik pozytywny: komentarz integracji w issue (linki do CR i QA, SHA merge, kontrole z wynikami, czego nie wykonano), `set-status <N> Done`, `gh issue close <N> --reason completed`.
5. Usuń własne worktree issue (czyste), zwolnij blokady, odblokuj zależne issue po sprawdzeniu ich `blocked by` (usuń nieaktualną etykietę `blocked`), zaktualizuj checkpoint.

## Wymaga jawnej zgody właściciela produktu

Wdrożenie (staging, produkcja), wydatki, zmiana ochrony gałęzi lub widoczności repozytorium, destrukcyjne lub nieaddytywne migracje danych, revert już wdrożonej zmiany, scalenie mimo niewykonanej obowiązkowej bramki.
