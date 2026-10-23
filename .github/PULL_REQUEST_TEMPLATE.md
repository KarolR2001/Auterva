## Rezultat

Problem i zmiana zachowania. Powiązane issue i ID wymagań. `Closes #…` tylko dla odebranego zakresu; nadrzędna funkcja i QA mogą pozostać otwarte.

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

- [ ] Kryteria zakresu spełnione lub pozostała praca w otwartym issue.
- [ ] Mapowanie wymaganie → ekran/kod/test i dokumentacja kontraktu aktualne.
- [ ] Kontrole mają rzeczywiste wyniki; zdalny CI i QA nie są deklarowane bez dowodu.
