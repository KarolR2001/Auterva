# Prywatny feed iCal floty: wdrożenie (#327, D-40)

Status: **wdrożone w #327** (Backend), zakres „wybrane pojazdy” w #366 (Backend). Źródłem decyzji jest kontrakt discovery `calendar-and-company-export.md` z PR #301 (sekcja 2, wariant S2 + Z1; E9–E13). Ten plik opisuje tylko to, co kod robi; po merge #301 należy dopisać do jego sekcji 2 odnośnik „wdrożone w #327”. Ekran zarządzania feedem (Frontend) czeka na makietę Penpota.

## Decyzje przyjęte w kodzie

- E9: wyłącznie feed prywatny, brak publicznego `.ics`. E10: nigdy typ blokady; w pliku tylko daty, nazwa pojazdu i tytuł „Niedostępny”.
- E11: token 256 bit (base64url, 43 znaki) w ścieżce, w bazie tylko SHA-256 (hex), do 5 aktywnych na firmę (kontrola pod blokadą wiersza firmy, także przy równoległych zapisach), ważność 365 dni od utworzenia lub rotacji. Wartość pokazywana raz. Zakres tokena (#366): cała flota (`FLEET`) albo 1–50 wybranych pojazdów firmy (`VEHICLES`), patrz „Zakres pojazdów”.
- E12: feed tworzy i obraca wyłącznie admin firmy; superadmin w kontekście firmy listuje i odwołuje. Odwołanie automatyczne: archiwizacja firmy, restore z kopii (`quarantineRestoredState`, pełny i firmowy), reset i zmiana hasła tworzącego (E12, rekomendacja kontraktu). Wyłączone konto (`disabledAt`), zmiana roli lub firmy tworzącego i zweryfikowany e-mail są sprawdzane przy każdym odczycie, więc feed przestaje działać natychmiast.
- E13: wygaśnięcie okresu usługi nie wyłącza feedu; archiwizacja tak.
- Host: feed odpowiada tylko na hoście panelu (`COMPANY_ADMIN`) tej samej firmy co token (`/api/calendar/feed` w polityce tras tego obszaru); inny host, host publiczny lub platformy daje 404. Do potwierdzenia z operatorem: klient kalendarza musi sięgać hosta panelu firmy.
- Tabele `CalendarFeedToken` i `CalendarFeedTokenVehicle` nie są odtwarzane z kopii (`COMPANY_EXCLUDED_TABLES`); wiersze użytkowników zastępowane przy restore firmy kaskadują na tokeny, a tokeny i pojazdy na wiersze zakresu.

## Zakres pojazdów (#366, E11, D-47)

- Model: kolumna `CalendarFeedToken.scope` (`FLEET` | `VEHICLES`, CHECK, domyślnie `FLEET` dla istniejących tokenów) i tabela `CalendarFeedTokenVehicle (organizationId, tokenId, vehicleId)`, klucz główny `(tokenId, vehicleId)`, indeks `(organizationId, vehicleId)`. Złożone klucze obce `(organizationId, tokenId)` → `CalendarFeedToken(organizationId, id)` i `(organizationId, vehicleId)` → `Vehicle(organizationId, id)`, oba `ON DELETE CASCADE`: baza nie przyjmie wiersza łączącego token jednej firmy z pojazdem innej. Migracja `20261110230000_calendar_feed_vehicle_scope_issue_366` jest addytywna (kolumna z domyślną wartością, nowa tabela, nowy indeks unikalny `(organizationId, id)` tokena); wycofanie opisane w jej nagłówku.
- Zakres zapisany jawnie: token `VEHICLES`, którego wszystkie wiersze zakresu znikną (kaskada po usunięciu pojazdu), zostaje `VEHICLES` i daje pusty kalendarz; nigdy nie rozszerza się do całej floty.
- Tworzenie: brak `vehicleIds` (lub `null`) = cała flota. Lista: 1–50 identyfikatorów UUID bez powtórzeń (porównanie bez wielkości liter); pusta lista jest odmową, by pusty wybór nie stał się całą flotą. Pod blokadą wiersza firmy (te same, którą biorą zmiany floty) każdy pojazd musi należeć do tej firmy i być `PUBLISHED` w chwili tworzenia (D-47). Kontrola limitu 5 aktywnych poprzedza kontrolę pojazdów (przy limicie `409`, nie `400`).
- Odmowy: `400 { code: "INVALID_INPUT", fieldErrors: { vehicleIds: <powód> } }`, gdzie powód to `INVALID_TYPE` (nie tablica lub element nie jest UUID), `OUT_OF_RANGE` (0 lub ponad 50), `DUPLICATE`, `VEHICLE_NOT_FOUND` (nieznany identyfikator **albo pojazd innej firmy** — ta sama odpowiedź bajt w bajt, więc nie ujawnia, czy pojazd istnieje gdzie indziej) i `VEHICLE_NOT_PUBLISHED` (pojazd tej firmy w stanie szkicu, wycofany lub archiwalny). Przy odmowie nic nie jest zapisywane (ani token, ani audyt). Kod 400 z `fieldErrors` (a nie 404 jak przy nieznanym tokenie) wynika z konwencji walidacji pól ciała żądania (`InvalidCharactersError`, ustawienia firmy).
- Rotacja kopiuje `scope` i zapisany wybór w tej samej transakcji, w której odwołuje stary token; wybór jest kopiowany taki, jaki jest zapisany (pojazd ukryty po utworzeniu zostaje w zakresie i tylko nie trafia do pliku).
- Odczyt feedu: dla `VEHICLES` tylko pojazdy z zakresu, które w chwili odczytu są `PUBLISHED` i należą do firmy tokena (filtr w tej samej migawce `REPEATABLE READ`, blokady filtrowane tym samym warunkiem). Pojazd ukryty, wycofany do szkicu lub zarchiwizowany znika przy następnym odczycie i wraca po ponownej publikacji. Gdy w zakresie nie zostaje żaden opublikowany pojazd: `200` z pustym `VCALENDAR` (bez `VEVENT`), nie błąd.
- Audyt `CALENDAR_FEED_CREATED`/`CALENDAR_FEED_ROTATED` bez zmian: `safeChanges: { count: 1 }`, bez identyfikatorów i nazw pojazdów.

## Ekran i odświeżanie przez klientów (D-49)

Ekran „Kalendarz zewnętrzny” (ADM-22, #355) jest pozycją w nawigacji Ustawień firmy. Objaśnia, że Kalendarz Google odświeża subskrypcję co kilka godzin, Apple co 5–60 minut, więc feed może chwilę zostawać w tyle; o dostępności rozstrzyga panel.

## Zawartość pliku

Okno: od dziś (Europe/Warsaw) do dziś + 365 dni włącznie. Decyzja D-47: tylko pojazdy `PUBLISHED` (szkice, wycofane i archiwalne są pominięte, także z blokadami); token `VEHICLES` dodatkowo zawęża do swojego wyboru (#366). Dla każdego takiego pojazdu z ustawioną aktywnością: dni poza aktywnością oraz dni z blokadą (reguła #33), sąsiednie i nakładające się zakresy połączone. Pojazdy bez okresu aktywności są pomijane. `DTSTART;VALUE=DATE` = pierwszy dzień, `DTEND;VALUE=DATE` = dzień po ostatnim (RFC 5545), `SUMMARY:Niedostępny: {nazwa}`, `UID` = HMAC (BETTER_AUTH_SECRET) z firmy, pojazdu i dnia początku, `TRANSP:OPAQUE`, bez `SEQUENCE`. Linie składane do 75 oktetów, tekst escapowany (`\ ; ,` i łamania wierszy zamieniane na `\n`, inne znaki sterujące usuwane). Limit 5000 zdarzeń; przy przekroczeniu nagłówek `X-Auterva-Feed-Truncated: true`. Z jednej migawki `REPEATABLE READ`, bez cache aplikacyjnego. Wyłącznie GET; brak ETag/304 w tym kroku. Zdarzenie audytu `CALENDAR_FEED_EXPIRED` (sweep) nie jest wdrożone: wygaśnięcie widać po `status: EXPIRED` na liście.

## Odpowiedzi publicznego endpointu

`GET /api/calendar/feed/{token}.ics`: `200 text/calendar; charset=utf-8`; każda odmowa (nieznany, błędny format, odwołany, wygasły, firma archiwalna, twórca nieaktywny, zły host) to jednolite `404` z pustym ciałem. Nagłówki: `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Request-Id`, bez ciasteczek. Limity: 60/min na zaufany adres (przed wyszukaniem tokena), 30/h na token; `429` z `Retry-After`. Ścieżka jest maskowana w logach (`/api/calendar/feed/[token]`).

## API zarządzania (JSON, `Cache-Control: no-store`)

Admin firmy (host panelu, pełne MFA, `Origin` przy mutacjach):

- `GET /api/admin/calendar-feeds` → `{ items: [{ id, label, status: "ACTIVE"|"EXPIRED"|"REVOKED", createdAt, expiresAt, lastUsedAt, revokedAt, revokedReason, scope: "FLEET"|"VEHICLES", vehicles? }], activeCount, activeLimit: 5, validityDays: 365 }` (nigdy token ani hash; `revokedReason`: MANUAL, ROTATED, COMPANY_ARCHIVED, PASSWORD_CHANGED, COMPANY_RESTORED). `vehicles: [{ id, name }]` występuje tylko dla `scope: "VEHICLES"`, w kolejności floty (`sortOrder`, `id`), i pokazuje zapisany wybór niezależnie od bieżącego statusu pojazdu (`name` może być `null`); dla `FLEET` pola nie ma.
- `POST /api/admin/calendar-feeds` `{ label, vehicleIds? }` (etykieta 1–60 znaków, bez znaków sterujących; `vehicleIds` jak w „Zakres pojazdów”) → `201` z polami pozycji (także `scope` i `vehicles`) plus `token`, `path`, `url` (jedyny raz). `409 FEED_LIMIT_REACHED` przy 5 aktywnych; `400 INVALID_INPUT` z `fieldErrors.vehicleIds` przy odmowie wyboru.
- `POST /api/admin/calendar-feeds/{id}/rotate` → `200` jak wyżej (nowe `id`, ta sama etykieta i ten sam zakres); stary token odwołany atomowo. `404` dla nieznanego, odwołanego, wygasłego lub cudzego.
- `DELETE /api/admin/calendar-feeds/{id}` → `200` z pozycją w stanie `REVOKED` (powtórzenie jest bezpieczne).

Superadmin: `GET /api/platform/companies/{organizationId}/calendar-feeds` (te same pozycje, z `scope` i `vehicles`) i `DELETE .../calendar-feeds/{id}`. Tras tworzenia i rotacji w obszarze platformy nie ma (metoda niewspierana, `405`); superadmin nie tworzy feedu. Warstwa domenowa dodatkowo odmawia takiemu aktorowi (`FEED_FORBIDDEN`), co chroni przed przyszłym dodaniem trasy.

Audyt: `CALENDAR_FEED_CREATED`, `CALENDAR_FEED_ROTATED`, `CALENDAR_FEED_REVOKED` (encja `CalendarFeedToken`, `entityId` = id wiersza, `safeChanges: { count }`), bez tokena, hasha i adresu.
