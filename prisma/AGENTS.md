# PostgreSQL i Prisma — MVP 3.1

- Model: `docs/ARCHITEKTURA_AUTERVA.md`; wymagania/decyzje: `docs/WYMAGANIA_AUTERVA.md`. Brak schematu/migracji oznacza brak implementacji.
- PRD proponuje Prisma 7.x. Potwierdź CLI/client/adapter PostgreSQL/Node i dokumentację `prisma.config.ts`, output generatora oraz ESM. Nie kopiuj API innego major.
- Wiele firm, jedno konto admina per firma, osobny superadmin. Okres i archiwizacja nie zastępują statusów konta/pojazdu. Bez tabel rezerwacji, klientów wynajmu, płatności, planów i zespołów.
- Rekordy tenantowe mają `organizationId`; złożone FK nie pozwalają wskazać rodzica innej firmy. Slug/redirect unikalny w firmie; hostname i znormalizowany e-mail globalnie.
- DB chroni jedno aktywne konto admina firmy, pojedynczy start trialu, jedną rozmowę/ustawienia oraz deduplikację ponawianych mutacji/wiadomości.
- Blokady, aktywność i `paidThrough`: DATE. Rejestracja, trial, sesje, audyt i wiadomości: TIMESTAMPTZ UTC. Trial: 336 godzin; opłacony dzień: granica w Europe/Warsaw.
- CHECK kolejności dat, FK i indeksy pod zapytania z firmą. Nakładanie blokad chronione przed równoległymi zapisami: constraint GiST/`btree_gist` lub zatwierdzona serializacja, przetestowana na PostgreSQL.
- Zmiana aktywności i zapis blokady używają spójnej blokady/izolacji. `version` wykrywa równoczesną edycję admina/superadmina bez cichego nadpisania.
- Indeks częściowy chroni co najwyżej jedno cover; publikacja wymaga transakcyjnej kontroli istnienia poprawnego zdjęcia. Szkic może go nie mieć. D-02 rozstrzygnij przed finalnym kontraktem publikacji.
- RLS to projektowana dodatkowa warstwa, nie dowód bezpieczeństwa. Jeśli stosowane: runtime nie jest właścicielem tabel/BYPASSRLS, kontekst transakcyjny, pooling nie przenosi firmy, platforma ma jawną politykę. Testuj adapter auth i worker.
- Zapis domenowy/audyt/outbox mają spójną transakcję; poczta/storage poza nią z retry. Audyt tylko dopisywany, bez sekretów/pełnego czatu i bez podszywania się pod admina firmy.
- Archiwizacja zachowuje firmę, flotę, media i rozmowę. Jedynym usunięciem danych firmy jest job `COMPANY_PURGE` 12 miesięcy po archiwizacji (D-58, #419; `docs/contracts/company-archive-restore.md`); bez kaskadowego usuwania firmy (FK `Restrict`), a nowa tabela z `organizationId` wymaga decyzji w `COMPANY_PURGE_TABLES`. Dozwolone usunięcie blokady/zdjęcia ma osobny audyt/reguły.
- Migracje wersjonowane i przeglądane; bez `db push`, reset i `--accept-data-loss` na staging/produkcji. Opisz wpływ, rollout i odtworzenie; testuj pustą i zasiedloną bazę testową.
- Migrator oddzielony od runtime. Zmiana produkcyjna/destrukcyjna wymaga jawnego polecenia. Nie wybieraj usługi Prisma Postgres z powodu nazwy skilla; dostawca pozostaje decyzją wdrożeniową.
