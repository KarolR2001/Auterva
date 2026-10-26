# Rozmowa i wiadomości czatu: kontrakt #50

Dla #27/#53 (UI) i #51/#52 (WebSocket, typing/read/unread). Zakres #50: trwały zapis i odczyt, bez realtime. Limity i liczenie znaków: [kontrakt D-04](technical-limits-and-mfa-bootstrap.md); archiwizacja: [kontrakt #48](company-archive-restore.md).

## Trasy

Wszystkie odpowiedzi mają `Cache-Control: no-store` i `X-Request-Id`; mutacje wymagają własnego `Origin`, pełnego MFA, odpowiedniego hosta oraz wspólnych limitów API. Tożsamość i firma pochodzą z hosta i sesji, nie z ciała żądania. Admin ma firmę z hosta `COMPANY_ADMIN`; superadmin adresuje firmę ścieżką na hoście `PLATFORM`. Ścieżki kończą się `/`.

| Trasa | Znaczenie |
|---|---|
| `GET/POST /api/admin/chat/conversation/`, `GET/POST /api/platform/companies/{id}/chat/conversation/` | GET: `{ conversationId \| null }`, niczego nie tworzy. POST: idempotentne otwarcie/utworzenie rozmowy tej firmy, `201 {conversationId, created:true}` albo `200 {…, created:false}`. Równoległe wywołania dają jedną rozmowę. |
| `GET/POST /api/admin/chat/messages/`, `GET/POST /api/platform/companies/{id}/chat/messages/` | Historia i wysyłka (niżej). Wysyłka bez istniejącej rozmowy tworzy ją w tej samej transakcji. |
| `GET /api/platform/chat/conversations/?limit&cursor` | Lista rozmów dla superadmina: `{conversations:[{conversationId, organizationId, organizationName, archived, activityAt, lastMessage:{id, senderRole, createdAt, preview(160 pkt), truncated}\|null}], nextCursor}` od najnowszej aktywności; zawiera firmy zarchiwizowane. Brak wskaźnika nowych: należy do #52. |

## Wysyłka

`POST {clientMessageId: UUID, body: string, conversationId?: UUID}`; inne pola (np. załączniki) dają `400 INVALID_INPUT`. Sukces `201 {message, conversationId, deduplicated:false}` wraca dopiero po commicie. Ponowienie tego samego `clientMessageId` od tego samego nadawcy z tym samym tekstem daje `200` z tą samą wiadomością (`deduplicated:true`), bez drugiego wiersza i bez obciążenia limitu ruchu. Inny tekst lub inny nadawca pod tym kluczem: `409 CLIENT_MESSAGE_ID_CONFLICT`. Obcy `conversationId`: `404 NOT_FOUND`, bez zapisu.

Tekst: NFC, CRLF/CR zamieniane na LF, brak pustych/białych, brak NUL i znaków sterujących poza TAB/LF, brak samotnych surrogatów; więcej niż 4 000 punktów kodowych po NFC to `422 MESSAGE_TOO_LONG`, niedozwolone znaki `422 INVALID_MESSAGE`. Zapisywany jest surowy tekst, nigdy HTML ani interpretacja; UI musi go wyświetlać jako tekst. Limit ruchu: 10/10 s i 30/60 s na konto, oba muszą mieć miejsce; odmowa `429 RATE_LIMITED` z `Retry-After`, odmówiona próba niczego nie zużywa. Licznik jest pobierany w tej samej transakcji co zapis wiadomości.

DTO wiadomości: `{id, clientMessageId (tylko własne, inaczej null), body, senderRole, own, createdAt}`. Bez `senderId`, adresu e-mail i danych technicznych.

## Historia

`GET …/messages/?limit=1..100 (domyślnie 30)&before=<kursor>|after=<kursor>&conversationId=`. Bez kursora: najnowsza strona. Odpowiedź: `{conversationId, messages (chronologicznie), olderCursor (null na początku historii), newerCursor, hasNewer}`. `before` czyta starsze, `after` nowsze (`hasNewer` oznacza kolejną stronę). Kursor jest nieprzewidywalny, podpisany i związany z rozmową; błędny, sfałszowany lub z innej rozmowy to `400 INVALID_CURSOR`. Klucz sortowania to `ChatMessage.seq`: numer w rozmowie przydzielany pod blokadą firmy, więc równy kolejności commitów; równoległe zapisy nie gubią ani nie dublują rekordów między stronami. Brak rozmowy: `{conversationId:null, messages:[]}`.

Dla #51: po commicie wiadomość jest widoczna przez `after=newerCursor`; WebSocket może używać tego jako źródła wznowienia. Zdarzenie push z procesu zapisu nie powstaje w #50 (brak outboxu dla czatu w architekturze); mechanizm rozsyłania wybiera #51. Istniejący `src/modules/chat/realtime.ts` nadal zapisuje fixture bez rozmowy i nadawcy (`conversationId` NULL, `seq` NULL); jest poza historią i musi zostać przepięty na `sendMessage` w #51.

## Autoryzacja i firma

Zapis blokuje wiersz `Organization` w trybie `FOR NO KEY UPDATE` (jak archiwizacja, okres, flota i blokady), po czym ponownie sprawdza aktora, rolę, firmę i `archivedAt`: archiwizacja zatwierdzona wcześniej odmawia adminowi (`403`), a oczekująca archiwizacja unieważnia czekającą wysyłkę. Wygaśnięcie okresu usługi niczego nie blokuje. Admin nie ma dostępu po archiwizacji; historia zostaje. Superadmin czyta rozmowy zarchiwizowanych firm, ale nie zapisuje do nich (`409 CHAT_ORGANIZATION_ARCHIVED`): decyzja do potwierdzenia przez właściciela. Czat nie zapisuje audytu (kontrakt audytu wyklucza treść czatu), nie tworzy zadań ani e-maili i nie loguje treści; błędy zwracają wyłącznie kody.
