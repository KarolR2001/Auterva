## Rezultat

Problem i zmiana zachowania. Powiązane issue przez `Refs #…` i ID wymagań. Orkiestrator zamyka issue po CR, QA oraz integracji; nie używaj automatycznego zamknięcia przy merge.

## Zakres i kontrakty

- Moduły/hosty/role; wpływ na FE/BE/QA.
- Migracje, API/DTO, cache lub konfiguracja, jeśli zmienione.
- UI: realny file/page/board ID Penpota, stan, fixture i viewport.

## Weryfikacja

| Komenda lub scenariusz | Commit/build | Wynik | Dowód |
|---|---|---|---|
| ... | ... | pass / fail / blocked / not-run | ... |

UI: porównanie z Penpotem i klawiatura/fokus. Backend: izolacja firm, uprawnienia i reguły zmienianego obszaru. Kontrola repozytorium nie zastępuje testów aplikacji.

## Ryzyka i przekazanie

Niewykonane testy i powód, usterki, zależności, uruchomienie dla QA; dla migracji rollout/odtworzenie. Bez sekretów i danych produkcyjnych.

## Przekazanie do CR — główny orkiestrator

Wykonawca dodaje **needs:cr do PR i issue**, ustawia issue w **Review** i podaje head SHA. Orkiestrator bierze widok **CR — Orchestrator**, czyta diff i powiązany kod; zapisuje CR: PASS/CHANGES_REQUESTED/BLOCKED z sesją, head/base SHA, uwagami i dowodami według [workflow](https://github.com/KarolR2001/Auterva/blob/main/docs/development/WORKFLOW.md). Autor nie wypełnia wyniku za reviewera.

CR: PASS + build/instrukcja → orkiestrator usuwa needs:cr i przekazuje Ready to test. Uwagi blokujące → Re-open do wykonawcy. Nowy commit wymaga ponownego CR/QA.

## Odbiór QA i integracja

QA odbiera to samo issue: Ready to test → Test; FAIL → Re-open. Zapisuje raport z rolą/sesją, commitem, scenariuszami i dowodami. Role pozostaje Frontend/Backend. QA: PASS pozostaje w Test; orkiestrator po sprawdzeniu raportów, merge i kontrolach integracji ustawia Done oraz zamyka issue. Na wspólnym koncie raporty CR/QA są komentarzami, nie formalnym Approve własnego PR.

- [ ] Kryteria zakresu spełnione lub pozostała praca w otwartym issue.
- [ ] Mapowanie wymaganie → ekran/kod/test i dokumentacja kontraktu aktualne.
- [ ] Kontrole mają rzeczywiste wyniki; zdalny CI i QA nie są deklarowane bez dowodu.
