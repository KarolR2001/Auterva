# Auterva — kontrakt responsywności

Reguły implementacji wynikają z [SPEC](../../docs/design/SPEC.md), [PRD 3.1](../../docs/product/PRD.md) i kanonicznych makiet Penpota. Nie są raportem zaliczonych testów aplikacji. Wysokości fixture opisują przykładową treść; nie kopiować ich jako stałych wysokości ani pozycji CSS.

## Formularze i dialogi na wąskim ekranie

- OVR-06/07 przy 320 px: gutter 16 px, kontrolki 48 px, ikony kalendarza 18×18 px, pełne daty oraz pola tekstowe jako alternatywa kalendarza. Referencja, notatka i pomoc zawijają się. Poniżej 360 px zamknięcie ma osobny górny wiersz; akcje układają się pionowo z odstępem 12 px: zapis, potem anulowanie/usunięcie. Niezmieniona edycja ma nieaktywny zapis.
- OVR-08: karty konfliktów i powrót zajmują szerokość kontenera z paddingiem 24 px; cała karta otwiera właściwą blokadę. Tytuł, opis i sheet rosną z treścią. Przy krótkim viewportcie przewijanie musi pozwalać dotrzeć do ostatniej akcji.
- Archiwizacja/przywrócenie firmy: szerokość dialogu `min(100% - 32px, 640px)`, padding 24 px. Przy 320 px treść ma 240 px; akcje 240×48 px w pionie, odstęp 12 px, główna nad anulowaniem. Desktop dopuszcza akcje obok siebie. Dłuższy tekst zwiększa wysokość; mały viewport wymaga scrolla treści.
- Dodanie firmy PLT-04: mobile jedna kolumna `viewport - 32px`, błędy i akcje na pełną szerokość. Podgląd po materiałach publicznych z odstępem 24 px, dolna nawigacja po formularzu z odstępem min. 32 px. Tablet używa reflow, a przy 1920 px shell jest wyśrodkowany i ma maks. 1600 px.
- VehicleForm: mobile jedna kolumna, etykiety i upload płynne; desktop pola w powiązanych parach z nawigacją/statusami obok. Textarea ma min. 120 px i padding 12 px, rośnie wraz z treścią. Długą wartość jednoliniowego pola można przewijać podczas edycji; etykiety i błędy nie są przycinane.
- Galeria w kompozycji VehicleForm ma jedną kolumnę M i dwie D; jest jawnym odstępstwem tej kompozycji od ogólnej galerii kafelków 2 kolumny M / 3–5 D. Zachować pełne akcje per zdjęcie, opisy i przyciski zmiany kolejności. Nie uogólniać układu formularza na cały DS.
- QuickBlockFlow A-02 przy 320 px: nagłówek i akcje mają margines 24 px; akcje 272×48 px z odstępem 8 px. Formularz i podsumowanie mają margines 16 px. Krok dat przewija się pionowo przy małej wysokości; stopka pozostaje po treści, także przy klawiaturze.

## Czat, platforma i podglądy

- Czat przy 320 px: odstępy treści 24 px; poniżej 360 px composer układa pole, akcję i pomoc pionowo. Pole min. 64 px, akcja min. 48 px, odstęp 12 px. Wysokość rośnie ze szkicem; ikony dolnej nawigacji pozostają wewnątrz własnych pozycji.
- Błąd historii ma naturalną wysokość i widoczny przycisk ponowienia. Offline zachowuje szkic i już wczytane wiadomości, ale blokuje wysyłanie. Nowe wiadomości podczas czytania nie odbierają pozycji przewijania; wygasła sesja wymaga ponownego dostępu. Koniec opłaty nie wyłącza czatu; archiwizacja wyłącza dostęp.
- PLT-09 poniżej 1024 px rozdziela listę i rozmowę z powrotem; od 1024 px używa listy i rozmowy obok siebie. Lista ma loading/empty/filtered-empty/error/unread/draft; obie prezentacje zachowują odbiorcę i osobny szkic rozmowy.
- Zagnieżdżona flota superadmina `PLT-03-to-ADM`: do 767 px jedna kolumna kart; 768–1279 px dwie kolumny; od 1280 px pełna tabela. Pasek kontekstu firmy pozostaje dostępny. Jest to wyjątek od ogólnego progu tabeli 1024 px.
- Pozostałe ekrany platformy: 320–767 px mobilna kolumna z gutterem 16 px; 768–1023 px mobilna anatomia w kontenerze do 680 px; od 1024 px desktopowy shell. Formularze i czat zachowują max-width, dodatkowa szerokość należy do shellu. `CompanyContextBar` przechodzi z pionu do wiersza.
- Podglądy produktu na stronie marketingowej zachowują proporcje źródła (`height: auto`; przy stałej ramce `object-fit: contain`). Używać widoku odpowiadającego urządzeniu, bez rozciągania i bez ekranów superadmina. Hero i zdjęcia pojazdów zachowują własne proporcje i focal point.

