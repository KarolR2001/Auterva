# Najbliższy wolny termin i zbiorcze blokady — kontrakt discovery (#70)

Status: **zatwierdzony przez właściciela 28.10.2026 (D-32); API zbiorczych blokad zaimplementowane w #215 (sekcja 2.1); wariant A najbliższego terminu (publiczne `POST /api/public/availability/next`) zaimplementowany w #216; pozostałe warianty bez implementacji**; P1–P7 w sekcji 4 są decyzjami. Zakres opcjonalny (COULD po stabilizacji, `docs/WYMAGANIA_AUTERVA.md` §10), poza obowiązkowym MVP. Po decyzji (D-32) powstają osobne zadania API i FE (sekcja 5). Źródła: C-F102, C-F103, C-F104, C-N027, FR-ADM-051/053/055/057/058, D-15; kontrakty [odczyty #33/#59/#65](availability-reads.md) i [blokady #38](availability-blocks.md), [audyt](audit-append-and-access.md).

Nie powstaje rezerwacja online, płatność ani zapis offline. Najbliższy termin to wyłącznie informacja; kontakt nadal niczego nie rezerwuje. Każdy wariant przejmuje niezmienniki: `LocalDate`/SQL DATE z końcami włącznie (jeden dzień poprawny), „dzisiaj” w `Europe/Warsaw` (`availabilityToday`), aktor/rola/firma/stan konta sprawdzane w każdej operacji, izolacja firm, brak `internalNote`/`reference`/typu/danych technicznych w odpowiedziach publicznych, brak cache wyniku (po commit następny odczyt widzi nowy stan).

## 1. Najbliższy wolny termin

### Definicja

Wejście: pojazd, długość `N` dni (z odrzuconego zapytania `from`–`to`: `N = days(to − from) + 1`, 1–365), początek szukania `S = max(from, dzisiaj)`, horyzont `H` dni. Wynik: najwcześniejszy zakres `[a, a+N−1]` z `a >= S`, który w całości mieści się w aktywności pojazdu i nie przecina żadnej blokady (ta sama reguła co `availableVehicleIds`), oraz `a+N−1 <= S+H−1`. Brak takiego zakresu to `{found:false}` (nie błąd i nie „dostępny”). Obliczenia na `LocalDate` z tą samą arytmetyką dni co `src/modules/availability/dates.ts` (dni kalendarzowe, bez konwersji do stałych 24 h/UTC), więc DST i rok przestępny nie przesuwają dnia.

Przykłady (dzisiaj = 2027-03-10, aktywność od 2027-01-01, otwarty koniec):

| Blokady | Zapytanie nieudane | Wynik |
|---|---|---|
| 10–12.03 | 10–11.03 (N=2) | 13–14.03 |
| 10–12.03 i 14–20.03 | 10–11.03 (N=2) | 21–22.03 (dziura 13.03 ma 1 dzień) |
| 10–12.03 | 10.03 (N=1) | 13.03 |
| brak, aktywność do 2027-03-12 | 11–13.03 (N=3) | `found:false` (poza aktywnością) |
| otwarta aktywność, blokady zapełniają cały horyzont | dowolne | `found:false` |
| blokada 28.02–01.03.2028 (rok przestępny) | 28.02 (N=1) | 02.03.2028; 29.02 jest dniem blokady |
| aktywność zaczyna się 2027-04-01 | 10.03 (N=2) | 01–02.04, jeżeli mieści się w horyzoncie |

### Warianty

