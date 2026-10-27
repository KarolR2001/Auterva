# Plan #51 i #159: WebSocket czatu (read/typing, odzyskiwanie) i konfiguracja serwera

Cel: serwer WS według [kontraktu](../contracts/chat-realtime.md), zgodny z C-F118–121, C-F127, C-F130–132, C-N004, C-N059 i D-08. Części klienckie (szkic, `read` po ok. 500 ms, throttling UI) należą do #52.

## Etapy

1. Konfiguracja (#159): `WS_HOST`, `WS_PORT`, `WS_ALLOWED_HOSTS` walidowane przy starcie; domyślnie loopback; bez trybu „dowolny host”.
2. Sygnał w transakcji: `pg_notify` w transakcji `sendMessage` (bez treści); `read` zapisuje kursor monotonicznie w tej samej transakcji co sygnał.
3. Serwer: autoryzacja handshake (Origin z `HostMapping`, sesja z MFA, rola, firma, stan konta, superadmin w kontekście firmy), kolejka ramek, `send`/`read`/`typing`, dostarczanie z DB od kursora gniazda (sygnał tylko budzi), LISTEN z odbudową, backpressure, heartbeat, rewalidacja.
4. Testy na PostgreSQL i prawdziwych połączeniach WS; pomiar p95.
5. Kontrakt, CI.md, traceability, bramki, PR.

## Kontrakt (skrót)

- Źródłem prawdy jest tabela `ChatMessage` (`seq`): sygnał `NOTIFY` jest podpowiedzią; każde gniazdo ma własny kursor `seq` i dociąga z DB. Dzięki temu zerwany LISTEN, reconnect i wiele instancji nie gubią ani nie dublują wiadomości.
- `typing` jest ulotny (przez `NOTIFY`, bez zapisu), wygasa po 3 s po stronie serwera, 1/s na aktora i firmę.
- `read` tylko na jawną ramkę klienta; samo połączenie nie zmienia kursora.

## Ryzyka

- `NOTIFY` nie jest kolejką: pokryte dociąganiem z DB po odbudowie LISTEN, pollingiem przy awarii LISTEN i okresowym uzgadnianiem.
- Wolni klienci: limit bufora i kod `4408`; limit zaległości odtwarzania i tryb `refetch`.
- Rewalidacja: zbiorcza co 1 s oraz przed każdą akcją; niedostępność DB nie rozłącza (nic nie jest wtedy dostarczane).
- Limity ruchu wysyłki (D-04) zostają w `sendMessage`; ramki mają własny limit i limit kolejki.