## Viewporty i siatka

Tokeny implementacyjne: `xs=320`, `sm=480`, `md=768`, `lg=1024`, `xl=1280`, `2xl=1440`, `wide=1920`. Breakpoint wybiera zmianę anatomii; Flex/Grid, szerokości procentowe, `minmax()` i `clamp()` obsługują przestrzeń pomiędzy progami.

Główne makiety powstają w 390×844 i 1440×1024. Walidacyjne viewporty to 320×568, 430×932, 768×1024, 1024×768 i 1920×1080.

## Niezmienniki funkcjonalne

Zmiana szerokości nie usuwa:

- dodawania i edycji pojazdu oraz zdjęć;
- dodawania, edycji i rozwiązywania konfliktu blokady;
- wyszukiwania i filtrowania;
- publikacji, ukrycia i archiwizacji;
- ustawień, konta, sesji i audytu;
- stanów loading, empty, error, conflict, offline i session expired;
- alternatywnych pól dat i informacji, że dostępność wymaga potwierdzenia;
- informacji, że kontakt nie tworzy rezerwacji ani klienta.

Osobny wariant komponentu jest potrzebny tylko wtedy, gdy zmienia się anatomia lub kolejność interakcji. Sama zmiana szerokości używa tego samego komponentu.

## Mapowanie wzorców

| Wzorzec | Mobile 320–767 | Tablet 768–1023 | Desktop 1024+ |
|---|---|---|---|
| Publiczna nawigacja | header 64 px, menu otwiera pełny drawer | skrócone linki | header 72 px, linki i CTA |
| Admin | bottom navigation 64 px + safe area, „Więcej” | sidebar zwijany 72 px | sidebar stały 240 px |
| Flota publiczna | jedna kolumna | dwie kolumny | trzy, opcjonalnie cztery na `wide` |
| Flota admina | karty rekordów | karty lub tabela uproszczona | pełna tabela |
| Filtry | przycisk + bottom sheet | panel nad listą | toolbar lub sidebar |
| Szczegóły pojazdu | jedna kolumna, kontakt przy dolnej krawędzi | dwie sekcje | treść + sticky availability aside |
| Galeria | jedno duże zdjęcie, przewijane miniatury dopiero gdy mieszczą się bez ścisku | duże zdjęcie + miniatury | mozaika + lightbox |
| Formularz pojazdu | sekcje/akordeony, sticky actions | sekcje i pola w dwóch kolumnach | szeroki formularz + panel statusu |
| Dialog | pełny/bottom sheet, gdy treść wymaga | 640–720 px | 560–800 px zależnie od wariantu |
| FilterSheet | bottom sheet, 16 px gutter; pełny zestaw filtrów | opcjonalny prawy drawer 520 px, inset 24 px | ta sama treść i akcje `apply`/`clear`; licznik nie zmienia anatomii |
| Publiczny kalendarz | jeden miesiąc + jawne pola od/do | jeden lub dwa miesiące | dwa miesiące |
| Kalendarz floty | lista pojazdów i blokad | przewijana oś | macierz pojazdy × dni/tygodnie |
| Główna akcja | `width:100%`, sticky tylko gdy nie zasłania treści | wyrównana do prawej | w PageHeader lub footerze sekcji |

## Reguły komponentów i treści

