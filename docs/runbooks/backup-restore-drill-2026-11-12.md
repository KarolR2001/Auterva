# Raport ćwiczenia: kopia i restore (lokalnie, #404, część #60, D-54)

Wynik: runbook [backup-restore.md](backup-restore.md) wykonany komendami `scripts/backup-restore.ts` na lokalnym fixture; wszystkie kroki zakończone powodzeniem, bez luk wymagających poprawki kodu. Pomiary dowodzą poprawności metody, nie parametrów produkcyjnych (RPO 24 h, RTO 4 h to cele D-10; środowisko u dostawcy i PITR: not-run, #90).

## Dane i środowisko

- Fixture lokalny: PostgreSQL 18, S3 (SeaweedFS), dwie firmy A i B, 6 pojazdów, 3 okładki w S3, bloki dostępności (w tym `internalNote`, `reference`, typ `MAINTENANCE`), prywatne feedy kalendarza, otwarte eksporty firmy (READY), zaproszenia, joby `MAIL_INVITATION` w PENDING, sesje wszystkich kont, dowód resetu hasła, czat.
- Klucz kopii i `OPERATOR_ID` testowe, tylko w środowisku powłoki. Zapis kodu i testów: `tests/integration/backup-restore.test.ts`.

## Przebieg i czasy (jedna maszyna, bez obciążenia)

| Krok | Wynik | Czas |
| --- | --- | --- |
| `backup` (DB + 3 obiekty mediów, 36 tabel) | `complete=true` | 0,6 s |
| `verify` | MAC i sumy poprawne | 0,5 s |
| `age` | `stale=false` | 0,4 s |
| `restore` pełny do nowej bazy i nowego bucketa | `ok=true`, 7 kontroli integralności bez błędu (migracje, liczby wierszy tabel i firm, 144 ograniczenia, FK/CHECK, 3 klucze mediów, brak aktywnych poświadczeń i jobów) | 1,0 s (w tym restore mediów 0,24 s) |
| `restore-company` firmy A do żywej bazy | `ok=true`, `otherCompaniesUnchanged=true` | 0,6 s |

Lokalne RTO całej procedury (kopia już istnieje) wynosi poniżej 2 s wobec celu 4 h. Czas rośnie liniowo z rozmiarem DB i mediów, więc wniosek dla produkcji wymaga próby na stagingu (#90).

## Wyniki sprawdzeń

- Pełny restore: `session` 0, `verification` 0, otwarte zaproszenia 0, joby PENDING/RUNNING/UNCERTAIN poza `AUDIT_RETENTION` jako `SKIPPED` z `RESTORE_QUARANTINED` i payloadem zredukowanym do digestu, feedy kalendarza unieważnione (`COMPANY_RESTORED`), eksporty PENDING/READY jako `EXPIRED`, wpis audytu `BACKUP_RESTORED`. Bloki zachowują dane (kopia DB nie publikuje niczego). Poczta nie została wysłana (Mailpit bez zmian).
- Restore firmy A po zmianach i usunięciu bloków A oraz zmianie danych B: A wraca do stanu kopii (pojazdy, bloki, relacje, media), dane B (pojazdy, bloki, sesje, feedy, eksport READY, zaproszenia, joby) bez zmian, sesje A i superadmina unieważnione, eksport A wygaszony, feed A usunięty razem z odtworzonym użytkownikiem lub unieważniony.
- Nowe pola i tabele z #327/#328/#366/#387: `CalendarFeedToken`, `CalendarFeedTokenVehicle`, `CompanyExport` i dowody MFA (`auterva:mfa:*`, reauth) są objęte kwarantanną i klasyfikacją tabel (`assertCompanyTablesClassified` przechodzi). Pól `mfaRecovery*` w schemacie nie ma; stan odzyskania MFA to `twoFactor.failedVerificationCount/lockedUntil` oraz audyt `MFA_OPERATOR_RECOVERY`, objęte istniejącymi testami B3/B6/N14.

## Zmiana w testach

Test integracyjny rozszerzono o dane D-54 (blok z polami prywatnymi, feed floty i feed z zakresem pojazdów, eksport READY) i asercje: pełny restore unieważnia feedy i wygasza eksporty; restore firmy A przywraca blok A, unieważnia feedy i eksport A, a feedy i eksport B zostają użyteczne.

## Niewykonane

PITR, harmonogram i alerty u dostawcy, synchronizacja do R2 z blokadą, restore na środowisku nieprodukcyjnym u dostawcy z pomiarem RTO i próbą MFA, test współbieżnego uploadu podczas transferu snapshotu (blokada GC): not-run, #90.
