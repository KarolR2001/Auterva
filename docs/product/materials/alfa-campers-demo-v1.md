# Alfa Campers DEMO — materiały PUB, wersja 1.0

**Status:** syntetyczny pakiet pierwszej firmy do implementacji, fixture i oznaczonego podglądu staging na podstawie D-17. „Alfa Campers” z Penpota jest nazwą demonstracyjną, nie wskazaniem rzeczywistego podmiotu lub jego oferty. Przed prerejestracją rzeczywista firma otrzymuje własny pakiet i akceptuje jego wersję poza aplikacją. **Źródło:** PUB-01 M/D `1e066793-8858-8051-8008-cf38b2bec442` / `1e066793-8858-8051-8008-cf38f350ea9b`, PUB-04 `1e066793-8858-8051-8008-cf38b2beb248` / `1e066793-8858-8051-8008-cf38f3509bc5`, PUB-05 `1e066793-8858-8051-8008-cf38d9b4dc7e` / `1e066793-8858-8051-8008-cf3916c13ab3` w [Penpocie](https://design.penpot.app/#/workspace?file-id=b564c72c-f31f-81ec-8008-af198a313438&page-id=269b07ba-69e5-8066-8008-c84a9b898bc0).

## Marka i oferta

- Wordmark: tekst „ALFA CAMPERS · DEMO” w publicznej ofercie. Nie używać logo Autervy jako logo firmy. Kolory, Inter, ikony oraz wygląd panelu pozostają wspólne.
- Hero z PUB-01: **„Podróż zaczyna się od dobrego auta.”** „Poznaj flotę, sprawdź dostępne terminy i skontaktuj się z nami, aby dobrać pojazd do swojej trasy.” CTA: „Zobacz pojazdy”. Wersja stagingu pokazuje oznaczenie DEMO przy nazwie i zdjęciach.
- Sekcja oferty: „Pojazdy gotowe na Twoją trasę”. Zalety z Penpota: przejrzysty podgląd terminów, flota na różne trasy, bezpośrednia pomoc firmy. Tekst nie obiecuje rezerwacji; dostępność wymaga potwierdzenia w rozmowie.
- Wariant pustej, aktywnej oferty wg PRD §12.3: **„Nasza oferta pojawi się wkrótce.”** „Przygotowujemy dla Ciebie ofertę pojazdów. Zajrzyj ponownie wkrótce.” Bez fikcyjnych aut, cen lub martwych filtrów. Wygaśnięcie usługi wyłącza całą stronę i nie używa tego wariantu.
- Kategorie do demonstracji, na podstawie kart PUB-01: `miejski-hatchback` — „Miejski hatchback”, `sedan-biznesowy` — „Sedan biznesowy”, `kombi-rodzinne` — „Kombi rodzinne”. To propozycje słownika superadmina dla fixture, nie globalny enum ani rzeczywista flota. Przed użyciem w API superadmin tworzy definicje; bez tego pojazd nie otrzymuje kategorii przez samą etykietę.

## Cena i kontakt

**Ustawienie fixture:** `showPrices=false`, ceny pojazdów puste. Kwoty z makiety (`149/229/219 zł`) są przykładowe i nie trafiają do publicznego stagingu jako oferta. Warianty tekstu wg D-03:

| Stan | Tekst publiczny |
|---|---|
| Cena znana i widoczna po zatwierdzeniu rzeczywistej firmy | „Od [zatwierdzona kwota] [waluta] / [jednostka]”; opis warunków z zatwierdzonej oferty. Brak kwoty wyklucza ten wariant. |
| Cena ukryta dla firmy | „Zapytaj o cenę i szczegóły wynajmu.” |
| Cena niepodana przy włączonym przełączniku | „Zapytaj o cenę i szczegóły wynajmu.” Nie pokazuj „0 zł”. |

PUB-04 przewiduje telefon, WhatsApp i e-mail, preferowany telefon, pełny adres, mapę i godziny. Copy: **„Porozmawiajmy o właściwym samochodzie.”** „Podaj nazwę pojazdu i termin. Potwierdzimy aktualną dostępność w rozmowie.” Preferowany kanał, godziny „pon.–pt. 8:00–18:00; sob. 9:00–14:00” oraz obszar Warszawa z makiety są **DEMO**, bez potwierdzenia realnej obsługi. Dla preview użyj `kontakt@alfa-campers.example.invalid` jako nieaktywnej wartości fixture i pokaż „Dane demonstracyjne — kontakt nieaktywny”. Nie kopiuj numerów `+48 22 000 00 00` / `+48 000 000 000`, domeny `alfacampers.pl`, adresu „ul. Przykładowa 12” ani linku mapy z makiety jako prawdziwych. Kanały `tel:`, WhatsApp, `mailto:` i mapa stają się aktywne dopiero po wprowadzeniu sprawdzonych danych konkretnej firmy; preview może wyświetlać ich układ bez wysyłki do obcej osoby.

## Meta, media i alt

- `meta title`: „Alfa Campers DEMO — oferta pojazdów i terminy”.
- `meta description`: „Przykładowa oferta wypożyczalni: poznaj pojazdy i sprawdź informacyjne terminy. Materiały demonstracyjne do podglądu Autervy.” Produkcyjna firma dostaje własne title/description bez słowa DEMO.
- Wordmark tekstowy ma alt „Alfa Campers — firma demonstracyjna” tylko gdy renderowany jest jako obraz; powtórzona przy widocznej nazwie dekoracja ma pusty alt.
- `public-hero-camper-lakeside`: „Srebrny kamper demonstracyjny nad jeziorem o poranku.” `public-editorial-camper-interior`: „Demonstracyjne wnętrze kampera z kuchnią i częścią wypoczynkową.” `public-fleet-depot`: „Trzy demonstracyjne pojazdy przed bazą floty.” To istniejące `synthetic-demo` w `design/assets/manifest.json`; warianty i SHA-256 są tam podane. Nie przypisywać ich rzeczywistemu pojazdowi ani licencji przyszłej firmy.
- Hero obsługuje kilka obrazów z kolejnością i kadrowaniem, ale fixture może użyć istniejących `public-hero-camper-lakeside` i `public-fleet-depot`. Na Mobile utrzymaj logo/tekst i CTA przed szeroką ilustracją; Desktop używa spokojnego hero z przestrzenią na tekst. Nowe zdjęcia są potrzebne tylko dla rzeczywistej firmy, nie dla tego fixture.

## Polityka prywatności firmy — szkic do podmiany

**Status:** wersja 1.0 DEMO. PUB-05 pokazuje strukturę, lecz nazwa, adres, e-mail i okresy są fikcyjne. Ten tekst **nie jest zatwierdzoną polityką konkretnego przedsiębiorcy**. Zakres pól wynika z [art. 13 RODO](https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX%3A32016R0679); jasny język wymaga [UODO](https://uodo.gov.pl/pl/492/2439).

1. **Administrator danych:** `[pełna nazwa, forma prawna, adres i publiczny kontakt właściwej firmy]`; IOD, jeśli wyznaczony. Auterva nie może zostać wpisana w to miejsce tylko dlatego, że dostarcza panel.
2. **Zakres i cele:** dane z telefonu, WhatsApp i e-maila o pojeździe, terminie i miejscu odbioru oraz dane techniczne potrzebne do bezpiecznego działania strony. Rozdzielić kontakt od faktycznej późniejszej umowy najmu, jeśli firma ją zawiera poza aplikacją. Kliknięcie kontaktu nie tworzy konta ani rezerwacji.
3. **Podstawy i odbiorcy:** dla każdego procesu rzeczywista podstawa z art. 6 RODO, odbiorcy lub kategorie odbiorców (w tym dostawcy hostingu, poczty i komunikacji), transfer poza EOG i zabezpieczenia, jeśli występują. Nie wpisywać domyślnie dostawcy ani podstawy bez sprawdzenia procesu.
4. **Retencja:** rzeczywisty okres lub kryterium dla zapytania, korespondencji, ewentualnej umowy i logów. Nie kopiować automatycznie czasu przechowywania logów Autervy.
5. **Prawa i skarga:** dostęp, sprostowanie, usunięcie, ograniczenie, sprzeciw, przenoszenie tam, gdzie ma zastosowanie, oraz skarga do organu nadzorczego. Wskazać tryb kontaktu, wymagalność podania danych i automatyczne decyzje, jeśli występują.

Przed publikacją: wypełnić realnymi danymi firmy, zweryfikować procesy i dostawców, ustalić datę/wersję, uzyskać akceptację osoby upoważnionej. Dla fixture **zasady najmu/regulamin: nie publikujemy**; rzeczywista firma wybiera brak/treść/link i dostarcza zatwierdzony dokument lub URL. Dokument operatora Autervy pozostaje osobny w [jego pakiecie](auterva-v1.md).