- Minimalny cel dotykowy to 44×44 px; standardowy przycisk i input mają 48 px.
- Sąsiednie cele dotykowe dzieli co najmniej 8 px.
- Długi polski tekst zawija się i zwiększa wysokość komponentu; nie używa ellipsis dla komunikatu błędu, skutku operacji ani głównego CTA.
- Tabela na mobile staje się kartami. Poziomy scroll nie jest podstawowym rozwiązaniem dla danych admina; jest dopuszczony dla osi czasu i miniatur.
- Sticky aside przechodzi do zwykłego układu przy małej wysokości viewportu lub gdy jego wysokość przekracza dostępną przestrzeń.
- Sticky CTA rezerwuje miejsce w `padding-bottom`, aby nie zasłonić ostatniego pola, błędu, focus ring ani komunikatu `aria-live`.
- `DS-FBK-021 AnnouncementRegion` jest wizualnie ukryty w każdym viewportcie; nie ma osi mobile/desktop, nie rezerwuje miejsca i nie wpływa na geometrię. Widoczne Toast/Alert pozostają osobnymi komponentami, a live region służy wyłącznie do ogłoszenia ich wyniku semantycznego.
- Obraz zachowuje zdefiniowane proporcje i focal point. `object-fit:cover` nie może ucinać pojazdu; wariant mobile ma własny kadr z manifestu assetów.

## Wyjątek kalendarza przy 320 px

Siedem celów po 44 px wymaga 308 px przed odstępami i typowym paddingiem. Nie zmniejszamy celów. Wykonany wariant `DS-AVL-004` używa sześciu przerw po 2 px, więc pełny wiersz katalogowy zajmuje dokładnie 320 px. W implementacji przy szerokości do 375 px nadrzędny region hero przechodzi na układ edge-to-edge, zamiast wypuszczać kalendarz poza jego rodzica:

1. pola `Od` i `Do` pozostają pierwszą, w pełni dostępną metodą wyboru;
2. nadrzędne `public-preview`, hero, formularz i region kalendarza rozszerzają
   się razem; żaden potomek nie wychodzi poza własny kontener ani viewport;
3. przy dokładnie 320 px siatka ma 308 px i zerowy odstęp, czyli `7 × 44 =
   308`; od 376 px wraca odstęp 2 px, a siatka rośnie maksymalnie do 320 px;
4. nagłówek miesiąca i akcje pozostają w standardowym paddingu 16 px;
5. komórki zachowują minimum 44×44 px, siedem kolumn i kolejność poniedziałek–
   niedziela w całym zakresie 320–1920 px.

To jawny wyjątek geometrii komponentu, nie nowy breakpoint ani osobny ekran.

## Wspólna karta treści

`DS-DAT-001 Card` nie ma wariantu viewport. Mobile rozszerza ją do szerokości kolumny (`calc(100% - 32px)`, sprawdzone 288 px przy viewportcie 320 px), a tablet i desktop przekazują szerokość z `ResponsiveGrid` albo listy. Wysokość rośnie z treścią; wartości 180 px w katalogu są demonstracyjne, nie są `max-height`. Długi tekst zawija się bez ellipsis, a focus ring pozostaje widoczny także przy overflow rodzica.

## Wyróżniona karta pojazdu

`DS-DAT-003 VehicleCardFeatured` nie tworzy drugiego komponentu ani osi viewport. Jest kontraktem użycia `DS-DAT-002 VehicleCardPublic`:

- `large` → `layout=featured`; `compact` → `layout=grid`;
- brak obrazu → istniejący wariant `image=fallback`;
- mobile układa karty w dostępny swipe z kontrolowanym snapem albo w jedną kolumnę; desktop składa 3–6 kart przez grid rodzica;
- karta zachowuje proporcję media 3:2, CTA 48 px i nie steruje szerokością całej kolekcji.

## Pozycja pojazdu w panelu

`DS-DAT-004 VehicleRowAdmin` i `DS-DAT-005 VehicleCardAdmin` używają jednej anatomii `VehicleAdminItem`:

- 320–768 px: `layout=card`, pełny zestaw statusów i akcji, szerokość kolumny;
- od 1024 px: `layout=row` w semantycznej tabeli; przy zbyt małej dostępnej szerokości rodzic pozostaje przy karcie zamiast uruchamiać poziomy scroll;
- `detail=detailed` jest opcjonalny i nie zastępuje głównych akcji;
- menu-open zwiększa wysokość wiersza, a updating zachowuje jego miejsce i zastępuje akcje wskaźnikiem operacji.

