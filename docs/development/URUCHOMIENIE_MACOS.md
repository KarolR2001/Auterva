# Uruchomienie Auterva na macOS (do przeklikania)

Ta instrukcja służy tylko do uruchomienia aplikacji lokalnie i zalogowania się. Nie uruchamia testów i nie dotyczy pracy nad kodem. Wszystko działa wyłącznie na Twoim Macu (`127.0.0.1`), na danych testowych.

Jak czytać: **Terminal** to aplikacja Terminal (albo iTerm). Karty otwierasz przez `Cmd+T`. Komendy wpisuj po kolei, jedna po drugiej, i czekaj, aż poprzednia się skończy (chyba że opis mówi, że zostaje włączona). Opis po `#` nie jest częścią komendy.

Szczegóły, rozwiązywanie problemów, testy i tryb CI są w [URUCHOMIENIE_MACOS_SZCZEGOLY](URUCHOMIENIE_MACOS_SZCZEGOLY.md).

Używamy jednej bazy portów `44200`. Adresy w tej instrukcji zakładają właśnie ją.

---

## Część A. Raz, przy pierwszej instalacji

Pomiń tę część, jeśli masz już repozytorium w `~/Developer/Auterva`, Node 24.20.0 i pnpm.

**Terminal, karta 1.**

```sh
# Krok A1. Zainstaluj narzędzia (Homebrew musi już być zainstalowany: https://brew.sh).
brew install nvm postgresql@18 colima docker docker-buildx
```

```sh
# Krok A2. Włącz nvm. Dopisz do pliku ~/.zshrc linie, które wypisze ta komenda (export NVM_DIR ... i source nvm.sh),
# potem ZAMKNIJ i otwórz Terminal od nowa.
mkdir -p ~/.nvm && brew info nvm
```

```sh
# Krok A3. Zainstaluj Node w wymaganej wersji (raz).
nvm install 24.20.0
```

```sh
# Krok A4. Włącz pnpm w wymaganej wersji (raz).
corepack enable && corepack prepare pnpm@12.6.0 --activate
```

```sh
# Krok A5. Pobierz repozytorium (raz). Wstaw adres repozytorium zamiast <adres>.
# Trzymaj je w krótkiej ścieżce (PostgreSQL ma limit długości ścieżki).
git clone <adres> ~/Developer/Auterva
```

```sh
# Krok A6. Wejdź do repozytorium i pobierz lokalne usługi (PostgreSQL ma własny klaster, SeaweedFS i Mailpit
# pobierają się z kontrolą sumy). Wykonuje się raz.
cd ~/Developer/Auterva
nvm use 24.20.0
pnpm install --frozen-lockfile
export LOCAL_PORT_BASE=44200
scripts/local-fixture.sh install
```

---

## Część B. Za każdym razem, gdy chcesz uruchomić aplikację

Najpierw **sprawdź, że porty są wolne** (karta 1):

```sh
cd ~/Developer/Auterva
lsof -iTCP:44200-44307 -sTCP:LISTEN   # pusty wynik = wolne; jeśli coś wypisze, zakończ to albo zmień bazę portów
```

### Karta 1. Baza danych, pliki zdjęć i poczta

Uruchom raz po restarcie Maca. Po ostatniej komendzie wracasz do znaku zachęty, a usługi działają w tle.

```sh
cd ~/Developer/Auterva && nvm use 24.20.0            # wejście do repozytorium i właściwy Node
pnpm install --frozen-lockfile                        # instaluje zależności zgodnie z lockfile
pnpm exec prisma generate                             # generuje klienta bazy danych
export LOCAL_PORT_BASE=44200                          # baza portów; w każdej karcie taka sama
scripts/local-fixture.sh start                        # włącza PostgreSQL, magazyn zdjęć (S3) i pocztę testową (Mailpit)
pnpm exec prisma migrate deploy                       # zakłada/aktualizuje tabele w bazie
pnpm exec tsx scripts/seed-local-fixture.ts           # wgrywa dane testowe: firmy A i B, pojazdy, konta, host platformy
scripts/local-fixture.sh seed-media                   # wgrywa trzy zdjęcia demonstracyjne
scripts/local-fixture.sh status                       # sprawdza, czy wszystko działa (powinno napisać „accepting connections”)
```

