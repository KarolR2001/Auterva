# Monitoring, health i alerty — kontrakt #58

Źródła: D-10, [środowiska](environments-hosts-operations.md), [retencja audytu #108](audit-retention-operations.md), [runbook](../runbooks/monitoring-incidents.md). Zakres lokalny; dostawca i dashboard zależą od #90 (D-16) i są not-run.

## Logi

Jedna linia JSON na zdarzenie (`src/modules/observability/log.ts`): `time`, `level`, `component`, `event`, `requestId`, `actorId`, `actorRole`, `organizationId`, `operation`, `outcome`, `durationMs`, kody. Redakcja (`redact.ts`) jest deny-listą nazw (hasła, tokeny, cookies, treść, e-mail, klucze, payload, audyt) plus maskowaniem wartości (e-mail, Bearer, JWT, URL z danymi, hex 32+, ścieżka tokenu zaproszenia). Błędy: tylko nazwa i kod maszynowy, nigdy `message`. Punkty centralne: `instrumentation.ts` (`onRequestError`), `reportInternalError` w pomocnikach HTTP, `withErrorRequestId`, proxy (licznik żądań), runner workerów, worker mediów, worker audytu, S3 (middleware), pula DB, serwer realtime. Poziom: `AUTERVA_LOG_LEVEL`.

## Health

| Endpoint | Zależności | Wynik |
|---|---|---|
| `/api/health/` | brak | zgodny alias liveness `{"status":"ok",...}` (Dockerfile/render/e2e bez zmian) |
| `/api/health/live/` | brak | 200 gdy proces odpowiada |
| `/api/health/ready/` | DB, storage (HeadBucket), kolejka (zaległe zadanie >300 s), migracje (nieudane/oczekujące) | 200/503; bez tokenu tylko `{status}` |
| `/api/health/metrics/` | token `OPS_METRICS_TOKEN` (≥24 znaki) | tekst Prometheus; bez tokenu w konfiguracji 404, zły token 401 |

Migracja: nowe sondy używają `/live` i `/ready`; `render.yaml`/Dockerfile pozostają na aliasie, bo gotowość zależna od workera nie może restartować WWW. Pozostałe procesy: `OPS_PORT`/`OPS_HOST` (domyślnie loopback), ścieżki `/live`, `/ready`, `/metrics`.

## Metryki (bez etykiet firmy i użytkownika)

`auterva_http_requests_total`, `auterva_http_responses_total{class}`, `auterva_http_unhandled_errors_total`, `auterva_db_probe_*`, `auterva_db_pool_errors_total`, `auterva_login_attempts_total{step,outcome}`, `auterva_storage_requests_total{operation,result}`, `auterva_mail_deliveries_total{kind,result}`, `auterva_worker_last_iteration_timestamp_seconds`, `auterva_jobs{kind,status}`, `auterva_jobs_oldest_due_age_seconds`, `auterva_jobs_terminal_failures`, `auterva_audit_*` (#108), `auterva_migrations_*`, `auterva_backup_*` (#60, z pliku statusu), `auterva_ready_check`, `auterva_ws_*`.

## Alerty

Reguły jako kod: `src/modules/observability/alerts.ts`; progi, histereza, właściciel i sekcja runbooka przy każdej regule. Silnik: grupowanie 60 s, limit 6/h + podsumowanie `STORM-GUARD`, przypomnienia, ponowienie po nieudanym dostarczeniu. Testy na danych syntetycznych: `tests/unit/observability-alerts.test.ts`. Monitor: `src/server/ops-monitor.ts` (`OPS_TARGETS`, `OPS_METRICS_TOKEN`, `OPS_ALERT_FILE`, `OPS_ALERT_MAILPIT_URL`, `OPS_ALERT_TO`, `OPS_BACKUP_STATUS_FILE`).

## Znane ograniczenia

- 5xx zwracane przez pomocniki HTTP są liczone przez `reportInternalError`/`withErrorRequestId`; odpowiedzi 5xx budowane bez nich (np. 503 konfiguracji) widać tylko w liczniku żądań i logu proxy. Nowy handler z własnym 500 używa `reportInternalError`.
- Ostrzeżenia samego Next (np. W6) nie przechodzą przez logger.
- Dostawca, dashboard, paging, staging: #90.