## Statystyki dashboardu

`DS-DAT-006 StatCard` pozostaje jednym komponentem bez osi viewport:

- 320–768 px: rodzic układa 2 kolumny z odstępem 12–16 px;
- od 1024 px: rodzic układa 4 kolumny, maksymalnie w kontenerze 1120 px;
- label i helper mogą zawijać się, ale wartość oraz znak braku danych nie są ucinane;
- warning zachowuje ikonę, tekst i obramowanie także w najwęższej kolumnie;
- loading rezerwuje wysokość karty, aby siatka nie skakała po pobraniu danych.

## Lista parametrów pojazdu

`DS-DAT-007 SpecList` ma jedną oś `mode`, a liczbę kolumn kontroluje rodzic:

- 320–430 px: 2 kolumny;
- 768 px: 3 kolumny;
- od 1024 px: 3–4 kolumny w kontenerze do 1120 px;
- brakujące pole opcjonalne jest pomijane, dlatego ostatni rząd może być niepełny bez pustej karty;
- dłuższe wartości zawijają się w obrębie pozycji, nie wymuszają poziomego przewijania całej strony.

## Cechy i wyposażenie

`DS-DAT-008 FeatureChip` zachowuje wysokość 44 px i naturalną szerokość etykiety. Kontener rodzica stosuje `display:flex`, `flex-wrap:wrap` i odstęp 8–12 px:

- 320 px: cztery przykładowe chipy zajmują 3 rzędy;
- 390–430 px: te same chipy zajmują 2 rzędy;
- od 768 px: mieszczą się w jednym rzędzie, ale nadal mogą się zawijać przy dłuższych polskich nazwach lub powiększeniu tekstu;
- usuwanie admina zachowuje cel 44×44 px i nie zmniejsza się w węższym kontenerze.

## Cena informacyjna

`DS-DAT-009 PriceBlock` ma jedną oś `mode` i zmienia wyłącznie ułożenie przez rodzica:

- 320–430 px: pełna szerokość, dwa przykłady w pionowym stacku z odstępem 12 px;
- od 768 px: kontrolowana szerokość 260 px, inline albo aside;
- `hidden`, brak kwoty oraz kwota `0` nie rezerwują miejsca w layoucie;
- dłuższy tekst wyceny indywidualnej zawija się wewnątrz bloku.

## Ogólna lista definicji

`DS-DAT-010 DefinitionList` ma jedną oś `layout`, bez wariantu viewportu:

- 320–430 px: `vertical`, termin nad wartością, pełna szerokość kolumny;
- 768 px: `two-column` w kontenerze 680 px;
- 1024–1920 px: `two-column` w wyśrodkowanym kontenerze maks. 720 px;
- brakujące wartości są pomijane przed renderem i nie rezerwują miejsca.

## Tabela danych i mobilne karty

`DS-DAT-011 DataTable` nie ma osi viewport i nie jest ściskany ani przewijany poziomo jako podstawowy widok mobile:

- 320–430 px: brak instancji tabeli; rekordy przechodzą do `DS-DAT-012 RecordCard`;
- 768 px: wybrano również karty, zgodnie z dopuszczonym wariantem tabletowym;
- 1024 px: tabela o szerokości 960 px z uproszczonym, nadal kompletnym układem danych i akcji;
- 1440 px: tabela pojazdów w kontenerze 1200 px;
- 1920 px: kontrolny grid czterech instancji po 900 px pokazuje logi, sesje, loading i empty.

`DS-DAT-012 RecordCard` ma stałą, zwartą szerokość 304 px i nie ma osi viewport:

- 320 px: jedna karta przy marginesie 8 px; brak poziomego przewijania;
- 390–430 px: jedna karta wyśrodkowana, compact albo expanded;
- 768 px: dwie karty w jednym rzędzie;
- 1024 px: trzy kompaktowe karty kontrolne; podstawowym wzorcem danych może już być `DataTable`;
- 1440–1920 px: karta jest opcjonalną reprezentacją kompaktową obok tabeli, bez zmiany anatomii komponentu.

