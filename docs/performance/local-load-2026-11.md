# Lokalny test obciążenia przez HTTP i profilowanie zapytań (#402, część lokalna #59, D-54)

Uzupełnia [PERF_REPORT.md](PERF_REPORT.md) (pomiar na handlerach, P1/P2, 28.10.2026). Tu: ruch przez prawdziwy HTTP, nowe scenariusze i zapytania najcięższe po stronie bazy. Pomiar na stagingu i zatwierdzony profil (#90) pozostają `not-run`.

## Wynik w skrócie

- Wszystkie cele NFR-PERF-002 spełnione z dużym zapasem przy P2 (2 firmy × 100 aut × 100 000 okresów, czyli 200 000 okresów łącznie; harmonogram 25 req/s): sprawdzenie dostępności p95 ok. 18-24 ms (cel 500), zapis blokady p95 28-117 ms (cel 800), lista 100 aut p95 53-68 ms (cel 600). 0 błędów we wszystkich scenariuszach, każdy limit produktu włączony.
- Zmiana po profilu: lista floty (znacznik „zablokowany dziś") i siatka floty czytały blokady filtrem relacji Prisma, który skanuje wszystkie ok. 100 000 blokad firmy (ok. 1500 buforów, 8-12 ms). Teraz korzystają z istniejącego GiST `availability_no_overlap` (vehicleId, daterange): 1,0-1,2 ms i ok. 450 buforów (8-10x mniej czasu na zapytanie). Bez nowej migracji i bez nowego indeksu, więc brak rollbacku schematu; rollback = cofnięcie zmiany zapytań. W pomiarze HTTP różnica jest poniżej szumu (p95 listy i siatki 50-75 ms przed i po), bo dominuje reszta ścieżki; zmiana usuwa zależność od liczby blokad firmy.
- Bez publicznego cache wyniku dostępności; każdy odczyt trafia do bazy.

## Warunki pomiaru

| Element | Wartość |
|---|---|
| Sprzęt | Apple M4, 10 rdzeni, macOS; Next, generator obciążenia i PostgreSQL na jednej maszynie współdzielonej z innymi agentami |
| Wersje | Node 24.20.0, PostgreSQL 18.6 (klaster fixture, konfiguracja domyślna: `shared_buffers` 128 MB, `max_connections` 100), Next 16.4.3 (build produkcyjny), Prisma 7.10.1 + adapter pg, pula domyślna |
| Load średni maszyny | przebieg „przed": 7,2 przy starcie, 8,6 na końcu; przebieg „po": 7,9 przy starcie, 11,3 na końcu. Maszyna była współdzielona, więc wyniki zawierają szum; p99 jest niestabilne przy 200 próbkach |
| Dane | `pnpm perf:generate -- --profile p2` (seed 59, idempotentny, tylko lokalny fixture): firmy `perf-1` i `perf-2`, po 100 aut (90% PUBLISHED), 2 zdjęcia/auto, 100 000 okresów/firmę (1-3 dni, ok. ±6 lat), razem 199 956 wierszy blokad w chwili pomiaru (generator tworzy 200 000; harness HTTP przed startem zwalnia zakres przeznaczony na zapisy testowe, od +2390 dni, czyli 44 okresy z końca przyszłości), 67 MB z indeksami. To więcej niż 100 000 łącznie, więc przypadek zapasowy |
| Transport | `pnpm perf:ingress` (`scripts/perf/load-ingress.ts`) uruchamia ten sam produkcyjny Next co `start-local-ingress.ts`, z jedną różnicą: adres odwiedzającego limitera pochodzi z nagłówka `x-perf-client` (tylko pętla zwrotna, tylko fixture). Limity produktu włączone: 60/min/adres publicznie, 120 odczytów i 60 zapisów/min/aktor |
| Generator | `pnpm perf:http` (`scripts/perf/http-load.ts`): pętla otwarta (opóźnienie od planowanego przyjścia), keep-alive, nagłówek Host firmy, sesja MFA admina, 20 s/scenariusz, 10 req/s na publiczny scenariusz, 3 req/s na admina (2 adminów, pod limitem 120/min), mieszanka 25 req/s |
| Nasycenie | procesu serwera Next (CPU z `ps`, RSS), połączeń i aktywnych zapytań PostgreSQL, CPU backendów |

Odtworzenie: `LOCAL_PORT_BASE=<base> scripts/local-fixture.sh start`, `prisma migrate deploy`, `pnpm perf:generate -- --profile p2`, `pnpm build`, `PORT=<base+14> pnpm perf:ingress`, `pnpm perf:http -- --port <base+14> --pid <pid>`. Po pomiarze: `pnpm exec tsx scripts/seed-local-fixture.ts --reset`. Nie wchodzi do `ci-local` ani `pnpm test:integration`.

## Wyniki HTTP (P2, p95 w ms, błędy 0; przed = zapytania sprzed #402, po = z #402)

| Scenariusz (cel NFR) | n | p50 po | p95 przed | p95 po | p99 po | CPU serwera po |
|---|---:|---:|---:|---:|---:|---:|
| dostępność check (≤ 500) | 200 | 7,7 | 17,0 | 18,1 | 32,6 | 8,5% |
| dostępność next | 200 | 9,7 | 23,8 | 19,1 | 35,8 | 8,6% |
| dostępność batch 50 aut | 200 | 7,8 | 63,9 | 20,8 | 37,7 | 7,9% |
| kalendarz publiczny 31 dni | 200 | 9,4 | 120,7 | 15,9 | 28,3 | 8,6% |
| katalog API, 50 aut | 200 | 12,1 | 43,0 | 21,2 | 49,4 | 9,7% |
| katalog API z datami | 200 | 23,2 | 179,8 | 36,0 | 46,7 | 12,7% |
| strona katalogu `/pojazdy` (HTML) | 200 | 18,5 | 100,9 | 43,9 | 88,6 | 18,6% |
| strona pojazdu (HTML) | 200 | 28,4 | 69,7 | 63,5 | 94,5 | 26,7% |
| lista floty, 100 aut (≤ 600) | 60 | 21,9 | 68,2 | 52,5 | 102,2 | 5,9% |
| lista floty z filtrami (status, szukaj, aktywność, kategoria, availableToday) | 60 | 21,4 | 71,2 | 74,7 | 110,6 | 5,3% |
| siatka floty 31 dni, 100 aut | 60 | 28,3 | 49,6 | 54,3 | 94,5 | 7,7% |
| kalendarz pojazdu 365 dni | 60 | 14,0 | 30,3 | 29,6 | 44,3 | 3,3% |
| zapis blokady, pojedyncza (≤ 800; 0,8/s) | 16 | 23,4 | 28,3 | 116,9 | 116,9 | 4,3% |
| zapis zbiorczy 10 aut (0,5/s) | 10 | 82,4 | 130,8 | 220,7 | 220,7 | 3,7% |
| zapis zbiorczy 50 aut (0,5/s) | 10 | 126,6 | 232,3 | 484,4 | 484,4 | 7,2% |
| mieszanka 25 req/s (500 żądań + zapis 0,8/s) | 500 | 17,4 | 51,3 | 75,4 | 133,5 | 35,5% |

Uwagi do odczytu: (1) próbki zapisów (n = 10-16) są za małe na wiarygodne p95, to jest maksimum; limit zapisu 60/min/admina trzyma tę częstość pod kontrolą. (2) Różnice „przed/po" w wierszach, których zapytania nie zmieniono, pokazują rozrzut pomiaru (przebieg „przed" miał zimniejszy start: pierwsze wywołania tras po uruchomieniu serwera). (3) Przebieg „po" w środku trwania miał skok obciążenia maszyny, stąd wyższe p95 zapisów. Wniosek: zapas ponad 6x nad każdym celem, błędów 0, nasycenie bazy niskie (patrz niżej).

### Nasycenie (próbnik `pg_stat_activity` co 500 ms w trakcie scenariusza; wartości maksymalne)

| Scenariusz | Połączenia PG (limit 100) przed / po | Zapytania aktywne naraz przed / po | Oczekujące na blokadę | CPU backendów PG przed / po | CPU serwera Next po | RSS serwera Next po |
|---|---:|---:|---:|---:|---:|---:|
| odczyty publiczne (8 scenariuszy, 10 req/s) | 3-13 / 3-7 | 1-2 / 1-2 | 0 | 2-39% / 2-15% | 8-27% | 203-390 MB |
| odczyty admina (4 scenariusze, 3 req/s) | 2-11 / 2-6 | 0-1 / 1 | 0 | 1-11% / 2-10% | 3-8% | 170-295 MB |
| zapisy blokad (pojedyncze, zbiorcze 10 i 50) | 2 / 2 | 0-1 / 1 | 0 | 1-6% / 3-16% | 4-7% | 162-236 MB |
| mieszanka 25 req/s + zapis 0,8/s | 13 / 9 | 1 / 1 | 0 | 33% / 26% | 35,5% | 284 MB |

CPU to procent jednego rdzenia. Baza nie zbliża się do nasycenia: najwyżej 13 ze 100 połączeń, 1-2 zapytania aktywne jednocześnie, żadnego oczekiwania na blokadę (`wait_event_type = 'Lock'`), CPU backendów poniżej 40% jednego rdzenia. Wąskim gardłem przy wzroście ruchu będzie proces Next (render HTML: 19-27% rdzenia przy 10 req/s), nie PostgreSQL. Surowe wyniki (`http-p2-run1.json` = przed, `http-p2-after.json` = po) zostają w `.local/perf/` poza repozytorium; tabele powyżej są ich pełnym streszczeniem p95, błędów i nasycenia.

## WebSocket i worker (`pnpm perf:run -- --profile p2 --only ws-chat,worker-queue`, 10 s)

Przebieg krótki i przy load maszyny 23-33 (poza progiem pomiarowym; maszyna miała skok), więc latencje są zawyżone i traktowane jako górne ograniczenie; poprawność jest wynikiem miarodajnym. WS (20 połączeń: 2 firmy po 5 adminów i 5 superadminów, serwer realtime w procesie): 16 wiadomości, 144/144 dostarczeń, 0 brakujących, 0 do obcej firmy, 0 duplikatów, 0 błędów gniazd; p95 dostarczenia 314,7 ms (cel C-N066 ≤ 2 s). Worker (claim + start + finish, 4 równoległe, zaległość 20 000 PENDING i 100 000 zakończonych): 1528 jobów, p95 49,1 ms, 0 błędów. Poprzedni pomiar na spokojniejszej maszynie (PERF_REPORT.md): WS p95 40 ms, worker p95 7,7 ms.

## Profilowanie zapytań (log PostgreSQL z `log_min_duration_statement = 0`, 8 s przebiegu P2, `scripts/perf/pg-log-top.ts`)

Największy łączny czas bazy miały: lista pojazdów katalogu (512 wywołań, śr. 1,1 ms), licznik katalogu z datami (`NOT EXISTS` na blokadach, 87 wywołań, śr. 6,2 ms), zapytania blokad listy floty „dziś" i siatki floty (po 30-35 wywołań, śr. 5,7-10 ms, max 27 ms, siatka 16 ms), reszta poniżej 1,5 ms. Zapytania HostMapping/ServiceAccess ok. 0,03-0,05 ms (3475 i 1273 wywołań), nie są wąskim gardłem.

### EXPLAIN (ANALYZE, BUFFERS), `pnpm perf:explain`, dane P2

| Zapytanie | Przed (relacja Prisma) | Po (GiST) |
|---|---:|---:|
| blokady „dziś" dla 100 aut (lista floty) | 10,5 ms, ok. 1530 buforów, odrzuca 99 940 z 99 986 wierszy blokad | 1,2 ms, ok. 450 buforów |
| blokady 31 dni dla 50 aut (siatka floty) | 11,1 ms, ok. 1545 buforów | 1,0 ms, ok. 450 buforów |
| dostępność 100 aut, wyszukanie ostatniej blokady (#59) | bez indeksu `(vehicleId, from DESC)`: 14,9 ms | z indeksem: 0,8 ms |

Plan „przed": Bitmap Heap Scan po `AvailabilityBlock_organizationId_vehicleId_idx` dla całej firmy plus filtr po datach. Plan „po": Bitmap Index Scan po `availability_no_overlap` z 50-100 wyszukaniami (jedno na auto). Koszt rośnie z liczbą aut na stronie, nie z liczbą blokad firmy.

### Decyzje

- Indeksy: bez nowych. Istniejący GiST wystarcza; kolejny indeks btree na `(organizationId, from, to)` nie skraca skanu (warunek `from <= X` obejmuje połowę historii).
- Zapytanie przepisane tylko tam, gdzie plan to uzasadnia (blokady listy i siatki floty). Semantyka dni włącznie niezmieniona: `daterange(from, to, '[]') && daterange(a, b, '[]')` jest równoważne `from <= b AND to >= a`; daty przekazywane jako `YYYY-MM-DD::date`, tenant sprawdzany po `organizationId`. Testy: `tests/integration/availability-fleet-calendar.test.ts`, `fleet-list.test.ts`, `fleet-list-filters.test.ts`, `fleet-list-http.test.ts`, w tym granice dnia dla znacznika „zablokowany dziś” (blokada kończąca się dziś, zaczynająca się dziś, zawierająca dziś, zakończona wczoraj, zaczynająca się jutro) oraz blokady siatki na drugiej stronie i przy zakresie stykającym się z pierwszym lub ostatnim dniem blokady.
- Dodatkowa, jednorazowa kontrola równoważności w SQL na danych profilu P2 (poza zestawem testów; `EXCEPT` w obie strony): 800 okien dat (1, 2, 7, 31 i 365 dni, od ok. 6 lat wstecz do ok. 6 lat naprzód, obie firmy), 1 193 534 porównane wiersze blokad, 0 różnic między starym predykatem `from <= b AND to >= a` a nowym `daterange && daterange`.
- Paginacja i limity: po profilowaniu bez zmian. Po przepisaniu zapytań blokad koszt listy i siatki floty zależy od rozmiaru strony, a nie od liczby blokad firmy (wyjątki: licznik katalogu z datami i filtr `availableToday`, punkt niżej). Obowiązujące granice, mierzone na wartościach maksymalnych: lista floty `pageSize` 1-100 (domyślnie 20; mierzona ze 100), siatka floty `pageSize` do 100 (mierzona ze 100 i 31 dniami; zakres do 365 dni), kalendarz pojazdu do 365 dni (mierzony z 365), katalog publiczny `limit` do 50 (domyślnie 12, kursor; mierzony z 50), dostępność zbiorcza do 50 pojazdów w żądaniu (mierzona z 50), zapis zbiorczy do 50 pojazdów (mierzony z 10 i 50). Limity ruchu (60/min/adres publicznie, 120 odczytów i 60 zapisów/min/aktor) bez zmian: przy 25 req/s rozłożonych na odwiedzających nie było ani jednego 429, a zapas p95 nie uzasadnia ich zmiany przed pomiarem na stagingu (#90).
- Nie zmieniono: licznik katalogu z datami i filtr `availableToday` listy (predykat `blocks: none`, 6 ms średnio pod ruchem, p95 katalogu z datami 36 ms). Do ponownej oceny przy większej liczbie firm (#90).
- Cache wyniku dostępności: nie dodano (C-N060).

## Kontrola poprawności po scaleniu main (16.11.2026, bez pomiaru latencji)

Wszystkie liczby p95 i nasycenia w tabelach powyżej pochodzą z przebiegów z 12.11.2026 (load 7-11). Po scaleniu aktualnego main maszyna miała load 40-90 (wiele równoległych zadań), więc latencji nie mierzono ponownie; wynik byłby zafałszowany. Na odtworzonym profilu P2 (200 000 okresów) powtórzono tylko kontrole poprawności:

- EXPLAIN (`pnpm perf:explain`): te same plany i liczby buforów co 12.11 (lista „dziś": 1532 → 476 buforów, siatka: 1539 → 387; „po" przez `availability_no_overlap`). Liczba buforów nie zależy od obciążenia maszyny; czasy z tego przebiegu pominięto.
- Równoważność predykatów w SQL: 0 różnic (opis w „Decyzje").
- Krótki przebieg wszystkich 16 scenariuszy HTTP (`pnpm perf:http -- --seconds 6`, produkcyjny build scalonego kodu): wszystkie ścieżki odpowiadają poprawnie, 714 z 716 żądań zakończonych sukcesem. Dwa pozostałe to `503` z `/api/public/availability/next`: serwer Next dostawał ułamek jednego rdzenia (12-27% w scenariuszach publicznych), kolejka żądań rosła do kilku sekund i Prisma nie rozpoczęła transakcji w limicie oczekiwania (`P2028`). Odpowiedź jest odmową, nie fałszywym „dostępny". W przebiegu uruchomionym równolegle z typecheckiem i lintem tego samego drzewa (jeszcze mniej CPU) ten sam mechanizm dał 23 błędy na 716 żądań: 4 × `503` z API, 15 × `500` (głównie strony HTML oferty) i 4 wyjątki połączenia po stronie generatora; w logu serwera wyłącznie `P2028`. Błędy dotyczą ścieżek niezmienianych w #402 i nie wystąpiły ani razu w przebiegach pomiarowych (2 × 16 scenariuszy, 0 błędów). To obserwacja zachowania przy zagłodzeniu CPU, nie wynik pomiaru.

## Ograniczenia i `not-run`

- Jedna maszyna, bez sieci i TLS, współdzielona (load 7-11 w pomiarze HTTP, 23-33 w krótkim pomiarze WS/worker). Wynik nie jest dowodem dla Render/Cloudflare.
- Profil P2 jest propozycją z #90 (niezatwierdzony); pomiar na stagingu: `not-run` (zależy od #90/#3/#10).
- WS tylko na jednej instancji i bez reconnectu z kursorem; zerwanie zależności pod obciążeniem: `not-run` (scenariusz QA).
- Zapis blokady z uploadem i Core Web Vitals: poza zakresem.
- Przebieg „przed" dla zapytań listy/siatki jest z poprzedniej wersji kodu uruchomionej na tym samym buildzie bazowym, ale w innym momencie obciążenia maszyny; porównanie jakościowe, rozstrzygające są plany EXPLAIN.
