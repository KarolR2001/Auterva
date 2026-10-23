# ADR-0002: walidacja stosu przed scaffoldem

Status: **OTWARTE**. Repozytorium zawiera dokumentację i kontrakty designu; nie ma aplikacji, `package.json`, lockfile aplikacji ani wykonanego testu zgodności stosu. Dawny demonstrator React/Vite usunięto; jego wersje i wyniki nie są podstawą produkcyjnego runtime.

Projekt technologiczny opisuje [ARCHITEKTURA_AUTERVA.md](../ARCHITEKTURA_AUTERVA.md). Kandydaci z bazowego PRD: Next.js 16.3+, React 19, TypeScript 7.x, Node 24 LTS, Tailwind 4, Prisma 7.x, Better Auth, Serwist, RHF/Zod, date-fns, Vitest, Testing Library, Playwright i pnpm. Dokładne wersje pozostają do potwierdzenia; lista nie jest deklaracją kompatybilności ani instalacji.

Przed utworzeniem aplikacji:

1. Sprawdzić bieżący stan katalogu i ewentualny manifest/lockfile, aby nie nadpisać nowszej pracy. Stosować [PRD 3.1](../product/PRD.md): cztery hosty, superadmin i odseparowane firmy.
2. Potwierdzić stabilne wydania oraz peer dependencies w oficjalnej dokumentacji. Nie wybierać beta/RC lub nowego major bez decyzji.
3. Zweryfikować zestaw Next/React/TypeScript/Node oraz Prisma CLI/client/adapter-pg/Better Auth na rzeczywistym PostgreSQL.
4. Sprawdzić sesje przypisane do hostów, tenant context, obowiązkowe MFA, zaproszenia i izolację A/B; sam build nie zamyka zgodności auth.
5. Wybrać integrację Serwist dla rzeczywistego Webpack/Turbopack oraz zweryfikować produkcyjny build, zakres `/admin/`, aktualizację z niezapisanym formularzem i brak prywatnego cache.
6. Potwierdzić hosting WebSocket i procesu zadań; test trwałego zapisu wiadomości, reconnect i izolacji rozmów jest częścią próby integracji.
7. Przypiąć runtime, pnpm i dokładne zależności, wygenerować kompletny lockfile; jeden zestaw lint/format: ESLint + Prettier według projektu architektury.
8. Wykonać instalację od zera, lint, typecheck, build, test DB/auth/MFA, współbieżny konflikt blokad oraz PWA production-build. Zapisać wersje i rzeczywiste wyniki; dopiero one zamykają ADR.

Scaffold przygotować w osobnym katalogu roboczym i przenieść po przeglądzie, zachowując AGENTS, skille, dokumenty i kontrakty designu. Nie uruchamiać generatora na katalogu głównym bez sprawdzenia jego skutków.

Tabela do uzupełnienia po próbie:

| Pakiet | Wersja wybrana i przypięta | Źródło oficjalne | Dowód zgodności | Decyzja |
|---|---|---|---|---|
| Runtime/framework/auth/ORM/PWA/testy | Brak | Do uzupełnienia podczas walidacji | Testy niewykonane | Otwarte |
