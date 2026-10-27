# Kontrakt przekazywania pracy

Formaty briefów orkiestratora i raportów subagentów Claude Code. Raporty CR i QA realizują formaty z [WORKFLOW](../development/WORKFLOW.md); ten plik dodaje pola potrzebne do pracy subagentów. Subagent zna tylko swój brief — brief musi być kompletny.

## Kto co zapisuje

| Czynność | Wykonuje |
|---|---|
| Blokada przydziału, status Project, etykiety `needs:cr`/`blocked` | orkiestrator |
| Komentarz przejęcia w issue | orkiestrator |
| Commity, push własnego brancha, PR i jego opis z punktem synchronizacji | wykonawca |
| Raport CR w PR | orkiestrator (na podstawie własnego przeglądu i raportu `auterva-reviewer`) |
| Raport QA w PR | `auterva-qa` |
| Merge, kontrole integracji, Done, zamknięcie issue | orkiestrator |

## Brief dla wykonawcy

```text
Rola: auterva-backend | auterva-frontend
Issue: #N <tytuł> — link; Re-open: tak/nie (link do raportu CR/QA z uwagami)
Worktree: <ścieżka bezwzględna>; branch: claude/<rola>/issue-N; base: origin/main <sha>
Porty i dane: LOCAL_PORT_BASE=<p>; baza <nazwa>; fixture <A/B>
Zakres: rezultat, pliki/moduły w zakresie i poza zakresem
Kontrakty: docs/contracts/<plik>.md; decyzje D-xx; zależności (#…, stan)
Właściciel wspólnych plików: <kto edytuje manifest/lockfile/migracje/kontrakt w tym przebiegu>
Penpot (FE): file/page/board ID, stan, viewport; edytor makiety: ty | nikt
Wymagane bramki: <lista z quality-gates>
Równoległa praca: <issue/rola drugiego wykonawcy i pliki, których nie dotykać>
```

## Raport wykonawcy

```text
Wynik: gotowe do CR | częściowe (checkpoint) | zablokowane
PR: #… (Refs #N); head SHA …; base SHA …
Zmiany: moduły, migracje, kontrakty, traceability
Bramki: komenda — pass/fail/blocked/not-run — liczby/dowód
Penpot (FE): ID, viewporty, różnice | blocked + przyczyna
Ograniczenia, ryzyka, instrukcja i fixture dla QA
Uruchomione usługi: zatrzymane / pozostawione (port, powód)
```

Częściowy wynik zawiera checkpoint w komentarzu issue (co zrobione, co zostało, SHA) i nie trafia do Review.

## Brief dla recenzenta

```text
PR #…, issue #…; head SHA …; base SHA (origin/main) …
Worktree recenzenta: <ścieżka>, detached na head SHA; LOCAL_PORT_BASE=<p>
Kryteria akceptacji: link; kontrakty i decyzje: …
Zakres ryzyka: auth/izolacja/migracje/współbieżność/cache/WS/UI — według zmiany
```

Brief nie zawiera hipotez orkiestratora o błędach; recenzent ma dać niezależną ocenę.

## Raport CR

```text
CR: PASS | CHANGES_REQUESTED | BLOCKED
Problem / wynik: …
Przejrzany zakres i powiązany kod: …
Uwagi blokujące: plik:wiersz — wpływ — oczekiwana poprawka
Sugestie (nieblokujące / do triage): …
Kontrole i dowody: komenda/scenariusz — wynik — link
Ograniczenia / niesprawdzone obszary: …
Przekazanie: Ready to test | Re-open | Review + blocked
Synchronizacja: issue #…; PR #…; head SHA …; sprawdzony base SHA …; recenzent: orkiestrator (opus) + auterva-reviewer (opus); build … (jeśli dotyczy)
```

## Brief dla QA

```text
PR #…, issue #…; head SHA …; raport CR: PASS — link
Worktree QA: <ścieżka>, detached na head SHA; LOCAL_PORT_BASE=<p>; baza …; fixture A/B
Scenariusze obowiązkowe: z issue + regresja: …
Penpot: file/page/board ID i stany (FE); viewporty
```

## Raport QA

```text
QA: PASS | FAIL | BLOCKED
Wynik i wpływ: …
Scenariusze: akcja → oczekiwanie → rzeczywisty wynik — pass/fail/blocked/not-run — dowód
Regresja i bezpieczeństwo/izolacja A/B: …
Penpot / dostępność (FE): ID, viewporty, różnice; VoiceOver: DEFERRED (#97)
Usterki: opis, reprodukcja, oczekiwanie
Ograniczenia: …
Synchronizacja: issue #…; PR #…; testowany SHA …; build …; środowisko …; agent auterva-qa (sonnet)
```

Obowiązkowy scenariusz `blocked` lub `not-run` wyklucza `QA: PASS`.

## Unieważnienie

- Nowy commit w PR unieważnia CR i QA. Zmiana `origin/main` po CR wymaga oceny integracji przed merge ([MERGE_POLICY](MERGE_POLICY.md)).
- Raport dotyczy wyłącznie SHA z jego punktu synchronizacji. Dalsze komentarze linkują ten punkt zamiast powtarzać metadane.

## Porty i dane

Każdy worktree ma własny `LOCAL_PORT_BASE` (używa go `scripts/local-fixture.sh`: base…base+7) oraz port aplikacji i WS:

| Kto | `LOCAL_PORT_BASE` | HTTP / WS |
|---|---|---|
| Wykonawca | `20000 + N×100` | base+10 / base+11 |
| Recenzent / integracja orkiestratora | `20000 + N×100 + 20` | base+10 / base+11 |
| QA | `20000 + N×100 + 40` | base+10 / base+11 |

`N` to numer issue. Przed startem sprawdź `lsof -i :<port>`; zajęty port zgłoś zamiast zatrzymywać cudzy proces. Bazy i schematy nazywaj z rolą i numerem issue. Pliki `.env*` w worktree tworzy użytkownik lub skrypt fixture z wartościami lokalnymi; agenci ich nie odczytują ani nie publikują.
