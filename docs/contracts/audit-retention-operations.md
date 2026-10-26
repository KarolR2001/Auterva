# Retencja audytu — kontrakt operacyjny #108

Źródła: [D-10](environments-hosts-operations.md), [audyt #16](audit-append-and-access.md), [worker #17](https://github.com/KarolR2001/Auterva/issues/17). Retencja dotyczy wierszy `AuditLog`, nie firmy, sesji, limitera ani zwykłych logów aplikacyjnych.

## Purge

Worker operatora planuje jeden `AUDIT_RETENTION` na dzień UTC w trwałej kolejce `Job`. Zapisany w payloadzie cutoff wynosi dokładnie `now − 365 × 24 h` i **nie przesuwa się** między partiami ani po restarcie. Usuwane są tylko wiersze `createdAt < cutoff`; wiersz dokładnie na granicy zostaje do następnego przebiegu. Wewnętrzny `listAudit` wylicza świeży cutoff przy każdym odczycie i nie pokazuje wygasłych wpisów czekających na dzienny purge. Jedna transakcja PostgreSQL usuwa najwyżej 500 wpisów i dopisuje `AuditRetentionManifest` z liczbą, najstarszym/najnowszym czasem UTC oraz SHA-256 uporządkowanych par ID/czas. Manifest dowodzi zakresu purge, lecz **nie jest eksportem wpisów**. Zakończenie partii i zmiana stanu joba są w tej samej transakcji. Po awarii lease pozwala innemu workerowi wznowić job; dwa procesy nie przetwarzają tej samej partii. Po wyczerpaniu prób job ma `FAILED` i zachowuje cutoff; operator bada przyczynę przed `retry`. Kolejny dzienny job jest niezależny. Mail worker nie przejmuje tego rodzaju, a worker audytu nie terminalizuje poczty.

## Eksport operatora

Eksport jest **ręczną operacją operatora** dla wybranego półotwartego zakresu UTC `[from, to)` w bieżącym oknie 365 dni. Jedno żądanie obejmuje najwyżej 7 dni i 1000 wpisów. Bezpieczna projekcja usuwa wartości spoza allowlisty audytu; artefakt jest szyfrowany AES-256-GCM, a w bazie zostają stan, liczba, zakres, digest i termin. Wiersze starsze od bieżącego cutoff nie są eksportowane automatycznie przed purge. Termin artefaktu to wcześniejszy z `now + 24 h` oraz `najstarszy wpis + 365 × 24 h`; jeśli zapis trwa poza tym terminem, nie pojawia się `READY`. Odczyt po terminie odmawia niezależnie od stanu pliku. Sweep usuwa bajty i oznacza `DELETED`; przerwany `PENDING` oraz `FAILED` mają jawny stan i są sprzątane po pięciu minutach. Powtórkę eksportu uruchamia operator jako nowe żądanie po sprawdzeniu przyczyny.

Obecny adapter plikowy działa **wyłącznie na lokalnej bazie fixture** i odmawia w `NODE_ENV=production`. Nie jest zatwierdzonym storage produkcyjnym ani testem dostarczalności. #58 musi zapewnić alert dla `FAILED`, opóźnienia joba i przeterminowanego artefaktu; #60 musi dostarczyć chroniony storage, klucz, egzekwowanie usunięcia oraz test backup/restore bez wskrzeszenia wygasłych danych. Bez tych odbiorów nie uruchamiamy retencji na produkcji.

## Lokalna próba operatora

Na własnej, odizolowanej bazie z `AUTERVA_FIXTURE=1`, migracjami i `DATABASE_URL` wskazującym loopback:

```sh
pnpm exec tsx scripts/audit-retention.ts status
pnpm exec tsx scripts/audit-retention.ts worker
pnpm exec tsx scripts/audit-retention.ts export <from-utc-iso> <to-utc-iso>
pnpm exec tsx scripts/audit-retention.ts verify <export-id>
pnpm exec tsx scripts/audit-retention.ts sweep
pnpm exec tsx scripts/audit-retention.ts retry <failed-job-id>
```

`export` i `verify` wymagają 32-bajtowego `AUDIT_EXPORT_KEY` w hex, przekazanego wyłącznie przez lokalne środowisko; nie umieszczaj klucza w komendzie, repo ani logu. Daty podaj w formacie `YYYY-MM-DDTHH:mm:ss.sssZ` i wybierz rzeczywisty zakres w bieżącym oknie. Uruchomienie `worker` może usunąć wygasłe **wpisy tej fixture**. Sprawdź przed próbą nazwę bazy i izolację zasobów. `status` pokazuje metadane bez treści audytu. Zwykłe API panelu nie ma endpointu maintenance; uprawnienie aplikacyjne admina firmy ani superadmina nie daje dostępu do tej ścieżki.
