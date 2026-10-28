# Konto superadmina — PLT-10

Ekran `/konto` należy wyłącznie do hosta platformy i tożsamości superadmina. Korzysta z nawigacji „Firmy”, „Wiadomości”, „Konto” i „Wyloguj”. Nie pokazuje firmy jako właściciela konta ani ustawień firmowych. W MVP jest dokładnie jeden superadmin; ekranu nie używa się do zapraszania kolejnych administratorów.

## Dane i akcje

| Obszar     | Widok i wejście                                                             | Wynik serwera                                                                                                                                                                                                              |
| ---------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dane konta | Nazwa edytowalna (1–100 znaków); e-mail i rola tylko do odczytu             | `POST /api/auth/profile` przyjmuje wyłącznie `{name}`. Saving blokuje ponowne wysłanie; sukces pokazuje zapisaną nazwę, błąd i konflikt zachowują wpisaną wartość.                                                         |
| Hasło      | Aktualne hasło i nowe hasło (12–256 znaków), z jawnym potwierdzeniem skutku | `POST /api/auth/password/change` wymaga pełnej sesji MFA. Sukces cofa wszystkie sesje, także bieżącą; ekran kieruje do logowania i ponownego MFA. Błędne hasło, walidacja, limit i utrata połączenia nie pokazują sukcesu. |
| MFA        | Obowiązkowy TOTP i jednorazowe kody odzyskania, bez akcji wyłączenia        | Ponowne wydanie kodów wymaga świeżego TOTP lub zużytego kodu odzyskania oraz hasła; aktualna pełna sesja nie wystarcza. Utrata obu czynników prowadzi do ręcznej procedury właściciela, bez samodzielnego obejścia.        |
| Wyloguj    | Akcja w menu użytkownika                                                    | Aplikacja czeka na serwerowe unieważnienie sesji przed przejściem do logowania; samo przejście prototypowe nie dowodzi wylogowania.                                                                                        |

Lista sesji, zarządzanie zespołem, drugie konto superadmina, wyłączenie MFA, zaufane urządzenie i ustawienia firmy pozostają poza tym ekranem. Nie pokazujemy sekretu TOTP ani istniejącej listy kodów odzyskania. Nowa lista jest jednorazowa; utrata odpowiedzi wymaga świeżej weryfikacji według D-05.

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
| Mobile  | `fb4e1683-f05f-8095-8008-c755dff0027c` | `2e56f6bf-6ab4-8076-8008-dbd35ead5dc9` | 390 × 1852 px  | `89433e5c-4f5c-80ad-8008-d910ad0b1908` → PLT-10 M |
| Desktop | `fb4e1683-f05f-8095-8008-c755dff4dae6` | `315aa115-0a58-807f-8008-dbc2af057cc6` | 1440 × 1024 px | `89433e5c-4f5c-80ad-8008-d90d3f63bcc2` → PLT-10 D |

Referencją wyglądu są tokeny i nawigacja platformy; ADM-15 panelu firmy nie jest celem `/konto`. W obu wariantach „Firmy” wraca do PLT-01/02, „Wiadomości” do PLT-09, a menu profilu pozostaje wejściem do konta i wylogowania. „Wyloguj” ma jedynie prototypowe przejście do PLT-08.

Istniejący ADM-15 Mobile `1e066793-8858-8051-8008-cf3e9586dccb` i Desktop `a4abf4c9-2e1f-80fd-8008-affaaf4fb733` pokazują układ profilu i bezpieczeństwa. Mają jednak firmową nawigację oraz zakładkę sesji, więc służą tylko jako źródło anatomii kart i pól. PLT-10 korzysta z menu platformy, nie przenosi zakładki sesji ani danych firmy. Nazwa konta jest edytowalnym polem, e-mail i rola są prezentowane jako dane tylko do odczytu. Odrębne bloki hasła i MFA wyjaśniają skutek zmiany hasła oraz wymaganie świeżego czynnika przed wydaniem nowej listy kodów.

Widoczna treść kart: „Dane konta” z polem „Nazwa” i wartościami „Adres e-mail” oraz „Rola: Superadmin”; „Zmień hasło” z polami „Aktualne hasło”, „Nowe hasło” i „Potwierdź nowe hasło” oraz informacją „Po zmianie hasła wylogujemy Cię ze wszystkich urządzeń”; „MFA” ze statusem „Włączone”, wyjaśnieniem jednorazowości kodów i akcją rozpoczęcia świeżej weryfikacji przed wydaniem nowych kodów. Wartości osobowe i e-mail w makiecie są fikcyjnym fixture, nie danymi właściciela.

Akcja „Wydaj nowe kody” prowadzi prototypowo do świeżej weryfikacji 07I: Mobile `89433e5c-4f5c-80ad-8008-d978bc2374d0`, Desktop `89433e5c-4f5c-80ad-8008-d97a4e1d6e10`. „Nie mam obu czynników” prowadzi do ręcznej ścieżki 07C: Mobile `4e2ad814-13be-80ec-8008-cc98f6937664`, Desktop `4e2ad814-13be-80ec-8008-cc96bbba80bb`. Te przejścia nie potwierdzają świeżego czynnika ani nie wydają kodów same w sobie. Przyciski „Zapisz nazwę” i „Zmień hasło” są statycznymi wzorcami dla #19; w Penpocie nie pokazują fikcyjnego sukcesu ani nie udają zapisu na serwerze.

Penpot pokazuje układ, treść i prototypowe przejścia. #19 wdraża formularze, walidację, stan saving/error/konflikt, klawiaturę i fokus oraz integrację API. Odbiór wizualny wymaga aktualnego renderu obu boardów; układ Mobile i Desktop obejrzano z live PNG po zapisach. Eksport Mobile raz zwrócił timeout, ponowienie po uproszczeniu ukrytej kopii zakończyło się poprawnie. VoiceOver pozostaje `DEFERRED` do #97; brak runtime w tej zmianie makiet oznacza `not-run`, nie sukces.
