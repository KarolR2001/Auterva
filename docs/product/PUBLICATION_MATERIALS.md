# Materiały i treści do publikacji — issue #6

Stan inwentaryzacji: 23.10.2026. Ten rejestr oddziela zatwierdzone **reguły produktu** od nieotrzymanych **materiałów konkretnej marki i firmy**. Decyzja D-03 w [wymaganiach](../WYMAGANIA_AUTERVA.md) jest zatwierdzona; nie potwierdza prawdziwości danych, praw do zdjęć ani akceptacji tekstów prawnych. Do czasu uzupełnienia pozycji oznaczonych `BRAK` publikacja treści produkcyjnych jest **zablokowana**. Materiały demonstracyjne służą wyłącznie makietom, preview oznaczonemu DEMO i testom.

## Zatwierdzony zakres redakcyjny

| Obszar | Obowiązująca reguła | Treść lub decyzja do dostarczenia |
|---|---|---|
| Auterva, `MKT-01` | Onepage opisuje system, korzyści i kontakt. Pierwszy kontakt jest telefoniczny; brak publicznej ceny i obietnicy trialu. Nie sugerować rezerwacji ani płatności online. | Finalny tekst marketingowy, dane operatora, numer telefonu, WhatsApp, e-mail, właściwa polityka prywatności Autervy i ewentualne inne teksty prawne. |
| Firma, `PUB-01`–`PUB-04` | Osobna marka i oferta jednej firmy. Superadmin przygotowuje publiczne logo, dane, treści, wiele obrazów hero i zdjęcia. Kanały kontaktu: telefon, WhatsApp, e-mail; pełny adres i mapa. | Nazwa i opis firmy, zatwierdzone media, trzy kanały kontaktu, preferowany kanał, pełny adres oraz miejsce/odnośnik mapy. |
| Flota, `PUB-02`–`PUB-03` | Kategorie definiuje superadmin. Cena pojazdu jest opcjonalna; superadmin ustawia widoczność cen osobno dla firmy. Dostępność jest informacyjna, a szczegóły potwierdza firma. | Nazwy kategorii, prawdziwe dane pojazdów i ich zdjęcia, reguły prezentowania cen i stan przełącznika firmy. Brak ceny lub ukryta cena wymaga tekstu kontaktowego, bez obietnicy ceny. |
| Prawo, `PUB-05`–`PUB-06` | Treści prawne Autervy i wypożyczalni są osobne. Polityka prywatności dotyczy konkretnej działalności. Zasady najmu/regulamin firmy są warunkowe. | Osobno zatwierdzona polityka Autervy i firmy; dla firmy decyzja „tekst / odnośnik / brak regulaminu” oraz odpowiedni dokument lub URL, jeśli ma być pokazywany. |
| Prezentacja przed prerejestracją | Firma akceptuje wygląd poza aplikacją. | Potwierdzenie, jaką wersję materiałów pokazano i zaakceptowano; bez tworzenia checkboxa, portalu ani fikcyjnego potwierdzenia w aplikacji. |

Źródła reguł: [PRD 3.1 §7.1–7.2 i §12.1–12.4](PRD.md), [wymagania C-F019–023, C-F106–112, C-F138–142, DS-N23 i D-03](../WYMAGANIA_AUTERVA.md), [SPEC](../design/SPEC.md). Przykładowe kategorie lub nazwy w makiecie nie stanowią decyzji o słowniku produkcyjnym.

## Matryca treść → miejsce użycia

`WYMAGA` oznacza wejście potrzebne do danego publicznego obszaru. `WARUNKOWO` oznacza, że element pokazuje się tylko po skonfigurowaniu, a nie że wolno wstawić tekst zastępczy. Wszystkie produkcyjne pozycje w tabeli mają obecnie status `BRAK`.

