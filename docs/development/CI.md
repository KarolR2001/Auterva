# CI aplikacji, obrazy i preview (#10, D-16)

Zakres według decyzji D-16: bezpłatne elementy (GitHub Actions, obrazy, opis preview). Płatny staging i produkcja nie są częścią tego dokumentu i wymagają osobnej zgody (#90). Nic tu nie wdraża usług ani nie tworzy kont. Workflow jest włączony od 16.11.2026 (D-65) i wykonuje wymagane kontrole przed merge; [tryb lokalny](#tryb-lokalny-d-29) (D-29) pozostaje procedurą zapasową, gdy workflow jest wyłączony albo limit minut GitHub Actions się wyczerpie.

## Workflow `.github/workflows/ci.yml`

Uruchamia się dla `pull_request`, `push` na `main` i ręcznie (`workflow_dispatch`). Uprawnienia: tylko `contents: read`. Nowy push do PR anuluje poprzedni przebieg tego PR. Pozostałe przebiegi (m.in. `main`) mają własną grupę `run_id`, więc nie są anulowane ani zastępowane jako oczekujące (GitHub trzyma w jednej grupie tylko jeden oczekujący przebieg). Node i pnpm wynikają z `package.json` (`engines.node`, `packageManager`), nie są powtórzone w workflow. Cache pnpm obsługuje `actions/setup-node`. Instalacja używa `--frozen-lockfile`.

| Job (nazwa checka) | Zawartość | Odtworzenie lokalnie |
|---|---|---|
| `Lint, typecheck, unit` | `prisma validate`, `pnpm lint`, `pnpm typecheck`, `pnpm test:unit` | te same komendy |
| `Integration (PostgreSQL, S3, bootstrap)` | PostgreSQL 18, prywatny SeaweedFS S3 i Mailpit z `scripts/local-fixture.sh`, migracje, seed A/B, `pnpm test:integration` (najpierw bootstrap na pustej bazie `auterva_bootstrap_12`) | README, sekcja „Lokalne usługi” |
| `Build and E2E` | ta sama fixture, `pnpm build`, Chromium, `pnpm test:e2e` (trzy serwery, trusted ingress na loopback) | README, sekcja „Lokalny scaffold” |
| `Secret scan` | gitleaks 8.30.1 (archiwum z weryfikacją SHA-256) na pełnej historii git, `--redact` | `gitleaks git --redact .` |
| `Dependency audit` | `pnpm audit --prod --audit-level high` (blokuje) | `pnpm audit --prod --audit-level high` |
| `Container images build (web)`, `(ws)`, `(worker)`, `(media-worker)` | `docker build --target …` z `Dockerfile`, bez push | `docker build --target web .` |

Nowy plik `tests/e2e/*.spec.ts` nie wymaga edycji `playwright.config.ts`: projekt `trusted-ingress` uruchamia wszystko poza `auth-production` i `auth-host` (`testIgnore`), więc PR-y dodające e2e nie konfliktują w jednej linii konfiguracji (#267). Spec wymagający własnego serwera (jak te dwa) dostaje osobny projekt i wpis w `testIgnore`.

Przy porażce `Integration` i `Build and E2E` zapisują artefakty na 7 dni: raport Playwright, `test-results`, logi fixture PostgreSQL/S3/Mailpit.

### Jak CI odtwarza środowisko lokalne

- Fixture startuje tym samym `scripts/local-fixture.sh` (PostgreSQL w `.local/fixture-9`, SeaweedFS 4.49, Mailpit 1.32.0, porty od `LOCAL_PORT_BASE`, domyślnie 15450). Skrypt dostał wariant Linux x86_64 z przypiętymi sumami SHA-256 (zgodnymi z digestami wydań GitHub). PostgreSQL 18 (ADR-0002) instaluje z PGDG composite action `.github/actions/fixture`.
- `.env` tworzy skrypt fixture z losowym `BETTER_AUTH_SECRET`; workflow go nie odczytuje ani nie wypisuje. `MAIL_PAYLOAD_KEY` (losowe 64 znaki hex, maskowane w logu) i `BOOTSTRAP_TEST_DATABASE_URL` trafiają do `GITHUB_ENV`. Klucze S3 są losowe i lokalne dla runnera. Nie ma żadnych sekretów repozytorium.
- Poczta: Mailpit i sink; testy nie wysyłają poczty na zewnątrz.

### Lokalne odtworzenie jobów Integration i Build and E2E

1. Jednorazowo na macOS (arm64) pobierz przypięte binaria: `scripts/local-fixture.sh install` (SeaweedFS, Mailpit; weryfikacja SHA-256).
2. Wyeksportuj zmienne, które CI ustawia w `GITHUB_ENV`: `export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"` oraz `export BOOTSTRAP_TEST_DATABASE_URL="postgresql://<user>@127.0.0.1:<LOCAL_PORT_BASE>/auterva_bootstrap_12"` (host `127.0.0.1`, nazwa bazy dokładnie `auterva_bootstrap_12`, bez parametrów URL; port jak PostgreSQL fixture). Nie wpisuj tych wartości do repozytorium.
3. `LOCAL_PORT_BASE=<port> scripts/local-fixture.sh start`, migracje i seed według README, potem `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Po pracy `scripts/local-fixture.sh stop`. Reset danych tylko przez `pnpm exec tsx scripts/seed-local-fixture.ts --reset`, nigdy `prisma migrate reset`.

### Testy bezpieczeństwa (#57)

`pnpm test:unit` i `pnpm test:integration` obejmują `tests/integration/security-regression.test.ts` (macierz negatywna po wszystkich handlerach `src/app/api` na PostgreSQL, firmy A/B, sesje z MFA i bez), a `Build and E2E` uruchamia `tests/e2e/security-headers.spec.ts` na zbudowanej aplikacji (nagłówki, CSP z nonce w Chromium, siostrzana subdomena, ograniczone ciała, ciasteczka, skan bundla pod kątem sekretów). Macierz kontroli, lista przypadków pentestu staging (`not-run`, #90) i znaleziska są w [OWASP_CONTROLS](../security/OWASP_CONTROLS.md). Skan sekretów wykonuje job `Secret scan`, a w trybie lokalnym (D-29) ten sam gitleaks 8.30.1 na pełnej historii.

### Przypięcie akcji

Akcje zewnętrzne są przypięte do pełnego SHA commita z komentarzem wersji (`checkout` v7.0.1, `pnpm/action-setup` v6.1.0, `setup-node` v7.1.0, `upload-artifact` v7.0.2). Wybrano SHA, bo tag można przesunąć, a workflow ma dostęp do kodu. Aktualizacja: sprawdź wydanie, zmień SHA i komentarz razem. Gitleaks nie używa `gitleaks-action` (licencja dla organizacji), tylko pobranego z weryfikacją sumy pliku wykonywalnego. Obraz bazowy Dockera jest przypięty tagiem `node:24.20.0-bookworm-slim`; digest przypnij po wyborze rejestru.

### Progi i ograniczenia

- Audyt zależności produkcyjnych blokuje od `high` (#158). Naprawiono: `postcss` 8.5.6 → 8.5.31 (zależność bezpośrednia) oraz `zod` 4.6.5 → 4.6.7 w drzewie `@serwist/next` przez `overrides` w `pnpm-workspace.yaml` (do usunięcia, gdy Serwist wyda wersję z `zod` >= 4.6.6). Nowy finding `high` w zależnościach produkcyjnych zatrzymuje CI; nie obniżaj progu, tylko podnieś zależność zgodnie z ADR-0002.
- `Container images build` buduje obrazy, ale ich nie uruchamia. Obraz `ws` nasłuchuje na `WS_HOST=0.0.0.0` i wymaga w czasie uruchomienia `WS_ALLOWED_HOSTS` (dokładne wartości `Host` przekazywane przez zaufane proxy; bez tej listy proces się nie uruchomi, nie ma trybu „dowolny host”); Origin musi dodatkowo być aktywnym hostem panelu z `HostMapping` ([kontrakt czatu realtime](../contracts/chat-realtime.md)). Zachowanie procesu sprawdza `tests/integration/realtime-process.test.ts`; sam obraz nie jest w CI uruchamiany, więc nie dowodzi wdrażalności.
- E2E uruchamia tylko Chromium; Firefox/WebKit, PWA na urządzeniach, VoiceOver (#97) i testy wydajności nie są w CI.
- Zaufane źródło adresu klienta za proxy Render/Cloudflare nie jest sprawdzane w CI (komentarz do #10); wymaga rzeczywistego środowiska.
- Minuty GitHub Actions są limitowane (prywatne repo), stąd anulowanie starych przebiegów PR i brak macierzy przeglądarek.

## Wymagane checks (do włączenia przez właściciela)

Ochrona gałęzi i rulesets w prywatnym repozytorium wymagają GitHub Pro albo repozytorium publicznego (API zwracało `403`), więc nie da się jej teraz włączyć, a agenci jej nie zmieniają. Gdy plan pozwoli, w Settings → Branches → Branch protection rule (albo ruleset) dla `main` włącz:

1. Require a pull request before merging.
2. Require status checks to pass before merging oraz Require branches to be up to date, z checkami (nazwy dokładnie tak):
   - `Lint, typecheck, unit`
   - `Integration (PostgreSQL, S3, bootstrap)`
   - `Build and E2E`
   - `Secret scan`
   - `Dependency audit`
   - `Container images build (web)`, `Container images build (ws)`, `Container images build (worker)`, `Container images build (media-worker)`
3. Zakaz force push i usuwania `main`.

Checki pojawiają się na liście wyboru dopiero po przebiegu na tym repozytorium. Zmiana nazwy joba wymaga aktualizacji listy. Do tego czasu obowiązuje rzeczywisty CR i QA według workflow oraz sprawdzenie zielonego przebiegu przed merge (`gh pr checks`), a przy wyłączonym workflow lub wyczerpanym limicie minut wynik [trybu lokalnego](#tryb-lokalny-d-29) zapisany w PR.

## Tryb lokalny (D-29)

Procedura zapasowa (D-65). Od 16.11.2026 wymagane kontrole wykonuje workflow `CI` na GitHub Actions: przebieg na PR albo na gałęzi kandydata integracyjnego zawierającej aktualny `main` (`workflow_dispatch`), a po scaleniu przebieg na `main`. Tryb lokalny stosuje się tylko wtedy, gdy workflow jest wyłączony albo limit minut GitHub Actions się wyczerpie; zestaw kontroli jest ten sam.

W trybie lokalnym przed merge te same joby uruchamia lokalnie orkiestrator, na drzewie kandydata: head PR zawierający aktualny `main`. Wykonawca może je uruchomić wcześniej, ale wynik przed merge potwierdza orkiestrator.

- Wymagania jednorazowe: `scripts/local-fixture.sh install`, lokalne środowisko kontenerów z `docker` i `buildx` (np. Colima) oraz gitleaks 8.30.1 (wersja jak `GITLEAKS_VERSION` w `ci.yml`).
- Klient Prisma: po `pnpm install --frozen-lockfile` skrypt jawnie uruchamia `pnpm exec prisma generate` (w drzewie głównym i w czystym worktree przed lint, typecheck i unit), bo pnpm pomija `postinstall` przy niezmienionym lockfile i nowy schemat zostawiłby nieaktualnego klienta (`PrismaClientValidationError` w integracji).
- Uruchomienie: `scripts/ci-local.sh <LOCAL_PORT_BASE> <plik-wyniku>`. Skrypt wykonuje joby `ci.yml` w tej samej kolejności i z tymi samymi zmiennymi. `prisma validate`, lint, typecheck i unit z wartościami zastępczymi z `ci.yml` w czystym, tymczasowym worktree (jak świeży checkout CI, bez `.env` i `.env.local`). Integracja i build z E2E na świeżej fixture: `seed-local-fixture --reset` usuwa schemat tej fixture i stosuje migracje od zera, a `scripts/local-fixture.sh reset-media` opróżnia bucket tej fixture (jak w CI, gdzie jest pusty); polecenie działa tylko przy uruchomionym SeaweedFS tego worktree i na jego porcie. Dalej gitleaks na pełnej historii z `--redact`, `pnpm audit --prod --audit-level high` oraz `docker build --target` dla `web`, `ws`, `worker` i `media-worker`. Logi trafiają do `.local/ci-local/`, a kod wyjścia jest niezerowy przy dowolnym `FAIL`.
- Skutki uboczne: przebieg resetuje dane fixture tego worktree (lokalne dane deweloperskie przepadają) i zatrzymuje ją na końcu, jeśli sam ją uruchomił. E2E działa na portach wyprowadzonych z `LOCAL_PORT_BASE` worktree: produkcja `base+12`, dev `base+13`, ingress zaufany `base+14`. Fixture zajmuje w ramce bazy `base..+7`, `+10`/`+11` (HTTP/WS dev) oraz `+101`, `+104..+107` (gRPC SeaweedFS), więc `+12..14` jest wolne w każdej ramce roli agentów (wykonawca `base`, recenzent `base+20`, QA `base+40`; ramki trzymaj w odstępie co najmniej 30) (eksportowane jako `E2E_PORT`, `E2E_DEV_PORT`, `E2E_TRUSTED_PORT`, które czyta `playwright.config.ts`). Dzięki temu przebiegi z różnych worktree nie kolidują na portach; pozostałe wystąpienia 3305 w repozytorium to wartości zastępcze (`BETTER_AUTH_URL` w kroku unit, w `.env` fixture i w `ci.yml`), nie porty nasłuchu. Obciążenie maszyny ogranicza semafor: krok `Build and E2E` zajmuje jeden z `AUTERVA_E2E_SLOTS` slotów (domyślnie 2), czyli katalogów `e2e.slots/<n>` w `git rev-parse --git-common-dir` (wspólnych dla worktree; atomowy `mkdir`, bo macOS nie ma `flock`; pliki `pid` i `owner`). Czekanie trwa do `AUTERVA_E2E_LOCK_TIMEOUT` (domyślnie 1800 s, odpytywanie co `AUTERVA_E2E_LOCK_POLL`, domyślnie 5 s), komunikaty trafiają do `.local/ci-local/e2e-lock.log`; po limicie wynik to `FAIL (E2E slot or ports not available …)`. Slot martwego procesu (PID nie istnieje) przebieg przejmuje; slot ręczny bez numerycznego `pid` (plik `owner` z nazwą) jest porzucony tylko z wieku (40 min mtime, goły katalog 1 min) i nigdy nie jest przenoszony, gdy żyje. Priorytet: plik `.git/e2e-priority` istnieje wyłącznie w oknie kandydatów (tworzy go orkiestrator na czas okna i usuwa po nim); gdy istnieje i ma mtime młodszy niż 120 min, ostatni slot jest zarezerwowany dla przebiegów z `AUTERVA_E2E_PRIORITY=1` (kandydaci orkiestratora), a zwykłe przebiegi używają pozostałych (przy jednym slocie nie ma rezerwacji). Zgodność wsteczna: `AUTERVA_E2E_LOCK_HELD=1` (wywołujący trzyma globalną blokadę `e2e.lock` z dawnego protokołu) pomija semafor; stara blokada `e2e.lock` nie jest już wymagana dla ci-local, bo porty są rozłączne, i zostaje tylko dla ręcznego `pnpm test:e2e` na domyślnym 3305 (porty nadal są sprawdzane i czekają do tego samego limitu). Trap (zwykły koniec kroku, błąd, SIGINT, SIGTERM) zatrzymuje wszystko, co nasłuchuje na portach tego przebiegu: zbiera ich grupy procesów (Playwright startuje serwery jako osobne grupy) jeszcze przed zamknięciem gniazd, wysyła TERM, czeka do 5 s i dobija KILL, także serwer, który już zamknął gniazdo, a nadal się wyłącza. Przerwanie nie zostawia więc osieroconych serwerów. Wczesna kontrola (`precheck_ports`, przed instalacją i krokami): port fixture lub E2E zajęty przez proces spoza tego worktree kończy start kodem 2 z numerem portu, PID, katalogiem i podpowiedzią (inna baza); własne procesy worktree nie blokują. Sprzątanie dotyczy wyłącznie procesów działających w tym worktree (katalog roboczy pod worktree), nigdy cudzych. Kroki mają stdin z `/dev/null`. Skrypt odmawia nadpisania śledzonego pliku wyniku. Plik wyniku zapisz w `.local/` (ignorowany) albo poza repozytorium, inaczej kolejny przebieg odmówi startu przez niepuste drzewo. Fixture zatrzymywana jest tylko wtedy, gdy przebieg sam ją uruchomił; dane i tak są resetowane.
- Długość ścieżki: fixture umieszcza gniazdo PostgreSQL w `<worktree>/.local/fixture-9/.s.PGSQL.<port>`, a limit ścieżki gniazda na macOS to 103 bajty. `scripts/local-fixture.sh` odmawia startu (kod 2) z czytelnym komunikatem o długości ścieżki, zamiast kończyć się `pg_ctl: could not start server`; użyj krótszej nazwy lub lokalizacji worktree.
- Odmowa startu (kod 2, komunikat mówi, czego brakuje): drzewo nie jest czyste (`git status --porcelain` bez plików ignorowanych; kandydatem jest dokładnie HEAD); gitleaks inny niż `GITLEAKS_VERSION` z `ci.yml`; Node inny niż `engines.node` (zakres semver jest odrzucany, wymagana dokładna wersja); `pg_dump` o wersji głównej innej niż 18; brak `docker` lub `docker buildx`.
- Przerwanie (Ctrl-C, SIGTERM) lub błąd: `trap` usuwa tymczasowy worktree `quality` (`git worktree remove --force`, awaryjnie `prune`), zatrzymuje swoją grupę procesów kroku oraz fixture uruchomioną przez ten przebieg i przywraca `next-env.d.ts`. Skrypt zatrzymuje tylko własne procesy.
- Wynik w PR: head SHA, base `main`, wersje narzędzi (Node, gitleaks, `pg_dump`, Docker z platformą) i tabela dziewięciu nazw jobów z `PASS`/`FAIL` oraz liczbą testów; plik wyniku zawiera je w tej postaci. Brak lub `FAIL` dowolnej pozycji blokuje merge.
- Potwierdzenie na `main` po merge: drzewo commita merge równe sprawdzonemu drzewu kandydata. Inaczej tryb lokalny uruchamia się ponownie na `main`.
- Różnice środowiska: macOS zamiast `ubuntu-24.04`, a obrazy budują się dla architektury hosta (na Apple Silicon `linux/arm64`). Budowa `linux/amd64` dla docelowego dostawcy należy do odbioru stagingu (#90).

## Obrazy

`Dockerfile` ma cztery cele: `web`, `ws`, `worker`, `media-worker`. Konfiguracja wyłącznie przez zmienne środowiska w czasie uruchomienia (`.env.example`); obrazy nie zawierają sekretów (`.dockerignore` wyklucza `.env*`, `.local`, dokumentację i testy). Procesy działają jako użytkownik `node`. Nic nie jest publikowane do rejestru.

## Preview (D-09)

`deploy/render/render.preview.yaml` to szkic Render Blueprint dla krótkotrwałego, bezpłatnego preview: tylko web i darmowa baza, dane syntetyczne, poczta sink, osobne sekrety. **Nie był walidowany ani wdrożony** (wymaga konta Render). Darmowy Render usypia usługę, baza wygasa po 30 dniach bez kopii, worker nie ma planu Free; chat/WS i worker nie są objęte. Wcześniej przejdź [kontrakt środowisk](../contracts/environments-hosts-operations.md): osobna baza, bucket i poświadczenia, żadnych skopiowanych sekretów.
