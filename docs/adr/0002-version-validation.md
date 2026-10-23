# ADR-0002: walidacja stosu i lokalny scaffold

Status: **zamknięte dla wyboru wersji i próby zgodności stosu**. Nie oznacza ukończenia modułów produktu, CI, hostingu ani wdrożenia. Zakres prób i ograniczenia są poniżej.

## Decyzja

Przypinamy Node 24.20.0, pnpm 12.6.0, Next.js 16.4.3 (App Router, Webpack), React 19.3.1, TypeScript 5.9.3, Tailwind 4.3.3, Prisma CLI/client/adapter-pg 7.10.1, Better Auth i adapter Prisma 1.7.12, Serwist 9.5.13, Vitest 5.0.5 oraz Playwright 1.64.1. Dokładny zestaw, UI dependencies i peer dependencies są w `package.json` oraz `pnpm-lock.yaml`. Minimalny schemat Prisma i migracje służą rzeczywistej próbie stosu, nie stanowią docelowego modelu MVP.

TypeScript 7 był kandydatem w historycznym PRD, ale `typescript-eslint@8.72.0` deklaruje peer `typescript >=4.8.4 <6.1.0`. Wybór 5.9.3 utrzymuje wspierane lintowanie i nie zmienia funkcji produktu. `minimumReleaseAgeExclude` w `pnpm-workspace.yaml` wymienia tylko dokładnie przypięty zestaw Next 16.4.3 oraz jego platformowe SWC, aby odtworzyć lockfile mimo świeżej publikacji. Nie jest ogólnym wyłączeniem ochrony wieku pakietów. Każda aktualizacja wersji wymaga ponownej kontroli peer dependencies i prób.

Next pracuje w trybie Webpack, który obsługuje użyta integracja Serwist; konfiguracja Turbopack nie jest tu weryfikowana. `next-env.d.ts` jest plikiem generowanym przez Next i w repozytorium zapisano wariant po produkcyjnym buildzie. `next dev` może przełączyć referencje na `.next/dev`; przed przekazaniem commita należy ponownie wykonać build i przyjąć wariant produkcyjny. Wygenerowany przez Next blok instrukcji w głównym `AGENTS.md` pozostaje częścią scaffoldingu.

## Sprawdzone granice

| Właściwość | Rzeczywisty dowód w fixture PostgreSQL / przeglądarce | Granica próby |
|---|---|---|
| Instalacja i DB | Frozen lockfile; `prisma validate`, `migrate deploy`, `generate`; lokalny PostgreSQL 18 i test migracji; `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` bez różnicy | Schemat zawiera tylko tabele potrzebne próbom, bez finalnych danych floty |
| Auth, host i MFA | Produkcyjny serwer Next w E2E: zły Host odrzucony, publiczny signup i niekontrolowany enrolment wyłączone, sign-in z wyzwaniem TOTP, weryfikacja kodu, dowód MFA zapisany dla dokładnej sesji. Test WS odmawia ważnej sesji użytkownika z włączonym TOTP, lecz bez dowodu tej sesji; dowód drugiej sesji tego samego użytkownika nie odblokowuje pierwszej | Tymczasowy `AUTERVA_AUTH_PROBE=1` otwiera tylko 4 ścieżki do testów; domyślnie API auth zwraca 404. Produkcyjny onboarding, bootstrap roli i endpointy powstaną w osobnym issue |
| Zaproszenie | Testowa logika nad tabelą `verification`: token ograniczony do firmy, hosta i adresu, TTL 7 dni, bezpieczny GET, atomowe jednokrotne zużycie przy konkurencji, resend unieważnia stary token | Tylko `tests/fixtures/invitation-probe.ts`; brak publicznego endpointu, wysyłki e-mail i transakcji zakładania firmy |
| Izolacja danych i współbieżność | Prisma/PG: odczyt A/B w zakresie firmy, równoległy konflikt blokad na `btree_gist`, idempotentny zapis wiadomości i reconnect WS | Nie ma jeszcze pełnych ról/archiwizacji, kompletnych API pojazdów ani biznesowego czatu |
| WS i worker | Osobne procesy startują na lokalnej bazie; WS weryfikuje Origin, Host rzeczywistego portu WS, aktualną sesję, dowód MFA i firmę także przy wiadomości; test złego Host przy poprawnym Origin/sesji, revocation i A/B | Worker sprawdza połączenie z DB, nie obsługuje jeszcze trwałych jobs; WS pozostaje minimalną próbą |
| PWA | Produkcyjny build emituje SW; E2E w Chromium asertuje rzeczywiste `registration.scope = origin + /admin/`, brak prywatnego CacheStorage, no-store dla panelu i aktualizację przy syntetycznym niezapisanym formularzu | Brak testu instalacji na urządzeniu, offline produktu i rzeczywistych formularzy; te wymagają modułów UI |

Ścieżka auth próby jest celowo zamknięta przy braku flagi. Nie wolno włączać `AUTERVA_AUTH_PROBE` w publicznym środowisku. Produktowe API ma w osobnym zadaniu egzekwować aktora, rolę, firmę i stan konta na serwerze. Same Host, MFA enabled i ukrycie UI nie wystarczą.

Mapowanie tej próby do wymagań (bez przypisywania jej ukończenia modułów produktu):

| Wymaganie | Kod | Test |
|---|---|---|
| D-12 | `package.json`, `pnpm-lock.yaml`, `prisma/`, `src/app/`, `src/server/` | `tests/unit/env.test.ts`, `tests/integration/database.test.ts`, build i E2E |
| C-R001 | `src/modules/tenancy/`, `src/modules/chat/`, `src/lib/`, wspólne entrypointy | `tests/integration/tenancy.test.ts`, `tests/integration/realtime.test.ts` |
| C-N060 — tylko próba PWA/bezpieczeństwa | `src/app/sw.ts`, `src/app/admin/`, ograniczona trasa auth | `tests/e2e/pwa.spec.ts`, `tests/e2e/auth-host.spec.ts`; SEO, dostępność i wydajność wymagają dalszych ekranów i pomiarów |

## Reprodukcja i źródła

Instrukcja lokalnego PostgreSQL, bezpiecznych wartości fixture i komend znajduje się w [README](../../README.md). Aktualna próba obejmuje 1 test unit, 7 testów integracyjnych i 2 E2E; dowodami są te testy, migracje `prisma/migrations`, diff schematu bez zmian oraz wynik `pnpm build`. Konkretny SHA i wyniki bramek są w PR. Nie wykonano zewnętrznego provisioningu, prób poczty, storage, DNS/TLS ani wdrożenia.

Wersje i sposób integracji sprawdzono z [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), lokalną dokumentacją zainstalowanego Next w `node_modules/next/dist/docs/`, [Prisma PostgreSQL](https://www.prisma.io/docs/orm/overview/databases/postgresql), [Better Auth Prisma adapter](https://www.better-auth.com/docs/adapters/prisma), [Better Auth 2FA](https://www.better-auth.com/docs/plugins/2fa), [Serwist Next Webpack](https://serwist.pages.dev/docs/next/getting-started) oraz deklaracjami peer w zainstalowanych pakietach. Przy kolejnej zmianie zależności źródła trzeba ponownie sprawdzić.
