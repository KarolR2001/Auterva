# Aktywacja zaproszonego administratora — #22

Źródła: PRD 3.1 §7.4, C-F029/C-F031–039/C-F050–054, [wydanie zaproszeń](company-onboarding-invitations.md), [okres usługi](service-period-runtime.md) oraz [MFA](technical-limits-and-mfa-bootstrap.md). Aktywacja przyjmuje istniejącego oczekującego użytkownika z #20; nie tworzy drugiego konta ani sesji z pełnym MFA.

## HTTP i odmowy

`GET /api/auth/invitation/{token}/` pozostaje odczytem bez skutków. `POST` na tej samej ścieżce przyjmuje wyłącznie JSON `{ "password": string }` (12–256 znaków). Token ma 32 losowe bajty base64url i znajduje się tylko w ścieżce; odpowiedzi mają `Cache-Control: no-store`, `Referrer-Policy: no-referrer` i własny serwerowy `X-Request-Id`. Klient nie wysyła firmy, roli, adresata, chwili, okresu ani identyfikatora żądania. `Origin` musi odpowiadać aktywnemu hostowi `COMPANY_ADMIN`, do którego wydano zaproszenie. Pozytywna odpowiedź 200 zawiera `organizationId`, `registeredAt` UTC, `signInRequired: true` i `siteState`:

- `READY`: aktywna publiczna domena i ważny okres z odblokowaną publikacją;
- `DOMAIN_PENDING`: publiczny host nie jest aktywny;
- `PERIOD_EXPIRED`: domena jest gotowa, lecz nie ma ważnego prawa publikacji;
- `RESTORE_LOCKED`: domena jest gotowa, ale publikacja wymaga osobnego odblokowania po przywróceniu.

Odpowiedź nie zawiera cookie. Następny login daje tylko ograniczoną sesję enrolmentu; pełny panel/API/WS nadal wymagają potwierdzonego TOTP lub kodu odzyskania. Błędny obszar/host/token oraz nieaktualne, odwołane lub zużyte w niespójnym stanie zaproszenie dają neutralne `404 NOT_FOUND`; obcy `Origin` daje `403 FORBIDDEN`, błędne body `400 INVALID_REQUEST`, brak zaufanego adresu ingress w produkcji `503 INGRESS_NOT_CONFIGURED`. Techniczny limiter przed odczytem body ma ruchome okno 5 prób/15 min dla HMAC tokenu i 20 prób/15 min dla zaufanego IP; `429 RATE_LIMITED` ma `Retry-After`. Nie korzysta z nagłówków IP klienta. Bez publicznego signup, resetu pending konta i automatycznego MFA.

## Jedna transakcja

Serwer po zamkniętej walidacji żądania haszuje hasło mechanizmem Better Auth. Transakcja blokuje `Organization FOR NO KEY UPDATE`; ta blokada serializuje aktywację z issue/resend/cancel zaproszenia i zmianą okresu używającymi `FOR UPDATE`, a dopuszcza wymagany przez FK `KEY SHARE` audytu równoległego operator recovery po wcześniejszym `UPDATE user`. **Po** uzyskaniu blokady ponownie odczytuje bieżący czas, token, `issuedHost`, aktywne mapowanie hosta, firmę, zarezerwowanego admina bez credential oraz `ServiceAccess`. Granica `issuedAt+168h` jest wyłączna. Legacy `issuedHost=NULL`, alias, host innej firmy, archiwum, odwołanie i wcześniejsze uruchomienie odmawiają. Zmiana publicznego aliasu bez zmiany hosta panelu nie odbiera samego zaproszenia.

Pierwszy sukces w tej transakcji tworzy jedno `Account` credential, ustawia `emailVerified` i `Invitation.usedAt`, utrwala `Organization.firstAdminRegisteredAt`, inkrementuje `periodVersion`, a przy `trialGranted=true` ustawia `trialStartedAt` na tę samą chwilę i `trialEndsAt` na dokładnie +336 godzin UTC. `INVITATION_ACCEPTED` zapisuje rzeczywistego nowego admina jako aktora uprawnionego zużytym linkiem; nie podszywa się pod superadmina ani nie tworzy fikcyjnej sesji. Audyt nie zawiera tokenu lub hasła. Błąd audytu cofa wszystkie zapisy. Równoległy POST lub retry po utraconej odpowiedzi odczytuje zapisany wynik i nigdy nie wymienia hasła ani nie przesuwa startu. Powtórzenie nie odnawia siedmiodniowej ważności tokenu.

Publiczna widoczność nadal pochodzi z centralnej bramki #21, nie z odpowiedzi aktywacyjnej ani liczby aut. Przypomnienia po nowym `periodVersion` wymagają osobnej integracji harmonogramu #54. DNS/TLS, zewnętrzne doręczenie poczty i publikacja mediów nie są dowodzone lokalnym testem aktywacji.

## Odbiór

`company-activation.test.ts` bada rzeczywisty PostgreSQL, dwie zmiany DST, 336 h UTC, dwa POST, retry z innym hasłem, wyłączną granicę 168 h, host/alias/legacy, cancel/resend w obu kolejnościach, rollback audytu, brak trialu bez grantu, operator recovery z barierą i ograniczony login po aktywacji. `company-onboarding.spec.ts` bada zbudowany serwer przez lokalny ingress. QA powtarza te scenariusze na własnych firmach A/B i własnym zaufanym adapterze; nie używa zewnętrznego dostawcy poczty jako dowodu lokalnej transakcji.
