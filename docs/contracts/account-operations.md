# Reset hasła i operacje konta — #18

Aktywny host `COMPANY_ADMIN` obsługuje wyłącznie administratora przypisanej firmy, a aktywny `PLATFORM` wyłącznie superadmina. Publiczny i marketingowy host nie otwierają auth API. Każdy POST wymaga zgodnego `Origin`; źródłowy IP pochodzi ze zweryfikowanego adaptera ingress. Odpowiedzi mają `Cache-Control: no-store`. Wygaśnięcie trialu/opłaty nie zamyka konta, ale archiwizacja firmy odmawia resetu i loginu.

## Kontrakt HTTP dla #19

| Operacja | Wejście | Sukces i odmowa |
| --- | --- | --- |
| `POST /api/auth/password/request-reset` | `{email, idempotencyKey: UUID}` | Zawsze `{accepted:true}` dla poprawnego żądania, niezależnie od istnienia i stanu konta; błędne dane `400`, limit `429` + `Retry-After`, brak konfiguracji poczty `503`. |
| `POST /api/auth/password/reset` | `{token, newPassword}` | Ważny dowód: `{status:true,signInRequired:true}`; nieważny, zużyty, obcy lub wygasły: `401 INVALID_CREDENTIALS`. Błędny format `400`. |
| `POST /api/auth/profile` | `{name}` | Pełna sesja MFA; zmienia wyłącznie nazwę (1–100 znaków). E-mail, rola, firma i MFA są tylko do odczytu; dodatkowe pola dają `400`. |
| `POST /api/auth/password/change` | `{currentPassword,newPassword}` | Pełna sesja MFA i ponowna weryfikacja aktualnego hasła pod blokadą credential; sukces `{status:true,signInRequired:true}`, błędne dane `400`, błędny dowód `401`. |

Nowe hasło ma 12–256 znaków. Po resecie i zmianie wszystkie sesje konta, także bieżąca, oraz niewykorzystane tokeny resetu i challenge MFA są cofnięte. Następny login wymaga hasła i MFA; faktor TOTP/kody nie są zerowane. Ekran linku resetu stosuje `Referrer-Policy: no-referrer`, bez analityki, zasobów stron trzecich i logowania pełnego URL. Sam GET/skaner nie zużywa tokenu. Frontend #19 odpowiada za ekran i komunikat o ponownym logowaniu.

## Wydanie i zużycie

Token to losowe 32 bajty zakodowane jako base64url. `Verification` przechowuje wyłącznie SHA-256 tokenu pod `password-reset:<kanoniczny-email>`; jawny token występuje tylko w pamięci producenta i szyfrowanym payloadzie outboxa #17. Wydanie tokenu, odwołanie poprzedniego, trwały receipt idempotencji oraz enqueue poczty są jedną transakcją. Token żyje 30 minut od wydania, z wyłączną granicą końca. Nowe logiczne żądanie odwołuje poprzedni token. Ponowienie tego samego UUID przez 24 godziny nie wydaje ani nie przedłuża tokenu; receipt przechowuje HMAC klucza i wejścia, bez jawnego adresu, tokenu lub hasła. Ten sam klucz z innym wejściem również nie uruchamia nowej operacji.

Wydanie, enqueue, dispatch i użycie wymagają zweryfikowanego, nieblokowanego konta właściwej roli i firmy oraz istniejącego credential z hasłem. Konto prerejestrowane przez #20 bez credential dostaje neutralną odpowiedź, bez skutecznego tokenu i maila. Reset nie tworzy credential, nie oznacza adresu jako zweryfikowanego, nie aktywuje zaproszenia ani nie uruchamia trialu #22. Zużycie dowodu, zmiana hasha, cofnięcie sesji/challenge i audyt są jedną transakcją. Dwie równoczesne konsumpcje dają najwyżej jeden sukces; błąd audytu cofa całość. Audyt resetu opiera się na zużytym dowodzie, nie na sfingowanej sesji MFA. Zdarzenia nie zawierają hasła, tokenu ani pełnego URL.

Serwer liczy w ruchomym oknie godzinowym 3 żądania resetu na znormalizowany adres i 20 na zaufany IP, wspólnie między hostami i instancjami. Nieudane użycie tokenu podlega odrębnemu limitowi 3/h token i 20/h IP. Login, MFA i operacje profilu zachowują własne limity z [kontraktu technicznego](technical-limits-and-mfa-bootstrap.md). Wspólna blokada wiersza credential serializuje wydanie challenge loginu, zakończenie/odzyskanie/rotację MFA i zmianę hasła. Po zmianie lub resecie wcześniej rozpoczęty challenge nie może stworzyć nowej pełnej sesji.

Kontrole implementacji: `tests/integration/password-reset.test.ts` na prawdziwym PostgreSQL oraz standardowe bramki repozytorium. Dostarczalność poczty zewnętrznej i ekran #19 wymagają odrębnego odbioru; lokalny outbox nie dowodzi dostarczenia wiadomości.
