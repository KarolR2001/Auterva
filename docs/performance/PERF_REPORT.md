# Raport wydajności zapytań i obciążenia — #59

Pomiar lokalny (nie staging) profilu P1 i proponowanego profilu P2. Dotyczy NFR-PERF-002 (dostępność p95 ≤ 500 ms, zapis blokady bez uploadu p95 ≤ 800 ms, lista ≤ 100 aut p95 ≤ 600 ms), §21.2, C-N060 i C-N062.

## Wynik w skrócie

- Wszystkie trzy cele p95 są spełnione z ponad dziesięciokrotnym zapasem przy P1 i przy P2 (ruch przez handlery z realnymi limitami: dostępność ok. 20 ms, zapis blokady ok. 23 ms, lista 100 aut ok. 31-34 ms). Błędów 0 we wszystkich scenariuszach, 0 zagubionych dostarczeń WS.
- Zmieniono tylko to, co profil wskazał: indeks `(vehicleId, from DESC)` i zapytanie sprawdzenia dostępności (przepustowość serwisu 1,7-6,3x wyższa, p95 batch 5,9 -> 1,2 ms) oraz rzut dni kalendarza (p95 prywatnego kalendarza 365 dni pod 16 równoległymi wywołaniami 280 -> 13 ms). Listy (admin, katalog) nie były wąskim gardłem i ich zapytania nie zostały zmienione.
- Bez cache wyniku dostępności (C-N060). Każdy odczyt czyta bazę; test regresji sprawdza brak starego pozytywnego wyniku po zapisie i usunięciu blokady.
- Pozostają `not-run`: staging, profil wielu firm, WS na wielu instancjach z reconnectem, zapis z uploadem (patrz „Nie wykonano”).

## Warunki pomiaru

| Element | Wartość |
|---|---|
| Sprzęt | jedna maszyna: Apple M4, 10 rdzeni, 24 GB RAM, macOS; aplikacja, harness, PostgreSQL i generator obciążenia na tym samym komputerze |
| Wersje | Node 24.20.0, PostgreSQL 18.6 (lokalny klaster fixture), Prisma 7.10.1 z adapterem pg 7.10.1 (pg 8.23.1), pula połączeń domyślna (10 na klienta Prismy) |
| Data pomiaru | 2026-10-28 (data „dzisiaj” w Europe/Warsaw jest punktem odniesienia generatora) |
| Dane | seed 59; firma `perf-1`: 100 aut (90% PUBLISHED), 2 zdjęcia na auto, 100 000 blokad (po 1000 na auto, 1-3 dni, 1-4 dni przerwy; około 6 lat historii i 6 lat przyszłości, bez nakładania), aktywność 8 lat wstecz i naprzód; P2 dodaje `perf-2` o tych samych rozmiarach |
| Profil P1 | zatwierdzony (§21.2): jedna firma, 100 aut, 100 000 okresów, równolegli klienci, jeden admin i superadmin |
| Profil P2 | **proponowany w #90, niezatwierdzony**: dwie firmy po 100 aut i 100 000 okresów, szczyt 25 żądań/s, 20 połączeń WS. Podano jako dane pomocnicze, nie jako cel |
| Harness | w procesie: prawdziwe handlery modułów (`publicCheck`, `publicBatch`, `readCatalog`, `listVehicles`, `privateCalendar`, `addBlock`), prawdziwa sesja MFA, limitery i pula pg, serwer realtime i kolejka jobów. Bez transportu HTTP i routingu Next |
| Limity produktu | nie wyłączane: zapis 60/min i odczyt 120/min na aktora, publiczne 60/min (dostępność) i 120/min (oferta) na adres. Publiczne żądania używają osobnego adresu zaufanego ingressu na żądanie, ruch admina jest utrzymany poniżej limitu |
| Pomiar | pętla otwarta (opóźnienie liczone od zaplanowanego przyjścia, bez ukrywania kolejki), 20 s na scenariusz; nasycenie: CPU i RSS procesu, opóźnienie event loop, połączenia i aktywne/oczekujące zapytania PostgreSQL, CPU backendów PostgreSQL (próbkowanie co 0,5 s) |

Uwaga o interpretacji: wszystko działa na jednej maszynie, więc CPU procesu i bazy konkurują o te same rdzenie, a w czasie pomiaru nie pracowało nic poza harnessem. Liczby są dowodem proporcji i marginesu, nie prognozą dla Render/Cloudflare.

