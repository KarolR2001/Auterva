# Uruchomienie całości lokalnie na macOS — wersja szczegółowa

Prosty skrót do przeklikania (bez testów i bez pracy nad kodem): [URUCHOMIENIE_MACOS](URUCHOMIENIE_MACOS.md).

Instrukcja krok po kroku dla osoby, która po restarcie Maca chce uruchomić Auterva lokalnie: baza, S3, poczta, aplikacja, worker, media-worker i WebSocket. Komendy sprawdzono na macOS (Apple Silicon) z Node 24.20.0, pnpm 12.6.0 i PostgreSQL 18, na bazie portów `44200`. Dokument nie zmienia zakresu ani statusów projektu; szczegóły fixture opisuje [README](../../README.md), odbiór auth [AUTH_QA](AUTH_QA.md), tryb CI [CI](CI.md).

Wszystko działa wyłącznie na `127.0.0.1` i lokalnych danych (`.local/`, ignorowane przez Git). Nie wpisuj tu produkcyjnych danych ani nie publikuj plików `.env`, `.local/fixture-9/secrets.env` i `.local/fixture-9/access.json`.

> **Warunkowość opisów (stan: do czasu scalenia wskazanych PR):**
> - Host `platform.localhost` tworzy `seed-local-fixture.ts` od scalenia PR #432 (także po `--reset`); ręczny `INSERT` jest potrzebny tylko na starym checkoutcie sprzed #432.
> - Proxy `/ws` dla czatu na żywo jest dostępne od scalenia PR #438: `start:local-ingress` (build produkcyjny) i `pnpm dev:gateway` (wariant dev, karta 6) przekazują WebSocket do procesu `dev:ws`. Szczegóły w sekcji 4.

## Szybki start: kolejność komend (po restarcie Maca)

Szczegóły i objaśnienia są w sekcjach poniżej. Wartość `LOCAL_PORT_BASE` (tu `44200`) musi być taka sama w każdej karcie. Karty otwieraj w Terminalu przez `Cmd+T`; każda zaczyna od `cd ~/Developer/Auterva && nvm use 24.20.0`.

**Karta 1 — przygotowanie i fixture (jednorazowo po restarcie):**

```sh
colima start && docker info | head -3        # tylko dla docker/ci-local
cd ~/Developer/Auterva && nvm use 24.20.0
pnpm install --frozen-lockfile
pnpm exec prisma generate
export LOCAL_PORT_BASE=44200
lsof -iTCP:44200-44307 -sTCP:LISTEN          # pusty wynik = porty wolne
scripts/local-fixture.sh install             # tylko za pierwszym razem
scripts/local-fixture.sh start
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/seed-local-fixture.ts
scripts/local-fixture.sh seed-media
scripts/local-fixture.sh status
# host platform.localhost tworzy seed (od #432); na starszym checkoutcie dodaj go ręcznie wg sekcji 4
```

**Karta 2 — aplikacja (wybierz jedno):**

```sh
set -a; . .local/fixture-9/secrets.env; set +a   # klucze S3 do uploadu zdjęć
pnpm dev --port 44210                             # wariant A: dev
# albo wariant B (MFA, limity, PWA): pnpm build, a potem
# NODE_ENV=production PORT=44212 BETTER_AUTH_URL=http://platform.localhost:44212 pnpm start:local-ingress
```

**Karty 3–5 — opcjonalne (poczta, zdjęcia, czat):** `pnpm dev:worker` (z `MAIL_*` wg sekcji 4), `pnpm dev:media-worker` (po `set -a; . .local/fixture-9/secrets.env; set +a`), `WS_PORT=44211 pnpm dev:ws`.

**Wejście:** `http://admin.company-a.localhost:44210/admin/login/` (panel firmy), `http://platform.localhost:44210/login/` (superadmin), hasła i TOTP z `.local/fixture-9/access.json` (nie publikuj). Poczta: `http://127.0.0.1:44203`.

**Koniec pracy:** zatrzymaj procesy `Ctrl+C` w kartach, potem `LOCAL_PORT_BASE=44200 scripts/local-fixture.sh stop`.

## 0. Okna Terminala (skrót)