Jeśli `start` zgłasza `Existing .env does not belong to this local fixture and port`, wykonaj `mv .env .local/env.old` i ponów `scripts/local-fixture.sh start`.

### Karta 2. Aplikacja (strony i panele)

Zostaje włączona (nie zamykaj tej karty). Cmd+T, potem:

```sh
cd ~/Developer/Auterva && nvm use 24.20.0             # wejście do repozytorium
set -a; . .local/fixture-9/secrets.env; set +a        # wczytuje klucze lokalnego magazynu zdjęć (nic nie wypisuje)
pnpm dev --port 44210                                 # włącza aplikację; pierwsze wejście na stronę trwa kilkanaście sekund
```

Jeśli komenda zatrzyma się komunikatem Next.js o „znanej luce bezpieczeństwa”, wpisz **tę samą komendę jeszcze raz**. Za drugim razem przechodzi.

### Karta 3. Wysyłka e-maili (zaproszenia, reset hasła)

Zostaje włączona. Cmd+T, potem:

```sh
cd ~/Developer/Auterva && nvm use 24.20.0                                              # wejście do repozytorium
export MAIL_PAYLOAD_KEY="$(openssl rand -hex 32)"                                      # losowy klucz do kolejki wiadomości
export MAIL_ENVIRONMENT=development MAIL_PROVIDER=sink                                 # poczta testowa: nic nie wychodzi na zewnątrz
export MAIL_ALLOWED_RECIPIENTS=admin-a@example.test,admin-b@example.test,superadmin@example.test  # dozwoleni odbiorcy
pnpm dev:worker                                                                        # włącza wysyłkę; wiadomości zobaczysz w Mailpit
```

Wiadomości testowe czytasz pod adresem `http://127.0.0.1:44203` (Mailpit).

### Karta 4. Zdjęcia pojazdów (przetwarzanie)

Zostaje włączona. Potrzebna tylko, jeśli dodajesz zdjęcia. Cmd+T, potem:

```sh
cd ~/Developer/Auterva && nvm use 24.20.0             # wejście do repozytorium
set -a; . .local/fixture-9/secrets.env; set +a        # klucze lokalnego magazynu zdjęć
pnpm dev:media-worker                                 # włącza przetwarzanie zdjęć
```

### Karta 5. Czat na żywo (serwer)

Zostaje włączona. Potrzebna tylko do czatu. Cmd+T, potem:

```sh
cd ~/Developer/Auterva && nvm use 24.20.0             # wejście do repozytorium
WS_PORT=44211 pnpm dev:ws                             # włącza serwer czatu na porcie 44211
```

### Karta 6. Bramka czatu (jeden adres dla stron i czatu)

Zostaje włączona. Potrzebna tylko, jeśli chcesz czat „na żywo” (pisanie, status przeczytania). Cmd+T, potem:

```sh
cd ~/Developer/Auterva && nvm use 24.20.0                                            # wejście do repozytorium
PORT=44216 DEV_APP_PORT=44210 WS_PORT=44211 pnpm dev:gateway                         # łączy aplikację (44210) i czat (44211) pod adresami na porcie 44216
```

---

## Część C. Wejście do aplikacji i logowanie

Hasła i klucze logowania (TOTP) każdego konta są w pliku `.local/fixture-9/access.json`. Otwórz go **tylko u siebie** i nigdy nie wklejaj nigdzie. Konta testowe:

