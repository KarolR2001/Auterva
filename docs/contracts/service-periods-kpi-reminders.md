# Kontrakt D-06/D-07/D-11/D-14: okres usługi, KPI i przypomnienia

Decyzje właściciela z 23.10.2026 są zapisane w [issue #2](https://github.com/KarolR2001/Auterva/issues/2), [PRD 3.1 §5.2A, §8–9](../product/PRD.md) i [wymaganiach C-F045–079](../WYMAGANIA_AUTERVA.md). Ten dokument doprecyzowuje implementację bez zmiany 336 godzin trialu, daty opłaty włącznie ani godzin 7/1/0. Dotyczy każdej firmy osobno; archiwizacja, rejestracja, okres, domena i publiczne odblokowanie są niezależnymi stanami.

## Granice czasu i odczyt publiczny

- `paidThrough` jest datą kalendarzową (`LocalDate`/SQL `DATE`). Jeśli istnieje, wyłączna granica opłaty to **00:00 następnego dnia w `Europe/Warsaw`**, przeliczona na chwilę UTC. Opłata jest ważna przy `now < paidEndsAt`. Nie dodawać 24 godzin do znacznika czasu ani karencji. Wpis opłaty nie jest zdarzeniem pobrania płatności i nie ma osobnej daty przyszłego startu.
- Przyznany jeden trial zaczyna się dopiero przy pierwszej skutecznej rejestracji administratora: `trialStartedAt = firstAdminRegisteredAt`. Wyłączna granica to `trialEndsAt = trialStartedAt + 336 godzin` w UTC. Trial jest ważny przy `now < trialEndsAt`; resend, GET linku, retry, ponowne logowanie i zmiana czasu go nie przesuwają.
- `effectiveEndsAt` jest późniejszą z dostępnych granic `paidEndsAt` i `trialEndsAt`. Publiczne uprawnienie okresowe istnieje, gdy **co najmniej jedna** granica jest w przyszłości. Wygaśnięcie jednej gałęzi nie może wyłączyć drugiej. Podgląd okresu i przypomnienia używają granicy, która faktycznie kończy uprawnienie; przy równości źródłem jest opłata. Historyczne zadanie wygaśnięcia nie zapisuje flagi `inactive`.
- Serwer udostępnia stronę firmy wyłącznie przy zakończonej rejestracji, niearchiwalnej firmie, poprawnej domenie, braku blokady po przywróceniu i ważnym trialu **lub** opłacie. Ten sam warunek obejmuje strony, API, sitemapę z ofertą i media; stan floty jest dodatkowym filtrem pojazdów. Odczyt sprawdza bieżący stan, więc opóźniony job nie decyduje o widoczności.
- Gdy oba okresy są ważne, główna etykieta panelu brzmi „opłacono do [data] włącznie”, również gdy trial kończy się później. Etykieta nie ukrywa rzeczywistej daty wyłączenia ani obu źródeł na szczegółach okresu. Gdy ważny jest tylko trial, etykieta nazywa trial i pokazuje jego dokładną datę/czas; nigdy nie sugeruje opłaty.

## Tabela stanów

Zakładamy poprawną domenę, o ile wiersz mówi inaczej. `KPI płatne` i `KPI trial` oznaczają dwa główne liczniki PLT; żadna firma nie trafia do obu. KPI opisują okres niezarchiwizowanej firmy, a nie liczbę widocznych witryn, więc oczekiwanie na rejestrację/domenę/odblokowanie nie usuwa ważnej opłaty z licznika.

| Stan firmy i okresu w chwili odczytu | Publiczna strona | Panel administratora | Główna etykieta | KPI płatne / trial | Przypomnienia |
|---|---|---|---|---|---|
| Prerejestracja, nawet z ważnym `paidThrough`; trial przyznany, lecz nie rozpoczęty | Wyłączona | Konto oczekuje na rejestrację | Opłata lub oczekiwanie na start trialu, bez obietnicy działającej strony | 1 / 0 przy ważnej opłacie, inaczej 0 / 0 | Dopiero po skutecznej rejestracji; bez wiadomości wstecz |
| Zarejestrowana, brak ważnej opłaty i trialu | Wyłączona | Pełny panel i czat | Okres wygasł; komunikat D-11 | 0 / 0 | Brak nowych terminów |
| Zarejestrowana, tylko ważny trial | Widoczna | Pełny panel i czat | Trial do dokładnej chwili | 0 / 1 | Według końca trialu |
| Zarejestrowana, tylko ważna opłata | Widoczna | Pełny panel i czat | Opłacono do lokalnej daty włącznie | 1 / 0 | Według końca opłaty |
| Zarejestrowana, ważny trial i opłata | Widoczna | Pełny panel i czat | Opłacono do lokalnej daty włącznie | 1 / 0 | Jedna seria według późniejszej granicy |
| Zarchiwizowana, dowolny okres, nawet przyszła opłata | Wyłączona | Login i istniejące sesje zablokowane | Archiwum osobno od okresu | 0 / 0 | Nie wysyłać w archiwum; archiwalne zadania pomijać |
| Przywrócona, okres ważny, bez wymaganej opłaty lub jawnego odblokowania publicznego | Wyłączona | Login i panel ponownie dostępne | Rzeczywisty okres oraz „strona wyłączona” | Według ważnej opłaty, w przeciwnym razie trial | Przyszłe terminy według bieżącej granicy, treść uwzględnia wyłączoną stronę |
| Przywrócona, ważna opłata i jawne odblokowanie przez superadmina | Widoczna, jeśli domena gotowa | Pełny panel i czat | Opłacono do lokalnej daty włącznie | 1 / 0 | Według końca efektywnego okresu |
| Zarejestrowana, okres ważny, ale domena niegotowa | Wyłączona | Pełny panel i czat | Rzeczywisty okres oraz „konfiguracja strony w toku” | Według ważnej opłaty, w przeciwnym razie trial | Według okresu; komunikat nie twierdzi, że oferta jest widoczna |

Po wygaśnięciu **wszystkich** okresów u niezarchiwizowanej firmy panel nadal pozwala zapisywać flotę i używać czatu. Pokazuje dokładnie: „Konto aktywne. Publiczna oferta jest obecnie wyłączona. Skontaktuj się z Autervą w sprawie uruchomienia okresu usługi.” Archiwizacja jest osobną przyczyną odmowy dostępu. Zwykłe przedłużenie po przerwie przywraca stronę automatycznie po spełnieniu bramki domeny; **przywrócenie z archiwum** wymaga dodatkowo ważnej opłaty i jawnego odblokowania przez superadmina. Sama aktywacja konta po wygaśnięciu wcześniej wpisanej opłaty nie przedłuża usługi: bez przyznanego, aktualnego trialu strona pozostaje wyłączona i obowiązuje komunikat D-11.

## Harmonogram 7/1/0 i bezpieczne retry

1. Dla efektywnej granicy wyznacz lokalną **datę wygaśnięcia** (`endDate`): dla opłaty jest nią ostatni opłacony dzień `paidThrough`, a dla trialu lokalna data dokładnej chwili `trialEndsAt`, także gdy przypada ona o 00:00. Sloty to `endDate − 7 dni`, `endDate − 1 dzień` i `endDate`, każdy o **09:00 `Europe/Warsaw`**. Odejmowanie dotyczy dat kalendarzowych, nie 7×/1×24 godzin od UTC. Sloty są przeliczane do UTC po ustaleniu lokalnych dat. O 09:00 nie ma nieistniejącej ani podwójnej godziny podczas typowych zmian DST. To techniczna interpretacja dwóch różnych postaci końca: daty opłaconej włącznie i dokładnej chwili końca trialu.
2. Każda zmiana `paidThrough`, przyznania trialu, pierwsza rejestracja, archiwizacja i przywrócenie przelicza efektywną granicę atomowo z podniesieniem `periodVersion` oraz zapisaniem/anulowaniem intencji w trwałym outboxie. Nie planować drugiego trialu. Sloty, które minęły przed rejestracją lub nowym zapisem okresu, nie są wysyłane wstecz jako nowe przypomnienia.
3. Intencja zawiera `companyId`, `periodVersion`, granicę UTC, źródło efektywne i offset 7/1/0. Worker tuż przed doręczeniem ponownie czyta bieżącą wersję, efektywną granicę, archiwizację i adresata. Niezgodną wersję lub granicę odrzuca; nie wolno jej wyłączyć strony, cofnąć przedłużenia ani wysłać starej daty. Gdy zmiana okresu nie zmieniła efektywnej granicy, zachować już zrealizowane sloty, aby nie dublować wiadomości.
4. Trwały unikalny klucz doręczenia `(companyId, effectiveEndsAt, offset, channel)` chroni panel i e-mail przy równoległych workerach, restarcie i ponowieniu. Wersja służy do odrzucenia starego zadania, a klucz do deduplikacji także po zmianie wersji. Po awarii każdy należny slot 7/1/0 nadal aktualnej granicy jest nadrabiany najwyżej raz na kanał; nie łączyć trzech zatwierdzonych terminów w jedno zdarzenie. Nie wysyłać zdarzeń dla firmy zarchiwizowanej. To techniczna realizacja D-07, a nie dodatkowy termin zatwierdzony przez właściciela.
5. Zapis intencji, statusu próby i audytu jest trwały. Potwierdzony sukces nie jest ponawiany. Niepewny wynik po timeout u dostawcy poczty wymaga klucza idempotencji dostawcy albo uzgodnienia rezultatu przed ponowną próbą; bez tego automatyczne ponowienie mogłoby wysłać duplikat i nie wolno deklarować ścisłego „najwyżej raz”. Treść doręczenia opisuje aktualny stan: jeśli trial wygasł przed 09:00 w dniu slotu 0, mówi o zakończonym trialu, nie obiecuje jeszcze działającej oferty.

## Przykłady graniczne dla QA

Wszystkie chwile UTC poniżej są obliczone dla `Europe/Warsaw` w 2026 r. i są fixture, nie dowodem uruchomienia aplikacji.

| Przypadek | Wyłączna granica i widoczność | Sloty 7 / 1 / 0 o 09:00 lokalnie (UTC) |
|---|---|---|
| Opłata do **29.03.2026** (zmiana CET→CEST, dzień 23 h) | `30.03 00:00 CEST = 29.03 22:00Z`; aktywna jeszcze 29.03 23:59 lokalnie | `22.03 08:00Z` / `28.03 08:00Z` / `29.03 07:00Z` |
| Opłata do **25.10.2026** (CEST→CET, dzień 25 h) | `26.10 00:00 CET = 25.10 23:00Z`; aktywna jeszcze 25.10 23:59 lokalnie | `18.10 07:00Z` / `24.10 07:00Z` / `25.10 08:00Z` |
| Trial od `22.03.2026 12:00 CET = 11:00Z` | `+336 h = 05.04 11:00Z = 13:00 CEST`; działa aż do tej wyłącznej chwili | `29.03 07:00Z` / `04.04 07:00Z` / `05.04 07:00Z` |
| Trial od `18.10.2026 12:00 CEST = 10:00Z` | `+336 h = 01.11 10:00Z = 11:00 CET`; działa aż do tej wyłącznej chwili | `25.10 08:00Z` / `31.10 08:00Z` / `01.11 08:00Z` |
| Trial od `15.03.2026 00:00 CET = 14.03 23:00Z`, koniec dokładnie o północy | `+336 h = 29.03 00:00 CET = 28.03 23:00Z`; od tej chwili już nie działa | `22.03 08:00Z` / `28.03 08:00Z` / **`29.03 07:00Z`**, czyli 09:00 w lokalnym dniu wygaśnięcia |
| Trial od `22.03.2026 07:00 CET = 06:00Z`, koniec przed 09:00 | `+336 h = 05.04 08:00 CEST = 06:00Z`; od tej chwili już nie działa | `29.03 07:00Z` / `04.04 07:00Z` / **`05.04 07:00Z`**, godzinę po wygaśnięciu |

W dwóch ostatnich przypadkach slot 0 pozostaje o 09:00 lokalnego dnia końca trialu, zgodnie z D-07. Tekst wiadomości mówi, że trial **już wygasł**; nie przedstawia go jako aktywnego ani nie przesuwa granicy widoczności do chwili wysyłki.

Przykład nakładania: 24.10.2026 trial kończy się `25.10 08:00Z`, a opłata `paidThrough=25.10.2026` kończy się `25.10 23:00Z`. O `25.10 08:00Z` trial wygasa, lecz opłata nadal działa; strona pozostaje publiczna, etykieta to „opłacono do 25.10.2026 włącznie”, KPI wynosi **1 płatne / 0 trial**, a jedyny slot 0 dotyczy opłaty (`25.10 08:00Z`, ta sama chwila granicy trialu). Wysyłka sprawdza bieżącą granicę opłaty, nie próbuje wyłączyć witryny po trialu.

Odwrotne nakładanie: trial z przykładu marcowego kończy się `05.04 11:00Z`, a opłata do 29.03 kończy się `29.03 22:00Z`. W trakcie obu okresów główna etykieta i KPI wskazują opłatę (**1 / 0**), lecz przypomnienia odnoszą się do późniejszego końca trialu (`29.03 07:00Z`, `04.04 07:00Z`, `05.04 07:00Z`). Po `29.03 22:00Z` publiczna strona nadal działa dzięki trialowi, a KPI zmienia się na **0 / 1**. Nie wysyłać drugiej serii dla wcześniejszego końca opłaty.

Przykład zmiany i retry: przedłużenie `paidThrough` z 25.10 na 31.10 po wysłaniu slotu −7 dla starej daty podnosi wersję. Stare sloty −1/0 są nieważne. Nowy slot −7 przypada 24.10 o 09:00: zapis o 08:59 tworzy należny slot na 09:00, a zapis o 09:01 nie wysyła go wstecz jako nowego przypomnienia. Jeżeli worker obudzi się po awarii 31.10, odczytuje nową wersję i nadrabia każdy należny slot **nowej** granicy najwyżej raz, bez e-maila o końcu 25.10. Skrócenie do daty już zakończonej usuwa publiczne uprawnienie od razu przy odczycie; nie czeka na job ani nie odbiera panelu.

Przykład aktywacji po opłacie: `paidThrough=22.10.2026`, pierwsza skuteczna rejestracja `23.10.2026 10:00 Europe/Warsaw`, trial nieprzyznany. Konto i panel działają, strona nie jest publiczna, KPI **0 / 0**, panel pokazuje komunikat D-11; ponowna aktywacja ani resend nie odnawiają opłaty. Jeśli trial był przyznany, startuje w tej rejestracji i strona może działać w jego okresie przy spełnieniu pozostałych bramek.

Dokument jest kontraktem dla późniejszej implementacji i QA. Repozytorium na tym etapie nie ma działającej aplikacji, schedulera, bazy ani testów runtime; przykłady można sprawdzić rachunkowo, a testy integracyjne należy wykonać w odpowiednich issue po scaffoldzie.
