# Polityka prywatności platformy Auterva

**SZKIC — do weryfikacji prawnej, nie publikować.** Autor szkicu nie jest prawnikiem; tekst nie jest opinią prawną ani deklaracją zgodności. Ostatnia aktualizacja szkicu: 2026-11-12 (data po publikacji ustawiana przez serwer, D-36).

## Założenia i miejsca do uzupełnienia (usunąć przed publikacją)

1. Administrator danych: `{nazwa i forma prawna operatora Autervy}`, `{adres}`, `{NIP/KRS}`, `{e-mail do spraw prywatności}`. Brak danych w repozytorium; zob. PUBLICATION_MATERIALS.md, warunek 1.
2. Rola Autervy: wobec danych kont administratorów i superadmina oraz czatu Auterva jest administratorem. Wobec danych, które firma wprowadza o swojej ofercie, a także wobec danych odwiedzających jej stronę publiczną, Auterva działa najpewniej jako podmiot przetwarzający dla firmy. Wymaga to umowy powierzenia (art. 28 RODO) i oceny prawnika.
3. Podstawy prawne poniżej to propozycje robocze (art. 6 ust. 1 lit. b, c, f), do potwierdzenia.
4. Dostawcy są niezatwierdzeni (D-53). Lista poniżej to kategorie z placeholderami.
5. Okresy przechowywania pochodzą z D-10 i kontraktów. Brak zatwierdzonego okresu dla treści czatu, kont po zakończeniu współpracy i danych firmy po archiwizacji (poza 30-dniowym oknem eksportu, E8). Oznaczone jako `{do decyzji}`.
6. Czy powołano inspektora ochrony danych: `{tak/nie}`.

## Kim jesteśmy

Auterva to platforma dla firm wynajmujących pojazdy. Pokazuje ich flotę i dostępność w publicznej ofercie oraz daje firmom panel. Administratorem danych opisanych w tej polityce jest `{operator}`, `{adres}`, kontakt: `{e-mail}`.

Auterva nie oferuje rezerwacji online ani płatności online i nie prowadzi kont klientów końcowych. Kontakt z firmą wynajmującą odbywa się telefonicznie, przez WhatsApp lub e-mail poza systemem.

## Czyich danych dotyczy ta polityka

- Osoby odwiedzające stronę Autervy (onepage).
- Osoby, które kontaktują się z nami w sprawie usługi (telefon, WhatsApp, e-mail).
- Administratorzy firm i superadmin, którzy logują się do paneli.
- Odwiedzający publiczne strony firm: ich dane obsługuje przede wszystkim firma, zob. polityka tej firmy; opisujemy tu tylko ich techniczną stronę.

## Jakie dane przetwarzamy i po co

| Cel | Dane | Podstawa (do potwierdzenia) | Okres przechowywania |
|---|---|---|---|
| Kontakt w sprawie usługi | dane podane w rozmowie, wiadomości WhatsApp lub e-mail (imię, nazwa firmy, numer, treść) | art. 6 ust. 1 lit. b lub f | `{do decyzji}` (np. czas rozmów i przedawnienie roszczeń) |
| Zaproszenie firmy | adres e-mail administratora, nazwa firmy, jednorazowy token (przechowujemy tylko jego skrót) | lit. b | do wykorzystania lub wygaśnięcia zaproszenia; adres zostaje jako konto |
| Konto administratora lub superadmina | imię, adres e-mail (unikalny w całej platformie), skrót hasła, status MFA, data utworzenia, powiązanie z firmą | lit. b, f | do końca współpracy i archiwizacji; potem `{do decyzji}` |
| Uwierzytelnianie dwuskładnikowe | sekret TOTP i kody odzyskania (chronione, nigdy nie wyświetlane ponownie) | lit. f, c (bezpieczeństwo) | do zmiany lub usunięcia konta |
| Sesje | identyfikator sesji, adres IP i opis urządzenia (user agent) zapisane przy sesji, czasy utworzenia i ostatniej aktywności, moment potwierdzenia MFA | lit. f | do wygaśnięcia lub zakończenia sesji; `{potwierdzić długość sesji w konfiguracji produkcyjnej}` |
| Reset hasła | żądanie resetu, skrót tokenu; token ważny 30 minut | lit. b, f | krótko, do wygaśnięcia |
| Limity żądań i ochrona przed nadużyciami | klucze liczników (skrót, nie jawny adres lub e-mail), znaczniki czasu | lit. f | do końca okna limitu (minuty do godziny) |
| Dziennik audytu | kto (identyfikator i rola), kiedy, jaka operacja, której firmy; bez haseł, tokenów i treści notatek | lit. f, c | 365 dni |
| Czat z superadminem | treść wiadomości (do 4000 znaków), statusy dostarczenia i odczytu, sygnał pisania (krótkotrwały, wygasa po 3 s; `{potwierdzić, że nie jest zapisywany}`), identyfikatory nadawcy; szkic wiadomości w pamięci przeglądarki do wylogowania | lit. b, f | `{do decyzji}` (brak zatwierdzonej retencji) |
| Dane firmy w panelu | opis firmy, kanały kontaktu, flota, zdjęcia, blokady dostępności z notatkami wewnętrznymi (niepubliczne) | lit. b | do archiwizacji i oknie eksportu; `{do decyzji}` |
| Wiadomości e-mail systemowe | adres odbiorcy i treść zaproszenia, resetu hasła lub przypomnienia o okresie usługi; treść i adres w kolejce są szyfrowane | lit. b, f | kolejka: po wysyłce zostaje tylko niesekretny skrót do rozliczenia |
| Pomiar wydajności strony (Web Vitals) | typ urządzenia (mobile/desktop), wartości LCP, INP, CLS i wzorzec trasy z zamkniętej listy; bez adresu URL, identyfikatora, cookie i adresu IP; nic nie jest wysyłane przy włączonym Do Not Track lub Global Privacy Control | lit. f | wyłącznie zagregowane liczniki w pamięci serwera; restart je zeruje |
| Logi techniczne | czas, identyfikator żądania, rola i identyfikator konta/firmy, operacja, wynik; bez haseł, tokenów, cookies, adresów e-mail i treści czatu | lit. f | 30 dni (logi bezpieczeństwa: 365 dni) |
| Kopie zapasowe | kopia bazy i mediów (szyfrowana) | lit. f, c | 30 dni |
| Eksport danych firmy | plik z danymi firmy dla jej administratora lub, na prośbę, przez superadmina | lit. b, c | okno 30 dni po archiwizacji lub zakończeniu współpracy; plik ma krótki termin ważności `{potwierdzić po wdrożeniu #328}` |
| Prywatny kalendarz iCal | token w adresie (przechowujemy skrót), etykieta; w feedzie tylko daty niedostępności pojazdów opublikowanych, bez typu blokady | lit. b | do odwołania; wygasa po 365 dniach od utworzenia lub rotacji `{funkcja w trakcie wdrażania}` |

