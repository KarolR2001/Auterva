# Strefa sesji PostgreSQL dla aplikacji

`createPrismaClient` ustawia `TimeZone=UTC` na **każdym nowym połączeniu** puli, zanim połączenie zostanie udostępnione Prisma. Dotyczy to runtime, workerów, skryptów i testów korzystających ze wspólnej fabryki, również gdy serwer lub URL połączenia rozpoczyna sesję w `Europe/Warsaw`. W zainstalowanym `pg-pool` callback `onConnect` jest oczekiwany przed wypożyczeniem klienta; błąd ustawienia strefy odrzuca połączenie.

To chroni rzeczywiste chwile `TIMESTAMPTZ` przy parametrach JavaScript `Date`. Odczyt modelu może pozornie odtworzyć tę samą wartość mimo błędnego zapisanego epoch, dlatego regresja porównuje `EXTRACT(EPOCH)` w SQL, oba przejścia DST i constraint trialu 336 godzin. `DATE` pozostaje datą kalendarzową; granicę opłaconego dnia nadal oblicza domena według `Europe/Warsaw`.

Zmiana nie przepisuje istniejących rekordów ani strefy serwera. Ewentualne dane zapisane wcześniej przy sesji innej niż UTC wymagają oddzielnej oceny i jawnej procedury korekty. Przed stagingiem trzeba sprawdzić ten kontrakt na docelowej konfiguracji dostawcy i poolera.
