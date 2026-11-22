# Materiały i treści do publikacji — rejestr #6

Rejestr odpowiada na pytanie, co z treści, danych oferty i dokumentów można dziś użyć i czego brakuje do publikacji. Opiera się na pakietach [#81 / PR #189](materials/README.md) ([Auterva](materials/auterva-v1.md), [Alfa Campers DEMO](materials/alfa-campers-demo-v1.md)), decyzjach D-03 i D-17 w [wymaganiach](../WYMAGANIA_AUTERVA.md) oraz [PRD 3.1 §7.1–7.2 i §12.1–12.4](PRD.md). Nie zmienia zakresu MVP, uprawnień ani walidacji.

## Zakres użycia

| Poziom | Znaczenie | Stan |
|---|---|---|
| Implementacja, fixture, preview DEMO | Dozwolone na podstawie D-17: treści z Penpota i wygenerowane wg PRD. Wszystko oznaczone DEMO. | **Gotowe** (pakiety v1.0, AUT-01–05, FIR-01–06). |
| Publikacja produkcyjna | Wymaga prawdziwych danych, praw do mediów, zatwierdzonych dokumentów prawnych i osobnej zgody na wdrożenie. | **Zablokowana**: brak danych rzeczywistego operatora i firmy (lista w sekcji „Warunki publikacji”). |

D-03 określa strukturę (kategorie superadmina, opcjonalna cena z przełącznikiem firmy, telefon/WhatsApp/e-mail, pełny adres i mapa, osobne dokumenty prawne, hero z wieloma obrazami). Nie potwierdza prawdziwości danych ani praw do zdjęć. Zgodnie z D-01 superadmin wprowadza publiczne dane, SEO i treści prawne firmy; administrator firmy ma odczyt.

## Matryca treść → miejsce użycia

Źródło: „Penpot” lub „wg PRD” (D-17). Status DEMO oznacza użycie tylko w fixture i oznaczonym preview.

| Treść | Ekran / miejsce | Źródło | Pakiet | Status dziś | Warunek produkcji |
|---|---|---|---|---|---|
| Hero, korzyści, FAQ, CTA Autervy | MKT-01 | Penpot | AUT-01 | staging | Prawdziwy telefon, WhatsApp i e-mail; zatwierdzenie właściciela. |
| Cztery kroki, meta title/description, alt | MKT-01 | wg PRD §12.1 | AUT-02 | staging | Zgodność z rzeczywistą ofertą. |
| Logo i podgląd produktu | MKT-01 | Penpot; SVG w `design/assets/brand/` | AUT-03 | preview | Autorstwo i prawo użycia SVG; w preview wordmark tekstowy. |
| Ilustracja redakcyjna `public-fleet-depot` | MKT-01 | manifest, `synthetic-demo` | AUT-04 | preview DEMO | Zastąpić zasobem z udokumentowanym prawem. |
| Polityka prywatności Autervy | MKT-01 stopka | wg PRD, art. 13 RODO | AUT-05 | szkic | Dane operatora, procesy, dostawcy, retencja, data, akceptacja. |
| Szkice prawne D-55: polityka Autervy, wzór polityki firmy, wariant regulaminu | MKT-01 stopka, PUB-05, PUB-06 | agent na podstawie kodu i kontraktów, [docs/legal](../legal/README.md) | AUT-05, FIR-03, FIR-06 | **do akceptacji**, „do weryfikacji prawnej”, nie w aplikacji | Weryfikacja prawna, dane operatora i firmy, dostawcy (D-53), decyzje o retencji, akceptacja właściciela. |
| Marka, hero, opis, kategorie | PUB-01, PUB-02/03 | Penpot | FIR-01, FIR-05 | staging DEMO | Prawdziwa firma, jej materiały i słownik kategorii superadmina. |
| Kontakt, godziny, adres, mapa | PUB-04 | Penpot jako wzór | FIR-02 | staging DEMO, kontakt nieaktywny | Sprawdzone kanały, pełny adres i działająca mapa firmy. |
| Polityka prywatności firmy | PUB-05 | Penpot + wg PRD | FIR-03 | szkic DEMO | Administrator, procesy, dostawcy i akceptacja konkretnej firmy. |
| Hero, redakcja (`public-hero-camper-lakeside`, `public-editorial-camper-interior`, `public-fleet-depot`) | PUB-01, PUB-04 | manifest, `synthetic-demo` | FIR-04 | preview DEMO | Zdjęcia firmy z prawami; nie przypisywać demo prawdziwym pojazdom. |
| Cena i widoczność | PUB-01–03 | wg PRD i D-03 | FIR-05 | `showPrices=false`, ceny puste | Zatwierdzone kwoty i decyzja firmy. Brak ceny: „Zapytaj o cenę i szczegóły wynajmu.”, nigdy „0 zł”. |
| Zasady najmu / regulamin | PUB-06 | decyzja fixture | FIR-06 | nie publikować | Firma wybiera: brak / tekst / odnośnik; bez pozornego dokumentu. |

Pusta aktywna flota pokazuje zapowiedź „Nasza oferta pojawi się wkrótce.” (PRD §12.3), bez fikcyjnych aut. Wygaśnięcie usługi wyłącza całą stronę i nie używa tego wariantu.

## Decyzja: warianty copy Mobile / Desktop

Uwaga QA z #81: copy PUB-01 i PUB-04 różni się między M i D w Penpocie. **Decyzja orkiestratora: warianty M/D zachowujemy takie, jakie są w Penpocie**, bo makieta rozstrzyga wygląd i copy ekranu. Nie ujednolicamy tekstu per viewport. Pakiet FIR zapisuje po jednym wariancie, więc implementacja bierze tekst z właściwej planszy.

| Ekran | Mobile (390 px) | Desktop (1440 px) |
|---|---|---|
| PUB-01, opis hero | „…aby dobrać pojazd.” | „…aby dobrać pojazd do swojej trasy.” |
| PUB-04, opis | „Podaj nazwę pojazdu i termin. Potwierdzimy aktualną dostępność w rozmowie.” | To samo zdanie rozszerzone o „Najszybciej odpowiadamy telefonicznie i przez WhatsApp…”. |

Pełny początek zdania PUB-01 oraz dokończenie zdania PUB-04 desktop są w planszach; kod i test czytają je z Penpota, a nie z tego dokumentu. Copy kanału pozostaje DEMO, a kontakt nieaktywny do podmiany danymi firmy. Ta rozbieżność nie jest zmianą zatwierdzonych reguł.

Boardy (plik `b564c72c-f31f-81ec-8008-af198a313438`, strona `269b07ba-69e5-8066-8008-c84a9b898bc0`, `state=default`), M / D:

| Ekran | Mobile | Desktop |
|---|---|---|
| MKT-01 | `1e066793-8858-8051-8008-cf36d8d5909f` | `269b07ba-69e5-8066-8008-c84b6a04500c` |
| PUB-01 | `1e066793-8858-8051-8008-cf38b2bec442` | `1e066793-8858-8051-8008-cf38f350ea9b` |
| PUB-04 | `1e066793-8858-8051-8008-cf38b2beb248` | `1e066793-8858-8051-8008-cf38f3509bc5` |
| PUB-05 | `1e066793-8858-8051-8008-cf38d9b4dc7e` | `1e066793-8858-8051-8008-cf3916c13ab3` |

Treść plansz potwierdziło QA #81 odczytem live; ten PR nie wykonywał nowego odczytu Penpota.

## Rejestr zasobów

| Zasób | Pochodzenie | Dozwolone teraz | Warunek przed produkcją |
|---|---|---|---|
| `design/assets/brand/auterva-*.svg` | Pliki w repo; [README zasobów](../../design/assets/README.md) nie podaje autorstwa ani licencji. | Projekt, preview. | Potwierdzić autorstwo, prawo użycia i wariant. |
| 37 ujęć syntetycznych, 152 warianty AVIF/WebP w [manifeście](../../design/assets/manifest.json) | `provenance.kind=synthetic-demo`, prompty i SHA-256 w manifeście. Nie jest to licencja firmy. | Makiety, preview DEMO, fixture. | Nie używać jako rzeczywistej oferty; zastąpić materiałami z prawem. |
| Źródłowe PNG (`archivedOriginal`) | Ścieżki w manifeście, plików nie ma w repo. | Zoptymalizowane warianty do porównań. | Nie deklarować posiadania oryginałów. |
| Logo, hero i zdjęcia rzeczywistej firmy | Brak w repo. | n/d | Plik źródłowy, właściciel praw, zakres zgody, przypisanie do firmy. |

Źródło nowego pliku zapisuje się jako: podmiot, plik i wersja/hash, właściciel praw, podstawa użycia, zakres publiczny, data i zatwierdzający. Dowody akceptacji przechowuje się poza repo; w repo wystarczy identyfikator wersji i status.

## Warunki publikacji

Brakuje, zatem publikacja produkcyjna pozostaje zablokowana:

1. **Auterva:** tożsamość operatora, prawdziwy telefon/WhatsApp/e-mail, prawa do logo i obrazów, zatwierdzona polityka prywatności, zewnętrznie zaakceptowana wersja.
2. **Pierwsza rzeczywista firma:** nazwa i osoba upoważniona, kanały kontaktu, pełny adres i mapa, godziny, logo/hero/zdjęcia z prawami, kategorie i dane pojazdów, zasady cen, własna polityka prywatności, wariant regulaminu, zewnętrzna akceptacja wyglądu przed prerejestracją.
3. **Zgoda na wdrożenie produkcyjne** (D-17).

Przy konfiguracji produkcyjnej implementacja i QA odrzucają `example.invalid`, etykietę DEMO, numery i adres z makiety oraz ceny przykładowe. Brak materiału nigdy nie oznacza „0 zł” ani domyślnego telefonu, mapy lub polityki. Treści nie obiecują rezerwacji, płatności online, publicznego trialu ani niepopartych wyników.

## Odbiór

Sprawdzić osobno materiały Autervy i firmy, ceny widoczne/ukryte/puste, mapę i regulamin oraz to, że fixture DEMO nie trafia do konfiguracji produkcyjnej. PR zmienia wyłącznie dokumentację, więc runtime, klawiatura i API nie są tu zaliczone; VoiceOver: DEFERRED do [#97](https://github.com/KarolR2001/Auterva/issues/97).
