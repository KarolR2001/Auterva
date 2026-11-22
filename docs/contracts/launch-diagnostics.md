# Diagnostyka uruchomienia firmy dla operatora — kontrakt #77

Źródła: [wymagania C-F035, C-F089](../WYMAGANIA_AUTERVA.md), [cykl domeny #23](custom-domain-lifecycle.md), [zaproszenie #20](company-onboarding-invitations.md), [outbox poczty #17](jobs-mail-outbox.md), [przypomnienia #54](service-reminders.md), [odczyt firm #24](platform-companies-read.md). Odbiorca UI: #78 (karta firmy). Odczyt (#77) nie zapisuje; rozszerzenie #417 (D-52, D-63, D-64) dodaje dane stanów karty, akcję „Sprawdź ponownie” i okresowe sprawdzanie aktywnej domeny (sekcja „Rozszerzenie #417”). Zmiany DTO są addytywne.

## Dostęp

`GET /api/platform/companies/{organizationId}/launch-diagnostics` (bez parametrów zapytania). Wyłącznie `SUPERADMIN_AUTERVA` z pełnym MFA na aktywnym hoście `PLATFORM`, wspólny limit odczytów; administrator firmy, host firmy i host publiczny dostają 403/404 jak w pozostałych odczytach platformy. `Cache-Control: no-store`, `X-Request-Id`. Nieznana firma 404, zły UUID 400, parametr zapytania 400. Odczyt czyta jedną firmę w jednej transakcji `RepeatableRead` i jednym `now`; niczego nie zapisuje, nie wywołuje DNS/TLS ani dostawcy poczty (sprawdzenia robi akcja #417 i worker). Stan wynika z ostatniego **zapisanego** sprawdzenia (`checkedAt`, `Job`, `ReminderIntent`); świeże sprawdzenie z karty diagnostyki uruchamia wyłącznie `POST …/launch-diagnostics/recheck` (sekcja „Akcja »Sprawdź ponownie«”), nigdy `POST …/domains/verify`.

## DTO

```ts
type Severity = "OK" | "WAITING" | "UNCERTAIN" | "ERROR" | "NOT_APPLICABLE";
// ERROR = wymaga działania operatora lub definitywna porażka; WAITING = oczekiwanie bez błędu; UNCERTAIN = wynik nieznany.
{
  organizationId: string; generatedAt: string; archived: boolean;
  overall: Severity; // najgorszy z trzech sekcji: ERROR > UNCERTAIN > WAITING > OK; NOT_APPLICABLE nie liczy się
  domain: {
    severity: Severity;
    aliasHost: "ACTIVE" | "PENDING" | "MISSING"; adminHost: "ACTIVE" | "PENDING" | "MISSING"; // hosty PROVIDER
    aliasCheckedAt: string | null; adminCheckedAt: string | null; // #417: ostatnie potwierdzenie stanu hosta (null = nigdy)
    aliasRedirectsToCustomDomain: boolean; // #417, D-64: adres Autervy nie serwuje strony, tylko przekierowuje na domenę własną
    customDomain: null | {
      hostname: string; status: "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY" | "ACTIVE";
      state: "NOT_CHECKED" | "WAITING" | "FAILED" | "READY" | "ACTIVE";
      category: "OWNERSHIP" | "DNS" | "TLS" | "ROUTING" | "CONFIG" | null;
      failureCode: FailureCode | "UNKNOWN" | null; checkedAt: string | null; version: number;
      tlsNotAfter: string | null;                                 // #417: koniec ważności certyfikatu z ostatniego udanego sprawdzenia
      tlsExpiry: "OK" | "EXPIRING_SOON" | "EXPIRED" | "UNKNOWN";  // #417: próg 21 dni; UNKNOWN = brak daty
      proofs: { ownership: boolean; routing: boolean; tls: boolean };
      retry: { action: "VERIFY_DOMAIN"; allowed: boolean; reason: "PLATFORM_CONFIG_REQUIRED" | null }; // = „Sprawdź ponownie” (recheck), patrz „Retry”
    };
  };
  invitation: {
    severity: Severity; state: "NOT_APPLICABLE" | "NOT_ISSUED" | "ISSUED" | "EXPIRED";
    invitationId: string | null; expiresAt: string | null;
    delivery: null | { cause: MailCause | null; /* #417 */ state: "QUEUED" | "RETRYING" | "SENDING" | "ACCEPTED_BY_PROVIDER" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN";
      errorCode: MailCode | null; attempts: number; maxAttempts: number;
      lastAttemptAt: string | null;   // zakończenie ostatniej próby (completedAt), null w trakcie ponowień
      firstAttemptAt: string | null;  // początek pierwszej wysyłki (okno idempotencji dostawcy 24 h)
      nextAttemptAt: string | null };
    retry: { action: "ISSUE_INVITATION"; allowed: boolean; reason: "OPERATOR_DECISION_REQUIRED" | "ADMIN_HOST_NOT_READY" | null;
      next?: "REVOKE_INVITATION" }; // next tylko przy UNCERTAIN
  };
  lastMail: null | { type: "INVITATION" | "REMINDER"; at: string; // #417; null w archiwum albo bez wysyłek
    state: "QUEUED" | "RETRYING" | "SENDING" | "ACCEPTED_BY_PROVIDER" | "DELIVERED" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN";
    cause: MailCause | null;
    attempts: number; maxAttempts: number | null; // #417: próby i limit z tego samego Job („próba 2 z 5”); null = brak zadania
    nextAttemptAt: string | null };               // #417: planowana kolejna próba (tylko QUEUED/RETRYING)
  reminders: { severity: Severity; items: Array<{ cause: MailCause | null; /* #417 */ offsetDays: number; slotAt: string;
    state: "PENDING" | "QUEUED" | "RETRYING" | "SENDING" | "DELIVERED" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN";
    errorCode: MailCode | null; attempts: number; lastAttemptAt: string | null; nextAttemptAt: string | null;
    retry: { allowed: false; reason: "AUTOMATIC_ONLY" } }> };
}
```

`FailureCode` to kody checkera domeny #23 (`OWNERSHIP_TXT_MISSING`, `OWNERSHIP_TXT_MISMATCH`, `CNAME_MISSING`, `CNAME_MISMATCH`, `ADDRESS_NOT_PUBLIC`, `DNS_ERROR`, `TLS_UNREACHABLE`, `TLS_INVALID`, `ROUTING_MISMATCH`, `DOMAIN_CONFIG_MISSING`). `MailCause` = `PROVIDER_REJECTED` | `PROVIDER_TEMPORARY` | `PLATFORM_CONFIG` | `OUTCOME_UNKNOWN` | `OTHER` (#417). `MailCode` to allowlista kodów jobów/przypomnień (`MAIL_PERMANENT`, `MAIL_TRANSIENT`, `MAIL_OUTCOME_UNKNOWN`, `LEASE_EXHAUSTED`, `RECIPIENT_NOT_ALLOWED`, `STALE_INTENT`, `INVALID_PAYLOAD`, `UNSUPPORTED_JOB_KIND`, `RECIPIENT_INVALID`, `ADMIN_HOST_MISSING`, `DELIVERY_REJECTED`, `DELIVERY_ERROR`, `RESTORE_QUARANTINED`); każda inna wartość (także nieznany `FailureCode`) jest zwracana jako `UNKNOWN`; nieznany kod domeny daje stan `FAILED`.

## Reguły stanu

* **Domena.** Brak sprawdzenia (`checkedAt=null`) to `NOT_CHECKED`, nie błąd. Brak rekordów (`OWNERSHIP_TXT_MISSING`, `CNAME_MISSING`) to `WAITING` (klient jeszcze nie ustawił DNS); niezgodność, adres nie-publiczny, `DNS_ERROR`, TLS, routing i brak konfiguracji platformy to `FAILED` z kategorią. `READY` czeka na jawną aktywację (WAITING). Alias lub host panelu `PENDING`/`MISSING` jest `ERROR` (operator: kontrola infrastruktury / skrypt aktywacji hostów). Nie zwraca tokenu własności, wartości TXT/CNAME ani instrukcji — te zwraca istniejący `GET …/domains`.
* **Zaproszenie.** Dotyczy tylko firmy bez zarejestrowanego admina i niearchiwalnej. Stan dostarczenia pochodzi z `Job` (`MAIL_INVITATION:{id}`), nie z samego zapisu firmy. `ACCEPTED_BY_PROVIDER` oznacza przyjęcie przez dostawcę, nie doręczenie do skrzynki. `FAILED`/`SKIPPED`/wygasłe = `ERROR`; `UNCERTAIN` = `UNCERTAIN`; ostatnia próba to `completedAt` albo `firstSendAt`.
* **Przypomnienia.** Wyłącznie sloty e-mail bieżącej granicy okresu (wcześniejsze lub `SUPERSEDED` nie są pokazywane, więc stare przypomnienie nigdy nie wygląda na aktualne). Dla intencji `QUEUED` stan (`QUEUED`/`RETRYING`/`SENDING`/końcowy), próby, kod, `lastAttemptAt` i `nextAttemptAt` pochodzą z `Job` (bez N+1, ten sam odczyt), nie z kopii na intencji. Severity slotu: `DELIVERED` = OK; `QUEUED`/`RETRYING`/`SENDING` = WAITING; `PENDING` = WAITING, gdy `slotAt <= now` (zaległy, np. worker nie działa) lub były próby, inaczej OK (przyszły slot); `FAILED`/`SKIPPED`/`UNKNOWN` = ERROR; `UNCERTAIN` = UNCERTAIN. Severity sekcji to najgorszy slot. Powtórzenie jest wyłącznie automatyczne (`AUTOMATIC_ONLY`).
* Archiwum: wszystkie sekcje `NOT_APPLICABLE`.

## Retry

| Akcja w DTO | Wywołanie | Gwarancje |
|---|---|---|
| `VERIFY_DOMAIN` (`domain.customDomain.retry`) | `POST …/launch-diagnostics/recheck` `{eventKey}` | Przycisk „Sprawdź ponownie” karty diagnostyki. Nie tworzy firmy ani trialu; aktualizuje `checkedAt` i kod; **nie cofa domeny `ACTIVE`** i nie zmienia przekierowania aliasu. |
| `ISSUE_INVITATION` | `POST …/invitations` `{idempotencyKey}` | Nowe wydanie na 168 h unieważnia poprzedni link; nie tworzy firmy, konta ani trialu (rozpoczyna go aktywacja #22). Retry z tym samym kluczem zwraca zapisany wynik. |

**`domain.customDomain.retry` od #417.** Identyfikator `VERIFY_DOMAIN` zostaje bez zmiany (zgodność DTO), ale oznacza akcję „Sprawdź ponownie”, czyli `POST …/launch-diagnostics/recheck`. Karta diagnostyki **nie woła** `POST …/domains/verify`: to osobna operacja karty domeny (#23), która przy niepełnych dowodach cofa domenę `ACTIVE` do stanu oczekującego i zdejmuje przekierowanie aliasu, z audytem i bez limitu 6/h. `allowed` odpowiada temu, co zrobi `recheck` w chwili odczytu:

* `allowed: false`, `reason: null` — firma zarchiwizowana (`recheck` → `409 DOMAIN_COMPANY_ARCHIVED`);
* `allowed: false`, `reason: "PLATFORM_CONFIG_REQUIRED"` — proces odpowiadający na żądanie nie ma `AUTERVA_CUSTOM_DOMAIN_CNAME_TARGET`; `recheck` firmy z domeną własną zwraca wtedy `409 PLATFORM_CONFIG_REQUIRED` bez próby sieciowej, bez zapisu i bez zużycia limitu. Operator uzupełnia konfigurację platformy; UI wyłącza przycisk;
* w pozostałych przypadkach `allowed: true`, także gdy ostatni zapisany kod to `DOMAIN_CONFIG_MISSING` (zapisany wcześniej przez `domains/verify`): po uzupełnieniu konfiguracji kolejne sprawdzenie zastępuje ten kod.

`allowed` nie zależy już od zapisanego `lastFailureCode` (wcześniej przycisk pozostawał wyłączony także po naprawie konfiguracji). Brak konfiguracji platformy nie jest wynikiem sprawdzenia domeny: ani `recheck`, ani worker nie zapisują z tego powodu `DOMAIN_CONFIG_MISSING`.

`allowed:false` + `OPERATOR_DECISION_REQUIRED` odzwierciedla istniejące `INVITATION_DELIVERY_UNCERTAIN` (409). Świadoma decyzja operatora po `UNCERTAIN` (kontrakty #17/#20) to audytowane odwołanie `REVOKE_INVITATION` (`DELETE …/invitations/{invitationId}`, audyt `INVITATION_REVOKED` z aktorem i sesją), po którym diagnostyka pokazuje `NOT_ISSUED` z `retry.allowed:true`, a `ISSUE_INVITATION` wydaje nowy link. Przy `UNCERTAIN` DTO zawiera `retry.next: "REVOKE_INVITATION"`.

## Znane ograniczenia

* Świadoma weryfikacja z karty domeny (`POST …/domains/verify`, #23) nadal cofa domenę `ACTIVE` do stanu oczekującego i czyści `activatedAt`, więc po niej usunięty przez klienta rekord TXT/CNAME wygląda jak zwykłe `WAITING`. Okresowe sprawdzanie i „Sprawdź ponownie” tego nie robią (#417, D-64): domena zostaje `ACTIVE` ze stanem `FAILED`.
* Stan domeny pochodzi z ostatniego zapisanego sprawdzenia; odczyt nie wykonuje DNS/TLS. Poza zakresem: ponowna wysyłka tego samego payloadu przez operatora.

## Rozszerzenie #417 (D-52, D-63, D-64)

Dane dla stanów `diag-*` karty firmy (#78). Wszystkie pola są addytywne; dotychczasowe zostają (w tym `errorCode`, którego UI nie pokazuje — UI używa `cause`).

* **Certyfikat TLS.** Data `notAfter` liścia jest odczytywana w tym samym bezpiecznym połączeniu sprawdzenia routingu (`rejectUnauthorized`, polityka SSRF, brak dodatkowego gniazda) i zapisywana w `CustomDomain.tlsNotAfter` przy udanym sprawdzeniu. Ostatnią znaną datę zachowuje tylko nieudane sprawdzenie domeny `ACTIVE` (okresowe albo „Sprawdź ponownie”); zwykła weryfikacja domeny w innym stanie oraz `domains/verify` przy niepełnych dowodach czyszczą `tlsNotAfter` razem z dowodami. `tlsExpiry`: `EXPIRING_SOON` gdy zostało ≤ 21 dni, `EXPIRED` gdy data minęła, `UNKNOWN` bez daty. Dla domeny `ACTIVE` bez błędu `EXPIRING_SOON` daje severity `WAITING` (stan `ACTIVE` bez zmian; UI pokazuje ostrzeżenie z `tlsNotAfter`), `EXPIRED` daje `ERROR`.
* **Błąd aktywnej domeny (D-64, reguła zatwierdzona 16.11.2026).** Okresowe lub ręczne „Sprawdź ponownie” domeny `ACTIVE` zapisuje tylko wynik (`checkedAt`, `lastFailureCode`, `tlsNotAfter`) i NIE cofa cyklu życia (bez wpisu audytu). Taka domena ma `status: "ACTIVE"`, `state: "FAILED"`, severity `ERROR`, `category` i `failureCode` z kodu — do udanego sprawdzenia; ten sam `lastFailureCode ≠ null` przy `status: "ACTIVE"` zwraca `GET …/domains`. **Routing się nie zmienia:** domena zostaje aktywnym adresem firmy, a alias Autervy nadal przekierowuje na domenę własną (`aliasRedirectsToCustomDomain: true`), bez awaryjnego powrotu na adres Autervy. Jeśli usterka jest rzeczywista (nie chwilowa), strona firmy może być niedostępna **pod oboma adresami**. UI pokazuje to wprost („domena własna nie odpowiada, strona może być niedostępna”) i nie twierdzi, że adres Autervy działa nadal — o ile `aliasRedirectsToCustomDomain` jest `true`. Kolejny krok operatora:
  1. ustalić z klientem przyczynę według `category` (`DNS`, `TLS`, `ROUTING`, `OWNERSHIP`) i po poprawce użyć „Sprawdź ponownie”; bez działania worker sam powtórzy sprawdzenie w ciągu godziny;
  2. gdy usterka trwa, a strona ma wrócić pod adres Autervy — świadomie wyłączyć domenę z karty domeny (#23): `POST …/domains/verify` (przy niepełnych dowodach cofa domenę do stanu oczekującego i zdejmuje przekierowanie aliasu) albo `DELETE …/domains`. To decyzja operatora, nigdy automat.
* **`aliasCheckedAt` / `adminCheckedAt`** (`HostMapping.checkedAt`) to czas ostatniego potwierdzenia przez platformę, że host Autervy jest `ACTIVE` (skrypt aktywacji hostów, akcja „Sprawdź ponownie”, sprawdzenie domeny własnej) — odczyt stanu, nie próba sieciowa; etykieta w UI nie może sugerować testu sieci. `null` = nigdy.
* **`aliasRedirectsToCustomDomain`** — `true`, gdy host aliasu ma ustawiony cel przekierowania (`HostMapping.canonicalTarget`), czyli od aktywacji domeny własnej do jej cofnięcia lub usunięcia.
* **`lastMail`** to jedno zdarzenie: ostatnie spośród zaproszenia (ostatnie wydanie, także unieważnione lub zużyte) i przypomnień bieżącej granicy okresu (sloty `PENDING` nie są zdarzeniami); przy remisie wygrywa zaproszenie. Czas `at`: `completedAt` → `firstSendAt` → `runAt` zadania (przypomnienie bez zadania: `deliveredAt`/`updatedAt` intencji); `completedAt` zapisują tylko przyjęcie przez dostawcę i pominięcie, więc dla `RETRYING`, `FAILED` i `UNCERTAIN` jest to początek pierwszej wysyłki. `attempts`, `maxAttempts` i `nextAttemptAt` pochodzą z tego samego `Job` co stan (zaproszenie: `MAIL_INVITATION:{id}`; przypomnienie: zadanie intencji); bez zadania `attempts` to licznik intencji (zaproszenie: 0), `maxAttempts` jest `null`. `nextAttemptAt` jest ustawione tylko dla `QUEUED`/`RETRYING`. **Zaproszenie wykorzystane** (`usedAt`) jest zgłaszane jako `state: "DELIVERED"`, `cause: null`, `nextAttemptAt: null` niezależnie od zapisanego wyniku zadania: użycie linku dowodzi, że wiadomość dotarła, więc zarejestrowana firma nie pokazuje „wyniku niepewnego” ani błędu po starym zaproszeniu. **Reset hasła (`MAIL_PASSWORD_RESET`) nie występuje nigdzie w diagnostyce** (D-63). Odpowiedź nie zawiera adresów, treści, tokenów ani kodów dostawcy. Archiwum: `null`.
* **`cause`** mapuje kod: `MAIL_PERMANENT`/`DELIVERY_REJECTED`/`RECIPIENT_INVALID` → `PROVIDER_REJECTED`; `MAIL_TRANSIENT`/`DELIVERY_ERROR`/`LEASE_EXHAUSTED` → `PROVIDER_TEMPORARY`; `RECIPIENT_NOT_ALLOWED`/`ADMIN_HOST_MISSING`/`INVALID_PAYLOAD`/`UNSUPPORTED_JOB_KIND` → `PLATFORM_CONFIG`; `MAIL_OUTCOME_UNKNOWN` → `OUTCOME_UNKNOWN`; każdy inny (także nieznany) → `OTHER`; brak kodu → `null`. Odpowiedź nie zawiera kodów dostawcy ani treści.

### Akcja „Sprawdź ponownie”

`POST /api/platform/companies/{organizationId}/launch-diagnostics/recheck`, body `{"eventKey": "<uuid>"}` (inne klucze 400). To jedyne wywołanie przycisku „Sprawdź ponownie” w bloku domeny karty diagnostyki (`retry.action = VERIFY_DOMAIN`). Wyłącznie `SUPERADMIN_AUTERVA` z pełnym MFA na hoście `PLATFORM`, kontrola `Origin` i wspólny limit zapisów jak pozostałe zapisy platformy; nieznana firma i inna rola to 403. Firma zarchiwizowana: `409 DOMAIN_COMPANY_ARCHIVED`. Firma z domeną własną, gdy platforma nie ma `AUTERVA_CUSTOM_DOMAIN_CNAME_TARGET`: `409 PLATFORM_CONFIG_REQUIRED` (bez próby sieciowej i zapisu; zgodne z `retry.allowed: false`). Limit **6 na godzinę na firmę** (429 `RATE_LIMITED` + `Retry-After`; żądania odrzucone przed sprawdzeniem — 400, 403, `409 DOMAIN_COMPANY_ARCHIVED`, `409 PLATFORM_CONFIG_REQUIRED` — go nie zużywają). Działanie: domena `ACTIVE` — odświeżenie wyniku bez zmiany cyklu życia i routingu (D-64); domena w innym stanie — zwykła weryfikacja (`verifyDomain`, audyt `DOMAIN_CHANGED` tylko przy zmianie stanu; `eventKey` jest kluczem tego audytu, powtórzony po zmianie stanu daje `409 EVENT_KEY_CONFLICT`); brak domeny — tylko potwierdzenie hostów Autervy (nie wymaga konfiguracji CNAME). Zmiana domeny w trakcie sprawdzenia: `409 DOMAIN_VERSION_CONFLICT`. Odpowiedź 200 to pełne DTO diagnostyki jak w GET (`no-store`). Błąd serwera (5xx, np. 500/503) oznacza **wynik nieznany**: nic nie zostało potwierdzone, UI pokazuje „Wynik niepewny” i ostatni potwierdzony wynik z datą (sprawdzenie sieciowe, które nie zdołało się wykonać, jest wynikiem `FAILED` z kodem, nie 5xx). Błędy są logowane w kategorii `domains` (bezpieczny kod, bez nazwy hosta i treści). Poczta nie ma aktywnego sprawdzenia: „Sprawdź ponownie” w jej bloku to ponowny odczyt GET.

### Okresowe sprawdzanie

Worker (`runWorkerLoop`, opcja `domains`) co minutę wybiera do 3 domen `ACTIVE` niezarchiwizowanych firm (najdawniej sprawdzone pierwsze), których `checkedAt` jest pusty, starszy niż **24 h** albo — gdy ostatnie sprawdzenie się nie powiodło (`lastFailureCode ≠ null`) — starszy niż **1 h**, więc chwilowa usterka (także resolvera po stronie workera) znika z diagnostyki najpóźniej po ok. godzinie. Każda domena jest odświeżana osobno (błąd jednej nie zatrzymuje reszty; wynik zmieniony w trakcie sondy jest pomijany), tym samym bezpiecznym sprawdzaniem co weryfikacja ręczna (SSRF, TLS) i bez zmiany cyklu życia.

Sprawdzanie biegnie **poza pętlą poczty**: paczka nie jest oczekiwana przez pętlę (jedna sonda trwa do ok. 24 s), więc zaproszenia, reset hasła i przypomnienia są pobierane bez opóźnienia; naraz działa najwyżej jedna paczka. Przy zatrzymaniu workera trwająca sonda kończy zapis, kolejna domena nie jest zaczynana.

**Konfiguracja.** Okresowe sprawdzanie wymaga `AUTERVA_CUSTOM_DOMAIN_CNAME_TARGET` w środowisku **workera** (tej samej wartości co w procesie web). Bez niej worker pomija sprawdzanie domen (ostrzeżenie w logu przy starcie, operation `domains.recheck`) i żadna domena nie dostaje `DOMAIN_CONFIG_MISSING`; poczta działa bez zmian.

### Migracja

`20261112120000_launch_diagnostics_checks_issue_417`: dwie kolumny `timestamptz` NULL (`CustomDomain.tlsNotAfter`, `HostMapping.checkedAt`); rollback w nagłówku pliku. Istniejące wiersze mają `NULL` (UI: brak daty do pierwszego sprawdzenia; pierwsze okresowe sprawdzenie uzupełni domeny aktywne w ciągu doby, po 3 na minutę).
