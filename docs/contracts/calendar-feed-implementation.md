# Prywatny feed iCal floty: wdrożenie (#327, D-40)

Status: **wdrożone w #327** (Backend). Źródłem decyzji jest kontrakt discovery `calendar-and-company-export.md` z PR #301 (sekcja 2, wariant S2 + Z1; E9–E13). Ten plik opisuje tylko to, co kod robi; po merge #301 należy dopisać do jego sekcji 2 odnośnik „wdrożone w #327”. Ekran zarządzania feedem (Frontend) czeka na makietę Penpota.

## Decyzje przyjęte w kodzie

- E9: wyłącznie feed prywatny, brak publicznego `.ics`. E10: nigdy typ blokady; w pliku tylko daty, nazwa pojazdu i tytuł „Niedostępny”.
- E11: token 256 bit (base64url, 43 znaki) w ścieżce, w bazie tylko SHA-256 (hex), do 5 aktywnych na firmę (kontrola pod blokadą wiersza firmy, także przy równoległych zapisach), ważność 365 dni od utworzenia lub rotacji. Wartość pokazywana raz.
- E12: feed tworzy i obraca wyłącznie admin firmy; superadmin w kontekście firmy listuje i odwołuje. Odwołanie automatyczne: archiwizacja firmy, restore z kopii (`quarantineRestoredState`, pełny i firmowy), reset i zmiana hasła tworzącego (E12, rekomendacja kontraktu). Wyłączone konto (`disabledAt`), zmiana roli lub firmy tworzącego i zweryfikowany e-mail są sprawdzane przy każdym odczycie, więc feed przestaje działać natychmiast.
- E13: wygaśnięcie okresu usługi nie wyłącza feedu; archiwizacja tak.
- Host: feed odpowiada tylko na hoście panelu (`COMPANY_ADMIN`) tej samej firmy co token (`/api/calendar/feed` w polityce tras tego obszaru); inny host, host publiczny lub platformy daje 404. Do potwierdzenia z operatorem: klient kalendarza musi sięgać hosta panelu firmy.
- Tabela `CalendarFeedToken` nie jest odtwarzana z kopii (`COMPANY_EXCLUDED_TABLES`); wiersze użytkowników zastępowane przy restore firmy kaskadują na tokeny.

## Zawartość pliku

Okno: od dziś (Europe/Warsaw) do dziś + 365 dni włącznie. Dla każdego pojazdu niearchiwalnego z ustawioną aktywnością: dni poza aktywnością oraz dni z blokadą (reguła #33), sąsiednie i nakładające się zakresy połączone. Pojazdy bez okresu aktywności są pomijane. `DTSTART;VALUE=DATE` = pierwszy dzień, `DTEND;VALUE=DATE` = dzień po ostatnim (RFC 5545), `SUMMARY:Niedostępny: {nazwa}`, `UID` = HMAC (BETTER_AUTH_SECRET) z firmy, pojazdu i dnia początku, `TRANSP:OPAQUE`, bez `SEQUENCE`. Linie składane do 75 oktetów, tekst escapowany (`\ ; ,` i łamania wierszy zamieniane na `\n`, inne znaki sterujące usuwane). Limit 5000 zdarzeń; przy przekroczeniu nagłówek `X-Auterva-Feed-Truncated: true`. Z jednej migawki `REPEATABLE READ`, bez cache aplikacyjnego. Wyłącznie GET; brak ETag/304 w tym kroku. Zdarzenie audytu `CALENDAR_FEED_EXPIRED` (sweep) nie jest wdrożone: wygaśnięcie widać po `status: EXPIRED` na liście.

## Odpowiedzi publicznego endpointu

`GET /api/calendar/feed/{token}.ics`: `200 text/calendar; charset=utf-8`; każda odmowa (nieznany, błędny format, odwołany, wygasły, firma archiwalna, twórca nieaktywny, zły host) to jednolite `404` z pustym ciałem. Nagłówki: `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Request-Id`, bez ciasteczek. Limity: 60/min na zaufany adres (przed wyszukaniem tokena), 30/h na token; `429` z `Retry-After`. Ścieżka jest maskowana w logach (`/api/calendar/feed/[token]`).

## API zarządzania (JSON, `Cache-Control: no-store`)

Admin firmy (host panelu, pełne MFA, `Origin` przy mutacjach):

- `GET /api/admin/calendar-feeds` → `{ items: [{ id, label, status: "ACTIVE"|"EXPIRED"|"REVOKED", createdAt, expiresAt, lastUsedAt, revokedAt, revokedReason }], activeCount, activeLimit: 5, validityDays: 365 }` (nigdy token ani hash; `revokedReason`: MANUAL, ROTATED, COMPANY_ARCHIVED, PASSWORD_CHANGED, COMPANY_RESTORED).
- `POST /api/admin/calendar-feeds` `{ label }` (1–60 znaków, bez znaków sterujących) → `201` z polami pozycji plus `token`, `path`, `url` (jedyny raz). `409 FEED_LIMIT_REACHED` przy 5 aktywnych.
- `POST /api/admin/calendar-feeds/{id}/rotate` → `200` jak wyżej (nowe `id`, ta sama etykieta); stary token odwołany atomowo. `404` dla nieznanego, odwołanego, wygasłego lub cudzego.
- `DELETE /api/admin/calendar-feeds/{id}` → `200` z pozycją w stanie `REVOKED` (powtórzenie jest bezpieczne).

Superadmin: `GET /api/platform/companies/{organizationId}/calendar-feeds` i `DELETE .../calendar-feeds/{id}`; utworzenie i rotacja zwracają `403`.

Audyt: `CALENDAR_FEED_CREATED`, `CALENDAR_FEED_ROTATED`, `CALENDAR_FEED_REVOKED` (encja `CalendarFeedToken`, `entityId` = id wiersza, `safeChanges: { count }`), bez tokena, hasha i adresu.