Używaj aplikacji Terminal (albo iTerm) i osobnych kart (`Cmd+T`). Każda karta zaczyna od `cd` do repozytorium (poniżej `~/Developer/Auterva`; wstaw własną ścieżkę — gniazdo PostgreSQL ma limit 103 bajtów ścieżki, więc trzymaj repozytorium w krótkiej ścieżce).

| Karta | Rola | Komenda (po kroku 2–3) | Port (baza 15450 domyślnie) |
|---|---|---|---|
| 1 | Fixture: PostgreSQL, S3 (SeaweedFS), Mailpit | `scripts/local-fixture.sh start` (kończy się i wraca do promptu; usługi działają w tle) | baza…baza+7 |
| 2 | Aplikacja (dev **albo** build produkcyjny z ingressem) | `pnpm dev --port <baza+10>` | baza+10 |
| 3 | Worker (poczta/outbox, joby) | `pnpm dev:worker` | brak nasłuchu |
| 4 | Media-worker (przetwarzanie obrazów) | `pnpm dev:media-worker` | brak nasłuchu |
| 5 | Serwer WebSocket czatu | `pnpm dev:ws` | `WS_PORT` |
| 6 | Bramka dev: jeden port dla stron i czatu na żywo (tylko wariant dev) | `pnpm dev:gateway` | baza+16 |

Karty 3–6 są potrzebne tylko do funkcji, które ich używają (e-maile zaproszeń/resetu, upload zdjęć, czat; karta 6 tylko do czatu na żywo w wariancie dev). Do samego przeglądania panelu wystarczą karty 1–2.

## 1. Wymagania jednorazowe

```sh
# Homebrew (jeśli brak): https://brew.sh
brew install nvm postgresql@18 colima docker docker-buildx gh gitleaks
```

1. **Node 24.20.0** (dokładna wersja z `engines.node`; `scripts/ci-local.sh` odmawia innej):
   ```sh
   mkdir -p ~/.nvm
   # dopisz do ~/.zshrc linie z `brew info nvm` (export NVM_DIR ... oraz source nvm.sh), potem nowe okno Terminala
   nvm install 24.20.0
   nvm use 24.20.0   # w repozytorium
   node --version    # v24.20.0
   ```
2. **pnpm 12.6.0** (pole `packageManager`): `corepack enable && corepack prepare pnpm@12.6.0 --activate`; sprawdź `pnpm --version`. (Jeśli pnpm masz już z innego źródła, wystarczy zgodna wersja.)
3. **PostgreSQL 18**: po `brew install postgresql@18` dodaj do `~/.zshrc` `export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"` (formuła jest „keg-only”; w tej konfiguracji `psql`/`pg_dump` są już w `/opt/homebrew/bin`, ale jeśli `which pg_dump` nic nie zwraca — dopisz PATH). Sprawdź: `psql --version`, `pg_dump --version`, `initdb --version` (18.x). Nie uruchamiaj `brew services start postgresql@18`; fixture tworzy własny klaster w `.local/`.
4. **colima + docker** (potrzebne do `scripts/ci-local.sh` i budowy obrazów; do samego uruchomienia aplikacji nie): `docker --version`, `docker buildx version`, `colima --version`. Jeśli `docker buildx` nie jest widoczny, wykonaj `brew info docker-buildx` i dodaj wskazaną linię `cliPluginsExtraDirs` do `~/.docker/config.json` (do potwierdzenia na świeżej maszynie).
5. **gh**: `gh auth login`, `gh auth status` (potrzebne do PR-ów, nie do uruchomienia aplikacji).
6. **gitleaks 8.30.1** (wersja jak w `.github/workflows/ci.yml`; tylko dla `ci-local.sh`): `gitleaks version`.
7. Repozytorium: `git clone <adres repozytorium> ~/Developer/Auterva`, następnie `cd ~/Developer/Auterva`.
8. Przeglądarka Playwright (tylko E2E): `pnpm exec playwright install chromium`.

## 2. Po każdym restarcie Maca

Restart zabija wszystkie procesy w tle (PostgreSQL fixture, SeaweedFS, Mailpit, Next, workery) i Colimę. Dane zostają w `.local/`.