`DS-DAT-013 KeyValueRow` używa dwóch układów wybieranych przez rodzica, nie osi viewport:

- 320–430 px: `vertical` 304×128 px; długi tekst zawija się w obrębie wartości, a akcja kopiowania pozostaje pełnym tekstowym celem;
- od 768 px: `row` 600×72 px; etykieta, wartość i opcjonalna akcja mieszczą się bez poziomego przewijania;
- status w obu układach składa ten sam `StatusBadge` i nie traci etykiety.

`DS-DAT-014 AuditLogRow` jest mapowaniem domenowym, nie osobnym komponentem:

- 320–768 px: compact/expanded używają odpowiednich wariantów `DS-DAT-012 RecordCard record=log`;
- od 1024 px: rekord pozostaje w `DS-DAT-011 DataTable dataset=logs`;
- akcja szczegółów na desktopie otwiera `OVR-18` zamiast zmieniać tabelę w akordeon albo tworzyć kolejną anatomię.

Katalog aliasu `1e066793-8858-8051-8008-cf32e1096be8` pokazuje obie karty mobile i realną tabelę desktopową. Redakcja wartości pozostaje widoczna w expanded; żaden wariant nie ujawnia sekretów ani tokenów.

`DS-DAT-015 SessionCard` jest rolą rekordu wewnątrz istniejącej listy:

- mobile: `DS-AUT-008 ActiveSessionList` układa bieżącą i pozostałe sesje jako karty; current nie ma terminate, other prowadzi przez `OVR-19`;
- desktop: dozwolone są te same karty albo `DS-DAT-011 DataTable/sessions`;
- expired: no-render w liście aktywnych sesji MVP w liście aktywnych sesji.

Katalog aliasu `1e066793-8858-8051-8008-cf32e1096c33` pokazuje realną listę kart 560 px oraz realną tabelę 1040 px. Obie prezentacje zachowują skrócone dane techniczne i nie ujawniają tokenów ani pełnych sekretów.

`DS-DAT-016 WarningList` zachowuje jedną treść bez osi viewport:

- 320–430 px: alerty w pionowym stosie z 16 px gutterem;
- od 768 px: jeden panel; dwa elementy mogą przejść do dwóch kolumn;
- `dismissed` usuwa element z układu, a `resolved` nie rezerwuje pustego miejsca;
- długi polski tekst zawija się wewnątrz alertu, bez poziomego scrolla.

`DS-DAT-017 ResultCount` zachowuje jedną anatomię 280×72 px:

- 320–430 px: jedna instancja przy triggerze filtrów lub wyszukiwaniu; sticky stosuje rodzic, nie komponent;
- od 768 px: filters i search mogą współistnieć w toolbarze;
- breakpoint nie zmienia osi ani semantyki polite live regionu.

`DS-DAT-018 SortControl` przełącza wyłącznie prezentację, nie funkcję:

- 320–430 px: `select` 304 px w treści lub sheecie filtrów;
- od 768 px: `select` może pozostać w szerszym toolbarze, a `menu` służy jako kompaktowy trigger, gdy przestrzeń współdzielą filtr i licznik wyników;
- bieżące kryterium jest tekstem kontrolki, nie osią wariantów ani nowym ekranem.

`DS-DAT-019 FilterChip` jest aliasem dwóch istniejących wariantów `DS-DAT-008 FeatureChip`:

- 320–430 px: parent-owned `overflow-x: auto`; 320 px pokazuje fragment następnego removable chipa jako affordance scrolla;
- od 768 px: lista chipów zawija się w toolbarze; sam chip zachowuje tę samą anatomię i cel usuwania 44×44 px;
- focus i remove nie tworzą osi viewport ani osobnego ekranu.

`DS-DAT-020 FilterBar` jest wzorcem kompozycyjnym, nie dodatkowym atomem:

- 320–430 px: compact z pełnoszerokim triggerem, ResultCount i opcjonalnym railem chipów;
- 768 px: ten sam compact jako bezpieczny fallback tabletu;
- od 1024 px: full z SearchInput, triggerem filtrów, SortControl i wierszem wyniku/chipów albo Skeleton w loading;
- query, dirty/applied, scroll i wrap pozostają odpowiedzialnością rodzica.