Podanie danych do konta jest warunkiem korzystania z panelu. Nie prowadzimy profilowania ani zautomatyzowanych decyzji wywołujących skutki prawne.

## Cookies i podobne technologie

- Strony publiczne (onepage Autervy i strony firm) nie ustawiają cookies i nie ładują narzędzi śledzących ani reklamowych; serwer usuwa nagłówek cookie z żądań do tych stron.
- Panele (superadmina i firmy) używają wyłącznie niezbędnych cookies sesji i uwierzytelniania (Secure, HttpOnly, ograniczone do hosta). Nie wymagają zgody według obecnej oceny `{potwierdzić prawnie}`.
- W przeglądarce panelu zapisujemy lokalnie szkic wiadomości czatu i niewysłaną wiadomość do ponowienia; szkic jest usuwany przy wylogowaniu.
- Mapa na stronach firm to zwykły odnośnik do OpenStreetMap otwierany po kliknięciu; nie osadzamy map ani wideo. Odnośniki telefon, WhatsApp i e-mail uruchamiają aplikację zewnętrzną po kliknięciu; od tej chwili dane obsługuje jej dostawca.

## Komu przekazujemy dane

Dane mogą trafiać do dostawców, którzy działają na nasze zlecenie. Lista nie jest zatwierdzona (D-53):

| Kategoria | Dostawca | Zakres | Lokalizacja i transfer poza EOG |
|---|---|---|---|
| Hosting aplikacji i bazy | `{dostawca}` | wszystkie dane aplikacji | `{region; mechanizm transferu}` |
| Przechowywanie zdjęć | `{dostawca}` | zdjęcia ofert | `{…}` |
| DNS i TLS | `{dostawca}` | ruch HTTP, adresy IP | `{…}` |
| Poczta transakcyjna | `{dostawca}` | adres odbiorcy i treść wiadomości systemowych | `{…}` |
| Monitoring i alerty | `{dostawca}` | metryki bez danych osobowych | `{…}` |
| Komunikatory | WhatsApp i operatorzy telefonii, e-mail | tylko gdy sam się z nami kontaktujesz | zależnie od usługi |

Dane nie są sprzedawane. Dane firm nie są widoczne dla innych firm; każdy odczyt jest ograniczony do firmy i roli aktora.

## Twoje prawa

Masz prawo dostępu do danych, sprostowania, usunięcia, ograniczenia przetwarzania, sprzeciwu wobec przetwarzania opartego na uzasadnionym interesie oraz przenoszenia danych tam, gdzie ma zastosowanie. Napisz na `{e-mail}`. Masz też prawo wniesienia skargi do Prezesa Urzędu Ochrony Danych Osobowych. Administrator firmy może pobrać dane swojej firmy na prośbę, zgodnie z oknem eksportu.

## Bezpieczeństwo

Wymagamy MFA dla paneli, ograniczamy liczbę prób i sesji, szyfrujemy kopie i kolejkę poczty, oddzielamy dane firm i środowiska, a w logach nie zapisujemy haseł, tokenów ani treści rozmów. Opis ma charakter ogólny i nie jest gwarancją.

## Zmiany polityki

Datę ostatniej zmiany pokazujemy na stronie. O istotnych zmianach informujemy administratorów firm w panelu `{potwierdzić sposób}`.

## Pytania do właściciela i prawnika

1. Kto jest administratorem (podmiot, adres, IOD)? Czy Auterva jest podmiotem przetwarzającym dla firm w zakresie stron publicznych i czatu?
2. Retencja: treści czatu, konta po archiwizacji, dane firmy po 30-dniowym oknie eksportu, dokumentacja rozmów telefonicznych.
3. Czy zapisujemy IP i user agent przy sesji dłużej niż trwa sesja? Jaka jest długość sesji na produkcji (domyślna biblioteki Better Auth do potwierdzenia)?
4. Czy IP w logach ingress dostawcy hostingu wymaga osobnej wzmianki?
5. Czy Web Vitals bez identyfikatorów (z DNT/GPC) wymagają zgody według art. 173 Prawa telekomunikacyjnego, czy mieszczą się w wyjątku?
6. Wybór dostawców (D-53), umowy powierzenia, transfery poza EOG.
7. Czy wystarczy jedna polityka dla platformy, czy potrzebna osobna klauzula informacyjna dla rozmów telefonicznych i WhatsApp?
