# Cykl domeny własnej i przekierowanie aliasu — kontrakt techniczny #23

Źródła: [PRD 3.1 §3.4, REQ-MVP-24, FLOW-MVP-12](../product/PRD.md), [wymagania C-F086–089, C-N008, C-N058](../WYMAGANIA_AUTERVA.md), [architektura §6 i §14](../ARCHITEKTURA_AUTERVA.md), [hosty i TLS](environments-hosts-operations.md), [okres usługi](service-period-runtime.md) oraz [macierz uprawnień ustawień](company-settings-and-vehicle-publication.md). Dokument opisuje **mechanizm aplikacji**. Konfiguracja Cloudflare, DNS strefy Autervy i domen klientów, certyfikaty i provisioning to kontrola infrastruktury #10/#58; nie jest tu wykonana ani zakupiona.

## Kto zarządza

Tylko `SUPERADMIN_AUTERVA` na hoście `PLATFORM` (własna tożsamość, MFA, zgodny `Origin`, wspólny budżet 60 zapisów/min). Administrator firmy ma w macierzy odczyt stanu domeny, ale ten kontrakt nie wystawia mu endpointu ani zapisu; widok panelu firmy należy do osobnego zadania. Brak domeny własnej nie blokuje publikacji: alias `{slug}.{publicDomainAutervy}` działa od pierwszej rejestracji zgodnie z bramką okresu.

## Model

`HostMapping` pozostaje jedynym rejestrem hostów (globalnie unikalny, znormalizowany hostname).

