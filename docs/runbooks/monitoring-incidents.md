# Runbook: monitoring, alerty i obsługa awarii (#58)

Źródła: [kontrakt monitoringu](../contracts/monitoring-alerts.md), D-10 ([wymagania](../WYMAGANIA_AUTERVA.md)), [retencja audytu #108](../contracts/audit-retention-operations.md), [backup/restore #60](backup-restore.md). Dashboard u dostawcy, dostarczenie alertu do prawdziwego dyżurnego i odbiór na adapterze docelowym: not-run (#90, D-16).

## Właściciele i reakcje (D-10)

| Rola | Kto | Reakcja |
|---|---|---|
| `operator` | Właściciel/operator procedury (D-10) | `page`: reakcja od razu, cel potwierdzenia 30 min; `ticket`: następny dzień roboczy |
| `owner` | Właściciel produktu | decyzje: restore z kopii, przełączenie ruchu, rotacja kluczy, zdarzenia bezpieczeństwa |

Obecnie obie role pełni jedna osoba; podział jest w kodzie reguł (`owner`), żeby dało się go rozdzielić bez zmiany reguł. Osoba dyżurna i kanał paging dla produkcji: not-run (#90).

## Jak zacząć

1. Alert zawiera `id` reguły, grupę, właściciela, liczby (bez treści) i link do sekcji poniżej.
2. Znajdź ślad: odpowiedź API ma `X-Request-Id`; ten sam `requestId` jest w logu JSON (`event` `http.internal_error`, `http.unhandled_error`, `request-refused`). Filtruj po `requestId`, `operation`, `outcome`; pola `actorId`/`organizationId` są identyfikatorami, nie danymi osobowymi.
3. Logi nie zawierają treści czatu, tokenów, cookies, haseł, adresów e-mail, kluczy ani treści audytu. Brak takiej treści w logu nie jest błędem do „naprawiania” dodatkowym logowaniem.
4. Zdrowie: `GET /api/health/live/` (proces żyje, bez DB), `/api/health/ready/` (DB, storage, kolejka, migracje; 503 gdy cokolwiek nie działa; szczegóły tylko z tokenem). `/api/health/` to zgodny alias liveness.
5. Cele monitora (`OPS_TARGETS`) obejmują WWW, worker, media-worker, realtime **i worker audytu** (`audit-worker=http://127.0.0.1:<OPS_PORT>/metrics`; `scripts/audit-retention.ts worker` otwiera listener, gdy ustawisz `OPS_PORT`). Bez celu audit-worker alert o jego zatrzymaniu nie powstanie z heartbeat, tylko z `AUDIT_RETENTION_NOT_COMPLETING`/`STALLED`.
6. Metryki: `GET /api/health/metrics/` z `Authorization: Bearer $OPS_METRICS_TOKEN` (bez tokenu w konfiguracji endpoint odpowiada 404). Pozostałe procesy: `OPS_PORT` (`/live`, `/ready`, `/metrics`).

Uwaga W6 ([OWASP_CONTROLS §6](../security/OWASP_CONTROLS.md)): ostrzeżenie Next `Request body exceeded … for <url>` może zawierać token zaproszenia w ścieżce i nie przechodzi przez nasz logger. Do czasu maskowania na proxy/log shipperze dostawcy (#90) nie kopiuj surowych logów procesu WWW poza system logów.

## Sekcje reakcji

### target-down
`TARGET_DOWN` (page, operator): scrape procesu (WWW, worker, realtime) nie działa 3 kolejne razy. Sprawdź, czy proces żyje i `/live`; zrestartuj proces. Restart nie gubi zatwierdzonych mutacji (trwałe joby, lease, wznowienie WS z kursorem); po restarcie sprawdź `/ready` i zniknięcie alertu `JOBS_STALLED`.

### ready-database
`READY_DATABASE`, `DB_POOL_ERRORS`: baza nieosiągalna lub błędy puli. Sprawdź dostawcę DB, limity połączeń, sieć. Liveness pozostaje zielone (restart procesu nie pomoże). `READY_QUEUE`, `READY_MIGRATIONS` i `COLLECTOR_DOWN` są wtedy tłumione (powód `DATABASE_UNAVAILABLE`): jedna awaria to jeden page.

### ready-storage
`READY_STORAGE`, `STORAGE_ERRORS`: bucket niedostępny lub brak konfiguracji (`NOT_CONFIGURED` jest awarią). Sprawdź poświadczenia i endpoint S3. Publiczne i panelowe zdjęcia nie działają do powrotu; zapisy nie są potwierdzane fałszywie.

### ready-queue
`READY_QUEUE`: (przy awarii DB tłumiony) zaległe zadanie nie jest podejmowane od 5 minut. Zobacz [worker](#worker).

### ready-migrations
`READY_MIGRATIONS`: zob. [migrations](#migrations).

### http-5xx
`HTTP_5XX_BURN_FAST` (page: ≥2 % odpowiedzi 5xx w 5 min, min. 20 żądań) i `HTTP_5XX_BURN_SLOW` (ticket: ≥0,5 % w 30 min, min. 100 żądań). Cel dostępności 99,9 % to budżet 0,1 % błędów; progi to ok. 20× i 5× tempo spalania. Wyszukaj w logach `outcome=server_error`, pogrupuj po `operation`/`route`, weź przykładowy `requestId`. Sprawdź ostatni deploy i zależności (`READY_*`). Zdarzenie `http.service_unavailable` (`status: 503`, `TEMPORARILY_UNAVAILABLE`, #314) oznacza wygasły budżet transakcji, `lock_timeout` 5 s (`55P03`), `statement_timeout` 30 s (`57014`), zakleszczenie lub konflikt serializacji: nic nie zapisano, klient ponawia; przy serii szukaj długiej transakcji trzymającej `FOR UPDATE` (`pg_stat_activity`, `pg_locks`). To samo zdarzenie z `operation: proxy.host_lookup` oznacza niedostępną bazę przed handlerem (rozpoznanie hosta w proxy, #412); przyczynę wskazuje `errorCode`: `P1001` lub `ECONNREFUSED` — PostgreSQL nie słucha albo nazwa hosta bazy nie istnieje; `P1008`, `ETIMEDOUT`, `EHOSTUNREACH`, `ENETUNREACH`, `EAI_AGAIN` — sieć lub DNS do bazy (przy braku odpowiedzi sieci 503 pojawia się dopiero po systemowym limicie połączenia TCP, ok. 75 s); `P1017` — zerwane połączenie; `P2037` — brak wolnych połączeń (`53300`); `P2039` lub `P2010` — PostgreSQL zamyka się, startuje albo przerwał zapytanie (`57P01`, `57P02`, `57P03`; w logu jest tylko kod Prisma). Sprawdź `READY_*`, proces i log PostgreSQL, pulę połączeń i sieć. `http.internal_error` z tym samym `operation` (500, bez `Retry-After`) to błąd programu albo konfiguracji połączenia (`P1000`, `P1003`, `P1010`, `P1011`): ponawianie nie pomoże, sprawdź `DATABASE_URL` i ostatni deploy.

### login
`LOGIN_SERVER_ERRORS` (page): błędy 5xx logowania/MFA; sprawdź DB i `BETTER_AUTH_SECRET` (zmiana sekretu psuje MFA, zob. backup-restore). `LOGIN_FAILURE_SPIKE` (ticket, owner): ≥50 nieudanych logowań w 10 minut; sprawdź limity (429) i źródła w logach bezpieczeństwa; decyzja o blokadzie należy do właściciela. Dane kont nie trafiają do metryk.

### worker
`WORKER_HEARTBEAT_STALE` (worker, media-worker i audit-worker), `JOBS_STALLED`, `MEDIA_JOBS_FAILED` (nowe porażki w godzinie): worker nie iteruje lub nie podejmuje zadań (próg 300 s). Zrestartuj worker (SIGTERM, potem start). Joby `RUNNING` z wygasłym lease wznawia kolejna instancja. `FAILED` wymaga ustalenia przyczyny przed ponowieniem; maile `UNCERTAIN` nie są wysyłane automatycznie drugi raz.

### mail
`MAIL_DELIVERY_FAILED` (ticket): w ostatniej godzinie przybyły joby `MAIL_*` w `FAILED` lub `UNCERTAIN` (alert znika sam po powrocie do zdrowia; nowa porażka alarmuje ponownie). `MAIL_PROVIDER_ERRORS` (ticket): ≥3 odpowiedzi dostawcy z błędem w 15 minut (licznik workera). Sprawdź dostawcę poczty i kody (`MAIL_TRANSIENT`, `MAIL_PERMANENT`, `MAIL_OUTCOME_UNKNOWN`). Nie wysyłaj ręcznie ponownie bez sprawdzenia u dostawcy (ryzyko duplikatu).

### audit-retention
Osobne sygnały #108, żaden nie jest ukryty sukcesem purge:
- `AUDIT_RETENTION_FAILED` (page): job w `FAILED`, cutoff zachowany. Zbadaj przyczynę (`scripts/audit-retention.ts status`), potem `retry <job-id>`.
- `AUDIT_RETENTION_STALLED` (page): job jest należny, lecz nikt go nie podejmuje >15 min; uruchom worker audytu (`scripts/audit-retention.ts worker`).
- `AUDIT_RETENTION_NOT_COMPLETING` (page): żaden job nie zakończył się od 26 h (albo od pierwszego zaplanowanego). Sprawdź, czy worker audytu działa (heartbeat `audit-worker`, `/live` na jego `OPS_PORT`).
- Wyczerpany lease (RUNNING z wygasłym lease i bez prób) liczy się jak `AUDIT_RETENTION_FAILED`.
- `AUDIT_UNLOCK_BASIS_HELD` (ticket, owner operator): `auterva_audit_held_unlock_basis` > 0, czyli wpis restore firmy starszy niż cutoff jest celowo zatrzymany jako podstawa odblokowania. To przegląd, nie awaria joba: operator decyduje o koncie z wpisu (odzyskanie przez `scripts/recover-mfa.ts` albo usunięcie konta), po czym kolejny dzienny purge zwalnia wpis i alert wygasa po dwóch zdrowych ocenach. Ticket przypomina o sobie co 12 h, dopóki wartość jest dodatnia.
- `AUDIT_PURGE_DELAYED` (ticket): najstarszy wpis jest >36 h poza cutoffem 365 dni; sprawdź dzienny job. Zatrzymany wpis restore firmy (podstawa odblokowania, [#108](../contracts/audit-retention-operations.md)) nie liczy się do opóźnienia; widać go w `auterva_audit_held_unlock_basis` (liczba wpisów starszych niż cutoff, zatrzymanych celowo). Wartość >0 nie jest awarią joba: operator przegląda wpis (odzyskanie konta przez `scripts/recover-mfa.ts` albo decyzja o usunięciu konta); wpis starszy niż 365 dni nie ma naturalnego końca bez tej decyzji.
Nie wklejaj treści audytu do zgłoszeń.

### audit-export
- `AUDIT_EXPORT_FAILED` (ticket): eksport operatora zakończył się błędem w 24 h; powtórka to nowe żądanie po ustaleniu przyczyny.
- `AUDIT_EXPORT_SWEEP_FAILING` (page): licznik rośnie tylko przy błędach systemu plików/storage (EACCES, EIO, EPERM…), nie przy niedostępnej bazie (to `READY_DATABASE`, jedna awaria DB = jeden page). Sweep nie potrafi usunąć bajtów (np. EACCES/EIO); stan w DB mógł już przejść na `DELETED`, a plik zostaje. Sprawdź uprawnienia katalogu/storage artefaktów i uruchom `sweep`.
- `AUDIT_EXPORT_CLEANUP_OVERDUE` (page): artefakt `READY` po terminie lub porzucony `PENDING/FAILED` nie został usunięty (sprzątanie awaryjne). Uruchom `scripts/audit-retention.ts sweep`; sprawdź prywatny storage artefaktów. Artefakt po terminie nie wolno odczytać, ale bajty mają zniknąć.
Klucze (`AUDIT_EXPORT_KEY`) i treść eksportu nigdy nie trafiają do logów ani alertów.

### migrations
`MIGRATIONS_NOT_APPLIED` (page): migracja nieudana lub kod oczekuje migracji, której baza nie ma. Nie uruchamiaj nowego buildu; `prisma migrate deploy` po przeglądzie; nieudaną migrację rozwiązuje operator (`migrate resolve`) po decyzji właściciela. Bez destrukcyjnych napraw bez zgody.

### backup
`BACKUP_STALE` (page: brak kompletnej kopii nowszej niż 23 h, cel RPO 24 h), `BACKUP_RUN_FAILED` (page: ostatni `backup` zakończył się błędem, np. `BACKUP_MEDIA_INCOMPLETE`), `BACKUP_UNMONITORED` (ticket, owner: monitoring nie widzi pliku statusu). Plik statusu (`OPS_BACKUP_STATUS_FILE`) zapisuje `scripts/backup-restore.ts` (`backup`, `age`); zawiera czasy, flagę i kod błędu. Postępuj według [runbooka backup/restore](backup-restore.md). Restore zatwierdza właściciel.

### collector
`COLLECTOR_DOWN` (ticket): monitor nie czyta źródła (DB/audyt/migracje); jego brak oznacza ślepotę, nie zdrowie. Alerty zależne od tego kolektora pozostają w poprzednim stanie.

### realtime
`WS_LISTENER_UNHEALTHY` (page; tłumiony przy awarii DB): serwer czatu stracił powiadomienia z DB (poll jako zapas). Sprawdź DB i zrestartuj realtime; klienci wznawiają połączenie z kursorem.

### web-vitals

Informacyjne, bez alertu (#340). Odczyt: `auterva_web_vital_lcp_seconds`, `auterva_web_vital_inp_seconds`, `auterva_web_vital_cls` w `/api/health/metrics/`; p75 z histogramu osobno dla `device="mobile"` i `"desktop"`, cele LCP ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1. Nagły wzrost `auterva_web_vitals_reports_total{rating="rate_limited"}` albo `invalid` oznacza nadużycie lub zmianę kontraktu paczki, nie awarię użytkowników; endpoint niczego nie zapisuje, więc nie wymaga czyszczenia danych. Opis i prywatność: [kontrakt](../contracts/monitoring-alerts.md#web-vitals-340).

## Ochrona przed lawiną alertów

Histereza (alert po kolejnych N naruszeniach, zamknięcie po M zdrowych), grupowanie po obszarze w oknie 60 s, limit 6 powiadomień na godzinę; nadmiar to jedna wiadomość `STORM-GUARD` z nazwami grup. Strony mają pierwszeństwo przed ticketami. Przypomnienie: page co 1 h, ticket co 12 h. Nieudane dostarczenie wraca do kolejki i nie zużywa limitu.

## Lokalna próba dostarczenia

`OPS_ALERT_FILE` i/lub `OPS_ALERT_MAILPIT_URL` + `OPS_ALERT_TO` (tylko loopback). Test: `tests/integration/ops-monitoring.test.ts` (zabija i restartuje worker oraz realtime, sprawdza plik i Mailpit). Dostawca docelowy i kontrolowany odbiorca w staging: not-run (#90).

## Lokalna symulacja awarii (#401)

`tests/integration/ops-failure-simulation.test.ts` wstrzykuje do rzeczywistych ścieżek kodu (readiness, middleware klienta S3, procesor poczty, tabela jobów) cztery awarie i prowadzi prawdziwy monitor (scrape `/metrics` + kolektory DB) na zegarze syntetycznym:

| Awaria | Health | Alert | Sekcja |
|---|---|---|---|
| baza niedostępna | `/live` 200 (brak restartu), `/ready` 503, `checks.database` fail | `READY_DATABASE` (kolejka i migracje to skutek, bez drugiej strony) | [ready-database](#ready-database) |
| storage niedostępny | `/ready` 503, `checks.storage` fail | `READY_STORAGE`, `STORAGE_ERRORS` | [ready-storage](#ready-storage) |
| dostawca poczty pada | bez zmiany (poczta nie jest zależnością gotowości) | `MAIL_PROVIDER_ERRORS` | [mail](#mail) |
| zadanie wisi >5 min | `checks.queue` fail `QUEUE_STALLED` | `JOBS_STALLED` | [worker](#worker) |

Po przywróceniu alerty wygasają i dostarczane jest RESOLVED; logi z próby nie zawierają adresów, treści błędu dostawcy, tokenów ani endpointu storage. Uruchomienie: `pnpm exec vitest run tests/integration/ops-failure-simulation.test.ts` (wymaga fixture z `DATABASE_URL`; test tworzy i usuwa własną bazę).

## Not-run (zależne od #90)

- Dashboard u dostawcy (dostępność 99,9 %, lokalizacja problemu).
- Dostarczenie alertu do prawdziwej osoby dyżurnej i adapter paging.
- Odbiór #108 na docelowym adapterze storage (alerty `AUDIT_*` na realnym eksporcie/purge).
- Retencja logów 30/365 dni na docelowym storage logów; maskowanie W6 na proxy dostawcy.
- Harmonogram `backup`/`age` u dostawcy; próba odłączenia DB/storage/poczty w staging.
