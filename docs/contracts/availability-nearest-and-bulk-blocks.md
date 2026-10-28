# Najbliższy wolny termin i zbiorcze blokady — kontrakt discovery (#70)

Status: **propozycja do decyzji właściciela, nie implementacja**. Zakres opcjonalny (COULD po stabilizacji, `docs/WYMAGANIA_AUTERVA.md` §10), poza obowiązkowym MVP. Po decyzji powstają osobne zadania API i FE (sekcja 5). Źródła: C-F102, C-F103, C-F104, C-N027, FR-ADM-051/053/055/057/058, D-15; kontrakty [odczyty #33/#59/#65](availability-reads.md) i [blokady #38](availability-blocks.md), [audyt](audit-append-and-access.md).

Nie powstaje rezerwacja online, płatność ani zapis offline. Najbliższy termin to wyłącznie informacja; kontakt nadal niczego nie rezerwuje. Każdy wariant przejmuje niezmienniki: `LocalDate`/SQL DATE z końcami włącznie (jeden dzień poprawny), „dzisiaj” w `Europe/Warsaw` (`availabilityToday`), aktor/rola/firma/stan konta sprawdzane w każdej operacji, izolacja firm, brak `internalNote`/`reference`/typu/danych technicznych w odpowiedziach publicznych, brak cache wyniku (po commit następny odczyt widzi nowy stan).

## 1. Najbliższy wolny termin

### Definicja

Wejście: pojazd, długość `N` dni (z odrzuconego zapytania `from`–`to`: `N = days(to − from) + 1`, 1–365), początek szukania `S = max(from, dzisiaj)`, horyzont `H` dni. Wynik: najwcześniejszy zakres `[a, a+N−1]` z `a >= S`, który w całości mieści się w aktywności pojazdu i nie przecina żadnej blokady (ta sama reguła co `availableVehicleIds`), oraz `a+N−1 <= S+H−1`. Brak takiego zakresu to `{found:false}` (nie błąd i nie „dostępny”). Obliczenia na `LocalDate` (arytmetyka na dniach kalendarzowych, bez konwersji do stałych 24 h/UTC), więc DST i rok przestępny nie przesuwają dnia.

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
| **A (rekomendowany)** Obliczenie na żądanie, jeden pojazd | Jedno zapytanie: blokady pojazdu w oknie `[S, S+H−1]` po indeksie `AvailabilityBlock(vehicleId, from DESC)`, luki wyznaczane w pamięci lub `LEAD()`; złożoność O(liczba blokad w oknie), nie O(H·blokady). | Jedno dodatkowe zapytanie; limit istniejącego rozmiaru okna. Bez migracji. | Wynik jest informacją chwilową; commit blokady po odczycie unieważnia go (tak jak `check`). |
| B Wsad do 50 slugów | Jak A dla listy slugów (zasady batcha #33: 1–50 różnych, duplikat = 400, nieznane/ukryte pomijane). | Do 50 zapytań lub jedno zapytanie po `ANY(uuid[])`. | Wzmocnienie kosztu na anonimowym adresie; wymaga osobnego budżetu. |
| C Materializacja/cache | Zapisana tabela „następny wolny dzień”. | Migracja, unieważnianie przy każdej mutacji blokady i aktywności. | Narusza „brak starego pozytywnego wyniku”; odrzucone. |

Rekomendacja: A, w drugim kroku B tylko jeśli FE realnie pokazuje alternatywy z terminami.

### Kontrakt API (wariant A)

- Publiczny `POST /api/public/availability/next` z `{slug,from,to}` → `200 {found:true,from,to}` lub `{found:false}`. Reguły hosta, widoczności i okresu usługi jak `check` (#33): niepubliczny host, firma po końcu okresu/archiwalna, ukryty/obcy/nieistniejący pojazd → `404`; zły format `400`; `from` przed dzisiaj `422`; `no-store`, wspólny limit publiczny 60/min na zaufany adres. Odpowiedź nie zawiera typu, przyczyny, `reference`, notatki ani informacji, że luka wynika z blokady a nie z aktywności.
- Prywatny odpowiednik (admin/superadmin) nie jest potrzebny: panel ma kalendarz #33/#65. Gdyby był, działa pod regułami prywatnymi (limit 120/min na aktora i firmę, historia dozwolona).
- Horyzont jest stałą serwera, nie parametrem klienta (klient nie podnosi kosztu). Zakres wejściowy nadal 1–365 dni; wynik nie wykracza poza `S+H−1`.
- Ujawnienie: daty wynikowe mają ten sam poziom szczegółu co `GET .../calendar` (dzienne stany publicznie widoczne), nie rewelują niczego nowego.

Koszt testowy (przy wdrożeniu): jeden dzień, wspólna granica końca/początku, dziura o długości N−1 i N, otwarty koniec aktywności, początek aktywności po `S`, koniec aktywności przed końcem luki, rok przestępny i DST Warszawa (zamrożony zegar), ukryty pojazd, firma wygasła/archiwalna, A/B, świeżość po mutacji blokady w osobnym kontekście, brak pól prywatnych w JSON.

## 2. Zbiorcze blokowanie i kopiowanie blokad

Zakres obejmuje tylko jedną firmę (C-N027: historia nie jest kopiowana między firmami). Aktor: administrator własnej firmy albo superadmin w jawnym kontekście firmy (ta sama bramka co #38; archiwum odmawia adminowi, superadmin zapisuje z `context: ARCHIVED_COMPANY`).

Dwie operacje, wspólny silnik zapisu:

1. **Zbiorcze utworzenie:** jedna definicja `{from,to,type,reference?,internalNote?}` dla zbioru `vehicleIds` (serwis floty, urlop).
2. **Kopiowanie:** istniejąca blokada (`sourceBlockId`) do `targetVehicleIds`, z opcjonalnym przesunięciem `shiftDays` (całkowite, ujemne dozwolone; arytmetyka `LocalDate`, długość zachowana). Kopiowane są daty, typ i `reference`; `internalNote` wyłącznie przy jawnym `copyNote:true` (domyślnie nie, bo notatka bywa wrażliwa dla konkretnego auta).

Wspólne zasady (dla każdego wariantu): źródło `MANUAL`; każdy cel sprawdzany jak w #38 (należy do firmy, nie `ARCHIVED`, zakres mieści się w aktywności, brak nakładania, limity pól); `vehicleIds` bez duplikatów, nie więcej niż `K` (rekomendacja: 50, jak batch #33); nieznane lub obce `vehicleId` dają `404` bez ujawniania, czy istnieje u innej firmy (całe żądanie, bez częściowego zapisu).

### Kolejność blokad (bezpieczeństwo współbieżności)

Transakcja: aktor → `Organization FOR NO KEY UPDATE` → wiersze `Vehicle FOR UPDATE` wszystkich celów **w rosnącej kolejności `id`** (jedna kolejność globalna wyklucza wzajemne zakleszczenie dwóch zbiorczych zapisów) → odczyt aktywności i blokad dopiero po blokadach → kontrola → zapis → audyt. Ograniczenie GiST `availability_no_overlap` pozostaje ostatnią barierą i mapuje się na ten sam konflikt. Koszt: blokada firmy już szereguje piszących firmę, więc przepustowość jest taka jak dla pojedynczych zapisów; `K` ogranicza czas trzymania blokad.

### Warianty polityki zapisu

| | A. Wszystko albo nic (rekomendowany jako domyślny) | B. Częściowy zapis | C. Podgląd, potem zapis |
|---|---|---|---|
| Zachowanie | Jedna transakcja; przy jakimkolwiek konflikcie rollback, `0` zapisów | Zapisuje wolne auta, pomija kolidujące | `dryRun:true` zwraca raport bez zapisu; właściwy zapis ponownie sprawdza stan |
| Co wie użytkownik | Dokładnie: nic nie zapisano, pełna lista przyczyn | Dokładnie: lista zapisanych i lista odrzuconych | Raport jest chwilowy; zapis nadal może zwrócić inny wynik |
| Koszt | Najprostszy; zgodny z atomowością #38 | Idempotencja i audyt per pozycja; trudniejsze wycofanie | Dodatkowy odczyt; wymaga UI dwuetapowego |
| Ryzyko | Jedno kolidujące auto blokuje całą serię (dla floty 50 aut częste) | Użytkownik przeoczy odrzucone auta; „sukces” mylący; częściowy stan trudny do wycofania | Podgląd bywa uznany za rezerwację terminu (nie jest) |

Rekomendacja: **A jako domyślny tryb z `dryRun` (C)**, tryb **B jako jawne `onConflict:"SKIP"`** dopiero po decyzji właściciela (pytanie P3). Dzięki temu domyślnie nikt nie zostaje z niejasnym stanem.

### Raport konfliktów

Raport zawsze zawiera wszystkie problemy (wszystkie auta są oceniane, nie zatrzymujemy się na pierwszym), tylko dla uwierzytelnionego aktora tej firmy:

```
409 BULK_CONFLICTS {
  saved: [],                         // tryb ALL_OR_NOTHING: zawsze puste
  rejected: [{ vehicleId, code, conflict?: {id,from,to,type,version} }]   // code: BLOCK_OVERLAP | BLOCK_OUTSIDE_ACTIVITY | BLOCK_VEHICLE_ARCHIVED | BLOCK_DATA_INVALID
}
```

Sukces: `201 {saved:[{vehicleId, blockId, version}], rejected:[]}`; w trybie `SKIP` `200` z obiema listami i `saved.length + rejected.length == vehicleIds.length`. Błędy żądania (`400 INVALID_INPUT`, `404`, `403`, `429`) nie zapisują niczego. Raport nie trafia do publicznych odpowiedzi.

### Audyt, retry, limity

- Audyt: jedno `BLOCK_CREATED` na zapisaną blokadę (jak #38, `changedFields` bez typu/reference/notatki), wspólny `requestId` jednego żądania; brak wpisów dla odrzuconych aut w `ALL_OR_NOTHING`.
- Idempotencja: `idempotencyKey: UUID` z trwałym receiptem 24 h (jak preregistracja i reset hasła). Ten sam klucz i wejście zwraca zapisany wynik; inne wejście pod tym kluczem to `409 IDEMPOTENCY_KEY_CONFLICT`. Bez tego ponowienie po timeoucie dałoby `BULK_CONFLICTS` z własnymi blokadami. Wymaga addytywnej migracji tabeli receiptów albo użycia istniejącego mechanizmu (do ustalenia w zadaniu API).
- Limit zapisów: wspólny budżet zapisów 60/min na aktora; jedno żądanie zbiorcze liczy się jako jeden zapis, więc rekomendacja to limit `K=50` aut i maksymalny rozmiar ciała (jak inne JSON).
- Świeżość: po commit następny publiczny odczyt (`check`, `calendar`, `batch`, `next`) czyta bieżące rekordy; brak cache, więc nie ma unieważniania.

### Przykłady (dzisiaj 2027-03-10)

| Scenariusz | A: wszystko albo nic | B: `SKIP` |
|---|---|---|
| 3 auta, blokada 15–17.03 serwis; auto 2 ma już 16–18.03 | `409`, 0 zapisów; `rejected:[{auto2, BLOCK_OVERLAP, conflict:16–18.03}]` | `200`; `saved:[auto1,auto3]`, `rejected:[auto2...]` |
| Auto 3 ma aktywność do 14.03 | `409` `BLOCK_OUTSIDE_ACTIVITY` dla auta 3, 0 zapisów | zapisane auto 1–2, odrzucone auto 3 |
| Auto 2 zarchiwizowane | `409` `BLOCK_VEHICLE_ARCHIVED` | pominięte |
| Kopia blokady 20–22.03 z auta 1 na auta 2–3 z `shiftDays:7` | blokady 27–29.03 lub konflikt | j.w. z dokładną listą |
| Auto z obcej firmy w `vehicleIds` | `404`, 0 zapisów | `404`, 0 zapisów |

## 3. Wpływ na istniejące kontrakty

- #33/#59: reguła dostępności i `availableVehicleIds` pozostają jedynym źródłem; „najbliższy termin” używa tych samych indeksów (`AvailabilityBlock_vehicleId_from_idx`) i nie tworzy drugiego źródła stanu.
- #65: kalendarz zbiorczy floty służy jako ekran podglądu przed zbiorczym zapisem (te same dni i blokady); zbiorcze blokowanie z jego siatki to zadanie FE.
- #38: pojedynczy zapis pozostaje bez zmian; zbiorczy zapis używa tych samych walidacji, kodów błędów i audytu.

## 4. Pytania do właściciela (z rekomendacją)

- **P1. Horyzont najbliższego terminu.** Kontekst: im dalszy horyzont, tym rzadziej `found:false`, ale wartość informacji maleje; koszt zapytania zależy głównie od liczby blokad w oknie, nie od `H`. Opcje 90/180/365 dni. Rekomendacja: 180 dni, stała serwera.
- **P2. Czy publicznie pokazywać „najbliższy wolny termin”, czy tylko w panelu.** Kontekst: dane dzienne są już publiczne, więc to nie nowe ujawnienie, ale nowy anonimowy koszt odczytu. Rekomendacja: publicznie, wariant A, bez wsadu w pierwszym kroku.
- **P3. Polityka zapisu zbiorczego.** Kontekst: patrz tabela. Rekomendacja: domyślnie wszystko albo nic z `dryRun`; `SKIP` tylko na jawne życzenie, pokazany z dokładną listą zapisanych i odrzuconych aut.
- **P4. Maksimum aut w jednym zbiorczym zapisie.** Rekomendacja: 50 (zgodnie z batchem #33; flota ok. 100 aut wymaga dwóch żądań).
- **P5. Kopiowanie notatki wewnętrznej.** Rekomendacja: domyślnie nie kopiować, jawny `copyNote`.
- **P6. Kopiowanie z przesunięciem.** Czy w ogóle potrzebne (np. cykliczne przeglądy) czy wystarczy kopia na te same daty? Rekomendacja: początkowo tylko zbiorcze utworzenie i kopia na te same daty, `shiftDays` w kolejnym kroku.
- **P7. Idempotencja.** Czy wymagać `idempotencyKey` (rekomendacja: tak, kosztem addytywnej migracji receiptów lub użycia istniejącego mechanizmu).

## 5. Planowane zadania po decyzji (propozycje)

| Zadanie | Rola | Zależności | Kryterium QA |
|---|---|---|---|
| API najbliższego wolnego terminu (`POST /api/public/availability/next`) | Backend | decyzje P1, P2; #33, #59 | przykłady z sekcji 1, świeżość po mutacji, brak pól prywatnych, A/B |
| API zbiorczego tworzenia i kopiowania blokad | Backend | decyzje P3–P7; #38 | all-or-nothing, raport konfliktów, równoległe zapisy w obu kolejnościach z aktywnością #28, idempotencja, audyt |
| FE: zbiorcze blokowanie z kalendarza floty i podgląd konfliktów | Frontend | API powyżej, #65, **nowe stany w Penpocie przed UI** | pełny raport zapisanych/odrzuconych, klawiatura, mobile 320–1920 |
| FE: pokazanie najbliższego wolnego terminu na ofercie | Frontend | API najbliższego terminu, stan w Penpocie | tekst + ikona statusu, brak sugestii rezerwacji |

Kryteria akceptacji #70: właściciel zatwierdza lub odrzuca zakres oraz odpowiada na P1–P7; do tego czasu nie ma kodu ani zadań implementacyjnych.
