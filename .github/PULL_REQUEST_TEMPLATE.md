## Rezultat

Problem i wynik zmiany. Powiąż issue przez `Refs #…` i podaj istotne ID wymagań.

## Zakres i kontrakty

- Zmienione moduły, hosty i role; wpływ na FE/BE/QA.
- Zmiany API/DTO, migracji, cache lub konfiguracji, jeśli dotyczą PR.
- UI: aktualny file/page/board ID Penpota, stan, viewport i fixture; różnice względem wzorca.

## Weryfikacja

| Komenda lub scenariusz | Wynik | Dowód |
|---|---|---|
| … | pass / fail / blocked / not-run | … |

Podaj rzeczywiste kontrole, ograniczenia i testy niewykonane z powodem. Kontrola repozytorium nie zastępuje testów aplikacji; UI wymaga osobnego sprawdzenia klawiatury/fokusu, a Backend izolacji i uprawnień odpowiednich do zmiany.

## Ryzyka i przekazanie

Usterki, zależności, fixture i instrukcja QA; dla migracji także rollout/odtworzenie. Bez sekretów, danych produkcyjnych i bezwzględnych lokalnych ścieżek.

Synchronizacja (raz dla tej wersji): head SHA …; sprawdzony base SHA …; build/środowisko … (jeśli dotyczy). Kolejne komentarze linkują ten punkt. Po nowym commicie dodaj nowy komentarz z danymi nowej wersji, zachowaj poprzedni dowód i ponów CR/QA.

Wykonawca ustawia issue w Review oraz `needs:cr` na issue i PR. Orkiestrator zapisuje niezależny CR, następnie QA odbiera to samo issue według [workflow](https://github.com/KarolR2001/Auterva/blob/main/docs/development/WORKFLOW.md). Raporty CR/QA na wspólnym koncie nie są formalnym Approve własnego PR. Merge, kontrola integracji, Done i zamknięcie issue należą do orkiestratora.

- [ ] Kryteria zakresu spełnione lub pozostała praca jawnie opisana.
- [ ] Mapowanie wymaganie → ekran/kod/test i dokumentacja kontraktu aktualne, jeśli dotyczy.
- [ ] Kontrole mają rzeczywiste wyniki; CI i QA nie są deklarowane bez dowodu.
