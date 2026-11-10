# Eksport danych firmy i subskrypcja kalendarza: kontrakt discovery (#79)

Status: **zatwierdzone przez właściciela 10.11.2026 (D-40); niezaimplementowane**. Zatwierdzono rekomendacje E1–E7, E9 i E11–E14; E8 = 30 dni, E10 = nigdy (typ blokady nie trafia do prywatnego feedu). Zakres opcjonalny (COULD po stabilizacji, `docs/WYMAGANIA_AUTERVA.md` §10 „eksport kalendarza oraz danych firmy”), poza obowiązkowym MVP. Poniższe „rekomendacje” są teraz decyzjami właściciela w zakresie opisanym wyżej (sekcja 4 zapisuje rozstrzygnięcia). Osobne zadania BE i FE: sekcja 5; feed to #327, eksport to #328. Źródła: C-N006, C-N029, FR-SAS-024 (samoobsługowy eksport odłożony; bezpieczna operacyjna obsługa praw do danych pozostaje potrzebna), kontrakty [odczyty #33](availability-reads.md), [blokady #38](availability-blocks.md), [audyt](audit-append-and-access.md) i [retencja/eksport operatora](audit-retention-operations.md), [media](media-upload-processing.md), [archiwum i restore firmy #48](company-archive-restore.md), [okres usługi](service-period-runtime.md), [środowiska i backup](environments-hosts-operations.md), [runbook #60](../runbooks/backup-restore.md), [limity i MFA](technical-limits-and-mfa-bootstrap.md).

To dwie różne funkcje o różnym modelu zagrożeń; kontrakt rozdziela je i nie wiąże decyzji jednej z drugą.

| | (a) Jednorazowy eksport danych firmy | (b) Subskrypcja kalendarza (iCal) |
|---|---|---|
| Cel | Przeniesienie/kopia danych, prawa do danych | Podgląd zajętości w zewnętrznym kalendarzu (Google, Apple, Outlook) |
| Model dostępu | Uwierzytelniony aktor z pełnym MFA pobiera plik | Zewnętrzna aplikacja odpytuje adres bez sesji (bearer w URL) |
| Kontrola po wydaniu | Plik po pobraniu jest poza kontrolą; do tego czasu można go zablokować | Aplikacja zewnętrzna trzyma kopię i URL; odwołanie działa tylko dla przyszłych odczytów |
| Główne ryzyko | Wyciek całego zestawu danych firmy | Wyciek URL (logi, historia przeglądarki, udostępnienie kalendarza), nieaktualny cache klienta |
| Dane | Szerokie, prywatne (dla właściciela danych) | Wąskie, minimalne (zajęty/wolny, pojazd) |

Wspólne niezmienniki (każdy wariant je przejmuje): aktor, rola, firma i stan konta sprawdzane po stronie serwera w każdej operacji (host, proxy i ukryty przycisk nie zastępują autoryzacji); izolacja firm obejmuje DB, media, cache, jobs i pliki eksportu (klucz storage zawiera firmę i jest sprawdzany przy odczycie); `LocalDate`/SQL DATE z końcami włącznie i „dzisiaj” w `Europe/Warsaw` (`availabilityToday`), czas zdarzeń audytu w UTC; odpowiedzi prywatne `no-store` z `X-Request-Id`; brak `internalNote`, `reference`, typu i danych technicznych blokady w czymkolwiek publicznym; obca/nieistniejąca/odwołana rzecz daje jednolite `404`, które nie zdradza, że zasób istnieje (jak w C-N006); superadmin działa wyłącznie jako własny aktor w jawnym kontekście jednej firmy, nie ma eksportu „wszystkich firm” ani impersonacji.

## 1. Eksport danych firmy (a)

### 1.1 Kto i kiedy

| Wariant | Opis | Koszt | Ryzyko |
|---|---|---|---|
| **A1. Admin firmy i superadmin w kontekście firmy (rekomendacja)** | Ta sama bramka co zapisy panelu: host `COMPANY_ADMIN` albo `PLATFORM` z jawną firmą, pełne MFA, rola, `Origin`; dodatkowo świeży dowód reauth (nowe `purpose`, np. `export-company-data`, jednorazowy, 5 min, jak w [account-operations](account-operations.md)). | Rozszerzenie mechanizmu reauth o jeden cel; jeden use case wspólny dla obu aktorów. | Admin z przejętą sesją potrzebuje jeszcze drugiego czynnika; ryzyko niskie. |
| A2. Tylko superadmin na prośbę firmy | Operacyjna obsługa praw do danych (FR-SAS-024) bez ekranu firmy. | Najmniejszy: bez UI firmy, tylko operacja platformy. | Firma jest zależna od operatora, brak samoobsługi; superadmin staje się wąskim gardłem; wymaga weryfikacji tożsamości zgłaszającego poza systemem. |
| A3. Skrypt operatora (jak `backup-restore.ts`) | Bez API aplikacji, uruchamia operator z kluczem. | Bardzo mały kod; zero powierzchni HTTP. | Brak audytu aplikacyjnego i uprawnień aktora; nie nadaje się do rutyny; zgodność z FR-SAS-024 tylko „ręcznie”. |