| Materiał / pole | MKT-01 Auterva | PUB-01 strona firmy | PUB-02/03 flota | PUB-04 kontakt | PUB-05/06 prawo | Źródło i zatwierdzenie przed użyciem |
|---|---|---|---|---|---|---|
| Nazwa, opis, korzyści i CTA Autervy | WYMAGA | — | — | — | — | Właściciel Autervy zatwierdza finalny tekst; tylko sprawdzalne możliwości z PRD. |
| Telefon, WhatsApp, e-mail Autervy | WYMAGA | — | — | — | — | Właściciel podaje prawdziwe kanały i preferowany kontakt; sprawdzić działanie odnośników. |
| Logo Autervy | WYMAGA | — | — | — | — | Potwierdzić autorstwo, prawo do użycia i finalny wariant. |
| Polityka prywatności Autervy | WYMAGA w stopce/odnośniku | — | — | — | — | Finalna, zatwierdzona treść właściwa operatorowi Autervy; wskazać datę i dane kontaktowe. |
| Nazwa, opis, hero: tekst i wiele obrazów firmy | — | WYMAGA | — | możliwy obraz | — | Konkretna firma: finalne brzmienie, pliki, autorstwo/licencja, zgoda na publiczne użycie; superadmin wprowadza. |
| Logo firmy | — | WYMAGA | WYMAGA w kontekście oferty | WYMAGA | — | Konkretna firma: plik i prawo do publicznego użycia; superadmin wprowadza. |
| Kategorie i dane pojazdów | — | WARUNKOWO: wyróżnione | WARUNKOWO: opublikowane pojazdy | — | — | Superadmin zatwierdza słownik kategorii; rzeczywiste dane/zdjęcia każdej firmy. Pusta aktywna oferta pokazuje zapowiedź, nie fikcyjne auta. |
| Cena i przełącznik jej widoczności | — | WARUNKOWO | WARUNKOWO | — | — | Cena może być pusta; superadmin określa dla danej firmy widoczność. Bez ceny lub przy ukryciu: neutralna zachęta do kontaktu, bez wymyślonej kwoty. |
| Telefon, WhatsApp, e-mail firmy | — | CTA kontaktowe | CTA kontaktowe | WYMAGA | — | Konkretna firma podaje prawdziwe kanały, preferowany kontakt i godziny, jeśli mają być publikowane. |
| Pełny adres i mapa firmy | — | WARUNKOWO w sekcji kontaktowej | — | WYMAGA | — | Konkretna firma potwierdza adres i poprawny punkt/odnośnik mapy. Nie wskazywać fikcyjnej lokalizacji. |
| Polityka prywatności firmy | — | odnośnik | odnośnik, jeśli obecny | odnośnik | WYMAGA: PUB-05 | Treść prawna zatwierdzona dla tej wypożyczalni, z datą i właściwym administratorem danych. |
| Regulamin / zasady najmu firmy | — | WARUNKOWO: odnośnik | WARUNKOWO: odnośnik | WARUNKOWO: odnośnik | WARUNKOWO: PUB-06 | Decyzja firmy o wariancie; zatwierdzona treść lub URL. Jeśli brak, nie renderować pozornego dokumentu. |

Zgodnie z D-01 superadmin zapisuje publiczne dane, SEO i treści prawne firmy; administrator firmy ma do nich odczyt. Ten rejestr opisuje źródła materiałów, a nie zmienia uprawnień lub walidacji z #1.

## Rejestr istniejących zasobów

| Zasób | Pochodzenie potwierdzone w repo | Dozwolone teraz | Warunek przed publicznym użyciem produkcyjnym |
|---|---|---|---|
| `design/assets/brand/auterva-symbol.svg`, `auterva-wordmark.svg`, `auterva-wordmark-compact.svg` | Istniejące pliki SVG; [README zasobów](../../design/assets/README.md) nie dokumentuje autorstwa ani odrębnej licencji. | Projekt i lokalny podgląd. | Właściciel potwierdza autorstwo, prawo do użycia i finalny wariant. |
| 37 ujęć syntetycznych, 152 warianty AVIF/WebP w [`manifest.json`](../../design/assets/manifest.json): 2 hero, 3 redakcyjne/publiczne, 32 ujęcia 8 demonstracyjnych pojazdów. | `provenance.kind=synthetic-demo`; manifest przechowuje prompty, metadane plików i SHA-256. `rights` opisuje demonstracyjne pochodzenie, nie jest licencją konkretnej firmy. | Makiety, oznaczone DEMO preview i fixture testowe. | Nie używać jako prawdziwej oferty, floty ani zdjęć konkretnej firmy. Zastąpić materiałami firmy z udokumentowanym prawem. |
| Źródłowe PNG wskazane jako `archivedOriginal` w manifeście | Manifest podaje ścieżki archiwalne, ale plików nie ma w repo. | Zachowane zoptymalizowane warianty służą porównaniu makiet. | Nie deklarować posiadania ani prawa do dystrybucji niedostępnych oryginałów. |
| Logo, hero i fotografie konkretnej firmy | BRAK w repo. | — | Pliki źródłowe, właściciel praw, zakres licencji/zgody, data i przypisanie do firmy. |
| Teksty prawne i dane kontaktowe produkcyjne | BRAK w repo. | — | Dostarczenie właściwego, zatwierdzonego dokumentu/danych dla Autervy i osobno każdej firmy. |

