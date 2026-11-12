# Szkice dokumentów prawnych — D-55

**SZKIC — do weryfikacji prawnej, nie publikować.** Ostatnia aktualizacja: 2026-11-12.

Na podstawie decyzji właściciela D-55 z 12.11.2026 (decyzje D-51–D-56 są w PR #406) agent przygotował trzy szkice oparte na faktycznym przetwarzaniu danych w kodzie i kontraktach repozytorium. Autor nie jest prawnikiem. Szkice nie są opinią prawną ani deklaracją zgodności z RODO, prawem konsumenckim ani przepisami o świadczeniu usług drogą elektroniczną. Publikacja wymaga akceptacji właściciela i weryfikacji prawnika.

| Plik | Dokument | Odbiorca | Miejsce użycia po akceptacji |
|---|---|---|---|
| [privacy-auterva.md](privacy-auterva.md) | Polityka prywatności platformy Auterva | odwiedzający onepage, administratorzy firm, superadmin | stopka MKT-01 (AUT-05) |
| [privacy-company-template.md](privacy-company-template.md) | Wzór polityki prywatności firmy wynajmującej | odwiedzający stronę publiczną firmy | PUB-05 (FIR-03), wpisywana przez superadmina (D-01) |
| [terms-variant.md](terms-variant.md) | Regulamin platformy dla firm (propozycja) oraz uwagi do regulaminu firmy | firmy-klienci Autervy; opcjonalnie strona publiczna | warunki zaproszenia; PUB-06 tylko wg wyboru firmy |

## Jak powstały szkice

- Fakty przetwarzania pochodzą z kodu (`prisma/schema.prisma`, `src/`) i kontraktów w `docs/contracts/`, `docs/runbooks/`, D-10, D-36, D-40, D-47. Każdy szkic wskazuje, które twierdzenie wymaga potwierdzenia na wdrożeniu.
- Dostawców, administratora danych, adresy, okresy ponad ustalone w D-10 i podstawy prawne trzeba uzupełnić; w tekście stoją placeholdery w nawiasach klamrowych albo kwadratowych. Dostawcy nie są zatwierdzeni (D-53), a wybór hostingu i monitoringu jest otwarty (#90).
- Format treści zgodny z D-36: `## ` w treści daje numerowane nagłówki i spis treści, bez HTML. Datę „Ostatnia aktualizacja” ustawia serwer po zapisie tekstu; data w nagłówku szkicu jest tylko informacją redakcyjną i nie przechodzi do aplikacji.
- Szkiców nie wstawiono do aplikacji, fixture ani treści DEMO.

## Wspólne założenia produktowe (z PRD 3.1)

- Brak publicznej rejestracji, kont klientów końcowych, rezerwacji online i płatności online. Kontakt z publicznej oferty to telefon, WhatsApp lub e-mail poza systemem.
- Dwie role: superadmin i dokładnie jeden administrator firmy na firmę; MFA obowiązkowe.
- Publiczne strony nie ustawiają cookies i nie używają narzędzi śledzących. Jedyny pomiar to anonimowe Web Vitals z poszanowaniem DNT/GPC.
