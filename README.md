# Auterva

Platforma prezentacji floty i informacyjnej dostępności dla wielu firm. MVP 3.1 obejmuje superadmina, panel firmy, strony publiczne oraz czat superadmin–firma.

Repozytorium zawiera minimalny lokalny scaffold Next.js, PostgreSQL, auth, WebSocket, workera i PWA. Implementacja modułów MVP dopiero powstaje; status próby stosu i ograniczenia opisuje [ADR-0002](docs/adr/0002-version-validation.md).

## Źródła

- [PRD MVP 3.1](docs/product/PRD.md) — nadrzędny zakres, w tym zatwierdzone U3/U4.
- [Wymagania](docs/WYMAGANIA_AUTERVA.md) — funkcje, jakość, priorytety i otwarte decyzje.
- [Architektura](docs/ARCHITEKTURA_AUTERVA.md) — moduły, model danych, hosty, API, testy i dokładne ścieżki Penpota.
- [Design System](docs/design/SPEC.md) i [kontrakt Penpota](design/README.md) — tokeny, komponenty, ekrany i mapowanie.
- [Instrukcje agentów](AGENTS.md), [workflow GitHub](docs/development/WORKFLOW.md), [tablica projektu](https://github.com/users/KarolR2001/projects/1), [quality gates](docs/quality-gates.md).
- [Stan dostępu GitHub](docs/development/GITHUB_ACCESS.md), [CI, obrazy i preview](docs/development/CI.md).

## Lokalny scaffold

Wymagane są Node 24.20.0, pnpm 12.6.0 i lokalny PostgreSQL 18. Użyj odrębnej testowej bazy i użytkownika z uprawnieniem do migracji. Nie łącz tych prób z produkcyjną bazą. Na czystym checkoutcie:

```sh
cp .env.example .env
# Uzupełnij DATABASE_URL bazy auterva_fixture_9 na 127.0.0.1, BOOTSTRAP_TEST_DATABASE_URL
# osobnej bazy auterva_bootstrap_12 na 127.0.0.1 i losowy BETTER_AUTH_SECRET (co najmniej 32 znaki).
pnpm install --frozen-lockfile
pnpm exec prisma validate
pnpm exec prisma migrate deploy
pnpm exec prisma generate
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm build
pnpm exec playwright install chromium
E2E_PORT=3305 pnpm test:e2e
```

Test E2E uruchamia trzy serwery na loopback: produkcyjny build bez adaptera na `E2E_PORT` (domyślnie 3305) dla odmowy auth, dev na `E2E_DEV_PORT` (kolejny port) oraz ten sam produkcyjny build przez `start:local-ingress` na `E2E_TRUSTED_PORT` (następny port) dla MFA, limitów i PWA. Ostatni adapter bierze adres z lokalnego socketu IPv4/IPv6, odrzuca pozostały ruch i usuwa nagłówki forwarding podane przez klienta. Katalogi builda Next są rozdzielone, więc dev nie nadpisuje produkcyjnego service workera. Serwery używają testowej bazy z `DATABASE_URL` po migracji. Stara flaga `AUTERVA_AUTH_PROBE` nie otwiera auth w produkcyjnym serwerze. `.env` jest ignorowany przez Git; nie zapisuj w nim danych produkcyjnych. [Instrukcja odbioru auth](docs/development/AUTH_QA.md) opisuje fixture. Adapter służy wyłącznie lokalnej próbie; za współdzielonym proxy Render adres socketu identyfikuje proxy, więc przed stagingiem wymagane jest zweryfikowanie dostawcy i odrębny zaufany adapter (#10/#90). Bez niego produkcyjny auth odmawia obsługi żądań. Ten sam lokalny adapter przekazuje też upgrade `/ws` i `/ws/platform` do procesu WS (`WS_PORT`, domyślnie 3101; fixture 3312): zachowuje `Origin` i `Cookie` klienta, zastępuje `Host` adresem `LOCAL_INGRESS_WS_HOST` (domyślnie `127.0.0.1:<WS_PORT>`, musi być w `WS_ALLOWED_HOSTS` procesu WS), usuwa nagłówki forwarding, przepuszcza tylko loopback i te dwie ścieżki (inne 404; proces WS nieosiągalny albo milczący przez 10 s: 502). Origin z rejestru hostów, sesję z MFA, rolę i firmę nadal sprawdza proces WS; adapter nie przekazuje mu żadnego adresu klienta, więc proces WS widzi połączenie z loopbacku. Zatrzymanie adaptera zamyka otwarte tunele. To przekazanie jest wyłącznie lokalne: w produkcji `/ws` kieruje do procesu WS proxy dostawcy. W E2E adapter kieruje `/ws` na `E2E_WS_PORT` (domyślnie port po `E2E_TRUSTED_PORT`; w `ci-local.sh` `baza+15`), gdzie nikt nie nasłuchuje, więc pozostałe testy widzą stan „brak połączenia na żywo”; tylko `tests/e2e/chat-live.spec.ts` uruchamia tam proces czatu i sprawdza czat na żywo w przeglądarce.

`pnpm test:integration` najpierw odtwarza wyłącznie bazę `auterva_bootstrap_12` wskazaną przez `BOOTSTRAP_TEST_DATABASE_URL`, nakłada migracje i bada pełną drogę od pustej bazy do MFA. Odmawia innego hosta niż `127.0.0.1`, innej nazwy, parametrów URL i bazy używanej przez inne połączenie. Następnie wykonuje pozostałe testy na `DATABASE_URL`; testy fixture #9 wymagają tam bazy `auterva_fixture_9`. Nie uruchamiaj tej komendy na wspólnej lub produkcyjnej bazie.

Opcjonalnie można uruchomić odrębny lokalny klaster PostgreSQL bez globalnego autostartu: `initdb -D .local/pg`, następnie `pg_ctl -D .local/pg -o '-h 127.0.0.1 -p 55438' start`; po próbie `pg_ctl -D .local/pg stop`. Utwórz w tym klastrze własną bazę fixture i ustaw jej URL w `.env`. Katalog `.local/` jest ignorowany przez Git. Komendy zakładają dostępne binaria PostgreSQL 18 w `PATH`.

## Lokalne usługi i fixture dwóch firm (#9)

Na macOS arm64 i Linux x86_64 potrzebne są Node.js 24, pnpm, PostgreSQL 18 (`initdb`, `pg_ctl`, `psql`, `createdb`, `pg_isready`), `curl`, `shasum`, `tar` i `lsof`. `scripts/local-fixture.sh install` pobiera do ignorowanego `.local/bin` przypięte SeaweedFS 4.49 i Mailpit 1.32.0, weryfikując SHA-256 archiwów przed rozpakowaniem. Skrypt nie instaluje usług globalnie. Skrypt obsługuje też Linux x86_64 (używa go CI); na innych platformach użyj zgodnych binariów w `.local/bin` i własnego startu usług.

```sh
pnpm install --frozen-lockfile
scripts/local-fixture.sh start
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/seed-local-fixture.ts
scripts/local-fixture.sh seed-media
pnpm exec vitest run tests/integration/local-fixture.test.ts tests/unit/local-fixture.test.ts
scripts/local-fixture.sh stop
```

Start tworzy wyłącznie lokalny klaster `auterva_fixture_9`, `.env` i losowe klucze w ignorowanym `.local/fixture-9`; odmawia istniejącego obcego `.env` lub zajętych portów. Domyślne porty loopback: PostgreSQL 15450, S3 15451, SMTP 15452, Mailpit UI 15453, komponenty SeaweedFS 15454–15457 i ich gRPC 15551/15554–15557. `LOCAL_PORT_BASE` można ustawić przed pierwszym startem, np. `LOCAL_PORT_BASE=16450`; ta sama wartość musi być używana przy kolejnych startach i stop. `stop` kończy wyłącznie procesy zapisane przez tę fixture i jej klaster PG. S3 wymaga podpisu, anonimowy odczyt obiektu daje 403, a lokalny `security.toml` odrzuca także bezpośredni odczyt przez filer i volume. SMTP przyjmuje tylko adresy `example.test`, a wiadomości są widoczne lokalnie w Mailpit.

Seed można ponowić bez duplikatów. Jawne `pnpm exec tsx scripts/seed-local-fixture.ts --reset` odtwarza **całą** bazę fixture od zera: usuwa i tworzy schemat `public`, uruchamia `prisma migrate deploy` i seed. Odmawia `NODE_ENV=production`, celu innego niż loopback `127.0.0.1` z bazą `auterva_fixture_9` oraz klastra, który nie jest klastrem tego worktree: `SHOW data_directory` musi wskazywać `.local/fixture-9/pg` tego repozytorium (`realpath`), a port serwera musi zgadzać się ze znacznikiem `.local/fixture-9/pg.port` zapisanym przez `scripts/local-fixture.sh start` (klaster uruchomiony starszą wersją skryptu nie ma znacznika; wtedy decyduje katalog danych, a ponowny `start` dopisuje znacznik). Ta sama kontrola obejmuje wierszowy reset `seedLocalFixture(..., true)` używany przez testy. Audyt jest nieedytowalny, więc nie jest kasowany wierszami; znika razem ze schematem. Po ręcznym uploadzie (wiersze audytu mediów) wierszowy reset z testów kończy się błędem FK: najpierw uruchom CLI `--reset`. Reset usuwa wszystkie dane tej lokalnej bazy, także rezerwacje, obrazy i joby mediów. Nie używaj komendy na bazie wspólnej. Testy integracyjne #9 resetują fixture własnym wywołaniem seed. Po testach uruchom seed ponownie, jeśli potrzebujesz kont z MFA. Obiekty w S3 zostają; odtwarza je `seed-media`. Media można wgrać ponownie; są w jednym prywatnym bucketcie z osobnym kluczem pojazdu i firmą w bazie.

Firmy A i B mają hosty `company-a.localhost` / `admin.company-a.localhost` oraz `company-b.localhost` / `admin.company-b.localhost`. Role to admin A `admin-a@example.test`, admin B `admin-b@example.test` i superadmin `superadmin@example.test`. Hasła i URI TOTP są generowane lokalnie w `.local/fixture-9/access.json` (0600); odczytaj je tylko na swojej maszynie, dodaj URI do lokalnej aplikacji TOTP i nie publikuj pliku ani kodów. Powtórny seed zachowuje hasła/TOTP. Konta mają działające hasło i MFA w adapterze Better Auth, co potwierdza test integracyjny. Gateway wymaga aktywnego hosta panelu, sprawdza rolę/firmę i obowiązkowe MFA; sama flaga `AUTERVA_AUTH_PROBE=1` nie otwiera auth w produkcyjnym buildzie. Routing weryfikuje aktywny `HostMapping` przy wejściu i ponownie w chronionej gałęzi. Do prób HTTP z hostem użyj własnego lokalnego serwera i `curl --resolve <host>:<port>:127.0.0.1` — nie zmieniaj DNS ani produkcji.

Flota zawiera sześć aut: A ma wolny bus, auto z blokadą na jeden dzień i szkic; B ma opublikowane auto, ukryte i archiwalne. Daty aktywności i blokad obejmują oba przejścia DST Europe/Warsaw oraz dzień graniczny. A ma opłacony okres, B trial dokładnie 336 godzin. Historia audytu B zawiera archiwizację i przywrócenie, a bieżący stan obu firm jest aktywny, by można było sprawdzić izolację A/B. Obie mają oddzielne rozmowy. Test zegara używa `vi.setSystemTime`, bez zmiany zegara systemowego. Fixture nie uruchamia produkcyjnych modułów publikacji, archiwizacji ani host routingu.

`pnpm dev --port 3305`, `pnpm dev:ws` i `pnpm dev:worker` uruchamiają trzy lokalne procesy na tej samej bazie. WS domyślnie słucha na porcie 3312; zmień `WS_PORT` w `.env` przy kolizji. Adres nasłuchu (`WS_HOST`, domyślnie loopback) i dokładne wartości `Host` (`WS_ALLOWED_HOSTS`, wymagane poza loopbackiem; przeglądarka łączy się z hostem panelu, więc lokalnie wpisz np. `admin.company-a.localhost:3312`) opisuje [kontrakt czatu realtime](docs/contracts/chat-realtime.md). Przed startem workera ustaw w ignorowanym `.env` własny `MAIL_PAYLOAD_KEY` (`openssl rand -hex 32`), `MAIL_ENVIRONMENT=development`, `MAIL_PROVIDER=sink` i jawny `MAIL_ALLOWED_RECIPIENTS` z adresami fixture. Sink nie wysyła wiadomości do skrzynki; testy procesowe używają własnego serwera HTTP na loopback. [Kontrakt outboxu i poczty](docs/contracts/jobs-mail-outbox.md) opisuje retry, szyfrowanie, statusy i wymagane późniejsze podłączenie domen #18/#19/#54. Czat na żywo w przeglądarce wymaga, by strona i `/ws` były na tym samym hoście i porcie, a `next dev` nie przekazuje upgrade do innego procesu. W trybie dev uruchom więc czwarty proces, bramkę: `pnpm dev --port 3306`, `pnpm dev:ws` i `PORT=3305 DEV_APP_PORT=3306 pnpm dev:gateway`, po czym otwieraj adresy na porcie bramki (`http://admin.company-a.localhost:3305/admin/czat/`). Bramka przyjmuje tylko loopback, strony i gniazdo HMR przekazuje bez zmian do `next dev`, a `/ws` i `/ws/platform` do procesu WS na tych samych zasadach co lokalny adapter (odmawia startu z `NODE_ENV=production`). Dla produkcyjnego builda to samo robi `pnpm start:local-ingress` obok `pnpm dev:ws`. Samo `pnpm dev` bez bramki obsługuje czat tylko przez HTTP: komunikat „Brak połączenia na żywo”, bez statusów pisania i odczytu na żywo. Rejestracja klientów pozostaje poza MVP; status kolejnych modułów produktu śledzi GitHub Project. Wymagane kontrole dalszych zmian są w [quality gates](docs/quality-gates.md).

Dla prywatnego uploadu #29 uruchom własną fixture z `scripts/local-fixture.sh seed-media`, a w powłoce procesu Next i osobnego workera wczytaj wygenerowane lokalnie zmienne S3 bez ich wypisywania:

```sh
set -a
. .local/fixture-9/secrets.env
set +a
pnpm dev:media-worker
```

Serwer Next korzysta z tych samych zmiennych. Jeden upload to surowy obraz na prywatnym endpointzie z sesją MFA i `Idempotency-Key`; pełny kontrakt, statusy, retry oraz granice próby lokalnego S3 opisuje [kontrakt mediów](docs/contracts/media-upload-processing.md). `pnpm test:integration` wymaga działającego prywatnego S3 z tej fixture dla testów mediów; nie używa publicznych danych ani usług płatnych.

## Organizacja pracy

Jedno issue ma jednego właściciela roli: frontend, backend albo QA. Opis zawiera wymagania, kryteria akceptacji, zależności i odpowiednie ID Penpota. QA weryfikuje zachowanie oraz zgodność z makietami. Szablony issue i PR są w `.github`; etykiety i statusy projektu opisuje workflow.

Skille w `.agents/skills/` oraz `skills-lock.json` są częścią repozytorium. Materiały demo nie przedstawiają rzeczywistej floty. Zasoby, ich przeznaczenie i pochodzenie opisuje [README zasobów](design/assets/README.md).
