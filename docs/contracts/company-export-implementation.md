# Eksport danych firmy: kontrakt implementacji (#328, D-40)

Status: zaimplementowane w backendzie; ekran „Eksport danych” (Frontend) czeka na makietę Penpota. Decyzje E1–E8 i E13 z [kontraktu discovery #79](calendar-and-company-export.md) (zatwierdzone 10.11.2026) są tu zrealizowane bez zmian. Ten dokument opisuje kształt API, stany i ograniczenia dla przyszłego ekranu.

## Kto, kiedy, co

| Reguła | Realizacja |
|---|---|
| Aktorzy (E1) | Admin firmy na hoście swojej firmy (`/api/admin/export`) i superadmin w jawnej firmie (`/api/platform/companies/{organizationId}/export`) jako własny aktor, bez impersonacji. Pełne MFA, rola, firma, stan konta i `Origin` (mutacja) sprawdzane w każdym wywołaniu. |
| Świeży dowód MFA (E1) | `POST /api/auth/mfa/reauth` z `purpose: "export-company-data"` (TOTP lub kod odzyskiwania) zwraca jednorazowy `proof` (5 min), związany z kontem, sesją i celem. Dowód jest zużywany dopiero po przejściu wszystkich reguł (limit, okno archiwum), więc odmowa z reguły go nie spala. Dowód innego celu nie działa. |
| Okres usługi (E13) | Wygasły trial/opłata nie blokuje eksportu admina. |
| Archiwizacja (E8) | Admin firmy zarchiwizowanej: brak (sesja i login zablokowane, `403`). Superadmin: przez 30 dni od `archivedAt`; później `409 EXPORT_ARCHIVE_WINDOW_ELAPSED`. Eksport z takiego okna ma `context: "ARCHIVED_COMPANY"` (wiersz i audyt). Po przywróceniu firmy zwykłe reguły. |
| Limity (E6) | Jeden eksport w toku na firmę (częściowy unikalny indeks `PENDING`), 3 żądania na firmę na dobę kroczącą (liczone wszystkie, także nieudane), zapis w budżecie zapisów 60/min. Nowy gotowy plik natychmiast unieważnia poprzednie gotowe pliki firmy. Maks. rozmiar ZIP: 50 MiB (`EXPORT_TOO_LARGE`), maks. 100 000 pojazdów i 100 000 blokad. |
| Bez e-maila (E7) | Brak powiadomień; status widoczny w panelu. |

## API

Wszystkie odpowiedzi: `Cache-Control: no-store`, `X-Request-Id`. Obcy, nieistniejący lub niepoprawny identyfikator eksportu: jednolite `404 {code:"NOT_FOUND"}` (także cudza firma i cudzy host).

| Metoda i ścieżka | Cel | Sukces |
|---|---|---|
| `POST …/export` | Start. Ciało ściśle `{ proof: string(64 hex), idempotencyKey: uuid }`. Ponowienie z tym samym `idempotencyKey` zwraca ten sam wiersz (`200`, bez nowego dowodu, bez drugiego jobu). | `202 {export}` (nowy), `200 {export}` (powtórka) |
| `GET …/export` | Ostatnie 10 eksportów i bieżące limity. | `200 {items: Export[], limits}` |
| `GET …/export/{exportId}` | Status jednego eksportu. | `200 {export}` |
| `GET …/export/{exportId}/download` | Pobranie ZIP (uwierzytelnione GET, wiele pobrań w terminie, każde audytowane). `Content-Type: application/zip`, `Content-Disposition: attachment; filename="auterva-export-YYYYMMDD.zip"` (bez danych osobowych), `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`. | `200` bajty ZIP |

`Export`: `{ id, status: "PENDING"|"READY"|"FAILED"|"EXPIRED", createdAt, completedAt|null, expiresAt|null, bytes|null, counts|null {vehicles, vehicleImages, blocks, publicMedia, hosts}, errorCode|null, requestedByRole, context|null }`. Status `EXPIRED` jest wyliczany przy odczycie po `expiresAt`, zanim sweep zmieni wiersz; `DELETED` jest pokazywany jako `EXPIRED` (albo `FAILED`, gdy był `errorCode`). Nie ma w odpowiedzi digestu, klucza obiektu ani identyfikatora żądającego.

`limits`: `{ canRequest, inProgress, requestsLeftToday (0..3), nextRequestAt|null, archiveWindowEndsAt|null }`. `canRequest=false` z powodu limitu dobowego, eksportu w toku albo zamkniętego okna archiwum (rozróżnij po pozostałych polach).

Kody błędów żądania: `400 INVALID_INPUT`, `401 REAUTH_REQUIRED` (brak/zużyty/wygasły/inny cel), `403 FORBIDDEN` (rola, host, Origin, firma zarchiwizowana dla admina), `409 EXPORT_ALREADY_ACTIVE {exportId}`, `409 EXPORT_ARCHIVE_WINDOW_ELAPSED`, `429 EXPORT_DAILY_LIMIT` + `Retry-After` (sekundy do zwolnienia miejsca) oraz `429 RATE_LIMITED`. Pobranie: `409 EXPORT_NOT_READY`, `410 EXPORT_EXPIRED` (termin minął, eksport nieudany lub unieważniony po restore), `503 EXPORT_UNAVAILABLE` (bajty nie przeszły kontroli integralności; nic nie jest wydawane).

Wskazówki UI (bez narzucania wyglądu): `FAILED` nigdy jako sukces; dla `PENDING` odpytywanie statusu co kilka sekund do 30 min (po 30 min wiersz jest uznany za porzucony i `FAILED`); przycisk „Pobierz” tylko dla `READY`; ostrzeżenie o poufności pliku (zawiera `reference` i `internalNote` blokad, dane kontaktowe i e-mail admina).

## Pliki i zakres (E2–E4)

Szyfrowany obiekt (`AUR1` + nonce + tag GCM + szyfrogram) zawiera ZIP: `manifest.json` (wersja schematu, `generatedAt` UTC, liczności, SHA-256 plików, lista „notIncluded”), `company.json` (firma, ustawienia strony bez `operatorNote`, okres usługi: daty, administrator: e-mail, imię, rola, data utworzenia, MFA tak/nie, publiczne hosty bez diagnostyki DNS, metadane mediów publicznych), `vehicles.json`/`vehicles.csv` (pola pojazdu, cechy, poprzednie slugi, zdjęcia jako metadane bez kluczy storage i bez usuniętych), `blocks.json`/`blocks.csv` (`from`/`to` jako `YYYY-MM-DD` włącznie, typ, źródło, `reference`, `internalNote`, wersja). Snapshot: jedna transakcja `REPEATABLE READ` tylko do odczytu. CSV: UTF-8 z BOM, separator `;`, CRLF, tekst zaczynający się od `=`, `+`, `-`, `@`, TAB lub CR (także po spacjach) dostaje apostrof. Nigdy: hasła, sekrety i kody MFA, sesje, tokeny, `Job`/outbox/receipty, audyt (całość), czat, `RateLimitEvent`, diagnostyka DNS/TLS, `AuditOperatorExport`, dane innych firm, dane platformy.

## Storage, szyfrowanie, termin

- Obiekt: `company-exports/{organizationId}/{exportId}.bin` w prywatnym buckecie (ten sam klient S3 co media; prefiks poza zakresem kopii, które obejmują tylko obiekty wskazane przez wiersze mediów). Klucz obiektu jest AAD szyfrowania i jest porównywany z wierszem przy odczycie.
- Klucz AES-256-GCM: `COMPANY_EXPORT_KEY` (64 hex) albo, gdy brak, HKDF z `BETTER_AUTH_SECRET` z etykietą `auterva-company-export`. Rotacja klucza unieważnia wcześniejsze pliki (są krótkotrwałe, 24 h). Produkcyjny klucz i zarządzanie nim należą do operatora (#58/#90); do czasu jego ustawienia działa wariant pochodny.
- Termin: `expiresAt = completedAt + 24 h`; odczyt po terminie odmawia na wierszu, niezależnie od bajtów.
- Job `COMPANY_EXPORT` (z `organizationId`, `dedupeKey` `COMPANY_EXPORT:{id}`, 3 próby z backoffem) jest przetwarzany przez proces `media-worker` (`pnpm dev:media-worker`), który ma dostęp do storage; ten sam proces wykonuje sweep. Worker sprawdza firmę i wiersz po `organizationId` joba; wiersz innej firmy w payloadzie jest pomijany (`SKIPPED`).
- Przejścia `READY` po terminie → `EXPIRED` (audyt `EXPORT_EXPIRED`) i porzucone `PENDING` (30 min) → `FAILED` `EXPORT_TIMEOUT` (zamknięcie joba `FAILED` i audyt `EXPORT_FAILED`) wykonuje jedna funkcja (`transitions.ts`) w tej samej transakcji co zmiana, niezależnie od tego, czy wywołał ją sweep, worker (nowy gotowy plik) czy `POST …/export` (porządkowanie przed regułami; zostaje zatwierdzone także przy odmowie 401/409/429). Sweep: powyższe przejścia, potem `EXPIRED`/`FAILED` → `DELETED`, potem usunięcie bajtów z ponawianiem do skutku (`storageCleanedAt`). Bajty zapisane po sweepie przez spóźniony worker są usuwane przez ten worker (nieudane `READY`) albo przy kolejnym przebiegu, jeśli worker zginął przed zapisem.

## Audyt

`EXPORT_REQUESTED`, `EXPORT_DOWNLOADED` (aktor sesyjny, rola, firma; w archiwum `context: "ARCHIVED_COMPANY"`), `EXPORT_READY` (`count` = pojazdy + blokady, `evidenceDigest` = SHA-256 pliku), `EXPORT_FAILED`, `EXPORT_EXPIRED` (zdarzenia systemowe z rolą `OPERATOR`, `actorId` `system:company-export`, w tej samej transakcji co zmiana stanu). Nigdy treść plików, nazwa pliku ani adres. Encja `CompanyExport`; etykiety PL w `view.ts`.

## Restore i kopie (#60)

`CompanyExport` jest tabelą wyłączoną z przywracania (`COMPANY_EXCLUDED_TABLES`). `quarantineRestoredState` (pełny i firmowy restore) ustawia `PENDING`/`READY` na `EXPIRED` dla odtwarzanej firmy (dla całego środowiska przy restore pełnym), więc po restore nie ma pobrania ani wskrzeszenia; kolejka jobów jest kwarantannowana tym samym krokiem, a sweep usuwa bajty.

## Migracja

`20261110170000_company_export_issue_328`: addytywna, jedna nowa tabela z CHECK (`status`, `READY` wymaga digestu, terminu i rozmiaru, rola) i częściowym unikalnym indeksem „jeden `PENDING` na firmę”. Rollback: `DROP TABLE "CompanyExport"`.

## Poza zakresem i ryzyka

- Zdjęcia tylko jako metadane (E3); paczka plików (M2) to osobne zadanie.
- Brak e-maila (E7), brak audytu i czatu w paczce (E4).
- Limit rozmiaru 50 MiB i brak strumieniowania: ZIP powstaje w pamięci workera; limit do rewizji po pomiarze na danych produkcyjnych.
- Brak osobnego klucza produkcyjnego i dostawcy storage w tym zadaniu (zależność od #58/#90); retencja i kasowanie danych firmy po zakończeniu współpracy pozostają osobnym tematem.
- UI: ekran „Eksport danych” i stany Penpota nie istnieją; PWA nie cache'uje tych odpowiedzi (`no-store`, ścieżki `/api/admin`).
