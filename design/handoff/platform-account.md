# Konto superadmina — PLT-10

Ekran `/konto` należy wyłącznie do hosta platformy i tożsamości superadmina. Korzysta z nawigacji „Firmy”, „Wiadomości”, „Konto” i „Wyloguj”. Nie pokazuje firmy jako właściciela konta ani ustawień firmowych. W MVP jest dokładnie jeden superadmin; ekranu nie używa się do zapraszania kolejnych administratorów.

## Dane i akcje

| Obszar     | Widok i wejście                                                             | Wynik serwera                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dane konta | Nazwa edytowalna (1–100 znaków); e-mail i rola tylko do odczytu             | `POST /api/auth/profile` przyjmuje wyłącznie `{name}`. Saving blokuje ponowne wysłanie; sukces pokazuje zapisaną nazwę, błąd i konflikt zachowują wpisaną wartość.                                                         |
| Hasło      | Aktualne hasło i nowe hasło (12–256 znaków), z jawnym potwierdzeniem skutku | `POST /api/auth/password/change` wymaga pełnej sesji MFA. Sukces cofa wszystkie sesje, także bieżącą; ekran kieruje do logowania i ponownego MFA. Błędne hasło, walidacja, limit i utrata połączenia nie pokazują sukcesu. |
| MFA        | Obowiązkowy TOTP i jednorazowe kody odzyskania, bez akcji wyłączenia        | Ponowne wydanie kodów wymaga świeżego TOTP lub zużytego kodu odzyskania oraz hasła; aktualna pełna sesja nie wystarcza. Utrata obu czynników prowadzi do ręcznej procedury właściciela, bez samodzielnego obejścia.        |
| Wyloguj    | Akcja w menu użytkownika                                                    | Aplikacja czeka na serwerowe unieważnienie sesji przed przejściem do logowania; samo przejście prototypowe nie dowodzi wylogowania.                                                                                        |

