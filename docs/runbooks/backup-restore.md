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
3. `RESTORE_DATABASE_URL=<nowa baza> RESTORE_S3_BUCKET=<nowy bucket> pnpm exec tsx scripts/backup-restore.ts restore --backup=<katalog> [--create-bucket]`. Kopia z mediami bez `RESTORE_S3_BUCKET` kończy się `RESTORE_MEDIA_TARGET_REQUIRED` przed utworzeniem bazy; tylko wewnętrzna baza robocza restore firmy pomija media na tym etapie. `--skip-media` odtwarza samą bazę, ale raport ma `mediaSkipped=true` i `ok=false`; nie przełączaj ruchu na taki wynik.
4. Skrypt: weryfikuje MAC i sumy, stosuje strażnika celu, tworzy bazę, `pg_restore`, wgrywa media, uruchamia kontrole integralności (migracje, liczby wierszy per tabela i firma, zestaw ograniczeń, brak sierot FK i naruszeń CHECK, istnienie kluczy mediów o zgodnym rozmiarze), po czym unieważnia dziedziczone poświadczenia i zadania (niżej) i dopisuje audyt `BACKUP_RESTORED` operatora. Wynik `ok=false` lub kod ≠ 0 oznacza: nie przełączać ruchu. Kontrola integralności działa na snapshocie przed kwarantanną; kwarantanna następuje zaraz po `pg_restore`, przed mediami. Każdy błąd po utworzeniu bazy usuwa bazę docelową i już wgrane obiekty, więc ponowna próba pod tą samą nazwą jest możliwa.
5. `pg_restore` działa z `--no-owner --no-privileges`: nadaj roli runtime aplikacji uprawnienia, których nie przeniosła kopia (np. `GRANT CONNECT ON DATABASE`, `GRANT USAGE ON SCHEMA public`, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` i `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public` dla roli aplikacji, oraz `ALTER DEFAULT PRIVILEGES` jak w środowisku źródłowym). Bez tego aplikacja dostaje `permission denied`. Rola restore pozostaje odrębna od roli WWW.
6. Jeśli ostrzeżenie mówi, że schemat jest za nowszą wersją kodu: `prisma migrate deploy`. Wersja nieznana kodowi: nie uruchamiać tego buildu.
7. Przełącz aplikację na nową bazę i bucket, zachowując **ten sam `BETTER_AUTH_SECRET`**, który szyfrował dane MFA w kopii. Uruchom WWW, potem worker i WS. Sprawdź logowanie z MFA, widoczność firm A/B i publiczną ofertę. Dawne sesje i challenge są unieważnione w kroku 4.

### Strażnik celu

Restore zawsze tworzy nową bazę. Odmawia: celu będącego bazą źródłową kopii (`RESTORE_IN_PLACE_REFUSED`), istniejącej bazy bez `--replace-existing` (`RESTORE_TARGET_EXISTS`), `--replace-existing` w `NODE_ENV=production`, na zdalnym serwerze lub poza własnym klastrem fixture (`assertOwnFixtureCluster`), zdalnego celu bez `--allow-remote`, niepustego bucketa. Nieudany `pg_restore` usuwa częściowo utworzoną bazę.

### Po restore

- Pełny restore przywraca ze snapshotu także dane poświadczeń (hasła, sekrety MFA, kody zapasowe). Kody zapasowe zużyte po czasie kopii są znowu ważne: operator ocenia to jako krok po restore i dla kont, które ich używały (incydent, odzyskanie MFA), rotuje kody lub uruchamia `recover-mfa`; skrypt tego nie robi sam.

- `BETTER_AUTH_SECRET` jest potrzebny do odszyfrowania zapisanych sekretów TOTP i kodów odzyskania Better Auth. Nie zmieniaj go podczas restore bez osobnej, przetestowanej migracji zaszyfrowanych danych MFA i procedury odzyskania dostępu do konta superadmina. Utrata starego sekretu wymaga ręcznego odzyskania MFA według D-05; samo ustawienie nowego sekretu nie naprawi logowania. Test integracyjny tworzy MFA przed kopią i potwierdza logowanie TOTP po odtworzeniu bazy z zachowanym sekretem.
- Usunięte: wszystkie sesje, rekordy `verification` (reset hasła, challenge MFA), wszystkie otwarte zaproszenia unieważnione (`revokedAt`), otwarte `PasswordResetRequest` skonsumowane.
- Jobs: `PENDING/RUNNING/UNCERTAIN` (poza `AUDIT_RETENTION`) mają status `SKIPPED` i `errorCode=RESTORE_QUARANTINED`; payload maili redukowany do digestu, więc nie da się go wysłać. Intenty przypomnień `QUEUED/UNCERTAIN` i przeterminowane `PENDING` są `SKIPPED`. Restore sam nie wysyła poczty ani nie wywołuje workerów.
- Uzgodnienie: operator porównuje wpisy kwarantanny z aktualną DB i audytem i wystawia ponownie tylko potrzebne akcje zwykłymi ścieżkami aplikacji (nowe zaproszenie, reset); nie ma „odblokowania” starych jobów.

## Odtworzenie jednej firmy bez nadpisania pozostałych

`DATABASE_URL=<żywa baza> S3_*=<żywy bucket> pnpm exec tsx scripts/backup-restore.ts restore-company --backup=<katalog> --organization=<id A> --confirm=<id A>`

1. Najpierw sprawdzane jest, że migracje żywej bazy są identyczne z migracjami kopii (`RESTORE_MIGRATION_MISMATCH` inaczej). Pełny snapshot ląduje w izolowanej bazie roboczej (`auterva_restore_<losowo>`), usuwanej po zakończeniu lub błędzie; jeśli proces zostanie zabity, usuń ręcznie pozostałą bazę `auterva_restore_*`. Plik z odszyfrowanym zrzutem nie powstaje (strumień do `pg_restore`).
2. Obiekty mediów tylko firmy A są wgrywane do żywego bucketa (klucze są niezmienne; inny obiekt pod tym samym kluczem to konflikt `RESTORE_MEDIA_KEY_CONFLICT`). Media B nigdy nie są dotykane.
3. Jedna transakcja READ COMMITTED, w której pierwsze polecenia to blokada doradcza i `SELECT ... FOR UPDATE` wiersza firmy (z tą blokadą konfliktuje każdy zapis firmy). Wszystkie kolejne polecenia widzą więc zapisy zatwierdzone przed blokadą, a późniejsze zapisy czekają na koniec restore. W transakcji: kontrola konfliktów, usunięcie wierszy A (dzieci przed rodzicami, razem z `OperationReceipt` A), aktualizacja wiersza `Organization` w miejscu, wstawienie wierszy A z kopii, kwarantanna (jak wyżej, ograniczona do A i jej użytkowników; sesje superadmina z dostępem są unieważniane, ale jego reset hasła i inne wiersze platformy zostają). Przed `COMMIT` działają kontrole „restore nieudany”: liczby wierszy A, brak jakiegokolwiek wiersza spoza A zapisanego przez tę transakcję (xmin) oraz istnienie kluczy mediów A. Każda niezgodność wycofuje całość (`RESTORE_INTEGRITY_FAILED`); po `COMMIT` nic już nie decyduje o powodzeniu.
4. Poświadczenia: użytkownicy A, którzy istnieją na żywo, zachowują żywe konto, czynnik MFA i licznik błędów/blokadę. Użytkownik odtwarzany z kopii, którego nie ma na żywo, dostaje nieużywalne hasło i brak czynnika MFA (`twoFactorEnabled=false`); operator uruchamia dla niego reset hasła i ponowną konfigurację MFA (raport: `usersNeedingReset`).

Konflikty (odmowa i pełny rollback, nic nie zmienione): slug zajęty przez inną firmę (`RESTORE_SLUG_CONFLICT`), host przypisany do innej firmy (`RESTORE_HOST_CONFLICT`), e-mail użytkownika innej firmy (`RESTORE_EMAIL_CONFLICT`), identyfikator wiersza należący do innej firmy (`RESTORE_ID_CONFLICT`), brakujący rodzic poza firmą (nadawca wiadomości, kategoria pojazdu: `RESTORE_REFERENCE_MISSING`), naruszenie unikalności lub FK (`RESTORE_CONFLICT`). Operator usuwa przyczynę (np. zmienia slug drugiej firmy zwykłą ścieżką) i powtarza.

Czego restore firmy świadomie nie cofa: audyt, `Job` i kolejki (nigdy nie nadpisywane; stare zadania firmy A są kwarantannowane); `ServiceAccess` (opłacony okres, `periodVersion`, trial) i `ReminderPlan` (opłata zapisana po kopii nie może zniknąć); stan archiwizacji i flagi publikacji firmy, `firstAdminRegisteredAt` i wyłączenie konta; poświadczenia istniejących użytkowników. Stare `OperationReceipt` firmy A są usuwane (brak pozornego sukcesu idempotencji). `Conversation.lastSeq` = większa z wartości (numer sekwencji nie jest używany ponownie, kursory klientów pozostają bezpieczne). Rozpoczęte uploady zdjęć firmy (`ImageUpload`) są porzucane. Sprzątanie osieroconych obiektów (dodanych po kopii) nie jest częścią restore: cleanup mediów działa na wierszach DB i nie listuje bucketa, więc takie obiekty zostają do osobnego zadania GC (follow-up). Wersje firmy (`version`, `domainVersion`) rosną, więc stare edycje klientów dostaną konflikt. Test `assertCompanyTablesClassified` wymusza decyzję dla każdej nowej tabeli schematu.

## Pomiar lokalny (fixture, nie produkcja)

Test `tests/integration/backup-restore.test.ts` wypisuje czasy etapów. Wynik z przebiegu fixture (2 firmy, kilka wierszy, 3 małe obiekty): kopia około 0,1 s, restore pełny około 0,4 s, restore firmy około 0,3 s. To ma znaczenie tylko dla poprawności metody. RPO metody: kopia dzienna daje stratę do jednego okresu między kopiami, czyli do 24 h (kopia o 2:00 i awaria o 1:59 następnego dnia); PITR nie jest tu uruchomiony, więc dla strat mniejszych niż 24 h nie ma dowodu.

## Not-run (zależne od #90, płatne środowiska)

- Harmonogram kopii u dostawcy, alerty produkcyjne i osoba dyżurna dla `age` oraz błędów `backup`.
- Synchronizacja kopii do R2, blokada bucketa 30 dni, wersjonowanie R2, osobne klucze i uprawnienia restore.
- PITR zarządzanego PostgreSQL i dobór punktu PITR z odpowiadającą kopią mediów.
- Retencja logów aplikacji 30 dni i audytu 365 dni na rzeczywistym storage, oraz odbiór eksportu/usuwania audytu po restore (#108).
- Restore na środowisku nieprodukcyjnym u dostawcy z pomiarem RTO i próbą logowania MFA z zachowanym sekretem. Ewentualna rotacja sekretu wymaga odrębnej migracji danych MFA i odbioru; nie jest częścią tego skryptu.
- Test współbieżny uploadu/usunięcia obrazu podczas transferu snapshotu (wymaga blokady GC z kontraktu środowisk).