Źródło/licencję nowych plików zapisuje się przy materiale: `firma lub Auterva`, `nazwa pliku i wersja/hash`, `autor/właściciel praw`, `podstawa użycia`, `zakres publiczny`, `data potwierdzenia`, `kto zatwierdził`. Nie umieszczać numerów prywatnych osób, danych innej firmy ani pełnych dokumentów prawnych w fixture DEMO.

## Robocze warianty copy — do zatwierdzenia, bez publikacji

Poniższe krótkie teksty są propozycjami redakcyjnymi opartymi na PRD, nie zatwierdzonymi materiałami marki:

| Stan | Roboczy tekst | Warunek użycia |
|---|---|---|
| MKT hero | „Twoja oferta pojazdów i dostępność w jednym miejscu.” / „Porozmawiajmy o uruchomieniu strony Twojej wypożyczalni.” | Zatwierdzenie właściciela i działający kanał kontaktu Autervy. |
| PUB-01, aktywna firma bez pojazdów | „Nasza oferta pojawi się wkrótce. Przygotowujemy dla Ciebie ofertę pojazdów. Zajrzyj ponownie wkrótce.” | Tekst roboczy z PRD §12.3; identyfikacja firmy i jej kontakt muszą być prawdziwe. |
| PUB-03, brak/ukryta cena | „Zapytaj o cenę i szczegóły wynajmu.” | Działający kontakt firmy; bez wymyślonej kwoty i automatycznej rezerwacji. |
| PUB-03, termin informacyjnie dostępny | „Zapytaj firmę o potwierdzenie terminu.” | Wynik dostępności z bieżących danych, bez obietnicy rezerwacji. |
| PUB-04, mapa niedostępna z powodu błędu | „Mapa jest chwilowo niedostępna. Skontaktuj się z firmą, aby potwierdzić adres.” | Tylko jeśli opublikowano prawdziwy adres i działający kanał kontaktu. |

## Checkpoint i blokada publikacji

Stan `BRAK`: finalna lista kategorii, dane oferty i zasady cen dla firm, decyzje o widoczności cen, prawdziwe kanały/adresy/mapy, zatwierdzone copy Autervy i firm, produkcyjne logo/hero/zdjęcia z prawami, obie polityki prywatności oraz wariant regulaminu firmy. Nie ma dowodu przedstawienia i akceptacji materiałów konkretnej firmy poza aplikacją. D-03 określa **strukturę** tych danych i nie wymaga ponownej decyzji o ogólnych zasadach.

Warunek odblokowania danego obszaru: dostarczono przypisany materiał i źródło, potwierdzono prawo/zgodę oraz finalny tekst; treść prawna ma rzeczywiste zatwierdzenie dla właściwej działalności. Dla firmy potwierdzono także zewnętrzną akceptację wyglądu przed prerejestracją. Nie trzeba tworzyć fikcyjnej firmy do zamknięcia dokumentacji, ale bez jej materiałów nie wolno ogłaszać gotowości jej strony do publikacji.

Referencja projektu: plik Penpot `b564c72c-f31f-81ec-8008-af198a313438`, strona publiczna `269b07ba-69e5-8066-8008-c84a9b898bc0`; boardy `MKT-01` mobile `1e066793-8858-8051-8008-cf36d8d5909f`, desktop `269b07ba-69e5-8066-8008-c84b6a04500c`; `PUB-01` mobile `1e066793-8858-8051-8008-cf38b2bec442`, desktop `1e066793-8858-8051-8008-cf38f350ea9b`; `PUB-04` mobile `1e066793-8858-8051-8008-cf38b2beb248`, desktop `1e066793-8858-8051-8008-cf38f3509bc5`; `PUB-05` mobile `1e066793-8858-8051-8008-cf38d9b4dc7e`, desktop `1e066793-8858-8051-8008-cf3916c13ab3`. Wszystkie to `state=default`, referencyjne viewporty 390 i 1440 px. ID pochodzą z [issue #6](https://github.com/KarolR2001/Auterva/issues/6) i lokalnego [traceability](../../design/traceability.json). Live MCP potwierdziło plik i stronę; odczyt boardów zakończył się timeoutem, więc aktualnej treści ani zgodności wizualnej **nie potwierdzono**.

Odbiór dokumentacji: sprawdzić osobno źródła Autervy i wybranej firmy, stan ceny widocznej/ukrytej/brak ceny, mapy oraz regulaminu, a także to, że fixture DEMO nie trafia do treści produkcyjnej. Testy runtime, klawiatury, API i renderu nie dotyczą tego PR i nie są tu zaliczone.
