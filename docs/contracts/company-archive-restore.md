# Archiwizacja i przywrócenie firmy: kontrakt #48

Wynik: archiwizacja odcina login, sesje, rozpoczęte challenge MFA, WebSocket administratora i wszystkie publiczne adresy firmy, nie usuwając żadnych danych. Przywrócenie oddaje wyłącznie login; publikację odblokowuje osobno istniejące `unlockPublicAfterRestore` ([okres usługi](service-period-runtime.md)). Wygaśnięcie okresu nie jest archiwizacją i panel firmy nadal działa.

## Operacje (tylko superadmin, własny aktor)

| Metoda i ścieżka | JSON żądania | Wynik 200 |
|---|---|---|
| `POST /api/platform/companies/{organizationId}/archive/` | `{ "expectedOrganizationVersion": int, "eventKey": UUID }` | `{ archivedAt, version, publicRequiresPaid: true, publicUnlockRequired: true, revokedSessions }` |
| `POST /api/platform/companies/{organizationId}/restore/` | to samo | `{ archivedAt: null, version, publicRequiresPaid: true, publicUnlockRequired: true }` |

Wejście ma te same bramki co zapisy okresu (host `PLATFORM`, własny `Origin`, pełne MFA, rola `SUPERADMIN_AUTERVA`, wspólny limit zapisów, `no-store`, `X-Request-Id`). `expectedOrganizationVersion` dotyczy `Organization.version`. Błędy: `400 INVALID_INPUT`, `403 FORBIDDEN`, `404 NOT_FOUND`, `429 RATE_LIMITED`, `409 COMPANY_VERSION_CONFLICT`, `COMPANY_ALREADY_ARCHIVED`, `COMPANY_NOT_ARCHIVED`, `EVENT_KEY_CONFLICT`, nieznane `500 INTERNAL_ERROR`. Brak ścieżki purge ani kasowania firmy.

## Co dzieje się atomowo

Jedna transakcja (awaria audytu cofa całość):

- Archiwizacja ustawia `archivedAt`, `publicRequiresPaid=true`, `publicUnlockRequired=true`, `version+1`; kasuje sesje użytkowników firmy, challenge `auterva:mfa:*` (także dowody reauth), natywne challenge Better Auth `2fa-*` oraz dowody resetu hasła; audytuje `AUTH_SESSIONS_REVOKED` (gdy były sesje) i `COMPANY_ARCHIVED` z tożsamością rzeczywistego superadmina.
- Przywrócenie ustawia `archivedAt=null`, `publicRequiresPaid=true`, `publicUnlockRequired=true`, `version+1` i audytuje `COMPANY_UPDATED` (archivedAt: ISO → null). Nie rusza `ServiceAccess`, trialu ani opłaty; nie przywraca sesji ani challenge. Stare sesje pozostają unieważnione, administrator loguje się od nowa z MFA.
- Odblokowanie pozostaje wyłącznie w `unlockPublicAfterRestore`: wymaga niearchiwalnej firmy, blokady po przywróceniu, zgodnej wersji i ważnej opłaty (`PERIOD_ARCHIVED`, `PERIOD_PAYMENT_REQUIRED`). Sam trial nie odblokowuje; późniejsze skrócenie opłaty ukrywa stronę mimo trwającego trialu.
- Dane (flota, zdjęcia, blokady, czat, hosty, ustawienia, okres) nie są zmieniane; testy porównują odczyt przed i po. Firma B jest nietknięta.

## Blokady i wyścigi

Kolejność blokad: wiersz `Organization` w trybie `FOR NO KEY UPDATE`, potem wiersze `account` (credential) użytkowników firmy. Login, weryfikacja MFA i zmiana hasła trzymają wiersz `account` i dopiero potem czytają `archivedAt` oraz tworzą sesję/challenge. Skutek: login zatwierdzony przed archiwizacją zostaje cofnięty (archiwizacja czeka na jego commit i usuwa wynik); login po archiwizacji czeka i jest odmówiony bez sesji. Tryb `NO KEY UPDATE` jest celowy: zakończenie MFA wstawia wiersz audytu (FK do organizacji, `FOR KEY SHARE`), a `FOR UPDATE` dawało deadlock `account → organization` kontra `organization → account`. Konkurencyjne zapisy okresu, odblokowania i floty używają `FOR UPDATE` na tym samym wierszu, więc nadal się z archiwizacją wykluczają. Archiwizacja i przywrócenie serializują się na wierszu organizacji; wersja decyduje o jednym zwycięzcy, przegrany dostaje `COMPANY_VERSION_CONFLICT`. Nowe operacje blokujące wiersz organizacji po wierszu `account` są zabronione.

Zapisy mediów (#29) i blokad dostępności (#38, PR #139) też blokują `Organization` w trybie `FOR NO KEY UPDATE`; razem z archiwizacją wzajemnie się wykluczają i nie tworzą cyklu z wierszem `account`. Po archiwizacji nowy upload obrazu jest odmawiany (sesja cofnięta; rezerwacja superadmina daje `MEDIA_ORGANIZATION_ARCHIVED`), a przetwarzany obraz kończy `MEDIA_SCOPE_INACTIVE` bez `VehicleImage` (`tests/integration/company-archive-media.test.ts`).

## WebSocket (mechanizm dla #51)

Serwer realtime (`src/server/realtime.ts`, `src/modules/chat/realtime.ts`) już autoryzuje upgrade i każde połączenie przez `resolveRealtimeTenant` (`requireAuthorizedActor`: sesja, MFA, rola, host i `archivedAt`). Połączenie jest rewalidowane co 1 s oraz przy każdej wiadomości i zamykane kodem `4401`. Archiwizacja kasuje sesję, więc aktywne połączenie administratora firmy zamyka się najpóźniej po około 1 s, a nowe upgrade'y są odrzucane (także po przywróceniu, dopóki administrator nie zaloguje się ponownie). #51 musi zachować ten model: każdy nowy typ połączenia wywołuje `resolveRealtimeTenant`, nie cache'uje wyniku między komunikatami i nie omija rewalidacji. Brak czatu w tym issue.

## Poza zakresem i znane ograniczenia

- Media są sprawdzone na main (#136). Publiczny alias i domena własna (#137) nie są jeszcze na main: dostaną odmowę przez `resolvePublicVisibility`, lecz test na ich ścieżkach należy do integracji po scaleniu #137.
- Oczekujące zaproszenie firmy bez administratora nie jest unieważniane przy archiwizacji; aktywacja i wysyłka są odmawiane, gdy firma jest zarchiwizowana, i znów możliwe po przywróceniu w ważnym terminie zaproszenia.
- UI listy firm, filtra archiwum i dialogów należy do frontendu; odczyt `includeArchived` istnieje w `platform-companies-read.md`.