## Odtworzenie jedną komendą

```sh
LOCAL_PORT_BASE=27200 scripts/local-fixture.sh start          # własny port; zobacz docs/development/CI.md
export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"             # wymagane przez konfigurację serwera, nie zapisywać
pnpm perf:report                                              # reset fixture, P1 przed/po, EXPLAIN, P2; ok. 20 min
```

`pnpm perf:report -- --no-reset` pomija reset fixture; `--seconds N` zmienia czas scenariusza. Wyniki: `docs/performance/results/SUMMARY.md`, `*.json`, `explain.txt`. Pojedyncze kroki: `pnpm perf:generate -- --profile p1|p2`, `pnpm perf:run -- --profile p1 --variant after --only public-check,mixed-peak`, `pnpm perf:explain`. Skrypty piszą wyłącznie do bazy `auterva_fixture_9` na klastrze tego worktree (ten sam guard co `seed-local-fixture.ts --reset`), a `--reset` kasuje jej dane. Harness nie wchodzi do `pnpm test:integration`.

Wariant „przed” (`--variant before`) usuwa nowy indeks, używa poprzedniego predykatu (`scripts/perf/legacy-availability.ts`) i poprzedniego rzutu kalendarza; „po” używa bieżącego kodu i indeksu.

## Wyniki: przed i po (P1, serwis, 16 równoległych wywołań, bez limiterów API)

To jest pułap ścieżki zapytań z prawdziwą pulą 10 połączeń, nie p95 widziane przez użytkownika.

| Scenariusz | p95 przed (ms) | p95 po (ms) | zapytań/s przed | zapytań/s po |
|---|---:|---:|---:|---:|
| dostępność 1 auta | 1,1 | 0,6 | 19 966 | 34 943 |
| dostępność 50 aut (batch) | 5,9 | 1,2 | 3 642 | 19 130 |
| dostępność 100 aut (prywatna) | 10,2 | 1,7 | 2 086 | 13 117 |
| kalendarz prywatny 365 dni | 280,3 | 12,7 | 70,6 | 1 623 |
| kalendarz publiczny 31 dni | 4,6 | 4,6 | 4 251 | 4 214 |
| lista admin 100 aut | 39,2 | 32,7 | 515 | 595 |
| lista admin 100 aut, availableToday | 43,9 | 39,7 | 428 | 489 |
| katalog publiczny 50 aut z datami | 29,1 | 31,4 | 689 | 659 |

Trzy ostatnie wiersze nie zmieniły kodu ani zapytania; różnice mieszczą się w szumie pomiaru (maszyna współdzielona z innymi procesami).

Saturacja pod 16 wywołaniami po zmianach: CPU procesu Node około 95-105% (jeden wątek jest granicą), CPU backendów PostgreSQL 340-635% przy 13-35 tys. zapytań/s, 8-9 aktywnych połączeń z puli 10, 0 oczekiwań na blokady. Przed zmianą baza filtrowała około 765 blokad na auto; po zmianie jedno wyszukanie po indeksie na auto.

### EXPLAIN (ANALYZE, BUFFERS), 100 aut, `docs/performance/results/explain.txt`

| Zapytanie | Czas | Bufory |
|---|---:|---:|
| poprzedni predykat (NOT EXISTS z filtrem `from <= to AND to >= from`) | ok. 2,2 ms | ok. 1230 |
| nowe wyszukanie ostatniej blokady, **bez** nowego indeksu | ok. 6,1 ms | ok. 1730 |
| nowe wyszukanie ostatniej blokady, **z** indeksem | 0,18 ms | ok. 400 |

Poprzedni predykat nie korzysta z nowego indeksu (plan ten sam). Nowe zapytanie bez indeksu jest gorsze od poprzedniego, więc migracja jest częścią zmiany (zapisane w `docs/contracts/availability-reads.md`).

## Wyniki: ruch przez handlery z realnymi limitami (po zmianach)

p95 w ms, 0 błędów w każdym wierszu. Cel NFR w nawiasie.