Zarządzanie zespołem, drugie konto superadmina, wyłączenie MFA, zaufane urządzenie i ustawienia firmy pozostają poza tym ekranem. Sesje superadmina (D-43, [kontrakt #72](../../docs/contracts/account-operations.md)): ekran ma kartę z linkiem do listy własnych sesji, na której superadmin widzi je i kończy; makieta do dostosowania. Nie pokazujemy sekretu TOTP ani istniejącej listy kodów odzyskania. Nowa lista jest jednorazowa; utrata odpowiedzi wymaga świeżej weryfikacji według D-05.

## Stany formularzy do #19

| Stan                             | Zachowanie                                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Odczyt trwa / brak danych        | Szkielet lub neutralny loading; nie pokazuje cudzych danych ani domyślnego sukcesu.                                   |
| Zapis nazwy trwa                 | Zapis zablokowany do odpowiedzi; wpis pozostaje w polu.                                                               |
| Błąd walidacji / konflikt        | Komunikat przy właściwym polu albo formularzu, zachowany wpis i ponowienie dopiero po korekcie lub odświeżeniu stanu. |
| Zmiana hasła trwa                | Brak podwójnego żądania. Timeout pozostawia wynik niepewny; odczyt sesji rozstrzyga, czy trzeba wrócić do logowania.  |
| Hasło zmienione                  | Sesje są cofnięte przez serwer; komunikat o ponownym logowaniu, potem właściwy login platformy i MFA.                 |
| Brak połączenia / cofnięta sesja | Brak pozornego zapisu offline. Po cofnięciu sesji nie renderować prywatnych danych; wrócić do logowania.              |
| Utrata obu czynników             | Informacja o ręcznej procedurze właściciela, bez przycisku wyłączającego MFA lub wydającego kod bez dowodu.           |

## Makiety i odbiór

Kanoniczne boardy PLT-10 w pliku Penpota `b564c72c-f31f-81ec-8008-af198a313438`:

| Wariant | Strona scenariusza                     | Board `state=default`                  | Viewport       | Pozycja „Konto” w menu platformy                  |
| ------- | -------------------------------------- | -------------------------------------- | -------------- | ------------------------------------------------- |
| Mobile  | `fb4e1683-f05f-8095-8008-c755dff0027c` | `2e56f6bf-6ab4-8076-8008-dbd35ead5dc9` | 390 × 1689 px  | `89433e5c-4f5c-80ad-8008-d910ad0b1908` → PLT-10 M |
| Desktop | `fb4e1683-f05f-8095-8008-c755dff4dae6` | `315aa115-0a58-807f-8008-dbc2af057cc6` | 1440 × 1024 px | `89433e5c-4f5c-80ad-8008-d90d3f63bcc2` → PLT-10 D |

Referencją wyglądu są tokeny i nawigacja platformy; ADM-15 panelu firmy nie jest celem `/konto`. W obu wariantach „Firmy” wraca do PLT-01/02, „Wiadomości” do PLT-09, a menu profilu pozostaje wejściem do konta i wylogowania. „Wyloguj” ma jedynie prototypowe przejście do PLT-08.

Treść obu boardów („Platform … / Content”) to Flex/Auto Layout z instancjami DS: `Shared / Form/FormField` (Nazwa, hasła), `Shared / Action/Button` (główny i drugorzędny, z celami prototypu do 07I i 07C), karty i pigułka statusu MFA z ikoną Lucide check i obramowaniem; bez luźnych warstw absolutnych. ID boardów PLT-10 i cele nawigacji z menu nie zmieniły się; przyciski „Wydaj nowe kody” i „Nie mam obu czynników” są teraz instancjami Button z tymi samymi celami co wcześniej.

Istniejący ADM-15 Mobile `1e066793-8858-8051-8008-cf3e9586dccb` i Desktop `a4abf4c9-2e1f-80fd-8008-affaaf4fb733` pokazują układ profilu i bezpieczeństwa. Mają jednak firmową nawigację oraz zakładkę sesji, więc służą tylko jako źródło anatomii kart i pól. PLT-10 korzysta z menu platformy i nie przenosi danych firmy; zamiast firmowej zakładki sesji pokazuje kartę/link do sesji superadmina (D-43). Nazwa konta jest edytowalnym polem, e-mail i rola są prezentowane jako dane tylko do odczytu. Odrębne bloki hasła i MFA wyjaśniają skutek zmiany hasła oraz wymaganie świeżego czynnika przed wydaniem nowej listy kodów.

Widoczna treść kart: „Dane konta” z polem „Nazwa” i wartościami „Adres e-mail” oraz „Rola: Superadmin”; „Zmień hasło” z polami „Aktualne hasło”, „Nowe hasło” i „Potwierdź nowe hasło” oraz informacją „Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń”; „MFA” ze statusem „Włączone”, wyjaśnieniem jednorazowości kodów i akcją rozpoczęcia świeżej weryfikacji przed wydaniem nowych kodów. Wartości osobowe i e-mail w makiecie są fikcyjnym fixture, nie danymi właściciela.

### Oddzielny graf MFA platformy

PLT-10 prowadzi do poniższych **platformowych** wariantów na tej samej stronie scenariusza. Firmowy FLOW-MVP-02/07I→07J→07G i jego powroty pozostały bez zmian. W nowych boardach nie ma aktywnego celu panelu ani logowania firmy.

| Stan                                               | Mobile                                 | Desktop                                |
| -------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| 07I — świeży TOTP albo wejście do posiadanego kodu | `864f85f5-29a0-8019-8008-dbe13f10e885` | `864f85f5-29a0-8019-8008-dbdf7b325dfe` |
| 07J — hasło po świeżym TOTP                        | `864f85f5-29a0-8019-8008-dbe13f356630` | `864f85f5-29a0-8019-8008-dbdf7b59e9a0` |
| 07J1 — odmowa lub wygaśnięcie potwierdzenia        | `864f85f5-29a0-8019-8008-dbe13f6429e4` | `864f85f5-29a0-8019-8008-dbdf7b82bfc7` |
| 07D — posiadany kod odzyskania                     | `864f85f5-29a0-8019-8008-dbe14b0a0917` | `864f85f5-29a0-8019-8008-dbdf8b75f0c5` |
| 07D1 — błędny albo użyty kod                       | `864f85f5-29a0-8019-8008-dbe14b30c38f` | `864f85f5-29a0-8019-8008-dbdf8b9c7639` |
| 07D2 — sprawdzanie kodu                            | `864f85f5-29a0-8019-8008-dbe14b710566` | `864f85f5-29a0-8019-8008-dbdf8bcc60f2` |
| 07D3 — limit prób                                  | `864f85f5-29a0-8019-8008-dbe157f6998c` | `864f85f5-29a0-8019-8008-dbdf974962bc` |
| 07E — hasło po zużyciu kodu                        | `864f85f5-29a0-8019-8008-dbe158315e04` | `864f85f5-29a0-8019-8008-dbdf9779d0df` |
| 07 — nowa konfiguracja TOTP                        | `864f85f5-29a0-8019-8008-dbe1585fff06` | `864f85f5-29a0-8019-8008-dbdf97b559a4` |
| 07G — nowa jednorazowa lista                       | `864f85f5-29a0-8019-8008-dbe13f8ea83f` | `864f85f5-29a0-8019-8008-dbdf7bc136dc` |
| 07C — ręczna procedura po utracie obu czynników    | `864f85f5-29a0-8019-8008-dbe14abda07f` | `864f85f5-29a0-8019-8008-dbdf8b40da10` |

„Wydaj nowe kody” na PLT-10 → platformowe 07I. Świeży TOTP → 07J → 07G → PLT-10. „Użyj kodu odzyskania” na 07I (Mobile hit `864f85f5-29a0-8019-8008-dbe17fb4f6cd`, Desktop hit `864f85f5-29a0-8019-8008-dbe001a93088`) → 07D → 07E → nowy TOTP 07 → 07G → PLT-10. Wariant błędu 07D1 pozwala na ponowienie przez stan sprawdzania 07D2; limit 07D3 nie ma aktywnego przedwczesnego ponowienia. Wynik API wybiera stan, prototyp nie traktuje kliknięcia jako potwierdzenia serwera. 07J1 wraca do świeżego 07I. „Nie mam obu czynników” na PLT-10 i 07D → platformowe 07C; widoczny powrót 07C i powrót z ograniczonego enrollmentu prowadzą do PLT-08 właściwego viewportu. W pełnej sesji 07I i 07J1 wracają do PLT-10. Żaden krok nie tworzy dostępu do firmy.

Kopie odtworzeniowe PLT-10 przed korektą: Mobile `864f85f5-29a0-8019-8008-dbe1308ad51c`, Desktop `864f85f5-29a0-8019-8008-dbdf67f36d9c`; obie są ukryte. Kody i QR w makiecie są fikcyjnym fixture, nie danymi właściciela. Te przejścia nie potwierdzają świeżego czynnika ani nie wydają kodów same w sobie. Przyciski „Zapisz nazwę” i „Zmień hasło” są statycznymi wzorcami dla #19; w Penpocie nie pokazują fikcyjnego sukcesu ani nie udają zapisu na serwerze.

Penpot pokazuje układ, treść i prototypowe przejścia. #19 wdraża formularze, walidację, stan saving/error/konflikt, klawiaturę i fokus oraz integrację API. Odbiór wizualny obejrzał live PNG PLT-10 M/D oraz nowych 07I, 07C i 07 M/D, a także 07E D. Eksport całego 07E M zwrócił timeout; osobny PNG jego zmienionego tekstu 342 × 60 px pokazał pełne trzy wiersze, z 28 px odstępu do kolejnego pola. Pełny render 07E M pozostaje `not-run`. Pozostałe warianty są klonami istniejących wzorców z przepiętym grafem, bez zmian układu. VoiceOver pozostaje `DEFERRED` do #97; brak runtime w tej zmianie makiet oznacza `not-run`, nie sukces.