Rekomendacja: **A1**, a A3 jako awaryjna ścieżka operatora dla firmy po archiwizacji i dla rozmów z klientem, który stracił dostęp (E1).

### 1.2 Zakres pól (minimalizacja)

Domyślna zasada: eksport zawiera dane **wprowadzone przez firmę i jej własne**, bez sekretów, bez danych innych firm i bez danych technicznych operatora. Poziomy:

| Pozycja | Zawartość | Rekomendacja |
|---|---|---|
| Firma i ustawienia | nazwa, dane kontaktowe i teksty z `SiteSettings`, publiczne media (logo itp. jako pliki), wybrane hosty/alias publiczny (bez tokenów weryfikacji DNS i diagnostyki) | TAK |
| Flota | pola pojazdu (nazwa, opis, parametry, kategoria/cechy, status, daty aktywności, kolejność, slug) | TAK |
| Zdjęcia pojazdów | metadane (kolejność, cover, alt) w JSON; same pliki jako **osobna opcjonalna paczka** (wariant 1.3) | metadane TAK, pliki wariantowo |
| Blokady dostępności | `from`, `to`, typ, `reference`, `internalNote`, źródło, wersja | TAK (to dane firmy; plik trafia wyłącznie do jej admina, nie jest publiczny) |
| Okres usługi | daty trialu i `paidThrough`, bez `periodVersion` i wewnętrznych flag publikacji | do decyzji (E4) |
| Konto administratora | e-mail, imię, rola, data utworzenia, status MFA (tak/nie) | minimalnie TAK (to dane osobowe osoby żądającej; art. 15/20 RODO) |
| Audyt firmy | bezpieczna projekcja allowlisty (jak panel audytu) za ostatnie 365 dni | wariantowo (E4) |
| Czat superadmin–firma | wiadomości firmy z tej konwersacji | wariantowo (E4); rozmowa jest wspólna ze stroną platformy |
| Nigdy | hasła i hashe, sekrety TOTP, kody odzyskania, sesje, tokeny (zaproszenia, reset, feed), klucze, `Job`/outbox/receipty, `AuditOperatorExport`, `RateLimitEvent`, diagnostyka DNS/TLS, dane innych firm, dane platformy (`PlatformLegalDocument`), `internalNote` innych kont | NIE |

Kontakt z publicznej oferty nie tworzy klienta ani zapisu (C-F107); w schemacie nie ma modelu zgłoszeń kontaktowych, więc eksport nie zawiera danych klientów końcowych (do ponownej weryfikacji na kodzie w zadaniu BE).

### 1.3 Format i paczka

| Wariant | Opis | Koszt | Ryzyko |
|---|---|---|---|
| **F1. ZIP: JSON z wersją schematu + CSV dla floty i blokad (rekomendacja)** | `manifest.json` (wersja schematu, `generatedAt` UTC, liczności, SHA-256 plików), `company.json`, `vehicles.json`/`.csv`, `blocks.json`/`.csv` (daty w ISO `YYYY-MM-DD`, bez godzin i stref), opcjonalnie `audit.json`. | Serializatory + test schematu; strumieniowy ZIP. | CSV podatny na wstrzyknięcie formuł w Excelu (`=`, `+`, `-`, `@`, TAB, CR na początku komórki): wymagany prefiks apostrofu lub cudzysłów i test; rozdzielacz i kodowanie (UTF-8 z BOM, `;` dla Excela PL) do potwierdzenia. |
| F2. Sam JSON | Najprostszy, maszynowy. | Najmniejszy. | Mniej wygodny dla właściciela firmy; brak CSV do arkusza. |
| F3. Pełny zrzut DB firmy (SQL/`pg_dump` fragment) | Przenoszenie 1:1. | Duży; zależny od schematu. | Wyciek pól technicznych i sekretów, brak minimalizacji; **odrzucone**. |
| Media: M1 metadane + linki | Bez plików zdjęć. | Mały. | Linki wygasną po archiwizacji; nie jest to przenoszenie danych. |
| **Media: M2 osobna paczka ZIP zdjęć (rekomendacja jako opcja)** | Oryginały lub warianty; osobne zadanie, ciężkie. | Rząd wielkości: 100 pojazdów × 30 zdjęć × 10 MB to teoretyczne 30 GB (limity D-04), fixture kosztowy 20 GB; wymaga limitu rozmiaru i czasu. | Obciążenie storage i transferu; potrzebny budżet i limit jednoczesnych eksportów. |

