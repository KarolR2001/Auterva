## Rezultat

Problem i zmiana zachowania. Powiązane issue i ID wymagań. `Closes #…` tylko gdy tester odebrał zakres przed merge; w pozostałych przypadkach `Refs #…`, a issue pozostaje otwarte do odbioru.

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

Agent QA odbiera to samo issue: Ready to test → Test → Done albo Re-open. Role pozostaje Frontend/Backend; właściciela sesji wskazuje komentarz przejęcia, bez osobnych kont GitHub. Raport QA podaje rolę/sesję i commit; wspólne konto nie zatwierdza własnego PR przyciskiem Approve.

- [ ] Kryteria zakresu spełnione lub pozostała praca w otwartym issue.
- [ ] Mapowanie wymaganie → ekran/kod/test i dokumentacja kontraktu aktualne.
- [ ] Kontrole mają rzeczywiste wyniki; zdalny CI i QA nie są deklarowane bez dowodu.