| Scenariusz | P1 p50 | P1 p95 | P2 p95 (proponowany) |
|---|---:|---:|---:|
| dostępność, pojedyncza (publiczna) (≤ 500) | 10,0 | 20,0 | 18,0 |
| dostępność, batch 50 slugów (publiczna) (≤ 500) | 10,7 | 20,6 | 15,1 |
| kalendarz publiczny 31 dni | 9,5 | 20,1 | 18,6 |
| katalog publiczny, strona 1 (50 aut) | 14,2 | 23,7 | 24,1 |
| katalog publiczny z datami (50 aut) | 25,1 | 34,0 | 33,6 |
| lista 100 aut publiczna: strona 1 / strona 2 / razem (≤ 600) | 13,4 / 8,3 / 22,3 | 23,1 / 15,6 / 31,3 | 23,5 / 10,9 / 33,1 |
| lista admin, jedna strona 100 aut (≤ 600) | 26,7 | 34,6 | 33,5 |
| lista 100 aut admin: strona 1 / strona 2 / razem (po 50) (≤ 600) | 18,9 / 11,9 / 31,2 | 22,5 / 13,6 / 33,8 | 24,0 / 14,1 / 36,1 |
| admin availableToday, 100 aut | 35,1 | 39,4 | 40,6 |
| kalendarz admina 365 dni | 12,9 | 20,5 | 19,0 |
| zapis blokady przez handler (0,4/s na admina, limit 60/min) (≤ 800) | 14,7 | 22,7 | 22,4 |
| usunięcie blokady przez handler | 8,0 | 14,5 | 14,3 |
| mieszanka 25 req/s (500 żądań, plus zapis 0,4/s na admina) | 5,4 | 19,4 | 17,0 |

Mieszanka: 50% sprawdzenie dostępności, 10% batch, 15% katalog, 10% katalog z datami, 9% kalendarz publiczny, 3% lista admina, 3% kalendarz admina. W P2 pula (do 12 połączeń z trzech pul harnessu i handlerów), CPU procesu około 10%, CPU backendów PostgreSQL około 120%, brak oczekiwań na blokady.

### Zapisy blokad i konflikty (serwis `createBlock`, bez limitu API)

Zgodnie z ustaleniem rozdzielono od ruchu przez handlery: zapis przez handler jest ograniczony limitem 60/min na admina, więc kontencję mierzono na serwisie. Limity produktowe nie zostały zmienione ani wyłączone.

| Scenariusz | Wynik |
|---|---|
| 8 równoległych cykli create+delete na różnych autach | p95 14,7 ms (ok. 640 cykli/s); 0 błędów |
| 8 równoległych cykli create+delete na jednym aucie | p95 14,3 ms; 0 błędów |
| 8 równoległych zapisów tych samych dat jednego auta, rundy | w każdej rundzie dokładnie 1 zapis i 7 odpowiedzi `BlockOverlapError` (409), 0 wyjątków, p95 4,3 ms |

Zapisy blokad jednej firmy są szeregowane blokadą wiersza Organization (taki sam czas przy różnych i tym samym aucie); przy jednym adminie na firmę nie jest to ograniczenie. Wynik dowodzi, że ochrona przed równoległym zapisem nie osłabła.

### WebSocket i worker

| Scenariusz | Wynik |
|---|---|
| Dostarczenie wiadomości czatu (cel C-N066 ≤ 2 s), P1: 10 połączeń, 14 wiadomości | p95 34,1 ms, 126 dostarczeń oczekiwanych, 0 zagubionych |
| to samo, P2: 20 połączeń (2 firmy po 5 admin i 5 superadmin), 28 wiadomości | p95 33,5 ms, 252 oczekiwane dostarczenia, 0 zagubionych |
| Worker, kolejka: claim + start + finish, 4 równoległych, zaległość 20 000 PENDING i 100 000 zakończonych | ok. 630 jobów/s, p95 cyklu 7,7-7,9 ms, 0 błędów; CPU backendów PostgreSQL około 380% |

Liczba wiadomości jest mała, bo limit wysyłki czatu (10/10 s i 30/min na aktora) nie jest wyłączony; próbka dostarczeń jest większa (każda wiadomość trafia do wszystkich pozostałych połączeń firmy). Pomiar workera obejmuje wyłącznie kolejkę (bez wywołania dostawcy poczty).

## Zmiany i dowody niezmienności semantyki