Rekomendacja: **F1**; zdjęcia: M1 w pierwszym kroku i M2 jako osobne, późniejsze zadanie (E3).

### 1.4 Wydanie pliku, limity i retencja

Eksport jest zadaniem asynchronicznym (`Job` z kontekstem firmy, kluczem idempotencji i audytem; nie w czasie żądania HTTP) i korzysta z wzorca eksportu audytu operatora: stan `PENDING`/`READY`/`FAILED`/`EXPIRED`/`DELETED`, szyfrowanie AES-256-GCM, digest i termin w bazie, odczyt po terminie odmawia niezależnie od stanu pliku, sweep najpierw oznacza `DELETED`, potem usuwa bajty, `PENDING`/`FAILED` sprzątane po 5 minutach.

| Punkt | Wariant | Koszt/ryzyko | Rekomendacja |
|---|---|---|---|
| Pobranie | **P1. Uwierzytelnione `GET` (sesja, MFA, rola, firma, stan konta, ten sam aktor co żądający lub dowolny admin tej firmy)**; P2. jednorazowy podpisany link (bearer) ważny kilka minut | P1 wymaga sesji (bezpieczniej, brak URL do wycieku); P2 wygodniejszy, ale link w logach/mailu jest bearerem na całe dane firmy | **P1** (E5) |
| Spójność odczytu | Transakcja `REPEATABLE READ` tylko do odczytu (jak backup #60), jedna firma | Brak anomalii między flotą a blokadami; krótkie trzymanie snapshotu | wymagane |
| Termin ważności pliku | 1 h, **24 h** (jak eksport audytu), 7 dni | Dłuższy = większe okno wycieku z magazynu; krótszy = konieczność ponawiania | 24 h od `READY` (E6) |
| Liczba pobrań | bez limitu w terminie / jednorazowo / 3 razy | Jednorazowość utrudnia retry po zerwanym połączeniu | wiele pobrań w terminie, każde audytowane |
| Limity żądań | jeden aktywny eksport na firmę; najwyżej 3 żądania na firmę na dobę; zapis w budżecie zapisów 60/min; plik do ustalonego limitu rozmiaru | Chroni przed kosztem i nadużyciem; ostrożnie zaniżony limit potrafi odmówić dużej firmie | jak obok; liczby do potwierdzenia (E6) |
| Powiadomienie | brak / e-mail „eksport gotowy” bez linku | E-mail do admina to dodatkowe wyjście danych (i outbox); bez linku mniej ryzykowny | **brak w pierwszym kroku**; status widoczny w panelu (E7) |
| Audyt | `EXPORT_REQUESTED`, `EXPORT_READY`/`EXPORT_FAILED`, `EXPORT_DOWNLOADED`, `EXPORT_EXPIRED` (aktor, firma, zakres/opcje, liczności, digest; nigdy treści, nazw plików z danymi osobowymi ani URL) w tej samej transakcji co zmiana stanu | Wymaga nowych akcji audytu (migracja enum) i wpisu w allowliście `safeChanges` | wymagane |

Plik eksportu leży w prywatnym storage z prefiksem firmy i nie wchodzi do kopii zapasowych (osobny prefiks poza zakresem `backup`) ani do publicznych mediów. Gdyby jednak trafił do kopii, odtworzenie (#60) nie może wskrzesić wygasłego eksportu: wiersze eksportu mają termin, a odczyt po terminie odmawia niezależnie od pliku; `restore-company` oznacza otwarte eksporty firmy jako `EXPIRED` (analogicznie do blokady kont po restore, `COMPANY_RESTORED_FROM_BACKUP`).

### 1.5 Okres usługi, archiwizacja, restore

| Stan firmy | Zachowanie (rekomendacja) | Uzasadnienie |
|---|---|---|
| Okres usługi ważny | Eksport dostępny dla admina i superadmina | normalny stan |
| Okres wygasły (trial/opłata), firma niearchiwalna | **Eksport nadal dostępny** dla admina (panel działa, AGENTS: „po wygaśnięciu panel firmy nadal działa”) | Firma, która kończy współpracę, ma zabrać dane; blokada wzmocniłaby presję płatniczą kosztem praw do danych |
| Zarchiwizowana | Admin: brak (sesja i login zablokowane, `requireAuditActor` odmawia); superadmin: może zażądać eksportu w kontekście archiwum jako własny aktor, z `context: "ARCHIVED_COMPANY"` (spójne z D-23) | Dane nie są usuwane (brak ścieżki purge); to ścieżka obsługi praw do danych po zamknięciu konta |
| Przywrócona z archiwum (#48) | Eksporty `READY` z czasu archiwum wygasają wg terminu; nowy eksport wymaga zalogowania z MFA | Przywrócenie nie przywraca sesji ani challenge |
| Odtworzona z kopii (#60 `restore-company`) | Otwarte eksporty `EXPIRED`; konta zablokowane do odblokowania operatora | Brak wskrzeszenia wygasłych danych |
| Po „zakończeniu współpracy” | Retencja danych firmy po zakończeniu nie jest zdefiniowana (brak operacji kasowania); historyczna liczba v2 „eksport min. 30 dni po zakończeniu” jest niezatwierdzona i tu jest wyłącznie propozycją | wymaga decyzji (E8) |

## 2. Subskrypcja kalendarza (b)

Subskrypcja to plik iCalendar (RFC 5545) pobierany cyklicznie przez zewnętrzną aplikację pod stałym adresem. Aplikacje zewnętrzne zwykle nie wysyłają ciasteczek ani nagłówków, więc **jedynym uwierzytelnieniem jest sekret w adresie** (bearer). To determinuje projekt: minimalne dane, odwołanie, wygasanie i brak sekretu w logach.

### 2.1 Publiczny czy prywatny

| Wariant | Opis | Koszt | Ryzyko |
|---|---|---|---|
| **S0. Bez publicznego feedu (rekomendacja)** | Publiczny kalendarz zostaje `GET .../calendar` (#33) w UI; nie ma publicznego `.ics`. | Zero. | Klient nie zasubskrybuje kalendarza pojazdu w swojej aplikacji; brak zgłoszonego wymagania. |
| S1. Publiczny feed per pojazd | `GET /api/public/vehicles/{slug}/calendar.ics` bez tokena; tylko zakresy niedostępne (łączone sąsiednie dni), od dziś do +365 dni, tytuł „Niedostępny”. Te same bramki co `calendar` (host publiczny, widoczność `PUBLISHED`, okres usługi, archiwum). | Mały: ta sama reguła dostępności co #33. | Klient końcowy dostaje kopię stanu na wiele godzin (klient kalendarza trzyma cache): nie wolno uznać za „aktualne” (niezmiennik świeżości); kolejny kanał scrapingu (ten sam poziom szczegółu co dzisiejszy kalendarz); brak możliwości odwołania innej niż ukrycie pojazdu. Typ/powód/`reference`/`internalNote` nie występują. |
| S2. Prywatny feed firmy (token) | Dla admina firmy: zajętość całej floty lub wybranych pojazdów w jego kalendarzu (patrz 2.2). | Średni: tokeny, rotacja, limity, audyt. | Wyciek URL daje dostęp do danych prywatnych floty (w minimalnej wersji: wyłącznie daty i nazwa pojazdu). |

Rekomendacja: **S0 plus S2**; publiczny feed (S1) tylko jeśli właściciel wskaże potrzebę (E9). Zasada dla obu: dowolny feed publiczny zawiera wyłącznie to, co dziś `GET calendar`, plus nazwę pojazdu publikowaną; nigdy typ, `reference`, `internalNote`, wersję, `id` blokady, źródło, ani informację, czy luka wynika z blokady czy z aktywności.

### 2.2 Zawartość prywatnego feedu (minimalizacja i typ blokady)

| Wariant | Treść zdarzenia | Ryzyko |
|---|---|---|
| **Z1. Tylko zajętość (rekomendacja)** | `SUMMARY: Zajęty — {nazwa pojazdu}`, całodniowe, bez opisu i typu | Typ i powód blokady nie opuszczają Autervy; wystarczy do planowania. |
| Z2. Zajętość + etykieta typu (odrzucone w E10) | `SUMMARY: Serwis — {pojazd}` (`typeLabel` jak w panelu: RESERVED/MAINTENANCE/BLOCKED/OTHER) | Typ trafia do dostawców kalendarza (Google/Apple/Microsoft), do współdzielonych kalendarzy i ich kopii; `RESERVED` może ujawnić fakt zarezerwowania poza Autervą; dłużej żyje poza naszą kontrolą. Wartość dla admina: odróżnia serwis od urlopu. |
| Z3. Z2 + `reference` i `internalNote` w opisie | Pełne dane blokady | **Odrzucone**: najwrażliwsze pola, kopiowane do cudzych serwerów, a adres feedu jest tylko bearerem. |

Decyzja: **zatwierdzone Z1 (E10, 10.11.2026)**: typ blokady nigdy nie trafia do feedu, ani prywatnego, ani publicznego; Z2 jest odrzucone, więc nie ma opcji `includeTypeLabel`. Z3 nie wchodzi w grę.

Format zdarzeń: `DTSTART;VALUE=DATE:YYYYMMDD` i `DTEND;VALUE=DATE:` **dzień po `to`** (RFC 5545: koniec wyłączny, a nasze `to` jest włączne; test na jeden dzień, granicę miesiąca, rok przestępny 28–29.02); wartości DATE, więc bez `VTIMEZONE` i bez DST; `DTSTAMP` UTC; `UID` stabilny i nieujawniający identyfikatorów (np. HMAC kluczem serwera z `id` blokady i firmy); `SEQUENCE` z wersji blokady; `TRANSP:OPAQUE`; folding wierszy do 75 oktetów i escape `, ; \ \n` w nazwach pojazdów (wejście pochodzi od użytkownika; test na wstrzyknięcie `\r\n` i `BEGIN:VEVENT`). Okno: od dziś (`Europe/Warsaw`) do +365 dni, stały limit liczby zdarzeń (np. 5000, ostrzeżenie w nagłówku `X-`/logu, nie obcinanie po cichu).

### 2.3 Adres, token, odwołanie i wygasanie

| Punkt | Wariant | Koszt/ryzyko | Rekomendacja |
|---|---|---|---|
| Postać tokena | **Token w ścieżce** `/api/calendar/feed/{token}.ics`; token w query | Ścieżka jest rzadziej logowana niż query przez zewnętrzne narzędzia, ale i tak trafia do logów ingress i historii; redakcja logów (`monitoring-alerts.md`) maskuje hex 32+ i parametry `token|code|secret|key`, trzeba dodać wzorzec ścieżki feedu | token w ścieżce, 256 bitów losowych (base64url), pokazywany **raz** przy tworzeniu |
| Przechowywanie | Hash (SHA-256) w bazie, bez wartości jawnej; odczyt przez porównanie stałoczasowe po wyszukaniu hasha | Utrata tokena = rotacja (nie ma „odczytaj ponownie”); brak sekretu w backupie | tak |
| Zakres tokena | firma + aktor tworzący + lista pojazdów lub „cała flota”; każdy token ma etykietę | Ograniczony rozmiar szkód przy wycieku | tak; limit np. 5 aktywnych tokenów na firmę (E11) |
| Host | Feed pod hostem publicznym firmy lub hostem platformy/panelu | Host publiczny miesza obszar prywatnych danych z publicznym i rozmywa regułę „prywatne tylko na hoście panelu”; host panelu jest wyłącznie dla zalogowanych (cookie, SameSite) i bywa niedostępny dla klientów kalendarza z innych sieci; **osobny host/ścieżka tylko dla feedu** wymaga wpisu w proxy/allowliście | do ustalenia w zadaniu BE po decyzji E11 (wymaga zgody operatora na allowlistę hosta) |
| Rotacja | Nowy token unieważnia stary natychmiast (atomowo w jednej transakcji) | Wymusza ponowną subskrypcję u wszystkich klientów | tak, ręczna przez admina |
| Odwołanie | Ręczne (admin/superadmin) i automatyczne przy: wyłączeniu/zmianie roli aktora tworzącego, zmianie e-maila lub resecie hasła tworzącego (opcjonalnie), archiwizacji firmy, restore z kopii (#60) | Bez automatu przejęte konto zostawia działającą tylną furtkę | wymagane: konto wyłączone, archiwizacja, restore; zmiana hasła wg E12 |
| Wygasanie | Bez terminu / 90 dni z odnowieniem / 365 dni | Brak terminu to wieczny bearer; krótki termin zrywa subskrypcje po cichu (klienci kalendarza często nie pokazują błędu, kalendarz po prostu przestaje się odświeżać) | **365 dni** od utworzenia lub ostatniej rotacji, przypomnienie w panelu 30 dni przed (E11) |
| Odpowiedź po odwołaniu/wygaśnięciu | `404` (nie `401`/`410`) identycznie jak dla nieistniejącego tokena, `no-store`, pusty `text/plain`; bez rozróżnienia powodów | Nie ujawnia, że token istniał; klienci kalendarza zwykle zatrzymują zawartość z poprzedniego pobrania, więc **istniejącej kopii nie uznajemy za usuniętą** | tak |
| Limity | Limit na adres klienta przed wyszukaniem tokena (zapobiega zgadywaniu: np. 60/min na zaufany adres, jak publiczne odczyty) i osobny limit na token (np. 30/h; klienci odpytują co 15 min–24 h) | Zbyt niski limit zrywa legalne odświeżanie; zbyt wysoki ułatwia skanowanie | liczby do potwierdzenia w zadaniu BE na teście obciążenia |

### 2.4 Okres usługi, archiwizacja i dane feedu

| Stan | Prywatny feed (rekomendacja) | Uzasadnienie |
|---|---|---|
| Okres ważny | Działa | normalny stan |
| Okres wygasły | **Działa** (panel działa; feed jest przedłużeniem panelu, nie publicznej oferty) | AGENTS: okres steruje publikacją strony, nie panelem |
| Zarchiwizowana | **`404`**, wszystkie tokeny odwołane trwale | Archiwizacja blokuje login i sesje; feed jest dostępem bez sesji, więc musi zniknąć razem z nimi; po restore (#48) tokeny nie wracają (jak sesje) i admin tworzy nowe |
| Odtworzona z kopii (#60) | Tokeny odwołane, hash tokenów z kopii nie wskrzesza dostępu | Analogia do blokady kont po restore: odtworzenie starej bazy nie może reaktywować odwołanych tokenów |
| Zmiana blokady | Następny odczyt feedu czyta bieżące rekordy (brak cache aplikacyjnego, `Cache-Control: private, no-store`); zewnętrzny klient i tak może trzymać stare dane przez godziny | niezmiennik „nie zwracać starego pozytywnego wyniku” dotyczy naszego serwera, nie cudzych cache; feed nie jest źródłem prawdy o dostępności i nie wolno go używać do decyzji o wolnym terminie |
| Publiczny feed S1 (jeśli powstanie) | Zamknięty, gdy zamknięta jest publiczna strona (`resolvePublicVisibility`: okres, archiwum, odblokowanie po restore) | Ta sama brama co `calendar` |

`ETag`/`If-None-Match` i `304` są dozwolone tylko wtedy, gdy ETag wynika z aktualnego stanu bazy (hash zawartości liczony po odczycie); `Cache-Control: no-store` wyklucza cache pośredników, a nie ponowną walidację u klienta, więc `ETag` jest tu optymalizacją transferu, nie cache wyniku. Brak `Last-Modified` zgadywanego z czasu żądania. Odpowiedź niesie `Content-Type: text/calendar; charset=utf-8`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`, `Referrer-Policy: no-referrer`, `X-Request-Id`, bez ciasteczek.

## 3. Bezpieczeństwo, audyt i testy wspólne

- Audyt: `CALENDAR_FEED_CREATED`, `_ROTATED`, `_REVOKED`, `_EXPIRED` (zdarzenie systemowe, jeden wpis przy pierwszym odrzuconym odczycie lub przez sweep), `EXPORT_*` z sekcji 1.4; `safeChanges` bez tokena, hasha, URL, typu i notatek; pierwsze użycie tokena (`last_used_at`) zapisywane w bazie bez adresu IP w jawnej postaci. Odczyty feedu nie są audytowane pojedynczo (hałas); wskaźniki ruchu idą do metryk (`auterva_*`).
- Tokeny i URL nigdy nie trafiają do logów aplikacji, metryk ani śladów; test redakcji (jak dla zaproszeń) na ścieżkę feedu.
- Izolacja A/B: token firmy A nie zwraca nic dla B nawet po podmianie `id`; obce pojazdy z listy zakresu tokena są pomijane; eksport firmy A nie zawiera wiersza B (test na zasianej bazie z dwiema firmami, jak regresja #172).
- Testy do wdrożenia: jeden dzień i granice włączne→wyłączne, rok przestępny, DST (zamrożony zegar), ukryty/`UNPUBLISHED`/`ARCHIVED` pojazd, firma wygasła i zarchiwizowana, restore z kopii (#60) nie wskrzesza tokenu ani eksportu, rotacja natychmiast unieważnia stary, równoległa rotacja i odczyt, brak `internalNote`/`reference`/typu w treści feedu (skan całego pliku, także po ucieczce znaków), wstrzyknięcie CRLF w nazwie pojazdu, wstrzyknięcie formuł w CSV, limit rozmiaru i liczby żądań eksportu, odczyt eksportu po terminie, pobranie cudzego eksportu (`404`).
- Ograniczenia, których kontrakt nie obiecuje: nie da się cofnąć kopii, którą zewnętrzny kalendarz lub użytkownik już pobrał; nie weryfikujemy, kto trzyma URL feedu; nie wysyłamy zaproszeń iCal (`METHOD:PUBLISH`, bez `ATTENDEE`/`ORGANIZER`); brak zapisu z kalendarza zewnętrznego (tylko odczyt; import blokad z zewnątrz jest poza zakresem i wymaga osobnej decyzji produktowej).

## 4. Pytania decyzyjne dla właściciela (E1–E14)

Każde pytanie ma rekomendację wykonawcy; właściciel zatwierdził 10.11.2026 rekomendacje E1–E7, E9 i E11–E14, a E8 i E10 rozstrzygnął jak niżej. Pytania E1–E8 dotyczą eksportu (a), E9–E12 kalendarza (b), E13–E14 wspólne.

| ID | Pytanie | Rekomendacja |
|---|---|---|
| **E1** | Kto może uruchomić eksport danych firmy: admin firmy i superadmin w kontekście firmy (A1), tylko superadmin (A2), czy tylko skrypt operatora (A3)? | A1, ze świeżym reauth MFA; A3 awaryjnie |
| **E2** | Format paczki: ZIP z JSON z wersją schematu i CSV (F1), sam JSON (F2)? Rozdzielacz/kodowanie CSV dla Excela PL (UTF-8 z BOM, `;`)? | F1, CSV z ochroną przed wstrzyknięciem formuł |
| **E3** | Zdjęcia pojazdów w pierwszym kroku: tylko metadane (M1), czy osobna paczka plików (M2) w osobnym zadaniu z limitem rozmiaru? | M1 teraz, M2 później |
| **E4** | Zakres pól: czy dołączyć okres usługi, audyt firmy (365 dni) i wiadomości czatu superadmin–firma? Czy `internalNote`/`reference` blokad są w eksporcie dla admina? | Blokady z `internalNote`/`reference`: TAK; okres usługi: TAK (daty); audyt i czat: NIE w pierwszym kroku |
| **E5** | Pobranie wyłącznie przez uwierzytelnione `GET` (P1), czy podpisany link (P2)? | P1 |
| **E6** | Termin ważności pliku (24 h?), liczba żądań (1 aktywny, do 3 na dobę?) i maksymalny rozmiar paczki — jakie liczby przyjmujemy? | 24 h od `READY`, 1 aktywny, 3/dobę, limit rozmiaru po pomiarze |
| **E7** | Czy wysyłamy e-mail „eksport gotowy” (bez linku) do admina? | Nie w pierwszym kroku |
| **E8** | Retencja danych firmy po zakończeniu współpracy i okno obsługi eksportu po archiwizacji: ile dni, kto inicjuje (superadmin na prośbę)? Czy zatwierdzamy 30 dni jako liczbę, a nie tylko jako historyczną propozycję v2? | Superadmin eksportuje w archiwum na prośbę; **Zatwierdzone 10.11.2026: 30 dni** (okno eksportu na prośbę po archiwizacji lub zakończeniu współpracy; inicjuje superadmin) |
| **E9** | Czy potrzebny jest publiczny feed iCal (S1), czy zostajemy przy kalendarzu w UI (S0)? | S0; S1 tylko przy zgłoszonym wymaganiu, wtedy wyłącznie „Niedostępny” |
| **E10** | Czy prywatny feed może zawierać etykietę typu blokady (Z2) jako opcję włączaną przez admina, czy nigdy (Z1)? `reference`/`internalNote` nigdy (Z3 odrzucone) — potwierdzić. | **Zatwierdzone 10.11.2026: nigdy** (Z1; bez opcji Z2); `reference`/`internalNote` nigdy |
| **E11** | Model tokenów prywatnego feedu: ścieżka, hash w bazie, zakres (cała flota/pojazdy), limit aktywnych tokenów (5?), wygasanie (365 dni z przypomnieniem?), host feedu (host publiczny firmy czy dedykowany host/ścieżka)? | Token 256 bit w ścieżce, hash, 5 tokenów, 365 dni, dedykowana ścieżka; host do uzgodnienia z operatorem |
| **E12** | Które zdarzenia kont odwołują tokeny automatycznie: wyłączenie konta/rola (tak), archiwizacja i restore (tak), zmiana lub reset hasła tworzącego (czy też)? Czy superadmin może tworzyć feed w kontekście firmy (token związany z jego kontem), czy tylko admin firmy? | Konto wyłączone, archiwizacja, restore: tak; reset hasła: tak (bezpieczniej, koszt: ponowna subskrypcja); feed tylko dla admina firmy w pierwszym kroku |
| **E13** | Czy okres usługi (wygaśnięcie) ma wpływać na prywatny feed i eksport admina? | Nie: panel działa, więc eksport i prywatny feed działają; wpływa tylko na publiczne |
| **E14** | Priorytet i kolejność: najpierw eksport (a) czy kalendarz (b)? Czy oba zostają COULD po stabilizacji i po #57/#60 w produkcji? | Najpierw (b) S2/Z1 (mniejszy, prywatny, wąski), potem (a) F1/M1; (a) po chronionym storage z #60 |

## 5. Podział na zadania po decyzji

Kolejność zatwierdzona przez właściciela (D-40): najpierw prywatny feed [#327](https://github.com/KarolR2001/Auterva/issues/327) (tokeny, endpoint `.ics`, ekran „Kalendarz zewnętrzny”), potem eksport danych firmy [#328](https://github.com/KarolR2001/Auterva/issues/328). Wiersze z publicznym feedem (E9 = S0) i opcją Z2 (E10) są bezprzedmiotowe.

| Zadanie | Rola | Zależności | Kryterium QA |
|---|---|---|---|
| BE: tokeny prywatnego feedu (model `CalendarFeedToken`, migracja addytywna, hash, tworzenie/rotacja/odwołanie, wygasanie, audyt, odwołanie przy archiwizacji/restore/wyłączeniu konta) | Backend | E9–E13; #38, #48, #60 | Odczyt po rotacji i odwołaniu to `404`; restore nie wskrzesza; brak tokena i hasha w logach/audytach; izolacja A/B |
| BE: endpoint `.ics` (generator RFC 5545, DATE z wyłącznym końcem, escape/fold, okno 365 dni, limit zdarzeń, nagłówki, limity ruchu, `no-store`) | Backend | tokeny powyżej; #33 (reguła dostępności), `availabilityToday` | Skan pliku: brak typu/`reference`/`internalNote`; przykłady 1 dnia, roku przestępnego, DST; wstrzyknięcie CRLF; świeżość po mutacji blokady w osobnym kontekście |
| BE: publiczny feed (tylko jeśli E9 = S1) | Backend | E9; brama `resolvePublicVisibility`; #33 | Te same odmowy co `calendar`; tylko „Niedostępny”; brak historii |
| BE: eksport danych firmy (model `CompanyExport`, `Job` z kontekstem firmy, snapshot `REPEATABLE READ`, serializatory JSON/CSV, szyfrowanie i termin jak eksport audytu, `GET` pobrania, audyt, nowe `purpose` reauth, limity, sweep, `restore-company` zamyka eksporty) | Backend | E1–E8; #60 (chroniony storage, klucz, egzekwowanie usunięcia), #58 | Brak pól spoza zakresu (skan wszystkich plików paczki), CSV bez formuł, obcy eksport `404`, odczyt po terminie odmowa, brak wskrzeszenia po restore, superadmin w archiwum z `ARCHIVED_COMPANY` |
| BE: paczka zdjęć (jeśli E3 = M2) | Backend | zadanie eksportu; limit rozmiaru; budżet storage | Limit czasu i rozmiaru, izolacja prefiksu mediów, brak wycieku wariantów usuniętych |
| FE: ekran „Kalendarz zewnętrzny” w panelu (lista tokenów, utwórz z jednorazowym wyświetleniem adresu, kopiuj, obróć, odwołaj, data wygaśnięcia) | Frontend | zadania BE tokenów; **nowe stany Penpot przed UI** | Klawiatura i fokus, mobile 320–1920, tekst + ikona statusu, adres widoczny tylko raz, brak sekretu w RSC props i cache |
| FE: ekran „Eksport danych” (żądanie z reauth, status `PENDING`/`READY`/`EXPIRED`/`FAILED`, pobranie, ostrzeżenie o poufności) | Frontend | BE eksportu; **nowe stany Penpot przed UI** | Brak pozornego sukcesu przy `FAILED`, PWA bez cache prywatnych odpowiedzi i bez zapisu offline, ochrona niezapisanego formularza |
| Penpot (jedna sesja projektowa, osobne zadanie): ekrany feedu i eksportu (puste, lista, tworzenie, jednorazowy token, rotacja/odwołanie, błąd, wygasły, pobranie) | Projekt (wyznaczony agent) | decyzje E1–E3, E9–E11 | Mapowanie w `design/traceability.json`; bez makiety FE nie startuje |
| QA: scenariusze z #79 (link skopiowany do innej osoby/firmy, pola eksportu, odwołanie linku) | QA | zadania BE/FE | Dla decyzji wymagana zapisana akceptacja właściciela; dla implementacji rzeczywiste uruchomienie |

Kolejność: decyzje E1–E14 → makiety Penpota (równolegle z BE) → BE tokenów → BE endpointu `.ics` → FE feedu; eksport (a) osobna ścieżka po #60. Żadne z zadań nie zmienia zatwierdzonych niezmienników MVP 3.1 (brak publicznych danych prywatnych, brak rezerwacji online, archiwizacja blokuje sesje); wymaga jedynie nowych akcji audytu i migracji addytywnych.
