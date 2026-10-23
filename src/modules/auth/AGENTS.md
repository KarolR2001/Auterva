# Uwierzytelnianie i izolacja firm — MVP 3.1

- Źródła: `docs/WYMAGANIA_AUTERVA.md`, `docs/ARCHITEKTURA_AUTERVA.md`, decyzje D-05/D-09/D-11. Better Auth + adapter Prisma i sesje bazodanowe są projektem stosu; sprawdź faktyczne wersje i ADR-0002.
- Role: `SUPERADMIN_AUTERVA` i `ADMIN_FIRMY`. Aktywowana firma ma jednego admina, konto obsługuje jedną firmę, e-mail globalnie unikalny. Bez zespołów, przełączania firm, OAuth i kont najemców z przykładów skilla.
- Publiczny signup i tworzenie superadmina są zablokowane na endpointach. Firmę przygotowuje superadmin, a zaproszony administrator sam ustawia hasło; operator go nie zna.
- Host określa obszar i firmę; każda chroniona operacja sprawdza sesję, rolę, firmę, archiwizację i zgodność zasobów: RSC, API, Server Actions, preview, upload i WebSocket.
- Publiczne hosty i marketing nie wystawiają admin API/auth/administracyjnego WebSocket. Konto firmy nie działa na hoście superadmina ani drugiej firmy.
- Superadmin wykonuje zagnieżdżone operacje pod swoją sesją, bez impersonation. Audyt zachowuje jego tożsamość i docelową firmę.
- MFA jest obowiązkowe w obu panelach. Enrolment, odzyskanie i start pierwszego konta wymagają kontraktu; makieta kodu MFA go nie zastępuje. Przed MFA brak pełnego dostępu.
- Zaproszenie: losowy jednorazowy token, bezpieczny zapis, firma/adresat/host, 7 dni. GET/skaner poczty nie aktywuje konta. Resend unieważnia poprzedni nieużyty link; retry tej samej próby nie tworzy nowego wydania.
- Pierwsza skuteczna rejestracja utrwala jedno zdarzenie, zaczyna przyznany trial 336 h i publikację przy spełnionych warunkach. Retry nie tworzy konta/trialu ponownie; wynik nie twierdzi, że wygasła/niegotowa oferta działa.
- Koniec opłaty/trialu nie odbiera loginu, sesji, resetu, floty ani czatu. Archiwizacja blokuje również istniejące sesje operacyjne i WebSocket admina firmy. Przywrócenie loginu nie odblokowuje automatycznie oferty.
- Cookies host-only, Secure/HttpOnly i właściwe SameSite; Origin/CSRF także między siostrzanymi subdomenami. Bez szerokich cross-subdomain cookies, dowolnego CORS i zaufania do niesprawdzonego Host.
- Rola, firma, obszar sesji i MFA są wyłącznie serwerowe; aktualizacja profilu/sesji nie przyjmuje tych pól od klienta. Cache nie przywraca cofniętych praw.
- Neutralne błędy logowania/resetu, rate limiting, bezpieczne odzyskanie i unieważnienie właściwych sesji po wylogowaniu/zmianie hasła. Tokeny/hasła/sekrety MFA poza logami, trace i zrzutami.
- Schemat Better Auth generuj do przeglądu i scalaj; migracje przez Prisma. Nie używaj na nim `migrate` przeznaczonego dla wbudowanego adaptera biblioteki.
- Testy: role/hosty A/B/platforma/publiczny, brak signup, MFA, zużyty/wygasły/odwołany token, resend, GET, CSRF/Origin, cofnięta sesja, archiwizacja, koniec opłaty z działającym panelem i brak prywatnych danych w HTML/API/RSC/cache/SW.