| Wariant | Opis | Koszt | Ryzyko |
|---|---|---|---|
| **A (wybrany, P2)** Obliczenie na żądanie, jeden pojazd | Jedno zapytanie: blokady pojazdu w oknie `[S, S+H−1]` po indeksie `AvailabilityBlock(vehicleId, from DESC)`, luki wyznaczane w pamięci lub `LEAD()`; złożoność O(liczba blokad w oknie), nie O(H·blokady). | Jedno dodatkowe zapytanie; limit istniejącego rozmiaru okna. Bez migracji. | Wynik jest informacją chwilową; commit blokady po odczycie unieważnia go (tak jak `check`). |
| B Wsad do 50 slugów | Jak A dla listy slugów (zasady batcha #33: 1–50 różnych, duplikat = 400, nieznane/ukryte pomijane). | Do 50 zapytań lub jedno zapytanie po `ANY(uuid[])`. | Wzmocnienie kosztu na anonimowym adresie; wymaga osobnego budżetu. |
| C Materializacja/cache | Zapisana tabela „następny wolny dzień”. | Migracja, unieważnianie przy każdej mutacji blokady i aktywności. | Narusza „brak starego pozytywnego wyniku”; odrzucone. |

Decyzja (P2): A; wariant B dopiero w drugim kroku i tylko jeśli FE realnie pokazuje alternatywy z terminami.

### Kontrakt API (wariant A)

- Publiczny `POST /api/public/availability/next` z `{slug,from,to}` → `200 {found:true,from,to}` lub `{found:false}`. Reguły hosta, widoczności i okresu usługi jak `check` (#33): niepubliczny host, firma po końcu okresu/archiwalna, ukryty/obcy/nieistniejący pojazd → `404`; zły format `400`; `from` przed dzisiaj `422`; `no-store`, wspólny limit publiczny 60/min na zaufany adres. Odpowiedź nie zawiera typu, przyczyny, `reference`, notatki ani informacji, że luka wynika z blokady a nie z aktywności.
- Zgodnie z P2 (publicznie) wersja publiczna jest podstawowa. Prywatny odpowiednik (admin/superadmin) nie jest wymagany: panel ma kalendarz #33/#65. Gdyby powstał, działa pod regułami prywatnymi (limit 120/min na aktora i firmę, historia dozwolona).
- Horyzont jest stałą serwera, nie parametrem klienta (klient nie podnosi kosztu). Zakres wejściowy nadal 1–365 dni; wynik nie wykracza poza `S+H−1`.
- Ujawnienie: daty wynikowe mają ten sam poziom szczegółu co `GET .../calendar` (dzienne stany publicznie widoczne), nie ujawniają niczego nowego.

Koszt testowy (przy wdrożeniu): jeden dzień, wspólna granica końca/początku, dziura o długości N−1 i N, otwarty koniec aktywności, początek aktywności po `S`, koniec aktywności przed końcem luki, rok przestępny i DST Warszawa (zamrożony zegar), ukryty pojazd, firma wygasła/archiwalna, A/B, świeżość po mutacji blokady w osobnym kontekście, brak pól prywatnych w JSON.

## 2. Zbiorcze blokowanie i kopiowanie blokad

Zakres obejmuje tylko jedną firmę (C-N027: historia nie jest kopiowana między firmami). Aktor: administrator własnej firmy albo superadmin w jawnym kontekście firmy (ta sama bramka co #38; archiwum odmawia adminowi, superadmin zapisuje z `context: ARCHIVED_COMPANY`).

Dwie operacje, wspólny silnik zapisu:

1. **Zbiorcze utworzenie:** jedna definicja `{from,to,type,reference?,internalNote?}` dla zbioru `vehicleIds` (serwis floty, urlop).
2. **Kopiowanie:** istniejąca blokada (`sourceBlockId`) do `targetVehicleIds`, z opcjonalnym przesunięciem `shiftDays` (całkowite, ujemne dozwolone; arytmetyka `LocalDate`, długość zachowana). Kopiowane są daty, typ i `reference`; `internalNote` wyłącznie przy jawnym `copyNote:true` (domyślnie nie, bo notatka bywa wrażliwa dla konkretnego auta; P5). Rekomendacja (nie decyzja): opcjonalny `copyReference:false`, gdy numer odniesienia nie ma trafić do kopii.

Wspólne zasady (dla każdego wariantu): źródło `MANUAL`; każdy cel sprawdzany jak w #38 (należy do firmy, nie `ARCHIVED`, zakres mieści się w aktywności, brak nakładania, limity pól); `vehicleIds` bez duplikatów, nie więcej niż `K` (P4: 50, jak batch #33); nieznane lub obce `vehicleId` dają `404` bez ujawniania, czy istnieje u innej firmy (całe żądanie, bez częściowego zapisu).

### Kolejność blokad (bezpieczeństwo współbieżności)

Transakcja: aktor → `Organization FOR NO KEY UPDATE` → wiersze `Vehicle FOR UPDATE` wszystkich celów **w rosnącej kolejności `id`** (jedna kolejność globalna wyklucza wzajemne zakleszczenie dwóch zbiorczych zapisów) → odczyt aktywności i blokad dopiero po blokadach → kontrola → zapis → audyt. Ograniczenie GiST `availability_no_overlap` pozostaje ostatnią barierą i mapuje się na ten sam konflikt. Koszt: blokada firmy już szereguje piszących firmę, więc przepustowość jest taka jak dla pojedynczych zapisów; `K` ogranicza czas trzymania blokad.

### Warianty polityki zapisu

| | A. Wszystko albo nic (domyślny, P3) | B. Częściowy zapis | C. Podgląd, potem zapis |
|---|---|---|---|
| Zachowanie | Jedna transakcja; przy jakimkolwiek konflikcie rollback, `0` zapisów | Zapisuje wolne auta, pomija kolidujące | `dryRun:true` zwraca raport bez zapisu; właściwy zapis ponownie sprawdza stan |
| Co wie użytkownik | Dokładnie: nic nie zapisano, pełna lista przyczyn | Dokładnie: lista zapisanych i lista odrzuconych | Raport jest chwilowy; zapis nadal może zwrócić inny wynik |
| Koszt | Najprostszy; zgodny z atomowością #38 | Idempotencja i audyt per pozycja; trudniejsze wycofanie | Dodatkowy odczyt; wymaga UI dwuetapowego |
| Ryzyko | Jedno kolidujące auto blokuje całą serię (dla floty 50 aut częste) | Użytkownik przeoczy odrzucone auta; „sukces” mylący; częściowy stan trudny do wycofania | Podgląd bywa uznany za rezerwację terminu (nie jest) |

Decyzja (P3): **A jako domyślny tryb z `dryRun` (C)**, tryb **B tylko jako jawne `onConflict:"SKIP"`**. Dzięki temu domyślnie nikt nie zostaje z niejasnym stanem.

### Raport konfliktów

Raport zawsze zawiera wszystkie problemy (wszystkie auta są oceniane, nie zatrzymujemy się na pierwszym), tylko dla uwierzytelnionego aktora tej firmy:

```
409 BULK_CONFLICTS {
  saved: [],                         // tryb ABORT (wszystko albo nic): zawsze puste
  rejected: [{ vehicleId, code, conflict?: {id,from,to,type,version} }]   // code: BLOCK_OVERLAP | BLOCK_OUTSIDE_ACTIVITY | BLOCK_VEHICLE_ARCHIVED | BLOCK_DATA_INVALID
}
```

Sukces: `201 {saved:[{vehicleId, blockId, version}], rejected:[]}`; w trybie `SKIP` `200` z obiema listami i `saved.length + rejected.length == vehicleIds.length`. Błędy żądania (`400 INVALID_INPUT`, `404`, `403`, `429`) nie zapisują niczego. Raport nie trafia do publicznych odpowiedzi.

### Audyt, retry, limity

- Audyt: jedno `BLOCK_CREATED` na zapisaną blokadę (jak #38, `changedFields` bez typu/reference/notatki), wspólny `requestId` jednego żądania; brak wpisów dla odrzuconych aut w trybie `ABORT`.
- Idempotencja (decyzja P7): wymagany `idempotencyKey: UUID` z trwałym receiptem ważnym **24 h**. Ten sam klucz i wejście w tym czasie zwraca zapisany wynik; inne wejście pod tym kluczem to `409 IDEMPOTENCY_KEY_CONFLICT`; po 24 h klucz można użyć ponownie. Bez tego ponowienie po timeoucie dałoby `BULK_CONFLICTS` z własnymi blokadami. Wybrany mechanizm (#215, sekcja 2.1): `OperationReceipt` z kolumną `expiresAt`.
- Limit zapisów: wspólny budżet zapisów 60/min na aktora; limit `K=50` aut (P4) i maksymalny rozmiar ciała jak inne JSON. Rekomendacja (nie decyzja): żądanie zbiorcze waży tyle jednostek budżetu, ile ma aut, żeby jedno żądanie 50 aut nie kosztowało tyle co jeden zapis; waga do ustalenia w zadaniu API.
- Świeżość: po commit następny publiczny odczyt (`check`, `calendar`, `batch`, `next`) czyta bieżące rekordy; brak cache, więc nie ma unieważniania.

### 2.1 Kontrakt API zbiorczych blokad (#215, doprecyzowanie uwag QA #70)

Ścieżki (obie operacje, `POST`, prefiks `/api/admin` albo `/api/platform/companies/{organizationId}`; reguły hosta, MFA, `Origin`, roli, firmy, stanu konta, archiwum D-23 i budżet zapisów jak w [#38](availability-blocks.md)): `{prefiks}/blocks/bulk` (zbiorcze utworzenie) i `{prefiks}/blocks/copy` (kopia). Ciało `application/json` jest ścisłe (nieznane pole, np. `shiftDays`, to `400 INVALID_INPUT`); odpowiedzi `no-store` z `X-Request-Id`.

| Pole | `blocks/bulk` | `blocks/copy` |
|---|---|---|
| `idempotencyKey` (UUID, w ciele) | wymagany przy zapisie, pomijalny przy `dryRun:true` | j.w. |
| cele | `vehicleIds`: 1–50 różnych UUID | `targetVehicleIds`: 1–50 różnych UUID |
| definicja | `fields: {from,to,type,reference?,internalNote?}` (jak #38) | `sourceBlockId` (blokada tej samej firmy); kopiowane daty, typ i `reference`; `internalNote` tylko przy `copyNote:true` (domyślnie `false`) |
| `onConflict` | `"ABORT"` (domyślnie: wszystko albo nic) albo `"SKIP"` (jawny częściowy zapis) | j.w. |
| `dryRun` | `false` domyślnie | j.w. |

`copyReference` z rekomendacji nie jest wdrożone (nie jest decyzją: `reference` jest zawsze kopiowane, P5). Źródło `MANUAL`; zbiorcze utworzenie i kopia dotyczą tych samych dat (P6, bez `shiftDays`).

Odpowiedzi:

- `201 {saved:[{vehicleId,blockId,version}], rejected:[]}`: wszystkie zapisane (kolejność jak w żądaniu).
- `200 {saved, rejected}`: tylko `onConflict:"SKIP"`, gdy choć jeden pojazd został odrzucony (także gdy `saved` jest puste); `saved.length + rejected.length = liczba pojazdów`.
- `409 {code:"BULK_CONFLICTS", saved:[], rejected:[{vehicleId, code, conflict?}]}`: tylko `ABORT`; nic nie zapisano, audytu ani receiptu nie ma; raport zawiera **wszystkie** odrzucone pojazdy w kolejności żądania. `code`: `BLOCK_VEHICLE_ARCHIVED`, `BLOCK_DATA_INVALID` (stary wiersz źródła przekracza limity pól; w odrzuceniach listy; `422 BLOCK_DATA_INVALID` tylko gdy CHECK zadziała dopiero przy zapisie), `BLOCK_OUTSIDE_ACTIVITY`, `BLOCK_OVERLAP` (z `conflict:{id,from,to,type,version}` najwcześniejszej kolidującej blokady); jeden pojazd ma jeden kod, w tej kolejności ważności.
- `dryRun:true`: zawsze `200 {dryRun:true, onConflict, wouldSave:[{vehicleId}], saved:[], rejected:[...]}` bez zapisu, audytu i receiptu; `wouldSave` pokazuje, co zapisałby prawdziwy zapis w tym samym `onConflict` (przy `ABORT` z jakimkolwiek odrzuceniem jest puste). To chwilowy raport, nie rezerwacja; właściwy zapis ponownie sprawdza stan pod blokadami. Podgląd zużywa budżet zapisów jak zapis.
- Błędy żądania bez zapisu: `400 INVALID_INPUT` (także NUL i znaki sterujące, `fieldErrors` z kluczem ścieżki, np. `fields.reference`), `404 NOT_FOUND` (nieznany lub obcy pojazd albo źródło, bez ujawniania, czy istnieje u innej firmy; całe żądanie), `403 FORBIDDEN`, `429 RATE_LIMITED`, `409 IDEMPOTENCY_KEY_CONFLICT`. Rzadki `409 BLOCK_OVERLAP` bez `conflict` oznacza zadziałanie bariery GiST przy zapisie spoza protokołu blokad (całe żądanie wycofane).

Idempotencja (P7): receipt w `OperationReceipt` (`operation` `BULK_CREATE`/`BULK_COPY`; zakres: firma + aktor + obszar + operacja + klucz, więc ten sam klucz użyty dla `bulk` i dla `copy` nie jest konfliktem) z nową, nullable kolumną `expiresAt` = zapis + 24 h; wiersze bez `expiresAt` (rejestracja firmy) są nietknięte. Receipt powstaje w tej samej transakcji co zapis i tylko gdy zapisano co najmniej jedną blokadę (`409` i zerowy `SKIP` go nie zostawiają, więc ponowienie po usunięciu przyczyny liczy się od nowa). Ten sam klucz i wejście (skrót wejścia: pojazdy, definicja/źródło, `copyNote`, `onConflict`) w 24 h zwraca zapisany status i ciało bez ponownego zapisu i audytu; inne wejście to `409 IDEMPOTENCY_KEY_CONFLICT`; wygasły receipt jest usuwany przy następnym żądaniu tej firmy, klucz można użyć ponownie. Równoległe ponowienia szereguje blokada firmy (receipt czytany po niej): jedno wykonanie, identyczne odpowiedzi.

Normalizacja identyfikatorów (#376): `vehicleIds`, `targetVehicleIds`, `sourceBlockId` i `idempotencyKey` są przy parsowaniu zamieniane na małe litery, więc UUID wielkimi literami daje ten sam wynik co małymi (raport zwraca identyfikatory małymi), ten sam pojazd w dwóch pisowniach to `400 INVALID_INPUT` (duplikat), a skrót wejścia idempotencji liczy się z wartości znormalizowanych.

Współbieżność i audyt: dokładnie kolejność z sekcji „Kolejność blokad” (jedno zapytanie `SELECT ... WHERE id = ANY(...) ORDER BY id FOR UPDATE`), odczyt aktywności i kolidujących blokad dopiero po blokadach, audyt `BLOCK_CREATED` per zapisana blokada w tej samej transakcji ze wspólnym `requestId`; superadmin zapisuje jako własny aktor (w archiwum z `context: "ARCHIVED_COMPANY"`). Waga budżetu zapisów (rekomendacja) nie jest wdrożona: żądanie zużywa jedną jednostkę, a limit pojazdów (50) ogranicza czas blokad. Migracja `20261108100000_operation_receipt_expiry_issue_215` jest addytywna (kolumna `expiresAt` i indeks `(organizationId, expiresAt)`); odtworzenie: `DROP INDEX`, `DROP COLUMN`.

### Przykłady (dzisiaj 2027-03-10)

| Scenariusz | A: wszystko albo nic | B: `SKIP` |
|---|---|---|
| 3 auta, blokada 15–17.03 serwis; auto 2 ma już 16–18.03 | `409`, 0 zapisów; `rejected:[{auto2, BLOCK_OVERLAP, conflict:16–18.03}]` | `200`; `saved:[auto1,auto3]`, `rejected:[auto2...]` |
| Auto 3 ma aktywność do 14.03 | `409` `BLOCK_OUTSIDE_ACTIVITY` dla auta 3, 0 zapisów | zapisane auto 1–2, odrzucone auto 3 |
| Auto 2 zarchiwizowane | `409` `BLOCK_VEHICLE_ARCHIVED` | pominięte |
| Kopia blokady 20–22.03 z auta 1 na auta 2–3 z `shiftDays:7` (P6, kolejny krok, jeszcze niewdrożone) | blokady 27–29.03 lub konflikt | j.w. z dokładną listą |
| Auto z obcej firmy w `vehicleIds` | `404`, 0 zapisów | `404`, 0 zapisów |

## 3. Wpływ na istniejące kontrakty

- #33/#59: reguła dostępności i `availableVehicleIds` pozostają jedynym źródłem; „najbliższy termin” używa tych samych indeksów (`AvailabilityBlock_vehicleId_from_idx`) i nie tworzy drugiego źródła stanu.
- #65: kalendarz zbiorczy floty służy jako ekran podglądu przed zbiorczym zapisem (te same dni i blokady); zbiorcze blokowanie z jego siatki to zadanie FE.
- #38: pojedynczy zapis pozostaje bez zmian; zbiorczy zapis używa tych samych walidacji, kodów błędów i audytu.

## 4. Decyzje właściciela (P1–P7, zatwierdzone 28.10.2026, D-32)

- **P1.** Horyzont najbliższego terminu: 180 dni, stała serwera.
- **P2.** Najbliższy termin jest dostępny publicznie, wariant A (na żądanie, jeden pojazd), bez wsadu w pierwszym kroku.
- **P3.** Zapis zbiorczy domyślnie wszystko albo nic z `dryRun`; `onConflict:"SKIP"` tylko jawnie, z dokładną listą zapisanych i odrzuconych aut.
- **P4.** Najwyżej 50 aut w jednym żądaniu (flota ok. 100 aut wymaga dwóch żądań).
- **P5.** `internalNote` nie jest kopiowana domyślnie; tylko z jawnym `copyNote`. `reference` jest kopiowane (jak w zatwierdzonej wersji); `copyReference` to wyłącznie rekomendacja, nie decyzja.
- **P6.** Początkowo zbiorcze utworzenie i kopia na te same daty; `shiftDays` w kolejnym kroku.
- **P7.** `idempotencyKey` (UUID) z receiptem ważnym 24 h; mechanizm wybiera zadanie API (patrz sekcja 2).

## 5. Planowane zadania po decyzji (propozycje)

| Zadanie | Rola | Zależności | Kryterium QA |
|---|---|---|---|
| API najbliższego wolnego terminu (`POST /api/public/availability/next`) | Backend | decyzje P1, P2 (zatwierdzone); #33, #59 | przykłady z sekcji 1, świeżość po mutacji, brak pól prywatnych, A/B |
| API zbiorczego tworzenia i kopiowania blokad | Backend | decyzje P3–P7 (zatwierdzone); #38 | all-or-nothing, raport konfliktów, równoległe zapisy w obu kolejnościach z aktywnością #28, idempotencja, audyt |
| FE: zbiorcze blokowanie z kalendarza floty i podgląd konfliktów | Frontend | API powyżej, #65, **nowe stany w Penpocie przed UI** | pełny raport zapisanych/odrzuconych, klawiatura, mobile 320–1920 |
| FE: pokazanie najbliższego wolnego terminu na ofercie | Frontend | API najbliższego terminu, stan w Penpocie | tekst + ikona statusu, brak sugestii rezerwacji |

Kryteria akceptacji #70: właściciel zatwierdził zakres i P1–P7 (D-32). Zadania API i FE tworzy orkiestrator według powyższej tabeli; do ich realizacji nie ma kodu.
