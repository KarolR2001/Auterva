# Quality gates Autervy

## Bramki aplikacji — po scaffoldzie

Brak aplikacji produkcyjnej, manifestu i lockfile nie jest zaliczonym testem. Podczas scaffoldingu utwórz i zweryfikuj `lint`, `typecheck`, `test:unit`, `test:integration`, `test:e2e`, `build`; równoważne nazwy dokumentuj. Testy CI kończą się kodem błędu i nie działają w watch.

| Zmiana | Minimalny dowód |
|---|---|
| Stos / scaffold | Instalacja z lockfile, lint/typecheck/build, PostgreSQL/auth/MFA i produkcyjny build PWA; ADR-0002 |
| Hosty / auth / izolacja | Publiczny/firma A/firma B/superadmin; podmiana hosta/ID, MFA, CSRF/Origin, cofnięta sesja, brak admin API na publicznych hostach |
| Zaproszenia | Jednorazowe 7 dni, resend, GET skanera, retry bez drugiego konta/trialu; osobny błąd poczty i zapisu |
| Okres / archiwizacja | Trial 336 h, opłacony dzień Warszawa/DST, wszystkie publiczne ścieżki/API/media, działający panel po wygaśnięciu; odrębne odblokowanie po przywróceniu |
| Daty / współbieżność | Granice, jeden dzień, aktywność; dwa rzeczywiście równoległe zapisy/edycje i zmiana aktywności |
| Prisma / migracje | Generate/validate, pusta i zasiedlona baza PostgreSQL, FK/constraints, tenant context i RLS jeśli używane |
| Media / publikacja | Szkic vs publikacja, typ/limity, częściowy błąd uploadu, cover, A/B, storage/cache bez obejścia widoczności |
| Aktualność publiczna | Zapis blokady → oddzielny publiczny kontekst widzi wynik; błąd nie pokazuje starego sukcesu |
| Czat | WebSocket auth, trwały zapis, retry, typing/read/unread, reconnect, szkic właściwej rozmowy; bez emaili czatu |
| Zadania / poczta | Restart, retry/deduplikacja, wersja okresu, osobne wyniki zapisu i dostarczenia; brak sekretów w logach |
| UI / Penpot | Realny board ID, identyczne dane/stan/viewport, render aplikacji i wzorzec, różnice; osobno zachowanie, klawiatura, fokus, semantyka, kontrast, zoom i reduced motion. Rzeczywisty VoiceOver według #97 po implementacji |
| PWA | Produkcyjny build, host firmy, start_url/scope `/admin/`, offline bez zapisu/cache prywatnego, logout, update z dirty form; realne urządzenia |
| Operacje / wydajność | Uzgodniony profil wielu firm, health/alerty; restore bazy/mediów bez nadpisania innej firmy |

## Odbiór i CI

- Każdy PR: CR głównego orkiestratora obejmuje diff i powiązany kod, zgodność z PRD/architekturą oraz adekwatność testów. Raport wskazuje head/base SHA, zakres, uwagi i dowody. CR: PASS poprzedza niezależny odbiór QA; nowy commit wymaga ponownego CR/QA.
- Done: aktualne CR: PASS i QA: PASS, spełnione kryteria, merge oraz wymagane kontrole integracji. Zamyka orkiestrator; dla decyzji bez PR sprawdza zatwierdzony rezultat, bez fikcyjnego builda.
- Po każdym Stage oraz przed #62/#64: orkiestrator wykonuje SYSTEM REVIEW całego aktualnego kodu i konfiguracji. Raport z commitem, zakresem, lukami i poprawkami trafia do issue zamykającego etap lub wydanie. Nierozwiązany bloker wstrzymuje zależne prace/wydanie.
- PR aplikacji: lint, typecheck, unit, build, integracja zmienionych modułów i smoke E2E. Auth/hosty/DB/cache zawsze obejmują izolację i prywatność.
- Przed wydaniem: TEST-MVP-01–55 i UC-01–10 w zakresie wydania; Chromium/Firefox/WebKit, reprezentatywne szerokości 320–1920, PWA i odtworzenie kopii.
- Cele wydajności: `WYMAGANIA_AUTERVA.md`; wynik lab nie dowodzi p75 realnych wizyt. Brak uzgodnionego obciążenia wielu firm raportuj jawnie. Pomiar zapytań i obciążenia (#59) uruchamia osobne `pnpm perf:*`, poza `pnpm test:integration`; opis i wyniki: [PERF_REPORT.md](performance/PERF_REPORT.md).
- QA czyta Penpot bez zmian wzorca/golden screenshotów. Brak live MCP oznacza niewykonane bieżące porównanie; historyczny eksport jest referencją z datą, nie potwierdzeniem aktualności.
- VoiceOver jest odroczony do #97 (P3) na koniec implementacji. Raport bieżącego PR oznacza tę niewykonaną próbę `DEFERRED` z linkiem do #97, nigdy `PASS`; nie blokuje ona sama CR/QA/merge. Nowe problemy czytnika otrzymują osobne P3 issue do końcowego odbioru. Pozostałe kontrole dostępności z tabeli pozostają obowiązkowe teraz.
- Raport: wymaganie/kryterium → commit/build → komenda/scenariusz → wynik → artefakt. UI dodaje file/page/board ID, viewport, fixture i różnice. Stosuj `pass`, `fail`, `blocked`, `not-run` zgodnie z faktem.
- Brak narzędzia, połączenia, testu lub komendy nie jest sukcesem. Makieta i recenzja subagenta nie zastępują runtime.
- Role, statusy i zasady zamknięcia: [WORKFLOW.md](development/WORKFLOW.md).
