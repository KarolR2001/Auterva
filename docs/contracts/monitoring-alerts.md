# Monitoring, health i alerty — kontrakt #58

Źródła: D-10, [środowiska](environments-hosts-operations.md), [retencja audytu #108](audit-retention-operations.md), [runbook](../runbooks/monitoring-incidents.md). Zakres lokalny; dostawca i dashboard zależą od #90 (D-16) i są not-run.

## Logi

Jedna linia JSON na zdarzenie (`src/modules/observability/log.ts`): `time`, `level`, `component`, `event`, `requestId`, `actorId`, `actorRole`, `organizationId`, `operation`, `outcome` i kody (bez `durationMs`). Redakcja (`redact.ts`) jest deny-listą nazw (hasła, tokeny, cookies, treść, e-mail, klucze, payload, audyt) plus maskowaniem wartości (e-mail, Bearer, JWT, URL z danymi, hex 32+, ścieżka tokenu zaproszenia). Błędy: tylko nazwa i kod maszynowy, nigdy `message`. Punkty centralne: `instrumentation.ts` (`onRequestError`), `reportInternalError` w pomocnikach HTTP, `withErrorRequestId`, proxy (licznik żądań), runner workerów, worker mediów, worker audytu, S3 (middleware), pula DB, serwer realtime. Poziom: `AUTERVA_LOG_LEVEL`. Aktor i firma: każdy eksport trasy `src/app/api/**/route.ts` (poza `/api/health/*`) jest owinięty w `routeContext`, który daje żądaniu własny obiekt kontekstu logu (`runWithLogContext`) od pierwszej linii handlera. `requireScopedActor`/`requireAuthorizedActor`/`selectActorOrganization` tylko uzupełniają ten obiekt (aktor, rola, firma; superadmin ma firmę, w której działa), bez `enterWith`, więc równoległe żądania mają osobne konteksty, a linia 500 z handlera po autoryzacji zawiera właściwego aktora. Nowa trasa musi używać `routeContext`. Callbacki puli pg logują przez `withoutLogContext`. Workery ustawiają firmę z joba (`runWithLogContext`), serwer realtime z principala połączenia. Redakcja maskuje też parametry `token|code|secret|key` w query, segmenty `/reset-password/`, `/verify-email/`, 32-znakowe identyfikatory sesji, bufory binarne i pola `stack|cause|meta|data`; `logEvent` nigdy nie rzuca.

## Health

| Endpoint | Zależności | Wynik |
|---|---|---|
| `/api/health/` | brak | zgodny alias liveness `{"status":"ok",...}` (Dockerfile/render/e2e bez zmian) |
| `/api/health/live/` | brak | 200 gdy proces odpowiada |
| `/api/health/ready/` | DB, storage (HeadBucket), kolejka (zaległe zadanie >300 s), migracje (nieudane/oczekujące) | 200/503; bez tokenu tylko `{status}`; wynik współdzielony (single-flight, TTL 3 s, `OPS_READY_TTL_MS`), więc anonimowe sondy nie obciążają puli; przy awarii DB kolejka i migracje mają powód `DATABASE_UNAVAILABLE` |
| `/api/health/metrics/` | token `OPS_METRICS_TOKEN` (≥24 znaki) | tekst Prometheus; bez tokenu w konfiguracji 404, zły token 401 |

Migracja: nowe sondy używają `/live` i `/ready`; `render.yaml`/Dockerfile pozostają na aliasie, bo gotowość zależna od workera nie może restartować WWW. Pozostałe procesy: `OPS_PORT` (każdy `/metrics` najpierw odświeża readiness z krótkiego cache, więc opublikowany gauge nie przeżywa awarii)/`OPS_HOST` (domyślnie loopback), ścieżki `/live`, `/ready`, `/metrics`.

## Metryki (bez etykiet firmy i użytkownika)

`auterva_http_requests_total`, `auterva_http_responses_total{class}`, `auterva_http_unhandled_errors_total`, `auterva_db_probe_*`, `auterva_db_pool_errors_total`, `auterva_login_attempts_total{step,outcome}`, `auterva_storage_requests_total{operation,result}`, `auterva_mail_deliveries_total{kind,result}`, `auterva_worker_last_iteration_timestamp_seconds{worker}` (worker, media-worker, audit-worker), `auterva_audit_export_sweep_failures_total`, `auterva_audit_retention_last_success_age_seconds`, `auterva_jobs_exhausted`, `auterva_jobs{kind,status}`, `auterva_jobs_oldest_due_age_seconds`, `auterva_jobs_terminal_failures`, `auterva_audit_*` (#108), `auterva_migrations_*`, `auterva_backup_*` (#60, z pliku statusu), `auterva_ready_check`, `auterva_ws_*`.

## Alerty

Reguły jako kod: `src/modules/observability/alerts.ts`; progi, histereza, właściciel i sekcja runbooka przy każdej regule. Silnik: grupowanie 60 s, limit 6/h + podsumowanie `STORM-GUARD`, przypomnienia, ponowienie po nieudanym dostarczeniu. Testy na danych syntetycznych: `tests/unit/observability-alerts.test.ts`. Monitor: `src/server/ops-monitor.ts` (`OPS_TARGETS`, `OPS_METRICS_TOKEN`, `OPS_ALERT_FILE`, `OPS_ALERT_MAILPIT_URL`, `OPS_ALERT_TO`, `OPS_BACKUP_STATUS_FILE`).

## Znane ograniczenia

- 5xx są liczone raz na `requestId` (`reportInternalError`, `withErrorRequestId`, `onRequestError`); odpowiedzi 5xx budowane bez nich (np. 503 konfiguracji) są widoczne tylko w liczniku żądań. Mianownik (`auterva_http_requests_total`) liczy wyłącznie żądania aplikacji: bez `/_next/`, plików z rozszerzeniem i prefetchu routera. Nowy handler z własnym 500 używa `reportInternalError`.
- Stan silnika alertów jest w pamięci: po restarcie monitora nie ma RESOLVED poprzednich alertów i brak dead-man's switch (not-run #90). Reguły z oknem (`increase`) liczą po dostępnej historii (min. dwie próbki).
- Joby nie mają kolumny czasu porażki: alerty „nowa porażka” poczty i mediów liczą wyłącznie dodatnie przyrosty gauge'a liczby jobów terminalnych w oknie 1 h (`rise`; spadek, np. po `retry` albo sprzątaniu, nie alarmuje). Porażki, które wystąpiły i zniknęły między próbkami albo w czasie przestoju monitora, nie są widoczne. Stan `AUDIT_RETENTION` FAILED/wyczerpany lease alarmuje do czasu `retry`.
- Ostrzeżenia samego Next (np. W6) nie przechodzą przez logger.
- Dostawca, dashboard, paging, staging: #90.