`DS-DAT-022 LegalContent` zachowuje jedną semantyczną kolumnę Flex:

- 320–430 px: 16 px gutter, szerokość `viewport - 32 px`, dokument przewijany pionowo bez poziomego scrolla;
- 768 px: kolumna 680 px wyśrodkowana w widoku;
- od 1024 px: czytelna kolumna ma maksymalnie 760 px i pozostaje wyśrodkowana;
- privacy/terms zmieniają treść, nie anatomię ani breakpoint; data, anchor navigation, nagłówki, listy i linki zachowują kolejność semantyczną.

`DS-DAT-023 ContactDataList` zmienia wyłącznie układ istniejących elementów:

- 320–430 px: jedna lista kart z 16 px gutterem; brak kanału usuwa kartę i domyka stos bez pustej przestrzeni;
- od 768 px: dwie kolumny — kanały/adres po lewej, WhatsApp i godziny po prawej; szerokość kompozycji rośnie maksymalnie do 1040 px;
- ContactHours używa open-text na mobile i structured na szerszych widokach; dane i kolejność kanałów nie tworzą osi viewport.

`DS-DAT-024 MapEmbed` zachowuje jedną anatomię i kontrolowaną szerokość:

- 320–430 px: 16 px gutter i preferowany statyczny podgląd; powierzchnia mapy skraca się do 180 px, ale adres, wyjaśnienie i akcja pozostają widoczne;
- 768 px: komponent ma 680 px; od 1024 px maksymalnie 760 px;
- embed na desktopie jest opcjonalny, a consent-required nie ładuje mapy; brak mapy nie zmienia układu ContactDataList.

`DS-FRM-008 Combobox` zmienia warstwę, nie model wyboru:

- 320–430 px: kontrolka wypełnia kolumnę, a otwarta lista jest modalnym sheetem / pełnym ekranem; cele opcji mają co najmniej 44 px;
- od 768 px: lista jest popoverem zakotwiczonym w polu i ma maks. 400 px;
- typing, loading, empty i selected zachowują ten sam pojedynczy `value`; filtrowanie nie zatwierdza wyboru i nie tworzy opcji;
- Escape zamyka warstwę i zwraca fokus; mobile dodatkowo blokuje scroll tła.

`DS-FRM-009 MultiSelect` nie ma własnej rodziny breakpointów: reużywa `FeaturePicker(searchable)` oraz jego sheet/popover.

- 320–430 px: usuwalne chipy zawijają się nad sheetem; kontrolka i grupy checkboxów mają pełną szerokość, a akcje/chipy zachowują cele 44 px;
- od 768 px: wybrane chipy są w jednym wierszu, a FeaturePicker korzysta z desktopowego panelu/popoveru;
- `max-reached` nie ukrywa wyborów: disabled są tylko niezaznaczone opcje; `empty` zachowuje wszystkie opcje i pokazuje `0 wybranych`.

`DS-MED-005 ImageAdminTile` zachowuje jedną anatomię, ale dopasowuje szerokość do siatki galerii:

- 320–430 px: dwie kolumny; karta może zejść do 140 px, teksty zawijają się, a każda akcja zachowuje cel 44×44 px;
- od 768 px: galeria dobiera 3–5 kolumn, a karta rośnie bez zmiany osi stanu;
- uploading i failed nie ukrywają nazwy pliku, postępu/błędu ani akcji retry, cancel i delete; komunikat może skrócić copy przy 320 px;
- drag handle pozostaje widoczny, lecz mobile otrzymuje równoważne przyciski „w górę/w dół” na poziomie `ReorderableGallery`.

`DS-MED-006 ReorderableGallery` zmienia metodę sterowania bez zmiany danych:

- 320–430 px: dwie kolumny kafelków i osobne cele 44×44 px „w górę”/„w dół”; początek i koniec listy są jawnie disabled;
- od 768 px: 3–5 kolumn, drag handle oraz równoważne `Ctrl+ArrowLeft/Right`; pozycja jest ogłaszana po zmianie;
- saving zachowuje geometrię kafelków i dodaje jeden indeterminate ProgressBar;
- conflict zachowuje ostatnią znaną kolejność, pokazuje Alert i wymaga reload przed kolejnym zapisem.

