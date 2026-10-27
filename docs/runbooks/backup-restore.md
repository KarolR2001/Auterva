# Runbook: kopia i odtworzenie systemu oraz jednej firmy (#60)

Źródła: [kontrakt środowisk](../contracts/environments-hosts-operations.md) (cele D-10: RPO 24 h, RTO 4 h, kopie DB i mediów codziennie, retencja 30 dni, audyt i logi bezpieczeństwa 365 dni, logi aplikacji 30 dni), [retencja audytu](../contracts/audit-retention-operations.md) i [jobs/outbox](../contracts/jobs-mail-outbox.md). Zakres wykonany lokalnie według D-16; to, co wymaga płatnego środowiska (#90), jest w sekcji „Not-run”.

**RPO i RTO to cele. Zmierzone wartości z lokalnej fixture dowodzą poprawności metody, nie parametrów produkcyjnych.**

## Narzędzia i uprawnienia

- `scripts/backup-restore.ts`: `backup`, `verify`, `restore`, `restore-company`, `age`, `prune`. Wymaga `pg_dump` i `pg_restore` w wersji nie niższej niż serwer (PostgreSQL 18), `BACKUP_ENCRYPTION_KEY` (32 bajty hex, przekazywany tylko przez środowisko operatora; nie w repo, manifeście ani logach) oraz `OPERATOR_ID` (wpis audytu `operator:<id>`).
- Uruchamia wyłącznie operator z uprawnieniem restore, odrębnym od procesów WWW/WS/worker. Procesy aplikacji nie mają klucza kopii ani prawa kasowania kopii.
- Kopia powstaje jako katalog `BACKUP_DIR/<id>/`: `db.dump.enc`, `media/*.enc` (każdy obiekt osobno), `manifest.json`. Katalog jest następnie synchronizowany do odrębnego, chronionego miejsca (np. bucket R2 z blokadą 30 dni); ta synchronizacja jest not-run (#90).

## Kopia (codziennie)

`pnpm exec tsx scripts/backup-restore.ts backup` z `DATABASE_URL`, `S3_*` źródłowego bucketa i `BACKUP_ENCRYPTION_KEY`.

1. Jedna transakcja `REPEATABLE READ` eksportuje snapshot. `pg_dump --snapshot`, liczby wierszy (tabela i firma), lista ograniczeń, wersje migracji i lista kluczy mediów pochodzą z tego samego punktu.
2. DB i każdy obiekt mediów są szyfrowane strumieniowo AES-256-GCM (ramki 1 MiB uwierzytelniane indeksem i znacznikiem ostatniej ramki); w postaci jawnej nic nie trafia na dysk.
3. Manifest zawiera czas UTC, commit, ostatnią migrację, sumy SHA-256 plików i obiektów, liczby wierszy oraz MAC (HMAC kluczem kopii). Zła suma, zły klucz lub edycja manifestu daje odmowę przed jakimkolwiek zapisem.
4. Jeśli brakuje choćby jednego wymaganego obiektu (READY), manifest ma `complete=false`, komenda kończy się błędem `BACKUP_MEDIA_INCOMPLETE`, a zestaw nie jest punktem RPO.

Ograniczenie: kopia wykrywa obiekt usunięty przez GC po snapshotcie, ale nie rejestruje blokady usuwania (opisanej w kontrakcie środowisk). Do czasu jej wdrożenia GC mediów nie powinien działać w oknie kopii; brak obiektu daje alarm, nie cichą lukę.

## Monitoring i alarm braku kopii

- `scripts/backup-restore.ts age` zwraca kod 2 i JSON, gdy nie ma kompletnej kopii nowszej niż 23 h (godzina zapasu względem RPO 24 h) lub gdy nie ma żadnej. Planista (cron/Render job) wywołuje go co godzinę, a kod ≠ 0 alarmuje osobę dyżurną.
- Błąd `backup` (kod ≠ 0, w tym `BACKUP_MEDIA_INCOMPLETE`) jest osobnym alarmem. Alerty produkcyjne i wskazanie osoby dyżurnej: not-run (#90).
- `verify --backup=<katalog>` sprawdza MAC i sumy bez odszyfrowania; uruchamiaj po przeniesieniu kopii.

## Retencja (D-10)

- `prune [--dry-run]` usuwa zestawy starsze niż 30 dni, zawsze zostawiając najnowszy kompletny. Retencja DB i mediów: 30 dni; audyt i logi bezpieczeństwa: 365 dni (purge i eksport audytu według #108; restore nie przywraca wygasłych wpisów, bo po restore worker audytu usuwa wpisy starsze niż cutoff); logi aplikacji 30 dni (egzekwuje docelowy storage logów).
- Archiwizacja firmy nie wykonuje purge: dane firmy pozostają w DB i w kopiach do końca okna retencji kopii. Dane wymagane wyjątkowo prawnie (np. wniosek o usunięcie, wstrzymanie) obsługuje operator poza panelem: decyzja właściciela, odnotowanie w audycie i usunięcie z aktywnych danych oraz z kopii po ich wygaśnięciu; nie ma ścieżki w UI ani API.

## Odtworzenie całego systemu

Role: operator (wykonuje), właściciel/orkiestrator (zatwierdza przełączenie ruchu). Czas liczony od zgłoszenia incydentu do zweryfikowanego wznowienia, cel RTO 4 h.

1. Zatrzymaj produkcyjne workery i WS. Wybierz najnowszą kompletną kopię (`verify`).
2. Utwórz **nową** bazę i **nowy, pusty** bucket w izolowanym środowisku bez dostępu do nadawców poczty i publicznych hostów.
3. `RESTORE_DATABASE_URL=<nowa baza> RESTORE_S3_BUCKET=<nowy bucket> pnpm exec tsx scripts/backup-restore.ts restore --backup=<katalog> [--create-bucket]`.
4. Skrypt: weryfikuje MAC i sumy, stosuje strażnika celu, tworzy bazę, `pg_restore`, wgrywa media, uruchamia kontrole integralności (migracje, liczby wierszy per tabela i firma, zestaw ograniczeń, brak sierot FK i naruszeń CHECK, istnienie kluczy mediów o zgodnym rozmiarze), po czym unieważnia dziedziczone poświadczenia i zadania (niżej) i dopisuje audyt `BACKUP_RESTORED` operatora. Wynik `ok=false` lub kod ≠ 0 oznacza: nie przełączać ruchu.
5. Jeśli ostrzeżenie mówi, że schemat jest za nowszą wersją kodu: `prisma migrate deploy`. Wersja nieznana kodowi: nie uruchamiać tego buildu.
6. Przełącz aplikację na nową bazę i bucket, **zmień `BETTER_AUTH_SECRET`**, uruchom WWW, potem worker i WS. Sprawdź logowanie z MFA, widoczność firm A/B i publiczną ofertę.

### Strażnik celu

Restore zawsze tworzy nową bazę. Odmawia: celu będącego bazą źródłową kopii (`RESTORE_IN_PLACE_REFUSED`), istniejącej bazy bez `--replace-existing` (`RESTORE_TARGET_EXISTS`), `--replace-existing` w `NODE_ENV=production`, na zdalnym serwerze lub poza własnym klastrem fixture (`assertOwnFixtureCluster`), zdalnego celu bez `--allow-remote`, niepustego bucketa. Nieudany `pg_restore` usuwa częściowo utworzoną bazę.

### Po restore

- Usunięte: wszystkie sesje, rekordy `verification` (reset hasła, challenge MFA), wszystkie otwarte zaproszenia unieważnione (`revokedAt`), otwarte `PasswordResetRequest` skonsumowane.
- Jobs: `PENDING/RUNNING/UNCERTAIN` (poza `AUDIT_RETENTION`) mają status `SKIPPED` i `errorCode=RESTORE_QUARANTINED`; payload maili redukowany do digestu, więc nie da się go wysłać. Intenty przypomnień `QUEUED/UNCERTAIN` i przeterminowane `PENDING` są `SKIPPED`. Restore sam nie wysyła poczty ani nie wywołuje workerów.
- Uzgodnienie: operator porównuje wpisy kwarantanny z aktualną DB i audytem i wystawia ponownie tylko potrzebne akcje zwykłymi ścieżkami aplikacji (nowe zaproszenie, reset); nie ma „odblokowania” starych jobów.

## Odtworzenie jednej firmy bez nadpisania pozostałych

`DATABASE_URL=<żywa baza> S3_*=<żywy bucket> pnpm exec tsx scripts/backup-restore.ts restore-company --backup=<katalog> --organization=<id A> --confirm=<id A>`

1. Pełny snapshot ląduje w izolowanej bazie roboczej (`auterva_restore_<losowo>`), usuwanej po zakończeniu lub błędzie.
2. Obiekty mediów tylko firmy A są wgrywane do żywego bucketa (klucze są niezmienne; inny obiekt pod tym samym kluczem to konflikt `RESTORE_MEDIA_KEY_CONFLICT`). Media B nigdy nie są dotykane.
3. Jedna transakcja `REPEATABLE READ` pod `pg_advisory_xact_lock` i blokadą wiersza firmy: kontrola konfliktów, usunięcie wierszy A (dzieci przed rodzicami), aktualizacja wiersza `Organization` w miejscu, wstawienie wierszy A z kopii, kwarantanna (jak wyżej, ograniczona do A oraz sesji superadmina, które miały dostęp), audyt `COMPANY_RESTORED_FROM_BACKUP`. Digest wierszy wszystkich innych firm (każda tabela z `organizationId` i `Organization`) przed i po musi być równy; inaczej transakcja jest wycofana (`RESTORE_OTHER_COMPANY_CHANGED`).
4. Po zatwierdzeniu: liczby wierszy A równe kopii i istnienie kluczy mediów A.

Konflikty (odmowa i pełny rollback, nic nie zmienione): slug zajęty przez inną firmę (`RESTORE_SLUG_CONFLICT`), host przypisany do innej firmy (`RESTORE_HOST_CONFLICT`), e-mail użytkownika innej firmy (`RESTORE_EMAIL_CONFLICT`), identyfikator wiersza należący do innej firmy (`RESTORE_ID_CONFLICT`), brakujący rodzic poza firmą (nadawca wiadomości, kategoria pojazdu: `RESTORE_REFERENCE_MISSING`), naruszenie unikalności lub FK (`RESTORE_CONFLICT`). Operator usuwa przyczynę (np. zmienia slug drugiej firmy zwykłą ścieżką) i powtarza.

Czego restore firmy świadomie nie cofa: audyt, `Job`, `OperationReceipt` i kolejki (nigdy nie nadpisywane; stare zadania firmy A są kwarantannowane); stan archiwizacji i flagi publikacji firmy, `firstAdminRegisteredAt`, przyznany trial i wyłączenie konta (zostaje stan żywy, zgodnie z niezmiennikami); rozpoczęte uploady zdjęć firmy (`ImageUpload` są porzucane, obiekty staging sprząta media cleanup); obiekty A dodane po kopii (osierocone, sprząta GC). Wersje firmy (`version`, `domainVersion`) rosną, więc stare edycje klientów dostaną konflikt. Test `assertCompanyTablesClassified` wymusza decyzję dla każdej nowej tabeli schematu.

## Pomiar lokalny (fixture, nie produkcja)

Test `tests/integration/backup-restore.test.ts` wypisuje czasy etapów. Wynik z przebiegu fixture (2 firmy, kilka wierszy, 3 małe obiekty): kopia około 0,1 s, restore pełny około 0,4 s, restore firmy około 0,3 s. To ma znaczenie tylko dla poprawności metody. RPO metody: kopia dzienna daje stratę do jednego okresu między kopiami, czyli do 24 h (kopia o 2:00 i awaria o 1:59 następnego dnia); PITR nie jest tu uruchomiony, więc dla strat mniejszych niż 24 h nie ma dowodu.

## Not-run (zależne od #90, płatne środowiska)

- Harmonogram kopii u dostawcy, alerty produkcyjne i osoba dyżurna dla `age` oraz błędów `backup`.
- Synchronizacja kopii do R2, blokada bucketa 30 dni, wersjonowanie R2, osobne klucze i uprawnienia restore.
- PITR zarządzanego PostgreSQL i dobór punktu PITR z odpowiadającą kopią mediów.
- Retencja logów aplikacji 30 dni i audytu 365 dni na rzeczywistym storage, oraz odbiór eksportu/usuwania audytu po restore (#108).
- Restore na środowisku nieprodukcyjnym u dostawcy z pomiarem RTO i rotacja `BETTER_AUTH_SECRET` w nim.
- Test współbieżny uploadu/usunięcia obrazu podczas transferu snapshotu (wymaga blokady GC z kontraktu środowisk).
