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

`pnpm dev --port 3305`, `pnpm dev:ws` i `pnpm dev:worker` uruchamiają trzy lokalne procesy na tej samej bazie. WS domyślnie słucha na porcie 3312; zmień `WS_PORT` w `.env` przy kolizji. Worker obecnie sprawdza połączenie z bazą i nie wykonuje biznesowych zadań. Scaffold nie realizuje jeszcze publicznego procesu rejestracji ani kompletnej floty. Wymagane kontrole dalszych zmian są w [quality gates](docs/quality-gates.md).

## Organizacja pracy

Jedno issue ma jednego właściciela roli: frontend, backend albo QA. Opis zawiera wymagania, kryteria akceptacji, zależności i odpowiednie ID Penpota. QA weryfikuje zachowanie oraz zgodność z makietami. Szablony issue i PR są w `.github`; etykiety i statusy projektu opisuje workflow.

Skille w `.agents/skills/` oraz `skills-lock.json` są częścią repozytorium. Materiały demo nie przedstawiają rzeczywistej floty. Zasoby, ich przeznaczenie i pochodzenie opisuje [README zasobów](design/assets/README.md).