| Host | `kind` | `area` | `status` | `canonicalTarget` |
|---|---|---|---|---|
| Alias `{slug}.{publicDomainAutervy}` | `PROVIDER` | `COMPANY_PUBLIC` | `PENDING`/`ACTIVE` (aktywuje zaproszenie #22) | `null`, po aktywacji domeny własnej hostname domeny własnej |
| Domena własna | `CUSTOM` | `COMPANY_PUBLIC` | `PENDING` do aktywacji, potem `ACTIVE` | zawsze `null` |

`CustomDomain` (1:1 z hostem `CUSTOM`, najwyżej jedna na firmę, złożone FK pilnuje tej samej firmy) trzyma stan cyklu, losowy token własności, znaczniki dowodów, ostatni kod niepowodzenia i `version`. DB chroni: `kind` ∈ `PROVIDER|CUSTOM`, `CUSTOM` tylko dla `COMPANY_PUBLIC`, `canonicalTarget` tylko dla aliasu `PROVIDER`, stan ∈ zbiór poniżej, `ACTIVE` wymaga kompletu dowodów i `activatedAt`.

### Stany `CustomDomain.status`

```text
(brak) --PUT--> PENDING_OWNERSHIP --TXT ok--> PENDING_ROUTING --CNAME+TLS+routing ok--> READY --activate--> ACTIVE
   ^                  ^                              ^                                     |        |
   |                  +---------- niepowodzenie ------+------------ niepowodzenie ---------+        |
   +------------------------------------------- DELETE / zmiana hosta -------------------------------+
```

* Samo wpisanie domeny daje `PENDING_OWNERSHIP`: host `CUSTOM` ma `status=PENDING`, więc nie jest publicznym adresem (`resolveHostMapping` go nie zwraca), a alias nadal obsługuje ofertę.
* `READY` oznacza komplet dowodów, nie publikację. Dopiero jawne `activate` ustawia `ACTIVE`, host `CUSTOM` na `ACTIVE` i `canonicalTarget` aliasu — jedną transakcją pod blokadą wiersza organizacji, z audytem `DOMAIN_CHANGED`.
* Weryfikacja domeny `ACTIVE`, która nie przechodzi kompletu dowodów, cofa ją do odpowiedniego stanu oczekującego, host `CUSTOM` do `PENDING` i czyści `canonicalTarget` w tej samej transakcji; alias ponownie sam obsługuje ofertę (zły DNS/TLS → oczekuje, nigdy przekierowanie na martwy adres).
* Zmiana domeny = `DELETE` + nowy `PUT`: nowy token, nowe dowody. Usunięty host zwalnia nazwę; poprzedni dowód nie przechodzi na inną firmę.

## Walidacja hostname (wejście)

Wejście to wyłącznie nazwa hosta (nie URL). Bez białych znaków na brzegach, po zamianie na małe litery i zdjęciu końcowej kropki `normalizeHostname` musi ją zaakceptować (ASCII/punycode, etykiety ≤63, całość ≤253). Dodatkowo odrzucane są: schemat, ścieżka, port, user-info, `*` (wildcard), litery inne niż ASCII, adres IP (ostatnia etykieta liczbowa lub literał IPv6), pojedyncza etykieta, apex bez poddomeny (**mniej niż 3 etykiety**; apex wymaga osobnej kontroli operatora u dostawcy DNS klienta, zgodnie z kontraktem hostów), TLD specjalnego przeznaczenia (`localhost`, `local`, `internal`, `invalid`, `onion`, `arpa`, `lan`, `corp`, `home`, `intranet`, `private`) oraz każdy host równy lub podrzędny wobec skonfigurowanych baz Autervy (`AUTERVA_ADMIN_BASE_DOMAIN`, `AUTERVA_PUBLIC_BASE_DOMAIN`). Host już obecny w `HostMapping` — dowolnej firmy, obszaru, rodzaju i stanu — daje `409 DOMAIN_TAKEN` bez wskazywania właściciela; równoległa próba kończy się naruszeniem unikalności mapowanym na ten sam kod.

## Dowody i instrukcja DNS

Instrukcja (tylko dla superadmina) zawiera trzy elementy; dla klienta Auterva przekazuje je poza aplikacją:

1. **Własność:** rekord TXT `_auterva-challenge.<hostname>` o wartości `auterva-verification=<token>`; token to 32 losowe bajty base64url, unikalny dla pary firma–host.
2. **Routing DNS:** `<hostname>` CNAME na `AUTERVA_CUSTOM_DOMAIN_CNAME_TARGET` (cel Cloudflare for SaaS wybrany w #3/#58). Brak konfiguracji celu daje `DOMAIN_CONFIG_MISSING`, nie „gotowe”.
3. **TLS i routing aplikacji:** `https://<hostname>/.well-known/auterva-domain-check` musi odpowiedzieć 200 z `proof = sha256("auterva-routing-v1\n" + hostname + "\n" + token)` po ważnym łańcuchu certyfikatu obejmującym dokładnie ten host. Endpoint zwraca wyłącznie ten skrót i wyłącznie dla hostu `CUSTOM` w dowolnym stanie; dla innych hostów jest to neutralne 404 (Proxy i handler).

Kolejność jest wiążąca: sprawdzenie własności jest warunkiem **jakiejkolwiek** próby sieciowej wobec hosta (CNAME, adresy, TLS). Host bez dowodu własności nie jest łączony — zawęża to powierzchnię SSRF do hostów, które kontrolują rekord z naszym tokenem.

### Bezpieczeństwo sprawdzaczy (SSRF)

* Rozwiązane adresy A/AAAA muszą być publiczne. Zablokowane: `0.0.0.0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`, `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`, `224/4`, `240/4`, IPv6 `::`, `::1`, `::ffff:0:0/96`, `64:ff9b::/96`, `100::/64`, `2001::/23`, `2001:db8::/32`, `2002::/16`, `fc00::/7`, `fe80::/10`, `ff00::/8`. Pusty wynik albo choćby jeden adres niepubliczny odrzuca całość (`ADDRESS_NOT_PUBLIC`).
* Połączenie TLS idzie **na zwalidowany adres** (przypięty, bez ponownego rozwiązywania nazwy — brak DNS rebinding) z SNI i nagłówkiem `Host` równym hostowi. Bez śledzenia przekierowań, limit czasu 5 s, limit odpowiedzi 1 KiB, tylko `GET`, bez nagłówków uwierzytelniających. Weryfikacja certyfikatu jest zawsze włączona (łańcuch, termin, nazwa).
* Polityka adresów jest parametrem konstruktora sprawdzacza. Fabryka produkcyjna `createProductionDomainChecker()` nie przyjmuje polityki, zaufanych CA ani portu i nie czyta ich ze zmiennych środowiska; testowe zaufanie certyfikatów i adresy loopback istnieją wyłącznie w konstruktorze używanym przez testy z jawnie wstrzykniętym resolverem. Test jednostkowy pilnuje, że fabryka produkcyjna odrzuca loopback.

### Kody niepowodzenia (`lastFailureCode`, tylko dla superadmina)

`OWNERSHIP_TXT_MISSING`, `OWNERSHIP_TXT_MISMATCH`, `CNAME_MISSING`, `CNAME_MISMATCH`, `ADDRESS_NOT_PUBLIC`, `DNS_ERROR`, `TLS_UNREACHABLE`, `TLS_INVALID` (zły łańcuch, termin lub nazwa), `ROUTING_MISMATCH` (TLS poprawny, odpowiedź inna niż oczekiwany skrót lub status), `DOMAIN_CONFIG_MISSING`. Ani kody, ani token, ani wynik sprawdzenia nie trafiają do publicznego API, HTML, RSC, cache ani logów żądań.

## API platformy

Wszystkie ścieżki z końcowym `/`, `Cache-Control: no-store`, `X-Request-Id`; aktor jak w [mutacjach okresu](service-period-runtime.md#mutacje-dla-superadmina-i-panelu-27). Błędne żądanie zużywa budżet zapisu.

| Metoda i ścieżka | JSON | Wynik 200 |
|---|---|---|
| `GET /api/platform/companies/{id}/domains/` | — | `{ aliasHostname, domain: null \| { hostname, status, instruction, lastFailureCode, checkedAt, activatedAt, version } }` |
| `PUT …/domains/` | `{ hostname, expectedVersion: int \| null, eventKey }` | stan jak wyżej; `expectedVersion=null` oznacza brak domeny, liczba — zamianę istniejącej |
| `DELETE …/domains/` | `{ expectedVersion, eventKey }` | `{ domain: null }` |
| `POST …/domains/verify/` | `{ eventKey }` | stan po sprawdzeniu |
| `POST …/domains/activate/` | `{ expectedVersion, eventKey }` | stan `ACTIVE` |

Odmowy: `400 INVALID_INPUT|INVALID_ORGANIZATION_ID|INVALID_HOSTNAME`, `403 FORBIDDEN`, `404 NOT_FOUND`, `409 DOMAIN_TAKEN|DOMAIN_VERSION_CONFLICT|EVENT_KEY_CONFLICT`, `422 DOMAIN_NOT_READY|DOMAIN_CONFIG_MISSING`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`. `verify` nie wymaga wersji klienta, ale wynik sprawdzenia jest stosowany tylko wtedy, gdy host, token i wersja domeny są niezmienione od początku sprawdzenia (inaczej `409 DOMAIN_VERSION_CONFLICT`); sieć jest używana poza transakcją DB, zapis pod blokadą wiersza organizacji. `activate` powtarza pełne sprawdzenie bezpośrednio przed zapisem; niepełne daje `422 DOMAIN_NOT_READY` i zapisuje cofnięcie stanu. Każda zmiana stanu zapisuje audyt `DOMAIN_CHANGED` (pola `status`; hostname tylko jako nazwa zmienionego pola, bez wartości, jak wymaga allowlista audytu).

## Przekierowanie aliasu

Proxy po dopasowaniu aktywnego hosta i dozwolonej trasy obszaru, dla hosta `COMPANY_PUBLIC` z `canonicalTarget`:

1. wywołuje `resolvePublicVisibility(alias)` — bieżący odczyt, bez cache wyniku pozytywnego;
2. dopiero przy wyniku pozytywnym sprawdza, że cel jest aktywnym hostem `CUSTOM`/`COMPANY_PUBLIC` **tej samej firmy** (cel nie pochodzi z żądania; zły rekord nie daje otwartego przekierowania);
3. odpowiada `307` na `https://<cel><ścieżka><query>` (port tylko gdy alias go miał, jak w lokalnym ingressie) z `Cache-Control: no-store`; tylko `GET`/`HEAD`, inne metody dostają neutralne 404.

Przy niewidocznej ofercie (koniec okresu, archiwum, blokada po przywróceniu, brak pierwszej rejestracji) lub niespójnym celu odpowiedź to neutralne `404` bez `Location`; alias z ustawionym celem nigdy nie serwuje treści sam. Tymczasowy `307` + `no-store` jest świadomy: stały `308` mógłby zostać zapamiętany przez przeglądarkę i prowadzić do wyłączonej domeny po cofnięciu aktywacji. Domena własna wywołuje tę samą bramę w swoich handlerach. Host panelu (`COMPANY_ADMIN`) i nieznany host nigdy nie są publicznym fallbackiem: `/` na panelu i na nieznanym hoście kończy się neutralnym `404`.

Odbiór okresu (kryterium integracji z #21): rozgrzać alias i domenę własną, skrócić okres (`paidThrough`, także skrócenie opłaty przy trialu z `publicRequiresPaid`), sprawdzić ponownie oba adresy z tą samą ścieżką i query — oba `404`, żaden bez ujawnienia oferty ani `Location`.

## Co jest poza tym zadaniem

Provisioning Cloudflare for SaaS i rekordów DNS strefy, realny cel CNAME i certyfikaty (#10/#58), zakup domen, harmonogram cyklicznej kontroli domen w workerze (kontrola jest dziś wyzwalana przez superadmina), apex u dostawcy DNS klienta, endpoint i UI odczytu dla administratora firmy.
