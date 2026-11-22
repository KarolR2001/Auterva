# Czat w czasie rzeczywistym: kontrakt #51 i #159

Dla #52/#53/#27 (UI) i operatora procesu `ws`. Zapis i historia: [kontrakt #50](chat-conversations-messages.md); limity: [D-04](technical-limits-and-mfa-bootstrap.md); archiwizacja: [#48](company-archive-restore.md); okres usługi: [#17](service-period-runtime.md). Wymagania: C-F118–121, C-F127, C-F130–132, C-N004, C-N059, D-08. Serwer jest podpowiedzią i kanałem; **źródłem prawdy jest zawsze baza** (`ChatMessage.seq`, `ConversationReadCursor`).

## Podział odpowiedzialności

| Serwer (#51) | Klient (#52) |
|---|---|
| Autoryzacja, dostarczenie od kursora, `read` zapisany dopiero na ramkę, wygaszanie `typing` po 3 s, limit 1/s, rewalidacja | Szkic w local storage per `(accountId, conversationId)`, wysłanie `read` dopiero po ok. 500 ms **faktycznej** widoczności wiadomości, throttling `typing` w UI, deduplikacja po `message.id`, ponowienie z tym samym `clientMessageId` |

## Konfiguracja procesu (#159)

Odczytywana i walidowana raz przy starcie (`src/modules/chat/realtime-config.ts`); błędna wartość kończy proces komunikatem `Invalid server configuration: <ZMIENNA>` (bez wartości).

| Zmienna | Znaczenie |
|---|---|
| `WS_PORT` | Port 1–65535, domyślnie 3101 (lokalnie `.env` ustawia własny). |
| `WS_HOST` | Adres nasłuchu (literał IPv4/IPv6), domyślnie `127.0.0.1`. Kontener ustawia `0.0.0.0` (obraz `ws` robi to w `Dockerfile`). |
| `WS_ALLOWED_HOSTS` | Lista dokładnych wartości nagłówka `Host`, rozdzielona przecinkami (`host` albo `host:port`, małe litery, bez schematu, ścieżki i `*`; najwyżej 50). Zastępuje domyślną wartość. Gdy pusta, a nasłuch nie jest loopbackiem, proces **nie startuje**. Domyślnie `127.0.0.1:<WS_PORT>`. |

W produkcji proxy zwykle przepisuje `Host` na stały host usługi WS, więc `WS_ALLOWED_HOSTS` zawiera host usługi, nie hosty paneli firm (te sprawdza Origin). Nie ma trybu „dowolny host”. `WS_ALLOWED_HOSTS` to host, który zaufany proxy przekazuje do procesu WS. Dodatkowo **Origin** przeglądarki musi być aktywnym wpisem `HostMapping`: `COMPANY_ADMIN` firmy z żądania albo `PLATFORM`. To ochrona przed cross-site WebSocket: sam `Host` jej nie zastępuje. Nagłówków `X-Forwarded-*` serwer nie używa. W produkcji Origin musi mieć `https:` (transport `wss`, C-N059); TLS kończy proxy.

## Handshake

`GET /ws?organizationId=<uuid>[&after=<kursor>]` z ciasteczkiem sesji i `Origin`. Inne parametry to `400`. Kolejno: ścieżka, `Host` z allowlisty, [limit prób źródła](#limit-prób-handshake-173), Origin z rejestru, sesja z **dowodem MFA tej sesji**, rola, firma i stan konta (`requireAuthorizedActor`: konto aktywne, e-mail zweryfikowany, TOTP włączone, firma niezarchiwizowana). Admin: `organizationId` musi być firmą hosta panelu. Superadmin: host `PLATFORM`, `organizationId` wskazuje istniejącą firmę (także zarchiwizowaną; kontekst firmy, własna tożsamość, bez impersonacji).

## Limit prób handshake (#173)

Pierwszy krok po sprawdzeniu ścieżki i `Host` (przed parsowaniem parametrów, `HostMapping`, sesją i jakimkolwiek zapytaniem do bazy): limit prób na **źródło**, 60 prób (każdy wynik: także `400`, `403`, `503` puli i przyjęte połączenie) na ruchome 60 s, wspólnie dla `/ws` i `/ws/platform`. Powyżej limitu: `429` z `Retry-After` (sekundy, co najmniej 1), bez zapytań do bazy; odrzucone próby nie są liczone, więc nie wydłużają okna, a klient po `Retry-After` wznawia połączenie z kursorem jak po każdym rozłączeniu. Odmowa ścieżki (`404`) i `Host` (`403`) nie zużywa budżetu. Limit dotyczy tylko nowych prób: otwarte połączenia, limit 5 połączeń konta i pula 2000 działają bez zmian.

Licznik jest w pamięci procesu WS, celowo poza współdzielonymi licznikami D-04 (odmowa nie może kosztować zapytania): każda instancja egzekwuje własny limit. Tabela źródeł ma najwyżej 10 000 wpisów po najwyżej 60 znaczników czasu; nowe źródło usuwa najpierw wygasłe, potem najstarsze wpisy, w stałym czasie. Wartości: `handshakeWindowMs`, `maxHandshakesPerWindow`, `maxHandshakeSources` (`RealtimeLimits`). Limit chroni przed powodzią z jednego źródła; powódź rozproszoną ogranicza nadal pula 2000 i limit na krawędzi (#90).

**Źródło** ustala wyłącznie serwerowy adapter `clientAddress` (`src/modules/chat/handshake-limit.ts`) i ta sama reguła co limity HTTP (`trustedClientAddress`). Nagłówki żądania (`X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`, `Forwarded`, `X-Auterva-Client-Address`) nie są czytane. IPv6 jest grupowane po /64, IPv4-mapped liczy się jako IPv4.

| Adapter | Źródło | Stan |
|---|---|---|
| Lokalny (`localClientAddress`, domyślny) | Peer gniazda, tylko gdy jest loopbackiem: lokalna przeglądarka albo lokalny pośrednik przekazujący `/ws` (local-ingress, #426), który sam przyjmuje wyłącznie loopback. Ta sama reguła co `scripts/start-local-ingress.ts`. Lokalnie wszyscy klienci są więc jednym źródłem (ta sama maszyna) i dzielą jeden limit. Pośrednik na loopbacku jest nieodróżnialny od lokalnego klienta, więc produkcyjne proxy na tym samym hoście też wymaga adaptera dostawcy. | dostarczone |
| Dostawcy za proxy | Adres z nagłówka ustawianego przez skonfigurowane proxy dostawcy, przyjmowany tylko od tego proxy; `null`, gdy go brak. Podłączany jako `clientAddress` w `startRealtimeServer`. | **otwarte, zależy od #90** (wybór dostawcy i jego nagłówka; bez tego nagłówek pochodziłby od klienta) |

Gdy adapter nie zna adresu (`null` albo wartość niebędąca adresem IP; dla adaptera lokalnego każdy peer spoza loopbacku, czyli np. load balancer dostawcy):

- w produkcji (`NODE_ENV=production`) handshake dostaje `503` przed zapytaniami do bazy, tak jak limity HTTP odpowiadają `503 TRUSTED_INGRESS_REQUIRED`. Adres proxy nigdy nie jest brany za klienta, bo wspólny licznik pozwalałby jednemu klientowi zablokować czat wszystkim. Skutek: obraz `ws` za proxy dostawcy nie przyjmuje połączeń do czasu adaptera z #90 (logowanie produkcyjne bez zaufanego adaptera też odmawia). Ostrzeżenie `realtime.handshake-source-failed` najwyżej raz na okno.
- poza produkcją (dev, testy) takie próby dzielą jedno źródło `unknown` z tym samym limitem.

Odrzucenia limitem: licznik `auterva_ws_handshake_limited_total` (bez wpisu w logu na każdą odmowę), alert `WS_HANDSHAKE_FLOOD` (ticket, ≥ 100 w 5 min; runbook `monitoring-incidents.md#realtime`).

Odmowa to odpowiedź HTTP przed upgrade, bez treści: `403` (każda odmowa autoryzacji, celowo jednolita), `400` zły parametr lub `after`, `404` ścieżka, `429` ponad 5 połączeń tego konta w tej samej firmie albo ponad limit prób źródła (wtedy z `Retry-After`), `503` ponad 2000 połączeń, zamykanie procesu albo brak zaufanego adresu źródła w produkcji. Zdarzenia firmy A nie trafiają do B (grupy per firma, zapytania z `organizationId`).

## Ramki (JSON, tekst)

Klient → serwer (ścisłe obiekty; obce pole lub inny `type` to `error INVALID_FRAME`; limit 64 KiB na ramkę, ponad to zamknięcie `1009`):

| Ramka | Znaczenie |
|---|---|
| `{type:"send", clientMessageId, body, conversationId?}` | Ten sam use case co `POST …/messages/` (`sendMessage`): D-04 (NFC, 4 000 punktów, polityka znaków, limit 10/10 s i 30/min), deduplikacja, blokada firmy i ponowna autoryzacja w transakcji. |
| `{type:"read", messageId}` | Jawny sygnał „ta wiadomość była widoczna”. Przesuwa kursor aktora **tylko do przodu**; starsza lub powtórzona wiadomość nic nie zmienia. Wiadomość musi należeć do firmy z połączenia (`NOT_FOUND`). |
| `{type:"typing"}` | Ulotne, nie jest zapisywane. Serwer przepuszcza najwyżej 1/s na aktora i firmę na instancję; nadmiar jest cicho pomijany. |

Serwer → klient:

| Ramka | Znaczenie |
|---|---|
| `ready` | `{protocol:1, role, conversationId\|null, cursor\|null, backlog:"none"\|"replay"\|"refetch", state}`. Pierwsza ramka. `state` = `{ownMessageId, ownSeq, peerMessageId, peerSeq, unread}`: dokąd przeczytał użytkownik i druga strona oraz liczba nieprzeczytanych wiadomości drugiej strony. **Samo połączenie, `ready` i odtworzenie nie zmieniają żadnego kursora** (ukryta karta, preload, dashboard nie kasują `unread`). |
| `message` | `{conversationId, message, cursor}`; `message` ma kształt DTO z kontraktu #50 (`own`, `senderRole`, `clientMessageId` tylko własne; bez `senderId` i e-maila). Kolejność rosnąca po `seq`. Własne wiadomości z tego samego gniazda przychodzą w `sent`, zwykle bez powtórzenia w `message`; przy wyścigu sygnału może przyjść także `message` z `own:true`, a własne z innego urządzenia zawsze mają `own:true`. Klient deduplikuje po `id`. |
| `sent` | Potwierdzenie `send` po trwałym zapisie: `{clientMessageId, conversationId, message, deduplicated, cursor}` (C-F130). Ponowienie tego samego `clientMessageId` i tekstu daje `deduplicated:true`, bez drugiego wiersza (C-F131). |
| `read` | `{conversationId, own, readerRole, messageId, unread}`. `own:false`: druga strona przeczytała do `messageId` (status „odczytano”, C-F121). `own:true`: kursor tego konta przesunięto (też z innego urządzenia lub potwierdzenie własnego `read`); `unread` aktualna liczba. Przy `own:false` brak `unread`. |
| `typing` | `{conversationId, senderRole, active}`. `active:true` przy pierwszym sygnale i najwyżej raz na sekundę; `active:false` serwer wysyła 3 s po ostatnim sygnale albo od razu po wiadomości tej strony. Nie dotyczy własnych sygnałów. |
| `sync` | `{conversationId, state}`: pełny stan po odbudowie LISTEN serwera. Klient zastępuje swój `unread` i stan odczytu. |
| `error` | `{code, clientMessageId?, retryAfter?}`: `INVALID_FRAME`, `INVALID_INPUT`, `INVALID_MESSAGE`, `MESSAGE_TOO_LONG`, `CLIENT_MESSAGE_ID_CONFLICT`, `NOT_FOUND`, `CHAT_ORGANIZATION_ARCHIVED`, `RATE_LIMITED` (z `retryAfter`), `INTERNAL_ERROR`. Bez treści wiadomości. Połączenie zostaje. |

`state.unread` superadmina w kontekście firmy **zarchiwizowanej** wynosi zawsze `0` w `ready` i `sync` (D-23: `read` jest tam odrzucany, więc licznik nigdy by nie zniknął), tak samo jak `unread` w liście platformy (liczba z `ready`/`sync` aktualizuje się przy następnym `ready`/`sync`, nie natychmiast po archiwizacji); wiadomości zostają w historii, a po przywróceniu firmy licznik wraca do zwykłej reguły. Administrator firmy zarchiwizowanej nie ma połączenia (4401).

Ramki jednego gniazda są wykonywane po kolei. Limit ruchu ramek: 60 na 10 s i 20 w kolejce; przekroczenie zamyka `4429`.

## Kody zamknięcia

| Kod | Znaczenie i zachowanie klienta |
|---|---|
| `4401` | Sesja lub konto nie daje już dostępu (wylogowanie, cofnięcie, wygaśnięcie sesji, archiwizacja, wyłączone konto, utrata MFA). Nie łączyć ponownie bez logowania. Dotyczy też `send`/`read`/`typing` na cofniętej sesji: zamknięcie i odmowa, bez zapisu. |
| `4408` | Klient czyta zbyt wolno (bufor wyjściowy ponad 1 MiB). Połączyć ponownie z kursorem. |
| `4429` | Za dużo ramek. Odczekać i połączyć ponownie. |
| `4503` | Proces się zatrzymuje (wdrożenie). Połączyć ponownie z kursorem, z wykładniczym opóźnieniem. |
| `1009` | Ramka większa niż 64 KiB. |
| `1006`/brak | Zerwanie sieci lub martwe połączenie (ping serwera co 30 s, brak odpowiedzi kończy połączenie). Połączyć ponownie z kursorem. |

## Kursory i odzyskiwanie

Kursor to podpisany, związany z rozmową token z kontraktu #50 (`message.cursor`, `sent.cursor`, `ready.cursor`; `newerCursor` z `GET …/messages/`). Jego pozycja to `ChatMessage.seq`, numer przydzielany pod blokadą firmy, więc równy kolejności commitów.

- **Reconnect:** `…/ws?organizationId=…&after=<ostatni kursor>`. Serwer dociąga z bazy wszystko po `seq` kursora (`ready.backlog:"replay"`), po kolei, bez braków i powtórzeń, a potem przechodzi na tryb na żywo. Ostatni kursor pochodzi z ostatniego `message`/`sent`/`ready` klienta. `sent.cursor` jest bezpiecznym punktem wznowienia: serwer wysyła `sent` dopiero po dostarczeniu na tym gnieździe wszystkich wiadomości o niższym `seq` (ta sama pętla gniazda; wiadomość o niższym `seq` przychodzi przed `sent`), a gdy się to nie uda, `cursor` jest `null` i klient używa kursora z historii HTTP.
- **Bez `after`:** brak odtwarzania; tryb na żywo od bieżącej pozycji. Klient pobiera historię przez HTTP (`GET …/messages/`). Aby nie mieć luki między HTTP a WS, łączy się z `after=newerCursor` z odpowiedzi HTTP albo najpierw łączy się, potem pobiera i deduplikuje po `message.id`.
- **Za daleko za serwerem** (ponad 200 wiadomości): `ready.backlog:"refetch"`, serwer nic nie odtwarza. Klient pobiera historię przez HTTP (`after`) i ewentualnie łączy się ponownie z nowym kursorem. Przy `ready` z `backlog:"refetch"` pole `ready.cursor` wskazuje głowę rozmowy, więc klient **zachowuje własny kursor** i dociąga historię HTTP (`after=<własny kursor>`) aż do `hasNewer:false`; dopiero potem przyjmuje kursor z gniazda (wdrożone w PR #400, #393).
- Nieprawidłowy, sfałszowany `after` lub z innej rozmowy: `400` przy handshake.
- Klient deduplikuje po `message.id`; serwer nie wysyła tej samej wiadomości dwa razy na jednym gnieździe.

## Sygnał i rozsyłanie między instancjami

`LISTEN` wymaga bezpośredniego połączenia z PostgreSQL (`DATABASE_URL` procesu WS); pooler w trybie transakcyjnym (PgBouncer) go nie obsługuje.

`sendMessage` wykonuje `pg_notify('auterva_chat', …)` **w tej samej transakcji** co zapis wiadomości, więc PostgreSQL dostarcza sygnał dopiero po commicie i nigdy dla wycofanej wiadomości. Ładunek to wyłącznie identyfikatory i pozycja (`{k:"m", o, c, s}`), bez treści. `read` zapisuje kursor i wysyła sygnał w jednej transakcji; `typing` jest tylko sygnałem (bez zapisu).

`NOTIFY` nie jest kolejką, więc sygnał jedynie budzi pętlę dostarczania gniazda, które samo trzyma `lastSeq` i czyta z bazy `seq > lastSeq`. Dlatego: (1) zerwanie i odbudowa połączenia `LISTEN` serwera nie gubi trwale zapisanych wiadomości: po odbudowie każde otwarte gniazdo jest uzupełniane z bazy i dostaje `sync`; w czasie awarii LISTEN serwer co 1 s sprawdza bazę; (2) co 30 s odbywa się uzgodnienie z bazą także przy zdrowym LISTEN; (3) wiele instancji i urządzeń widzi to samo bez wspólnej pamięci; (4) wiadomość zapisana bez sygnału (starszy kod) też jest dostarczona.

## Backpressure

Przed każdą ramką sprawdzany jest bufor wyjściowy gniazda. Powyżej 1 MiB ramka `typing` jest pomijana, a każda inna kończy połączenie kodem `4408`; powrót klienta to reconnect z kursorem. Zaległości odtwarzania są ograniczone (200), a odczyt z bazy idzie paczkami po 100.

## Rewalidacja

Autoryzacja jest sprawdzana: przy handshake; co 1 s zbiorczo jednym przebiegiem dla wszystkich połączeń firm i platformy: jedno zapytanie o sesje z użytkownikami oraz, tylko gdy istnieje gniazdo superadmina w kontekście firmy, jedno o te firmy (`revalidateAll`); przed każdą partią dostarczanych wiadomości; przy `send`/`read` ponownie pod blokadą firmy w transakcji (kontrakt #50); przy `typing`. Nie ma cache wyniku między ramkami. Unieważniają: usunięcie sesji (wylogowanie, cofnięcie, archiwizacja), `expiresAt`, brak dowodu MFA, wyłączone konto, zmiana roli lub firmy, `archivedAt` firmy admina. Zamknięcie następuje do około 1 s, a po zatwierdzonym cofnięciu żadna dalsza ramka nie jest wykonana. **Koniec okresu usługi nie rozłącza czatu i nie blokuje wysyłki.** Superadmin w kontekście zarchiwizowanej firmy zostaje połączony, ale `send`, `read` i `typing` dają `CHAT_ORGANIZATION_ARCHIVED` (D-23). Gdy baza jest niedostępna, połączenia nie są zamykane (nic nie jest wtedy dostarczane ani zapisywane).

## Wydajność

Cel: p95 dostarczenia ≤ 2 s (D-08). Test `tests/integration/chat-realtime.test.ts` (opóźnienie) mierzy lokalnie, na prawdziwym PostgreSQL i prawdziwych gniazdach, czas od rozpoczęcia `sendMessage` (zapis i commit) do odebrania `message` przez 3 gniazda (urządzenie admina i superadmin), 150 wysyłek, 300 próbek. Lokalny wynik: p50 ok. 2 ms, p95 ok. 4 ms, max ok. 20 ms. Wynik laboratoryjny nie dowodzi p95 w produkcji ani przy obciążeniu wielu firm (brak uzgodnionego profilu).

## Kanał platformy (skrzynka superadmina, #167)

Odświeżanie listy rozmów superadmina bez N połączeń: **jedno** połączenie platformy zamiast jednego na firmę. Wybrano sygnał po WebSocket, a nie odpytywanie: istniejący `pg_notify('auterva_chat')` już niesie `{k:"m", o, c, s}` (nowa wiadomość) i `{k:"r"…}` (przesunięcie kursora), więc nie powstaje druga pętla dostarczania, nowy kanał ani nowe zapytania w tle. Koszt: jedno odczytanie kilku wierszy na serię sygnałów (scalane przez 25 ms) tylko wtedy, gdy ktoś jest połączony.

`GET /ws/platform` (bez parametrów, inne to `400`; ta sama allowlista `Host` i limity: 2000 połączeń łącznie, 5 na konto, `429`/`503`). Origin musi być aktywnym wpisem `HostMapping` obszaru `PLATFORM`, sesja z dowodem MFA, rola `SUPERADMIN_AUTERVA` bez firmy (`requireAuthorizedActor`); administrator firmy, brak sesji i Origin panelu firmy dają `403`. Rewalidacja jak w #51: co 1 s zbiorczo (to samo zapytanie o sesje; wylogowanie, cofnięcie, wygaśnięcie, wyłączone konto, utrata MFA zamykają kodem `4401` do około 1 s) i przed każdym wysłaniem partii liczników. Kanał jest jednokierunkowy: ramka klienta to `error INVALID_FRAME`, powódź ramek (60/10 s) zamyka `4429`.

| Ramka serwera | Znaczenie |
|---|---|
| `ready` | `{protocol:1, scope:"platform", role}`. Klient najpierw łączy się, potem pobiera listę HTTP (bez luki) i deduplikuje po stanie z ramek. |
| `conversation` | `{organizationId, conversationId, archived, unread, lastSeq, readSeq, version, activityAt}`: aktualne liczniki jednej firmy po nowej wiadomości lub po zapisie kursora odczytu superadmina (też z innego urządzenia/gniazda firmy). Wyłącznie identyfikatory i liczniki, nigdy treść; `unread` z tego samego zapytania co lista (kursor superadmina, 0 dla archiwum). `readSeq` to pozycja kursora odczytu superadmina (0 bez kursora). Klient podmienia wiersz i przesuwa go według `activityAt`; nieznaną firmę dociąga listą. **Reguła klienta (deterministyczna):** dla danej firmy wygrywa stan z większym kluczem (`version`, `lastSeq`, `readSeq`) porównywanym leksykograficznie, w tej kolejności. `version` to `Organization.version`: archiwizacja, przywrócenie firmy i restore firmy z kopii podnoszą go, więc spóźniona odpowiedź HTTP sprzed archiwizacji nie nadpisze ramki `archived:true`. `version` jest pierwszy, bo restore z kopii może cofnąć `lastSeq` bazy kopii i kursor odczytu (`readSeq`), ale zawsze podnosi `version`: nowy stan po restore wygrywa mimo niższych `lastSeq`/`readSeq`. Poza restore wszystkie trzy wartości tylko rosną (kursor nie cofa się, `seq` i `version` rosną), więc spóźniona odpowiedź HTTP z `unread:3` nie nadpisze ramki z `unread:0` po odczycie na drugim urządzeniu. Ten sam kształt (`version`, `lastSeq`, `readSeq`, `unread`) ma wiersz listy HTTP. Przy równym kluczu stan jest identyczny (kolejne zmiany podnoszą któryś element). Klient z domyślną listą (bez `includeArchived`) usuwa wiersz po ramce `archived:true` i dodaje go z powrotem po `archived:false` (nieznaną firmę dociąga listą). |
| `refresh` | Klient odświeża listę od pierwszej strony: po odbudowie `LISTEN`, raz na początku awarii `LISTEN` (punkt odniesienia, zob. niżej), więcej niż 100 firm w jednej serii, błędzie odczytu liczników oraz co 30 s jako zabezpieczenie (zgubiony sygnał opóźni licznik najwyżej o tyle). Nowo zarchiwizowana firma znika z domyślnej listy po ramce `conversation` z `archived:true`, nie po `refresh`. |

Archiwizacja i przywrócenie firmy (`archiveCompany`, `restoreCompany`) oraz restore firmy z kopii (`src/modules/backup/company.ts`, tuż przed `COMMIT`) wykonują w swojej transakcji `pg_notify` na tym samym kanale z ładunkiem `{k:"o", o}` (tylko identyfikator firmy), więc sygnał wychodzi dopiero po commicie i nigdy przy wycofaniu. Kanał platformy odpowiada ramką `conversation` z `archived` i `unread` (0 dla archiwum), bez czekania na `refresh` co 30 s; gniazda firm tego sygnału nie obsługują i nic nie dostają.

Restore firmy z kopii unieważnia **wszystkie** sesje superadmina (nie tylko te działające w kontekście tej firmy): sesja nie niesie kontekstu firmy, więc zawężenie nie byłoby wiarygodne, a bezpieczeństwo ma pierwszeństwo przed wygodą. Skutek: otwarte `/ws/platform` zamyka się kodem `4401` (rewalidacja do około 1 s) i nie dostaje ramki `conversation` z sygnału `{k:"o"}`; po ponownym logowaniu klient pobiera listę HTTP z nowym `version`, więc dane nie przepadają. Gniazda firm spoza restore i sesje ich administratorów pozostają bez zmian.

**Tryb awaryjny (niezdrowy `LISTEN`).** Nic nie zapowiada zmian, więc **serwer sam** co `pollMs` (1 s) czyta z bazy jedno zapytanie na instancję, niezależnie od liczby gniazd: odcisk każdej rozmowy (`lastSeq`, `Organization.version`, stan archiwum oraz pozycja każdego kursora odczytu: użytkownik i `seq` wiadomości, na którą wskazuje; nie czas zapisu, bo `updatedAt` to czas startu transakcji, a dwa równoległe odczyty mogą zatwierdzić się w odwrotnej kolejności i jeden zamaskowałby drugi). Firmy, których odcisk różni się od poprzedniego przebiegu, trafiają do tej samej kolejki co sygnały (scalanie 25 ms, rewalidacja przed wysłaniem, ramki `conversation`), więc zmiana dociera w około 1 s bez żadnego żądania HTTP klienta i bez zużycia wspólnego limitu odczytów superadmina `api:read:<aktor>:platform` (120/min). Pierwszy przebieg epizodu ustawia tylko punkt odniesienia i wysyła jeden `refresh`. Gdy baza jest niedostępna, nie wysyła się nic (ani `refresh` co sekundę), a jedynie zabezpieczający `refresh` co 30 s działa dalej (jest niezależny od bazy i od `LISTEN`); punkt odniesienia zostaje, więc pierwszy udany przebieg zgłasza zmiany z czasu przerwy. Bez gniazd platformy zapytanie nie jest wykonywane.

Ramki są nieodrzucalne jak w #51: przekroczenie bufora 1 MiB zamyka `4408`, a klient łączy się ponownie i odświeża listę. Pomiar: `tests/integration/chat-inbox.test.ts` (60 wysyłek, lokalnie, prawdziwy PostgreSQL i gniazdo) od startu zapisu do ramki `conversation` p50 ok. 34 ms, p95 ok. 36 ms; cel p95 ≤ 2 s (D-08); wynik laboratoryjny, nie dowodzi produkcji.

## Granice

Brak załączników, e-maili o czacie, statusu „online”, reakcji. Jedno połączenie obsługuje jedną firmę (superadmin łączy się osobno z każdą rozmową); zbiorczy kanał skrzynki platformy opisuje sekcja „Kanał platformy” (#167); `unread` jednej rozmowy pochodzi z `ready`/`sync`, a listy z `GET /api/platform/chat/conversations/`. `typing` ma limit na instancję i dodatkowy próg po stronie odbiorcy; przy kilku instancjach nadawca może przez krótko przekroczyć 1/s, odbiorca dostaje najwyżej 1/s na nadawcę.
