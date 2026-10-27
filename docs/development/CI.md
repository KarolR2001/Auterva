# CI aplikacji, obrazy i preview (#10, D-16)

Zakres według decyzji D-16: bezpłatne elementy (GitHub Actions, obrazy, opis preview). Płatny staging i produkcja nie są częścią tego dokumentu i wymagają osobnej zgody (#90). Nic tu nie wdraża usług ani nie tworzy kont.

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

Przy porażce `Integration` i `Build and E2E` zapisują artefakty na 7 dni: raport Playwright, `test-results`, logi fixture PostgreSQL/S3/Mailpit.

### Jak CI odtwarza środowisko lokalne

- Fixture startuje tym samym `scripts/local-fixture.sh` (PostgreSQL w `.local/fixture-9`, SeaweedFS 4.49, Mailpit 1.32.0, porty od `LOCAL_PORT_BASE`, domyślnie 15450). Skrypt dostał wariant Linux x86_64 z przypiętymi sumami SHA-256 (zgodnymi z digestami wydań GitHub). PostgreSQL 18 (ADR-0002) instaluje z PGDG composite action `.github/actions/fixture`.
- `.env` tworzy skrypt fixture z losowym `BETTER_AUTH_SECRET`; workflow go nie odczytuje ani nie wypisuje. `MAIL_PAYLOAD_KEY` (losowe 64 znaki hex, maskowane w logu) i `BOOTSTRAP_TEST_DATABASE_URL` trafiają do `GITHUB_ENV`. Klucze S3 są losowe i lokalne dla runnera. Nie ma żadnych sekretów repozytorium.
- Poczta: Mailpit i sink; testy nie wysyłają poczty na zewnątrz.

### Lokalne odtworzenie jobów Integration i Build and E2E

1. Jednorazowo na macOS (arm64) pobierz przypięte binaria: `scripts/local-fixture.sh install` (SeaweedFS, Mailpit; weryfikacja SHA-256).
2. Wyeksportuj zmienne, które CI ustawia w `GITHUB_ENV`: `export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"` oraz `export BOOTSTRAP_TEST_DATABASE_URL="postgresql://<user>@127.0.0.1:<LOCAL_PORT_BASE>/auterva_bootstrap_12"` (host `127.0.0.1`, nazwa bazy dokładnie `auterva_bootstrap_12`, bez parametrów URL; port jak PostgreSQL fixture). Nie wpisuj tych wartości do repozytorium.
3. `LOCAL_PORT_BASE=<port> scripts/local-fixture.sh start`, migracje i seed według README, potem `pnpm test:integration`, `pnpm build`, `pnpm test:e2e`. Po pracy `scripts/local-fixture.sh stop`. Reset danych tylko przez `pnpm exec tsx scripts/seed-local-fixture.ts --reset`, nigdy `prisma migrate reset`.

### Przypięcie akcji

Akcje zewnętrzne są przypięte do pełnego SHA commita z komentarzem wersji (`checkout` v7.0.1, `pnpm/action-setup` v6.1.0, `setup-node` v7.1.0, `upload-artifact` v7.0.2). Wybrano SHA, bo tag można przesunąć, a workflow ma dostęp do kodu. Aktualizacja: sprawdź wydanie, zmień SHA i komentarz razem. Gitleaks nie używa `gitleaks-action` (licencja dla organizacji), tylko pobranego z weryfikacją sumy pliku wykonywalnego. Obraz bazowy Dockera jest przypięty tagiem `node:24.20.0-bookworm-slim`; digest przypnij po wyborze rejestru.

### Progi i ograniczenia

- Audyt zależności produkcyjnych blokuje od `high` (#158). Naprawiono: `postcss` 8.5.6 → 8.5.31 (zależność bezpośrednia) oraz `zod` 4.6.5 → 4.6.7 w drzewie `@serwist/next` przez `overrides` w `pnpm-workspace.yaml` (do usunięcia, gdy Serwist wyda wersję z `zod` >= 4.6.6). Nowy finding `high` w zależnościach produkcyjnych zatrzymuje CI; nie obniżaj progu, tylko podnieś zależność zgodnie z ADR-0002.
- `Container images build` buduje obrazy, ale ich nie uruchamia. WebSocket (`src/server/realtime.ts`) nasłuchuje dziś wyłącznie na `127.0.0.1` i oczekuje takiego Host, więc obraz `ws` nie przyjmie ruchu spoza kontenera, dopóki proces nie dostanie konfigurowalnego adresu i zaufanego hosta. Follow-up: #159. Obraz opisuje docelowy proces, nie dowodzi wdrażalności.
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

Checki pojawiają się na liście wyboru dopiero po przebiegu na tym repozytorium. Zmiana nazwy joba wymaga aktualizacji listy. Do tego czasu obowiązuje rzeczywisty CR i QA według workflow oraz sprawdzenie zielonego przebiegu przed merge (`gh pr checks`).

## Obrazy

`Dockerfile` ma cztery cele: `web`, `ws`, `worker`, `media-worker`. Konfiguracja wyłącznie przez zmienne środowiska w czasie uruchomienia (`.env.example`); obrazy nie zawierają sekretów (`.dockerignore` wyklucza `.env*`, `.local`, dokumentację i testy). Procesy działają jako użytkownik `node`. Nic nie jest publikowane do rejestru.

## Preview (D-09)

`deploy/render/render.preview.yaml` to szkic Render Blueprint dla krótkotrwałego, bezpłatnego preview: tylko web i darmowa baza, dane syntetyczne, poczta sink, osobne sekrety. **Nie był walidowany ani wdrożony** (wymaga konta Render). Darmowy Render usypia usługę, baza wygasa po 30 dniach bez kopii, worker nie ma planu Free; chat/WS i worker nie są objęte. Wcześniej przejdź [kontrakt środowisk](../contracts/environments-hosts-operations.md): osobna baza, bucket i poświadczenia, żadnych skopiowanych sekretów.
