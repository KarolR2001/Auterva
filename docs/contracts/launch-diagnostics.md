# Diagnostyka uruchomienia firmy dla operatora — kontrakt #77

Źródła: [wymagania C-F035, C-F089](../WYMAGANIA_AUTERVA.md), [cykl domeny #23](custom-domain-lifecycle.md), [zaproszenie #20](company-onboarding-invitations.md), [outbox poczty #17](jobs-mail-outbox.md), [przypomnienia #54](service-reminders.md), [odczyt firm #24](platform-companies-read.md). Odbiorca UI: #78 (karta firmy). Dokument opisuje **odczyt**; nie dodaje zapisu, migracji ani nowego retry.

## Dostęp

`GET /api/platform/companies/{organizationId}/launch-diagnostics` (bez parametrów zapytania). Wyłącznie `SUPERADMIN_AUTERVA` z pełnym MFA na aktywnym hoście `PLATFORM`, wspólny limit odczytów; administrator firmy, host firmy i host publiczny dostają 403/404 jak w pozostałych odczytach platformy. `Cache-Control: no-store`, `X-Request-Id`. Nieznana firma 404, zły UUID 400, parametr zapytania 400. Odczyt czyta jedną firmę w jednej transakcji `RepeatableRead` i jednym `now`; niczego nie zapisuje, nie wywołuje DNS/TLS ani dostawcy poczty. Stan wynika z ostatniego **zapisanego** sprawdzenia (`checkedAt`, `Job`, `ReminderIntent`); świeże sprawdzenie domeny uruchamia istniejące `POST …/domains/verify`.

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
    customDomain: null | {
      hostname: string; status: "PENDING_OWNERSHIP" | "PENDING_ROUTING" | "READY" | "ACTIVE";
      state: "NOT_CHECKED" | "WAITING" | "FAILED" | "READY" | "ACTIVE";
      category: "OWNERSHIP" | "DNS" | "TLS" | "ROUTING" | "CONFIG" | null;
      failureCode: FailureCode | "UNKNOWN" | null; checkedAt: string | null; version: number;
      proofs: { ownership: boolean; routing: boolean; tls: boolean };
      retry: { action: "VERIFY_DOMAIN"; allowed: boolean; reason: "PLATFORM_CONFIG_REQUIRED" | null };
    };
  };
  invitation: {
    severity: Severity; state: "NOT_APPLICABLE" | "NOT_ISSUED" | "ISSUED" | "EXPIRED";
    invitationId: string | null; expiresAt: string | null;
    delivery: null | { state: "QUEUED" | "RETRYING" | "SENDING" | "ACCEPTED_BY_PROVIDER" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN";
      errorCode: MailCode | null; attempts: number; maxAttempts: number;
      lastAttemptAt: string | null;   // zakończenie ostatniej próby (completedAt), null w trakcie ponowień
      firstAttemptAt: string | null;  // początek pierwszej wysyłki (okno idempotencji dostawcy 24 h)
      nextAttemptAt: string | null };
    retry: { action: "ISSUE_INVITATION"; allowed: boolean; reason: "OPERATOR_DECISION_REQUIRED" | "ADMIN_HOST_NOT_READY" | null;
      next?: "REVOKE_INVITATION" }; // next tylko przy UNCERTAIN
  };
  reminders: { severity: Severity; items: Array<{ offsetDays: number; slotAt: string;
    state: "PENDING" | "QUEUED" | "RETRYING" | "SENDING" | "DELIVERED" | "FAILED" | "UNCERTAIN" | "SKIPPED" | "UNKNOWN";
    errorCode: MailCode | null; attempts: number; lastAttemptAt: string | null; nextAttemptAt: string | null;
    retry: { allowed: false; reason: "AUTOMATIC_ONLY" } }> };
}
```

`FailureCode` to kody checkera domeny #23 (`OWNERSHIP_TXT_MISSING`, `OWNERSHIP_TXT_MISMATCH`, `CNAME_MISSING`, `CNAME_MISMATCH`, `ADDRESS_NOT_PUBLIC`, `DNS_ERROR`, `TLS_UNREACHABLE`, `TLS_INVALID`, `ROUTING_MISMATCH`, `DOMAIN_CONFIG_MISSING`). `MailCode` to allowlista kodów jobów/przypomnień (`MAIL_PERMANENT`, `MAIL_TRANSIENT`, `MAIL_OUTCOME_UNKNOWN`, `LEASE_EXHAUSTED`, `RECIPIENT_NOT_ALLOWED`, `STALE_INTENT`, `INVALID_PAYLOAD`, `UNSUPPORTED_JOB_KIND`, `RECIPIENT_INVALID`, `ADMIN_HOST_MISSING`, `DELIVERY_REJECTED`, `DELIVERY_ERROR`, `RESTORE_QUARANTINED`); każda inna wartość (także nieznany `FailureCode`) jest zwracana jako `UNKNOWN`; nieznany kod domeny daje stan `FAILED`.

## Reguły stanu

* **Domena.** Brak sprawdzenia (`checkedAt=null`) to `NOT_CHECKED`, nie błąd. Brak rekordów (`OWNERSHIP_TXT_MISSING`, `CNAME_MISSING`) to `WAITING` (klient jeszcze nie ustawił DNS); niezgodność, adres nie-publiczny, `DNS_ERROR`, TLS, routing i brak konfiguracji platformy to `FAILED` z kategorią. `READY` czeka na jawną aktywację (WAITING). Alias lub host panelu `PENDING`/`MISSING` jest `ERROR` (operator: kontrola infrastruktury / skrypt aktywacji hostów). Nie zwraca tokenu własności, wartości TXT/CNAME ani instrukcji — te zwraca istniejący `GET …/domains`.
* **Zaproszenie.** Dotyczy tylko firmy bez zarejestrowanego admina i niearchiwalnej. Stan dostarczenia pochodzi z `Job` (`MAIL_INVITATION:{id}`), nie z samego zapisu firmy. `ACCEPTED_BY_PROVIDER` oznacza przyjęcie przez dostawcę, nie doręczenie do skrzynki. `FAILED`/`SKIPPED`/wygasłe = `ERROR`; `UNCERTAIN` = `UNCERTAIN`; ostatnia próba to `completedAt` albo `firstSendAt`.
* **Przypomnienia.** Wyłącznie sloty e-mail bieżącej granicy okresu (wcześniejsze lub `SUPERSEDED` nie są pokazywane, więc stare przypomnienie nigdy nie wygląda na aktualne). Dla intencji `QUEUED` stan (`QUEUED`/`RETRYING`/`SENDING`/końcowy), próby, kod, `lastAttemptAt` i `nextAttemptAt` pochodzą z `Job` (bez N+1, ten sam odczyt), nie z kopii na intencji. Severity slotu: `DELIVERED` = OK; `QUEUED`/`RETRYING`/`SENDING` = WAITING; `PENDING` = WAITING, gdy `slotAt <= now` (zaległy, np. worker nie działa) lub były próby, inaczej OK (przyszły slot); `FAILED`/`SKIPPED`/`UNKNOWN` = ERROR; `UNCERTAIN` = UNCERTAIN. Severity sekcji to najgorszy slot. Powtórzenie jest wyłącznie automatyczne (`AUTOMATIC_ONLY`).
* Archiwum: wszystkie sekcje `NOT_APPLICABLE`.

## Retry (istniejące operacje, bez nowych)

| Akcja | Wywołanie | Gwarancje |
|---|---|---|
| `VERIFY_DOMAIN` | `POST …/domains/verify` `{eventKey}` | Nie tworzy firmy ani trialu; aktualizuje `checkedAt` i kod. |
| `ISSUE_INVITATION` | `POST …/invitations` `{idempotencyKey}` | Nowe wydanie na 168 h unieważnia poprzedni link; nie tworzy firmy, konta ani trialu (rozpoczyna go aktywacja #22). Retry z tym samym kluczem zwraca zapisany wynik. |

`allowed:false` + `OPERATOR_DECISION_REQUIRED` odzwierciedla istniejące `INVITATION_DELIVERY_UNCERTAIN` (409). Świadoma decyzja operatora po `UNCERTAIN` (kontrakty #17/#20) to audytowane odwołanie `REVOKE_INVITATION` (`DELETE …/invitations/{invitationId}`, audyt `INVITATION_REVOKED` z aktorem i sesją), po którym diagnostyka pokazuje `NOT_ISSUED` z `retry.allowed:true`, a `ISSUE_INVITATION` wydaje nowy link. Przy `UNCERTAIN` DTO zawiera `retry.next: "REVOKE_INVITATION"`.

## Znane ograniczenia

* Po cofnięciu domeny `ACTIVE` do stanu oczekującego `lifecycle.ts` czyści `activatedAt`, więc usunięty przez klienta rekord TXT/CNAME wygląda jak zwykłe `WAITING`; rozróżnienie wymaga cyklicznej kontroli (#58).
* Stan domeny pochodzi z ostatniego zapisanego sprawdzenia; odczyt nie wykonuje DNS/TLS. Poza zakresem: ponowna wysyłka tego samego payloadu przez operatora.