`DS-MED-007 CoverMarker` nie ma breakpointu ani osobnej rodziny komponentu: jest częścią ImageAdminTile. W 320 px marker „✓ GŁÓWNE” pozostaje widoczny nad obrazem, a akcja `★` zachowuje cel 44 px; na desktopie działa identycznie.

`DS-MED-008 UploadQueue` reużywa viewporty ImageUploader:

- mobile: pionowy stack plików, postęp i akcje pod każdym wpisem;
- desktop: lista/grid z tym samym statusem per plik;
- error i retry zachowują poprawne pliki, a completed przechodzi do galerii;
- metoda sterowania i status nie znikają przy zawężeniu.

`DS-MED-009 ImageAltEditor` reużywa jedno pole w trzech prezentacjach:

- mobile: BottomSheet 390 px z polem, helperem i akcjami zapisz/anuluj;
- desktop: preferowane inline; Dialog form jest opcją z kafelka;
- required, suggested i custom zachowują tę samą etykietę, licznik i limit;
- zmiana wrappera nie zmienia walidacji ani zapisanej wartości.

`DS-MED-010 LogoUploader` ma ten sam single-file model w obu viewportach:

- mobile jest tap-first i pokazuje wybór pliku/aparatu;
- desktop dodaje drag/drop, ale pozostawia dostępny przycisk wyboru;
- preview, replace, remove i invalid zachowują tę samą semantykę;
- poprzednie poprawne logo nie znika podczas błędnej zamiany.

`DS-SET-008 AuditFilters` zmienia wyłącznie prezentację jednego zapytania:

- 320–430 px: istniejący FilterSheet z grupami daty, aktora, akcji i encji;
- od 768 px: FilterBar, a od 1024 px pełny układ z chipami zastosowanych filtrów;
- `Apply`, `Clear`, liczba wyników i wartości są wspólne dla obu prezentacji;
- dłuższe chipy zawijają się w rodzicu, nie poszerzają całej strony.

`DS-SET-010 DataQualityIssue` dziedziczy zachowanie `DS-DAT-016 WarningList`:

- 320–430 px: jedna kolumna kart z pełnym opisem i akcją pod treścią;
- od 768 px: row/card w panelu; kategorie vehicle/contact/system są danymi;
- resolved i action-required zachowują tę samą anatomię oraz kolejność treści;
- brak problemów nie renderuje pustej listy ani zastępczego ekranu.

## Safe area, klawiatura i mała wysokość

Elementy przyklejone do krawędzi używają:

```css
padding-bottom: max(16px, env(safe-area-inset-bottom));
padding-top: max(12px, env(safe-area-inset-top));
```

Dotyczy to bottom navigation, sticky action bar, sheet i stanu offline. Przy otwartej klawiaturze `100dvh` zastępuje stałe `100vh`; aktywne pole oraz jego błąd muszą być przewinięte nad klawiaturę. Dialog/sheet ma wewnętrzny scroll, a nagłówek i podstawowe zamknięcie pozostają dostępne.

## Zoom i reduced motion

- Przy zoom 200% treść może przejść do węższego wariantu, ale funkcje nie znikają i nie pojawia się poziomy scroll całej strony.
- Zmiana wielkości tekstu nie może nałożyć etykiet na ikony ani odciąć statusu.
- `prefers-reduced-motion` nie zmienia geometrii: usuwa slide/zoom i pozostawia natychmiastową albo krótką zmianę opacity.

## Procedura QA

Dla każdej rodziny public/admin należy sprawdzić kolejno 320, 390, 430, 768, 1024, 1440 i 1920 px oraz co najmniej jedną szerokość pośrednią. Kontrola:

1. brak clippingu i poziomego scrolla strony;
2. widoczność wszystkich funkcji oraz poprawna zmiana nawigacji;
3. długie copy, empty/error/loading i duże liczby;
4. sticky elementy, safe area, klawiatura i mała wysokość;
5. cele 44 px, kolejność fokusu i widoczny focus ring;
6. kadry zdjęć, `sizes`, proporcje i brak CLS;
7. zoom 200% oraz reduced motion w aplikacji.
