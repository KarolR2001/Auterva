# Macierz kontroli OWASP i regresja bezpieczeństwa (#57)

To wewnętrzna lista kontroli z dowodami wykonania na lokalnej fixture, a nie deklaracja zgodności ani certyfikacji (OWASP ASVS, Top 10, SOC 2 ani innej). Odpowiada Top 10 2021 jako punktom odniesienia. Pentest na stagingu jest `not-run` (zależy od #90, D-16), więc zakres wydania z nim związany pozostaje otwarty. Stan: `pass` = zautomatyzowany dowód, `partial` = dowód częściowy, `not-run` = niewykonane.

## Jak odtworzyć

`LOCAL_PORT_BASE=<port> scripts/local-fixture.sh start`, migracje i seed (README, „Lokalne usługi”), potem:

```sh
pnpm exec vitest run tests/unit/security-headers.test.ts tests/unit/json-body.test.ts
pnpm exec vitest run tests/integration/security-regression.test.ts
pnpm build && pnpm exec playwright test --project=trusted-ingress security-headers
```

Test `tests/integration/security-regression.test.ts` wyszukuje **każdy** `route.ts` w `src/app/api` w systemie plików. Nowy handler w grupie `admin` lub `platform` przechodzi całą macierz automatycznie; nowa grupa najwyższego poziomu pada w teście inwentarza, dopóki nie zostanie jawnie sklasyfikowana.

## 1. Inwentarz wejść i kontrole

| Wejście | Autoryzacja (aktor, rola, firma, stan konta) | Origin/CSRF | Limit ruchu | Parsowanie | Dowód |
|---|---|---|---|---|---|
| `/api/admin/**` (28 handlerów) | host `COMPANY_ADMIN`, sesja z dowodem MFA, rola `ADMIN_FIRMY`, firma z hosta, firma niezarchiwizowana: `actor()` w `src/modules/fleet/http.ts`, `requireRequestContext` | dokładny Origin dla POST/PUT/PATCH/DELETE | 120 odczytów / 60 zapisów / minutę na konto+firmę, osobny budżet bajtów zdjęć | `readJsonObject` (64 KiB), allowlista kluczy, UUID | `security-regression.test.ts` (macierz 1–5, parsowanie), `fleet-mutations`, `availability-blocks`, `preview`, `chat` |
| `/api/platform/**` (44 handlery; firma wskazana ścieżką) | host `PLATFORM`, sesja superadmina z MFA, istniejąca firma; superadmin działa jako własny aktor | jak wyżej | wspólny klucz `…:platform` bez względu na firmę | jak wyżej | jak wyżej, `authenticated-read-budget`, `service-period-mutation` |
| `/api/public/**` | brak sesji; host `COMPANY_PUBLIC` i okres usługi ustalają dane; tylko PUBLISHED, bez pól prywatnych | tylko odczyty (POST dostępności jest odczytem) | per zaufany adres: oferta 120/min, dostępność 60/min, media własny budżet | Zod `.strict()`, `readJsonBody`, wzorzec sluga | `public-offer`, `availability-http`, `security-regression` (macierz 6–7) |
| `/api/auth/[...all]` | allowlista ścieżek, host panelu, MFA, odpowiedzi neutralne | dokładny Origin dla POST | konto 5/15 min, IP 20/15 min, reset 3+20/h, wspólny limit uwierzytelnionych | `bodyExceeds` 16 KiB (413), Zod | `auth-http`, `password-reset`, `e2e/security-headers` |
| `/api/auth/invitation/[token]` | host panelu firmy powiązany z zaproszeniem; jednorazowy token | Origin dla POST | POST: token 5 + IP 20 / 15 min; **GET: IP 60/min (nowe w #57)** | `readJsonBody` 16 KiB | `invitation`, `company-activation`, `security-regression` |
| Upload obrazów (`…/images`, `…/public-media/{logo,hero,brand}`) | jak API, sprawdzane przed odczytem treści; poza Proxy (matcher), więc handler powtarza wszystkie kontrole | dokładny Origin | budżet bajtów 600/min + 30 zdjęć na pojazd | strumień z limitem 10 MB, timeout bezczynności 3 s i całkowity 15 s, magic bytes, izolowany dekoder | `media-http`, `e2e/media`, `media-decode` |
| WebSocket `/ws` | host z `WS_ALLOWED_HOSTS`, Origin z `HostMapping`, sesja z MFA, rewalidacja co 1 s | Origin handshake | 5 połączeń na aktora, 2000 łącznie, 60 ramek / 10 s, kolejka 20, typing 1/s, wiadomości 30/min + 10/10 s | `maxPayload` 64 KiB, ramki Zod | `chat-realtime`, `realtime-process` |
| Strony HTML/RSC (`/`, `/admin/`) | host z `HostMapping`, serwerowa kontrola aktora, `notFound()` | brak mutacji | **brak** (patrz 6, uwaga W2) | brak parametrów | `host-proxy`, `e2e/security-headers` |
| `robots.txt`, `sitemap.xml`, `/.well-known/auterva-domain-check`, `/api/health` | bez danych prywatnych; neutralne 404 | brak mutacji | robots/sitemap: budżet oferty; probe i health bez | nie dotyczy | `public-offer`, `custom-domain-lifecycle` |
| Job worker, media worker | brak wejścia HTTP; zadania niosą `organizationId`, aktora sprawdza się przy wykonaniu | nie dotyczy | liczba prób i backoff | zaszyfrowany ładunek | `jobs-review-regressions`, `media-process-lifecycle` |

## 2. Top 10 (2021)

| Kategoria | Kontrole | Dowody | Stan |
|---|---|---|---|
| A01 Broken Access Control | autoryzacja w każdej operacji serwerowej; host, Proxy i przycisk jej nie zastępują; izolacja firm w DB (klucze złożone `organizationId`), mediach, cache (`no-store`), jobach i WS; superadmin jako własny aktor | macierz `security-regression` (anonim, sesja bez MFA, zły host, zła rola, cudze ID, nieistniejąca firma), `tenancy`, `schema-contract`, `chat-realtime`, `vehicle-images` | pass lokalnie; staging not-run |
| A02 Cryptographic Failures | hasła przez bibliotekę auth (min. 12 znaków), HMAC kluczy limitów, ładunki poczty szyfrowane, sekrety tylko w env; HSTS w produkcji; brak sekretów w bundlu klienta | `e2e/security-headers` (skan `.next/static` i `public`), `jobs-outbox`, `unit/env` | pass lokalnie; `Secure` ciasteczek i TLS: not-run (staging) |
| A03 Injection | Prisma (parametryzacja), raw SQL tylko z parametrami szablonu, Zod `.strict()`, NUL/znaki sterujące odrzucane, tekst nigdy jako HTML, CSP z nonce | `security-regression` (parsowanie i `__proto__`), `company-settings` (markup), `chat-text`, `e2e/security-headers` (przeglądarka) | pass; poprawka NUL w #57 |
| A04 Insecure Design | granice danych D-04, jeden administrator firmy (indeks unikalny), MFA obowiązkowe, zaproszenie bez rejestracji, brak rezerwacji i płatności | `schema-contract`, `security-regression` (TEST-MVP-45), `auth-http` | pass |
| A05 Security Misconfiguration | nagłówki na każdej odpowiedzi, CSP, noindex dla paneli i API, brak trybu „dowolny host”, produkcyjny auth wymaga zaufanego adaptera adresu | `unit/security-headers`, `e2e/security-headers`, `realtime-config`, `auth-production` | pass lokalnie; konfiguracja proxy dostawcy: not-run |
| A06 Vulnerable Components | audyt zależności produkcyjnych w CI, wersje przypięte, `overrides` udokumentowane | patrz sekcja 5 | pass (CI + lokalnie 27.10.2026) |
| A07 Identification & Authentication | hasło + TOTP/kod odzyskania, limity, neutralne komunikaty, sesje unieważniane przy archiwizacji/resetcie/rotacji MFA, ciasteczka HttpOnly + SameSite bez `Domain` | `auth-http`, `mfa-factor-lock`, `company-archive`, `e2e/security-headers` (ciasteczka) | pass; `Secure` i zaufany adres IP na stagingu: not-run |
| A08 Software & Data Integrity | lockfile z `--frozen-lockfile`, akcje CI przypięte do SHA, obrazy bez sekretów, migracje addytywne, audyt nieedytowalny | `docs/development/CI.md`, `audit-append` | pass (bez podpisów artefaktów; poza zakresem MVP) |
| A09 Logging & Monitoring | log odmowy zawiera tylko `requestId` i status; błędy to kody bez tekstu wyjątku; audyt aktora w transakcji | `unit/request-id`, `security-regression` (redakcja: brak stosu, SQL, ścieżek, komunikatów sterownika w 4xx/5xx) | pass; alerty i monitoring: not-run (staging, #90) |
| A10 SSRF | jedyne wychodzące żądania: weryfikacja własnej domeny (tylko adresy publiczne, brak przekierowań, brak nadpisywania polityki) i dostawca poczty (zadanie, adres z konfiguracji) | `custom-domain-network`, `unit/custom-domain-validation`, `jobs-provider` | pass |

## 3. Nagłówki i CSP

- `security-headers.mjs` (ładowany przez `next.config.mjs`) dodaje do **każdej** odpowiedzi, także tras uploadu poza Proxy: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` (kamera, mikrofon, geolokalizacja, płatności, USB, serial, Bluetooth wyłączone) oraz w produkcji `Strict-Transport-Security: max-age=31536000` bez `includeSubDomains` i `preload` (domeny własne firm nie należą do nas).
- Endpointy danych (`/api/*`, `robots.txt`, `sitemap.xml`, `/.well-known/*`) mają CSP `default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`.
- Dokumenty HTML dostają w `src/proxy.ts` CSP z nonce na żądanie (`src/modules/tenancy/csp.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, `style-src 'self' 'nonce-…'`, `style-src-attr 'unsafe-inline'` (atrybuty `style` komponentów; nie wykonują skryptu), `connect-src 'self' wss://<host żądania>`, `worker-src 'self'` (PWA `/admin/`), `object-src 'none'`, `frame-ancestors 'none'`. `unsafe-eval` istnieje wyłącznie w `next dev`.
- Ograniczenia dla frontendu: strony muszą być renderowane dynamicznie (nonce na żądanie; obecne strony mają `force-dynamic`), inline `<script>` musi nieść nonce z nagłówka `x-nonce`/Next, a zewnętrzne źródła (CDN, analityka, mapy) wymagają jawnej zmiany polityki w `csp.ts` i testu. Gniazdo czatu zakłada ten sam host co strona; inny host trzeba dopisać do `connect-src`.

## 4. Regresja TEST-MVP (wszystkie ID znaleziono w PRD 3.1 §20)

| ID | Scenariusz (skrót) | Test negatywny |
|---|---|---|
| 01 | cztery hosty, każdy swoja rola | `security-regression` „wrong area”; `unit/security-headers` (tabela tras); `host-proxy`; `e2e/auth-trusted` |
| 02 | niezalogowany do obu paneli | `security-regression` (anonim: każdy handler 401/403/404 bez danych, DB bez zmian); `e2e/security-headers` (HTML i API anonimowo) |
| 03 | konto Alfy w panelu superadmina | `security-regression` (rola admina na hoście platformy i trasy `platform`); `auth-authorization` |
| 04 | konto Alfy w panelu Bety | `security-regression` (cookie A na hoście B, ID B); `auth-authorization` |
| 05 | cudze ID pojazdu w odczycie | `security-regression` (ID B na hoście A, wszystkie handlery `admin`); `fleet-mutations`, `vehicle-images` |
| 06 | cudze ID blokady/zdjęcia w edycji i usunięciu | j.w. (PATCH/DELETE z ID B, brak zmian w DB); `availability-blocks`, `vehicle-images` |
| 07 | cudze ID rozmowy | `chat.test.ts` (podmieniony `conversationId`, kursor B); `security-regression` |
| 08 | publiczna oferta bez danych prywatnych | `security-regression` (po rozgrzaniu A i B brak `NOTE-`, `REF-`, `INT-`, `operatorNote`, typu blokady); `public-offer` |
| 09 | `/admin` i admin API na hoście publicznym | `security-regression`, `unit/security-headers`, `e2e/security-headers` (publiczny i marketing: 404) |
| 10 | nieznany host | `security-regression` (host bez mapowania na każdej trasie), `host-proxy`, `custom-domain-lifecycle` |
| 32 | HTML/skrypt w wiadomości lub opisie | `security-regression` (treść zwracana jako JSON, ustawienia z markupem odrzucone), `e2e/security-headers` (przeglądarka: handler inline zablokowany, brak naruszeń CSP strony), `company-settings`, `chat-text` |
| 33 | cache Alfy, potem Beta | `security-regression` (naprzemienne odczyty A/B/A/B, brak obcych markerów, `no-store` na każdej odpowiedzi), `public-offer`, `vehicle-images` |
| 34 | mutacja z siostrzanej subdomeny | `security-regression` (10 wariantów Origin na każdej mutacji, ważna sesja, DB bez zmian), `e2e/security-headers` (HTTP, siostrzane hosty) |
| 45 | drugi aktywny administrator / konto do innej firmy | `security-regression` (INSERT drugiego admina odrzucony; zaproszenie dla firmy z administratorem odrzucone), `schema-contract` |
| 47 | admin firmy woła mutację publicznych danych | `company-settings` (macierz D-01 bezpośrednio przez API), `security-regression` (trasy `platform` dla admina: odmowa) |
| 53 | logowanie bez drugiego składnika | `security-regression` (sesja bez dowodu MFA dla admina i superadmina na każdym handlerze), `auth-http`, `auth.test.ts` |

Przejście: wszystkie powyższe zielone na `Stan` w PR. Sprawdzenie skuteczności (test pada bez poprawki): wyłączenie sprawdzania Origin w `actor()` wywala TEST-MVP-34; cofnięcie ograniczonego parsera pozwala utworzyć pojazd z ciałem 70 KB, a cofnięcie limitu zaproszenia daje 404 zamiast 429.

## 5. Skan zależności i sekretów (#10)

- Job `Dependency audit`: `pnpm audit --prod --audit-level high`, blokujący. Lokalnie 27.10.2026: brak znanych podatności (zależności produkcyjne oraz pełne drzewo). Audyt nie dowodzi braku nieznanych podatności.
- Job `Secret scan`: gitleaks 8.30.1 (archiwum z weryfikacją SHA-256) na pełnej historii, `--redact`, reguły domyślne plus przejrzana lista wyjątków `.gitleaks.toml`. Lokalnie niewykonany (brak binarium); wynik daje CI. Nie dubluję tych jobów.
- Dodatkowo (#57): test `e2e/security-headers` skanuje zbudowany bundle klienta i `public/` pod kątem wartości sekretów środowiska i nazw zmiennych serwerowych oraz zmiennych `NEXT_PUBLIC_*`.

## 6. Znaleziska #57

Poprawione, każde z testem padającym bez poprawki:

| ID | Problem | Poprawka | Test |
|---|---|---|---|
| S1 | brak nagłówków bezpieczeństwa i CSP | `security-headers.mjs`, `src/modules/tenancy/csp.ts`, `src/proxy.ts` | `unit/security-headers`, `e2e/security-headers` |
| S2 | JSON czytany bez limitu (5 niezależnych parserów, w tym anonimowe wejścia: dostępność, aktywacja, logowanie) | `src/modules/tenancy/json-body.ts`: 64 KiB (auth 16 KiB, 413), licznik także dla chunked | `unit/json-body`, `security-regression` („bounded bodies”) |
| S3 | `?search=%00` na listach floty i firm oraz `?vehicle=%00` w kontakcie dawały 500 (NUL w PostgreSQL) | odrzucenie znaków sterujących w filtrze, wzorzec sluga w `buildContact` | `security-regression` („safe parsing”) |
| S4 | `GET /api/auth/invitation/{token}` bez limitu i bez obsługi błędu | 60/min na adres zaufanego proxy, `try/catch` | `security-regression` („rate limit”) |

Znalezione poza zakresem tego przebiegu (zgłoszone orkiestratorowi, bez zmian kodu):

- W1 (niskie/średnie): handshake WS (`src/modules/chat/realtime.ts`, funkcja `handshake`) nie ma limitu na źródło. Nieuwierzytelnione próby z losowym ciasteczkiem kosztują zapytania `HostMapping` i `session`; ogranicza je tylko pula 2000 równoległych połączeń. Wymaga decyzji, skąd proces WS zna adres klienta za proxy (kontrakt zaufanego adaptera, #90).
- W2 (niskie): strony HTML (`src/app/page.tsx`, `src/app/admin/page.tsx`) nie mają limitu żądań, a każdy hit robi zapytania do bazy. Strony są placeholderami; limit na krawędzi lub w Proxy należy dodać razem z implementacją UI.
- W3 (utrzymanie): kontrola Origin jest skopiowana w pięciu miejscach (`fleet/http.ts`, `service-period/http.ts`, `organizations/http.ts`, `auth/invitation/[token]/route.ts`, `auth/[...all]/route.ts`). Zachowanie jest identyczne i pokryte macierzą, ale poprawka musi być powtórzona pięć razy. Do rozważenia wspólny moduł.
- W4 (do sprawdzenia na stagingu): kontrola Origin porównuje protokół z `request.url`; za terminacją TLS adres żądania musi przekazywać `https`, inaczej mutacje będą odrzucane (bezpieczny kierunek błędu).

## 7. Izolacja A/B: media, cache, jobs, WS, DTO

| Obszar | Co sprawdzono | Dowód |
|---|---|---|
| DTO | publicznie tylko PUBLISHED i dostępny/niedostępny; `internalNote`, `reference`, typ blokady i dane okresu poza API i HTML; `operatorNote` poza odczytem admina | `public-offer`, `availability-http`, `security-regression` |
| Media | podmiana ID zdjęcia/media na cudze: 404 identyczne jak brak; podgląd i warianty za sesją, `no-store`; `/_next/image` nie obsługuje mediów; archiwum i wygaśnięcie okresu zamykają publiczne bajty | `vehicle-images`, `preview`, `e2e/vehicle-images`, `security-regression` |
| Cache | wszystkie publiczne odpowiedzi `no-store`; po zmianie blokady kolejny odczyt jest świeży; rozgrzanie A nie wpływa na B | `security-regression`, `availability-http`, `service-period-public` |
| Jobs | zadanie niesie firmę; przy wykonaniu sprawdzany jest aktualny administrator, firma i wersja okresu; zarchiwizowana firma nie dostaje poczty | `jobs-review-regressions`, `jobs-worker`, `service-reminders` |
| WS `/ws` | Origin, host, rola, firma; zdarzenia nie przechodzą między firmami; cofnięcie sesji i archiwizacja zamykają połączenie, kolejne ramki odmówione | `chat-realtime` |
| WS `/ws/platform` | **do dopisania po scaleniu #170**: odrzucenie admina firmy, publicznego Origin i sesji bez MFA; zdarzenia platformy poza połączeniami A/B; cofnięcie sesji superadmina zamyka kanał; limity ramek i połączeń | planowane |

## 8. Pentest na stagingu: `not-run` (zależy od #90)

Nie wykonano żadnego ataku poza lokalną fixture. Do wykonania, gdy powstanie środowisko stagingowe z produkcyjnym TLS, proxy i adresami:

1. Nagłówki i TLS: `Strict-Transport-Security`, `Secure` ciasteczek, CSP w przeglądarkach Chromium/Firefox/WebKit na prawdziwych domenach (alias, panel, platforma, domena własna), przekierowanie HTTP→HTTPS, brak mixed content.
2. Zaufany adres klienta za proxy dostawcy: podrobiony `X-Forwarded-For`/`CF-Connecting-IP`, wspólne adresy NAT, limity auth/publiczne liczone po właściwym adresie; protokół Origin za terminacją TLS (W4).
3. Auth i MFA: brute force hasła i TOTP, ponowne użycie kodu odzyskania, race dwóch równoległych logowań, fiksacja i kradzież sesji, wylogowanie na obu hostach, reset hasła z cudzym hostem.
4. Izolacja z prawdziwymi kontami A/B/superadmin: IDOR na wszystkich trasach (Burp/ZAP z listy z `security-regression`), zmiana sesji w trakcie WS i joba, host header injection, nieznane hosty i `Host` z portem.
5. CSRF i klikanie: mutacja z siostrzanej subdomeny i z domeny osoby trzeciej, formularz z innego Origin, clickjacking (ramka), `Origin: null`, `Content-Type` text/plain i multipart do endpointów JSON.
6. Upload: polyglot (JPEG+HTML/SVG/PHAR), bomby dekompresji, wymiary 12 000 px, powolny i pofragmentowany strumień, równoległe 31. zdjęcie, retry z tym samym kluczem.
7. XSS i wstrzyknięcia: ładunki w opisach, ustawieniach, wiadomościach, nazwach plików, nagłówkach; SSRF przez weryfikację domeny własnej (DNS rebinding, adresy prywatne, przekierowania).
8. DoS aplikacyjny: flood handshake WS bez ciasteczka (W1), strony HTML bez limitu (W2), duże zapytania i filtry, wyczerpanie puli połączeń DB, limit żądań na krawędzi.
9. WS: `/ws` i po scaleniu #170 `/ws/platform`: handshake z obcym Origin, ramki ponad `maxPayload`, wolny klient, flood typing, równoległe sesje ponad limit.
10. Poczta i joby: przekierowanie odbiorcy, nagłówki w ładunku, ponowienia po awarii dostawcy, skaner otwierający link (GET) przed użytkownikiem.
11. Kopie i odtwarzanie (#60): odtworzenie jednej firmy nie nadpisuje innych.
12. Zależności i sekrety na obrazach kontenerów, skan obrazów, konfiguracja panelu hostingu (sekrety, dostęp do bazy, publiczna dostępność S3).

Każdy niewykonany przypadek blokuje odpowiedni zakres wydania (kryterium #57).

## 9. Granice dowodów

Wyniki dotyczą lokalnej fixture (PostgreSQL 18, SeaweedFS S3, Mailpit, loopback), Chromium i zbudowanej aplikacji; nie dowodzą zachowania za proxy dostawcy, w Firefox/WebKit ani odporności na obciążenie. Macierz tras używa bezpośrednich wywołań handlerów z prawdziwymi sesjami i bazą, a `e2e/security-headers` dodaje prawdziwy HTTP, Proxy i przeglądarkę. VoiceOver: `DEFERRED` (#97), nie dotyczy tego zakresu.