| Konto | Do czego | E-mail |
|---|---|---|
| Superadmin | platforma, wszystkie firmy | `superadmin@example.test` |
| Administrator firmy A | panel firmy A | `admin-a@example.test` |
| Administrator firmy B | panel firmy B | `admin-b@example.test` |

Adresy wpisuj w przeglądarce (Chrome, Safari lub Firefox). Nie trzeba edytować pliku `hosts`.

| Co | Adres (bez czatu na żywo, port 44210) | Adres z czatem na żywo (port 44216, karty 5 i 6 włączone) |
|---|---|---|
| Logowanie superadmina | `http://platform.localhost:44210/login/` | `http://platform.localhost:44216/login/` |
| Wiadomości superadmina | – | `http://platform.localhost:44216/wiadomosci/` |
| Panel firmy A | `http://admin.company-a.localhost:44210/admin/login/` | `http://admin.company-a.localhost:44216/admin/login/` |
| Czat w panelu firmy A | – | `http://admin.company-a.localhost:44216/admin/czat/` |
| Panel firmy B | `http://admin.company-b.localhost:44210/admin/login/` | `http://admin.company-b.localhost:44216/admin/login/` |
| Strona publiczna firmy A | `http://company-a.localhost:44210/` | `http://company-a.localhost:44216/` |
| Strona publiczna firmy B | `http://company-b.localhost:44210/` | `http://company-b.localhost:44216/` |
| Poczta testowa | `http://127.0.0.1:44203` | `http://127.0.0.1:44203` |

Jak się zalogować:

1. Otwórz adres logowania z tabeli, wpisz e-mail konta i hasło z `access.json`.
2. Konta mają obowiązkowy drugi składnik (MFA). Pole `totpURI` z `access.json` dodaj do aplikacji z kodami (1Password, Google Authenticator): zeskanuj kod QR utworzony z tego adresu albo wpisz sekret ręcznie.
3. Na ekranie MFA wpisz 6-cyfrowy kod z aplikacji.

Konto firmy loguje się tylko na adresie swojego panelu, a superadmin tylko na adresie platformy.

---

## Część D. Zakończenie pracy

```sh
# Karty 2–6: w każdej naciśnij Ctrl+C (zatrzymuje aplikację, wysyłkę, zdjęcia, czat i bramkę).
```

W karcie 1:

```sh
cd ~/Developer/Auterva
LOCAL_PORT_BASE=44200 scripts/local-fixture.sh stop   # wyłącza bazę, magazyn zdjęć i pocztę testową (dane zostają)
```

Opcjonalnie wyłącz środowisko kontenerów, jeśli je włączałeś: `colima stop`.

---

## Gdy coś nie działa

| Objaw | Co zrobić |
|---|---|
| Po restarcie Maca nic nie działa | Wykonaj od nowa część B (dane zostają w `.local/`). |
| `lsof` w sprawdzeniu portów coś wypisuje | Port jest zajęty. Zamknij ten proces albo wybierz inną bazę portów (np. `45200`) i wpisuj ją **konsekwentnie** w każdej komendzie i każdej karcie. |
| Odmowa z `Existing .env does not belong…` | `mv .env .local/env.old`, potem ponów `scripts/local-fixture.sh start`. |
| Logowanie zwraca 404 | Sprawdź adres: superadmin na `platform.localhost`, firma na `admin.company-a.localhost` lub `admin.company-b.localhost`. Nie loguje się na samym `localhost`. |
| Brak e-maili w Mailpit | Włącz kartę 3 (wysyłka) i sprawdź `http://127.0.0.1:44203`. |
| Błąd o nieaktualnym kliencie bazy po `git pull` | `pnpm exec prisma generate` i `pnpm exec prisma migrate deploy` (karta 1). |
| Chcesz wyczyścić dane testowe i zacząć od zera | `pnpm exec tsx scripts/seed-local-fixture.ts --reset` (po tym trzeba ponownie dodać klucze TOTP do aplikacji). Nigdy `prisma migrate reset`. |