```sh
colima start                 # tylko jeśli używasz docker/ci-local
docker info | head -3        # weryfikacja: brak błędu "Cannot connect"
cd ~/Developer/Auterva
nvm use 24.20.0
pnpm install --frozen-lockfile
pnpm exec prisma generate
```

`pnpm install` przy niezmienionym lockfile pomija `postinstall`, dlatego `prisma generate` wykonuj jawnie (zwłaszcza po `git pull`).

## 3. Fixture lokalny (karta 1)

Ustal bazę portów. Domyślnie `15450`; poniżej `LOCAL_PORT_BASE=44200` jako przykład. **Tę samą wartość podawaj przy `start`, `stop`, `status`, `seed-media` i w każdej karcie.** Fixture zajmuje porty `baza…baza+7`, `+10`/`+11` są zarezerwowane dla dev HTTP/WS (bramka dev z karty 6 używa w tej instrukcji `+16`), a `+101`, `+104…+107` zajmuje gRPC SeaweedFS. Przed startem sprawdź, że porty są wolne:

```sh
lsof -iTCP:44200-44307 -sTCP:LISTEN   # pusty wynik = wolne
```

Pierwszy raz (pobiera przypięte SeaweedFS 4.49 i Mailpit 1.32.0 z weryfikacją SHA-256 do `.local/bin`):

```sh
export LOCAL_PORT_BASE=44200
scripts/local-fixture.sh install
```

Start, migracje, seed i obrazy demo (za każdym razem po restarcie; seed jest idempotentny):

```sh
export LOCAL_PORT_BASE=44200
scripts/local-fixture.sh start                      # tworzy .local/fixture-9 i .env przy pierwszym uruchomieniu
pnpm exec prisma migrate deploy
pnpm exec tsx scripts/seed-local-fixture.ts          # firmy A/B, flota, konta z hasłem i TOTP
scripts/local-fixture.sh seed-media                  # trzy okładki w prywatnym S3
```

Jak sprawdzić, że działa:

```sh
scripts/local-fixture.sh status
# 127.0.0.1:44200 - accepting connections
# SeaweedFS running on loopback
# Mailpit running on loopback
```

Poczta (Mailpit) pokazuje wiadomości pod `http://127.0.0.1:<baza+3>` (przy bazie 44200: `http://127.0.0.1:44203`).

**Zatrzymanie** (na końcu pracy): `LOCAL_PORT_BASE=44200 scripts/local-fixture.sh stop`. Kończy tylko procesy tej fixture.

**Reset danych** (kasuje całą lokalną bazę i odtwarza ją): `pnpm exec tsx scripts/seed-local-fixture.ts --reset` — nigdy `prisma migrate reset`.

### Uwaga o `.env`

Pierwszy `start` tworzy `.env` na bazie tego `LOCAL_PORT_BASE` (z losowym `BETTER_AUTH_SECRET`). `.env` z innej bazy portów lub obcy powoduje odmowę startu: `Existing .env does not belong to this local fixture and port`. Wtedy przenieś go: `mv .env .local/env.old` (bez czytania) i ponów `start`, albo wróć do poprzedniej bazy portów. `.env` ma stałe `BETTER_AUTH_URL=http://127.0.0.1:3305` i `WS_PORT=3312`; poniżej nadpisujemy je zmiennymi środowiska w danej karcie (zmienne ustawione w powłoce mają pierwszeństwo przed `--env-file`).

## 4. Aplikacja i procesy

Skrypty `pnpm dev:*` same wczytują `.env`/`.env.local` (`--env-file-if-exists`); `pnpm dev` robi to Next. Sekretów nie wypisuj: nie używaj `cat .env` ani `env`.

### Hosty lokalne

Routing wybiera obszar po nagłówku `Host` (port jest ignorowany). Domeny `*.localhost` przeglądarka rozwiązuje na `127.0.0.1`, więc nie trzeba edytować `/etc/hosts` (w Safari/Chrome/Firefox działa; do `curl` użyj `--resolve <host>:<port>:127.0.0.1` albo bezpośrednio, bo `curl` również rozwiązuje `*.localhost`). Seed tworzy:

| Obszar | Host | Adres (dev, port 44210) |
|---|---|---|
| Strona publiczna firmy A / B | `company-a.localhost`, `company-b.localhost` | `http://company-a.localhost:44210/` |
| Panel firmy A / B | `admin.company-a.localhost`, `admin.company-b.localhost` | `http://admin.company-a.localhost:44210/admin/login/` |
| Platforma (superadmin) | `platform.localhost` | `http://platform.localhost:44210/login/` |

Host platformy tworzy ten sam seed, także po `--reset` (#425); ręczny `psql` nie jest potrzebny. Tylko na checkoucie sprzed #432 dodaj host ręcznie (port jak `LOCAL_PORT_BASE`): `psql -h 127.0.0.1 -p 44200 -d auterva_fixture_9 -c "INSERT INTO \"HostMapping\" (id, hostname, area, status) VALUES (gen_random_uuid(), 'platform.localhost', 'PLATFORM', 'ACTIVE') ON CONFLICT DO NOTHING"`. Wiersz `platform.localhost` dodany wcześniej ręcznie seed zostawia bez zmian. Sprawdzono: `http://platform.localhost:44210/login/` zwraca 200, `/firmy/` bez sesji przekierowuje do logowania, a superadmin z fixture loguje się hasłem i kodem TOTP. (Pusta baza bez fixture dostaje hosta platformy z `pnpm exec tsx scripts/bootstrap-superadmin.ts`; nie używaj go na fixture z danymi, bo wymaga pustej bazy.)

### Wariant A: dev (szybki, bez PWA) — karta 2

```sh
cd ~/Developer/Auterva && nvm use 24.20.0
pnpm dev --port 44210
```

Pierwsze wejście na stronę kompiluje ją (kilkanaście sekund). Service worker i PWA działają tylko w buildzie produkcyjnym.

### Wariant B: build produkcyjny za zaufanym ingressem — karta 2 (MFA, limity, PWA)

Produkcyjny auth wymaga adaptera adresu klienta; lokalnie jest to `start:local-ingress` (ten sam co w E2E). Nie uruchamiaj go razem z wariantem A w tym samym katalogu `.next` — albo zatrzymaj dev przed `pnpm build`, albo dev uruchom z `AUTERVA_NEXT_DIST_DIR=.local/next-dev pnpm dev --port 44210`.

```sh
cd ~/Developer/Auterva && nvm use 24.20.0
pnpm build
NODE_ENV=production PORT=44212 WS_PORT=44211 BETTER_AUTH_URL=http://platform.localhost:44212 pnpm start:local-ingress
# Local trusted ingress on 127.0.0.1:44212
```

Adresy: `http://company-a.localhost:44212/`, `http://admin.company-a.localhost:44212/admin/login/`, `http://platform.localhost:44212/login/` (wszystkie zwracają 200). Ingress odrzuca ruch spoza loopback i usuwa nagłówki `X-Forwarded-*`. `WS_PORT` wskazuje mu proces czatu z karty 5: połączenia `/ws` i `/ws/platform` przekazuje właśnie tam (bez tej zmiennej użyłby `WS_PORT=3312` z `.env`). Wartość `BETTER_AUTH_URL` dla ingressu ustawiono jak host platformy; dokładne wymagania `BETTER_AUTH_URL` dla innych hostów — do potwierdzenia przy logowaniu w przeglądarce (Origin żądań musi zgadzać się z hostem strony).

### Worker — karta 3

Wymaga kluczy poczty w powłoce (losowych, niewypisywanych); sink nie wysyła nic na zewnątrz:

```sh
cd ~/Developer/Auterva && nvm use 24.20.0
export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"
export MAIL_ENVIRONMENT=development MAIL_PROVIDER=sink
export MAIL_ALLOWED_RECIPIENTS=admin-a@example.test,admin-b@example.test,superadmin@example.test
pnpm dev:worker
# {"operation":"worker.start","outcome":"success", ... "Worker ready"}
```

Klucz możesz też wpisać do ignorowanego `.env`, żeby nie generować go za każdym razem (kontrakt: [jobs-mail-outbox](../contracts/jobs-mail-outbox.md)). Zmiana klucza po wysłaniu zadań uniemożliwia odczyt starych payloadów w kolejce.

### Media-worker — karta 4

Wczytuje klucze lokalnego S3 bez wypisywania:

```sh
cd ~/Developer/Auterva && nvm use 24.20.0
set -a; . .local/fixture-9/secrets.env; set +a
pnpm dev:media-worker
# ... "Media worker ready"
```

Serwer Next (karta 2) do uploadu zdjęć potrzebuje tych samych zmiennych S3 — uruchom go z tym samym `set -a; . .local/fixture-9/secrets.env; set +a` przed `pnpm dev` / `pnpm start:local-ingress` (kontrakt: [media-upload-processing](../contracts/media-upload-processing.md)).

### WebSocket czatu — karta 5

```sh
cd ~/Developer/Auterva && nvm use 24.20.0
WS_PORT=44211 pnpm dev:ws
# ... "Realtime listening" ... "port":44211
```

`.env` ustawia `WS_PORT=3312`; powyższe nadpisanie unika kolizji z innymi fixture. Domyślnie przyjmuje `Host` tylko `127.0.0.1:<WS_PORT>`; kontrakt: [chat-realtime](../contracts/chat-realtime.md) (`WS_HOST`, `WS_ALLOWED_HOSTS`).

Przeglądarka łączy się z `ws://<host strony>/ws…` (ten sam host i port co strona), więc przed procesem `ws` stoi lokalne przekazanie (#426):

- **Wariant B** (build produkcyjny): `start:local-ingress` przekazuje `/ws` i `/ws/platform` do procesu z `WS_PORT`. Uruchom go z tym samym `WS_PORT=44211` co tę kartę (komenda w wariancie B); czat na żywo działa pod adresami ingressu (port 44212).
- **Wariant A** (dev): `next dev` nie przekazuje WebSocketu. Uruchom bramkę w karcie 6 i otwieraj adresy na jej porcie zamiast 44210:

  ```sh
  cd ~/Developer/Auterva && nvm use 24.20.0
  PORT=44216 DEV_APP_PORT=44210 WS_PORT=44211 pnpm dev:gateway
  # Development gateway on 127.0.0.1:44216 (app 44210)
  ```

  Czat: `http://admin.company-a.localhost:44216/admin/czat/` i `http://platform.localhost:44216/wiadomosci/`. Pod portem 44210 (bez bramki) czat działa tylko przez HTTP i pokazuje „Brak połączenia na żywo”.

Ingress i bramka przyjmują tylko ruch z loopback i niczego nie autoryzują: Origin, sesję z MFA, rolę i firmę sprawdza proces `ws`. Sprawdzono w przeglądarce w obu wariantach: logowanie hasłem i TOTP, status „Online”, „pisze…”, „Przeczytano”, wiadomości w obie strony bez przeładowania oraz wznowienie po zatrzymaniu i ponownym starcie karty 5 (do tego czasu „Brak połączenia na żywo — łączymy ponownie”, wysyłka działa).

## 5. Logowanie

Konta (sprawdzone w seedzie): `admin-a@example.test` (panel firmy A), `admin-b@example.test` (firma B), `superadmin@example.test` (platforma). Hasła i sekrety TOTP są losowe i lokalne: leżą w `.local/fixture-9/access.json` (uprawnienia 0600). Odczytaj plik tylko u siebie; nie wklejaj go do issue, PR ani czatu.

1. Otwórz właściwy host (tabela w sekcji 4) i zaloguj e-mailem oraz hasłem z `access.json`.
2. Dodaj `totpURI` z `access.json` do aplikacji TOTP (1Password, Google Authenticator) — pole `totpURI` jest adresem `otpauth://`, można z niego wygenerować kod QR albo wpisać sekret ręcznie. Kody 6-cyfrowe wpisz na ekranie MFA.
3. Konta fixture mają już włączone MFA; powtórny seed zachowuje hasła i TOTP. Po `--reset` powstają nowe sekrety i trzeba je dodać ponownie.
4. Kody odzyskiwania i procedura utraty czynników: [AUTH_QA](AUTH_QA.md) (`scripts/recover-mfa.ts`, interaktywny TTY).

Konto firmy nie zadziała na hoście platformy ani drugiej firmy; superadmin loguje się na hoście platformy. Brak publicznej rejestracji klientów.

## 6. Testy

Wszystkie komendy z korzenia repozytorium, z `nvm use 24.20.0`:

```sh
pnpm lint
pnpm typecheck
pnpm test:unit                      # bez bazy
pnpm test:integration               # wymaga uruchomionej fixture (karta 1) i migracji/seedu
```

`pnpm test:integration` najpierw odtwarza bazę `auterva_bootstrap_12` z `BOOTSTRAP_TEST_DATABASE_URL`, więc przed nim dopisz do `.env` (raz) osobną bazę loopback na PostgreSQL fixture (utwórz ją, jeśli jej nie ma: `createdb -h 127.0.0.1 -p 44200 auterva_bootstrap_12` — do potwierdzenia, niesprawdzone), np. `BOOTSTRAP_TEST_DATABASE_URL=postgresql://<twój-użytkownik>@127.0.0.1:44200/auterva_bootstrap_12` (host `127.0.0.1`, dokładna nazwa bazy, bez parametrów; port jak PostgreSQL fixture) oraz `MAIL_PAYLOAD_KEY` w powłoce. Dla testów mediów potrzebny jest prywatny S3 z `seed-media`. Przed pełnym zestawem uruchom `pnpm exec prisma generate`. Pojedyncze pliki: `pnpm exec vitest run tests/integration/<plik> --maxWorkers=2`.

**E2E** (Playwright, Chromium): `pnpm build`, potem `pnpm test:e2e`. Uruchamia trzy serwery na loopback: produkcja `E2E_PORT` (domyślnie 3305), dev `E2E_DEV_PORT` (+1), ingress `E2E_TRUSTED_PORT` (+2). Na własnych portach, np. `E2E_PORT=3345 E2E_DEV_PORT=3346 E2E_TRUSTED_PORT=3347 pnpm test:e2e`. Na maszynie wspólnej z innymi agentami przed ręcznym E2E weź blokadę `mkdir "$(git rev-parse --git-common-dir)/e2e.lock"` (patrz [CI](CI.md#tryb-lokalny-d-29)) i zwolnij ją po teście.

**Pełne lokalne CI** (odpowiednik wyłączonego workflow; dokładny opis w [CI](CI.md#tryb-lokalny-d-29)):

```sh
colima start
scripts/ci-local.sh 44200 .local/ci-result.txt
```

- Argumenty: baza portów (`LOCAL_PORT_BASE`) i plik wyniku (w `.local/`, nie śledzony).
- Wymaga czystego drzewa (`git status --porcelain` puste), Node dokładnie 24.20.0, `pg_dump` 18, gitleaks 8.30.1, działającego `docker` z `buildx`.
- Porty E2E to `baza+12…baza+14`; fixture zajmuje `baza…+7`, `+10/+11`, `+101`, `+104…+107`.
- **Resetuje dane fixture tego repozytorium** i zatrzymuje ją na końcu, jeśli sam ją uruchomił. Zatrzymaj wcześniej własną fixture na tej bazie portów.
- Krok E2E czeka na slot semafora w `<git-common-dir>/e2e.slots/` (domyślnie 2 sloty, limit czekania `AUTERVA_E2E_LOCK_TIMEOUT`, domyślnie 1800 s; na zajętej maszynie np. `AUTERVA_E2E_LOCK_TIMEOUT=10800`). Starej blokady `e2e.lock` nie bierz ręcznie przed `ci-local.sh`.
- Wynik: plik z dziewięcioma wierszami `PASS`/`FAIL`; logi w `.local/ci-local/`. Kod wyjścia ≠ 0 przy dowolnym `FAIL`. Przerwanie Ctrl-C sprząta własne procesy.
- Przed uruchomieniem usuń zapełniony magazyn S3 poprzednich prób: `rm -rf .local/fixture-9/storage` (tylko przy zatrzymanej fixture; zob. sekcja 8).

## 7. Penpot (makiety)

Penpot to osobne narzędzie w przeglądarce (nie uruchamia się go z repozytorium). Plik projektu: `Nowy plik 2`, ID `b564c72c-f31f-81ec-8008-af198a313438`; zasady odczytu, mapowanie FR/UC na ekrany i znane ograniczenia: [design/README.md](../../design/README.md). Do odczytu przez agentów służy wtyczka MCP; hostowany Penpot ma jedną kartę przeglądarki, więc nie otwieraj go równolegle w kilku sesjach agentów. Adres instancji Penpot właściciel zna z konta — **do potwierdzenia**, nie ma go w repozytorium.

## 8. Zatrzymanie i typowe problemy

**Zatrzymanie wszystkiego:**

1. Ctrl-C w kartach 2–6 (Next, worker, media-worker, WS, bramka dev).
2. `LOCAL_PORT_BASE=44200 scripts/local-fixture.sh stop` w karcie 1.
3. Opcjonalnie `colima stop`.
4. Sprawdź: `lsof -iTCP:44200-44307 -sTCP:LISTEN` ma być puste. Nie używaj `pkill node` — na maszynie mogą działać cudze procesy; kończ tylko własne po PID z `lsof -tiTCP:<port> -sTCP:LISTEN`.

| Problem | Przyczyna i działanie |
|---|---|
| Zajęty port przy `start` lub dev | Inny proces trzyma port. `lsof -iTCP:<port> -sTCP:LISTEN`; zakończ własny proces albo wybierz inną bazę (`LOCAL_PORT_BASE=45200` konsekwentnie w każdej komendzie). Nie zabijaj cudzych procesów. |
| `Existing .env does not belong to this local fixture and port` | `.env` pochodzi z innej bazy portów. `mv .env .local/env.old` i ponów `start` (lub użyj poprzedniej bazy). Stary `.env` utrzymuje stary port bazy. |
| `docker: Cannot connect to the Docker daemon` | Colima nie działa po restarcie: `colima start`, potem `docker info`. Dotyczy tylko `ci-local.sh`/obrazów. |
| `pg_ctl: could not start server` / odmowa o długości ścieżki | Gniazdo PostgreSQL `<repo>/.local/fixture-9/.s.PGSQL.<port>` ma limit 103 B na macOS. Użyj krótszej ścieżki repozytorium. |
| Po uśpieniu lub restarcie Maca brak połączenia z bazą, `status` pokazuje „no response” | Procesy fixture padły. Wykonaj `scripts/local-fixture.sh stop`, potem `start` z tą samą bazą; dane zostają. Jeśli `start` nadal zgłasza stary `postmaster.pid` — do potwierdzenia, niesprawdzone w tej instrukcji. |
| `backup-restore` test timeout lub zapełniony S3 | Przy zatrzymanej fixture `rm -rf .local/fixture-9/storage`, potem `start` i `seed-media`. Dotyczy wyczyszczonych wolumenów SeaweedFS (#212). |
| `PrismaClientValidationError` lub nieaktualny klient po `git pull` | `pnpm exec prisma generate` i `pnpm exec prisma migrate deploy`. |
| Logowanie zwraca 404 lub przekierowanie do `/login` na hoście platformy | Brak wiersza `platform.localhost` (uruchom seed, sekcja 3) albo zły host: superadmin loguje się na `platform.localhost`, administrator firmy na `admin.company-a.localhost`, nikt na `localhost`. |
| Brak e-maili | Worker nie działa (karta 3) albo klucze `MAIL_*` nie zostały ustawione; sprawdź Mailpit (`baza+3`). |
| Dev i build nadpisują się | Osobny katalog: `AUTERVA_NEXT_DIST_DIR=.local/next-dev pnpm dev --port <port>`. |
| Reset całej bazy | `pnpm exec tsx scripts/seed-local-fixture.ts --reset` (nie `prisma migrate reset`). Po resecie dodaj ponownie TOTP do aplikacji (nowe sekrety); host `platform.localhost` tworzy seed. |

## Niepotwierdzone w tym dokumencie

- Dokładna konfiguracja `docker buildx` na maszynie bez wcześniejszej instalacji.
- Logowanie w przeglądarce w wariancie B przy `BETTER_AUTH_URL` innym niż host platformy (wymagania Origin).
- Adres instancji Penpot.