1. **Indeks** `AvailabilityBlock_vehicleId_from_idx` (`vehicleId`, `from DESC`): addytywna migracja `20261028120000_availability_latest_block_issue_59`, zwykły `CREATE INDEX` (krótka blokada zapisu na tabeli; na zasiedlonej bazie rozważyć wcześniejsze `CREATE INDEX CONCURRENTLY` o tej samej nazwie ręcznie, wtedy migracja ma być oznaczona jako zastosowana lub dostosowana przez operatora). Wycofanie: `DROP INDEX`.
2. **Zapytanie** `availableVehicleIds` (`src/modules/availability/read.ts`) dla sprawdzenia publicznego (pojedynczego i batch) oraz prywatnego: blokady pojazdu nie nakładają się (constraint GiST `availability_no_overlap`), więc przecięcie z `[from, to]` wystąpi dokładnie wtedy, gdy blokada o najpóźniejszym `from <= to` kończy się w dniu `>= from`. Daty to `YYYY-MM-DD` rzutowane na `date`, końce włącznie, tenant sprawdzany po `organizationId` pojazdu i bloku. Odczyt zawsze trafia do bazy.
3. **Rzut kalendarza** (`calendarDays`): daty bloków formatowane raz zamiast w pętli po dniach (365 dni x blokady). Wynik identyczny.

Testy (nie wchodzą w ciężki harness): `tests/integration/availability-query-regression.test.ts` na danych z generatora (2 firmy, 12 aut, 1200 blokad na firmę): (a) brak nakładania blokad w danych; (b) ponad 300 zakresów, w tym jeden dzień, granice bloków, dzień przed i po, otwarta i zamknięta aktywność, poza zakresem aktywności, ukryte i szkic, każdy z filtrem PUBLISHED i bez, dla obu firm: zbiór identyczny z poprzednim predykatem; (c) publiczne pojedyncze, batch i prywatne zgodne z poprzednim predykatem, izolacja firm, nieznane i ukryte pominięte; (d) dni kalendarza identyczne z poprzednim rzutem; (e) po `createBlock` następny odczyt publiczny daje `available:false`, po `deleteBlock` `true` (brak starego wyniku); (f) 8 równoległych zapisów tych samych dat: dokładnie jeden sukces, reszta `BlockOverlapError`, a granice włącznie (sąsiedni dzień dozwolony, wspólny dzień odrzucony). Zmiana `>=` na `>` w nowym zapytaniu powoduje porażkę testu (sprawdzone). `tests/unit/perf-generator.test.ts` sprawdza deterministyczność generatora.

## Ograniczenia i ryzyka

- Pomiar lokalny na jednej maszynie, bez sieci, TLS, Next/proxy i transportu HTTP, z jednym procesem Node. Wyniki nie są dowodem dla staging ani produkcji.
- Zależność poprawności zapytania od niezmiennika „blokady pojazdu się nie nakładają” jest wymuszona przez bazę (constraint GiST); test (a) weryfikuje go na danych. Zapis omijający constraint złamałby założenie, ale złamałby też całą ochronę kolizji.
- Zapytania listy (admin availableToday, katalog z datami) nadal używają predykatu `blocks: none` i mają ok. 40 ms p95 pod nasyceniem. Mieszczą się w celu, więc nie zmieniono ich (zmiana wymagałaby surowego SQL w paginacji). Przy znacznie większej liczbie firm zależy to od planu PostgreSQL; do ponownej oceny po zatwierdzeniu profilu w #90.
- Dane P1 powstają z kalendarzem względem dnia generacji; ponowne uruchomienie innego dnia przesuwa okno (wyniki porównywalne, nie bitowo identyczne w czasie).
- WS: mała liczba wiadomości (limity wysyłki); jedna instancja serwera.

## Nie wykonano (`not-run`)

- Pomiar na stagingu / środowisku docelowym i zatwierdzony profil wielu firm: `not-run`, zależy od #90 (profil P2 jest tylko propozycją) i #3/#10.
- Dostarczenie WS przy wielu instancjach procesu i po reconnect z kursorem (C-N066, C-N062): `not-run` w tym pomiarze (pokrywają je testy integracyjne czatu; nie mierzono p95).
- Zapis blokady z uploadem (poza zakresem NFR), nieobecne w pomiarze.
- Zerwanie zależności (np. bazy) w trakcie obciążenia: `not-run`; scenariusz QA do wykonania na build z PR.
- Pomiar Core Web Vitals i wydajności frontu: poza zakresem tego zadania.
