# Auterva

Platforma prezentacji floty i informacyjnej dostępności dla wielu firm. MVP 3.1 obejmuje superadmina, panel firmy, strony publiczne oraz czat superadmin–firma.

Repozytorium zawiera minimalny lokalny scaffold Next.js, PostgreSQL, auth, WebSocket, workera i PWA. Implementacja modułów MVP dopiero powstaje; status próby stosu i ograniczenia opisuje [ADR-0002](docs/adr/0002-version-validation.md).

## Źródła

- [PRD MVP 3.1](docs/product/PRD.md) — nadrzędny zakres, w tym zatwierdzone U3/U4.
- [Wymagania](docs/WYMAGANIA_AUTERVA.md) — funkcje, jakość, priorytety i otwarte decyzje.
- [Architektura](docs/ARCHITEKTURA_AUTERVA.md) — moduły, model danych, hosty, API, testy i dokładne ścieżki Penpota.
- [Design System](docs/design/SPEC.md) i [kontrakt Penpota](design/README.md) — tokeny, komponenty, ekrany i mapowanie.
- [Instrukcje agentów](AGENTS.md), [workflow GitHub](docs/development/WORKFLOW.md), [tablica projektu](https://github.com/users/KarolR2001/projects/1), [quality gates](docs/quality-gates.md).
- [Stan dostępu GitHub](docs/development/GITHUB_ACCESS.md).

## Lokalny scaffold

Wymagane są Node 24.20.0, pnpm 12.6.0 i lokalny PostgreSQL 18. Użyj odrębnej testowej bazy i użytkownika z uprawnieniem do migracji. Nie łącz tych prób z produkcyjną bazą. Na czystym checkoutcie:

```sh
cp .env.example .env
# Uzupełnij DATABASE_URL własnej testowej bazy i losowy BETTER_AUTH_SECRET (co najmniej 32 znaki).
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

Test E2E sam uruchamia lokalny produkcyjny serwer z `AUTERVA_AUTH_PROBE=1`; port można zmienić przez `E2E_PORT` (1–65535), a `BETTER_AUTH_URL` jest dla tej próby ustawiany na wybrany localhost. Potrzebuje tej samej testowej bazy po migracji. Flaga udostępnia wyłącznie ograniczony auth fixture i **nie może być włączana w środowisku publicznym**. Domyślnie endpoint auth jest zamknięty. `.env` jest ignorowany przez Git; nie zapisuj w nim danych produkcyjnych.

Opcjonalnie można uruchomić odrębny lokalny klaster PostgreSQL bez globalnego autostartu: `initdb -D .local/pg`, następnie `pg_ctl -D .local/pg -o '-h 127.0.0.1 -p 55438' start`; po próbie `pg_ctl -D .local/pg stop`. Utwórz w tym klastrze własną bazę fixture i ustaw jej URL w `.env`. Katalog `.local/` jest ignorowany przez Git. Komendy zakładają dostępne binaria PostgreSQL 18 w `PATH`.

## Lokalne usługi i fixture dwóch firm (#9)

Na macOS arm64 potrzebne są Node.js 24, pnpm, PostgreSQL 18 (`initdb`, `pg_ctl`, `psql`, `createdb`, `pg_isready`), `curl`, `shasum`, `tar` i `lsof`. `scripts/local-fixture.sh install` pobiera do ignorowanego `.local/bin` przypięte SeaweedFS 4.49 i Mailpit 1.32.0, weryfikując SHA-256 archiwów przed rozpakowaniem. Skrypt nie instaluje usług globalnie. Na innych platformach użyj zgodnych binariów w `.local/bin` i lokalnego PostgreSQL; automatyczny `install/start` jest obecnie ograniczony do macOS arm64, więc taki wariant wymaga własnego startu usług.

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

Seed można ponowić bez duplikatów. Jawne `pnpm exec tsx scripts/seed-local-fixture.ts --reset` usuwa dane obu **oznaczonych** firm testowych z tej jednej bazy i odtwarza je; odmawia trybu `NODE_ENV=production`, innej bazy, zdalnego hosta oraz kolizji identyfikatorów firm lub użytkowników. Nie używaj tej komendy na bazie wspólnej. Testy integracyjne #9 również resetują wyłącznie tę fixture. Po testach uruchom seed ponownie, jeśli potrzebujesz kont z MFA (test resetuje stan przed próbami). Media można wgrać ponownie; są w jednym prywatnym bucketcie z osobnym kluczem pojazdu i firmą w bazie.

Firmy A i B mają hosty `company-a.localhost` / `admin.company-a.localhost` oraz `company-b.localhost` / `admin.company-b.localhost`. Role to admin A `admin-a@example.test`, admin B `admin-b@example.test` i superadmin `superadmin@example.test`. Hasła i URI TOTP są generowane lokalnie w `.local/fixture-9/access.json` (0600); odczytaj je tylko na swojej maszynie, dodaj URI do lokalnej aplikacji TOTP i nie publikuj pliku ani kodów. Powtórny seed zachowuje hasła/TOTP. Konta mają działające hasło i MFA w adapterze Better Auth, co potwierdza test integracyjny. Publiczny endpoint auth pozostaje zamknięty poza lokalną flagą `AUTERVA_AUTH_PROBE=1`; pełny onboarding/logowanie i routing hostów produktu należą do #12/#13. Do prób HTTP z hostem użyj własnego lokalnego serwera i `curl --resolve <host>:<port>:127.0.0.1` — nie zmieniaj DNS ani produkcji.

Flota zawiera sześć aut: A ma wolny bus, auto z blokadą na jeden dzień i szkic; B ma opublikowane auto, ukryte i archiwalne. Daty aktywności i blokad obejmują oba przejścia DST Europe/Warsaw oraz dzień graniczny. A ma opłacony okres, B trial dokładnie 336 godzin. Historia audytu B zawiera archiwizację i przywrócenie, a bieżący stan obu firm jest aktywny, by można było sprawdzić izolację A/B. Obie mają oddzielne rozmowy. Test zegara używa `vi.setSystemTime`, bez zmiany zegara systemowego. Fixture nie uruchamia produkcyjnych modułów publikacji, archiwizacji ani host routingu.

`pnpm dev --port 3305`, `pnpm dev:ws` i `pnpm dev:worker` uruchamiają trzy lokalne procesy na tej samej bazie. WS domyślnie słucha na porcie 3312; zmień `WS_PORT` w `.env` przy kolizji. Worker obecnie sprawdza połączenie z bazą i nie wykonuje biznesowych zadań. Scaffold nie realizuje jeszcze publicznego procesu rejestracji ani kompletnej floty. Wymagane kontrole dalszych zmian są w [quality gates](docs/quality-gates.md).

## Organizacja pracy

Jedno issue ma jednego właściciela roli: frontend, backend albo QA. Opis zawiera wymagania, kryteria akceptacji, zależności i odpowiednie ID Penpota. QA weryfikuje zachowanie oraz zgodność z makietami. Szablony issue i PR są w `.github`; etykiety i statusy projektu opisuje workflow.

Skille w `.agents/skills/` oraz `skills-lock.json` są częścią repozytorium. Materiały demo nie przedstawiają rzeczywistej floty. Zasoby, ich przeznaczenie i pochodzenie opisuje [README zasobów](design/assets/README.md).
