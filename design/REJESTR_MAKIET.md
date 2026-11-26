# Rejestr makiet i dopasowania aplikacji

Ten plik opisuje bieżący stan prac nad makietami Penpota i dopasowaniem do nich aplikacji. Każdy wiersz mówi, co już poprawiono, gdzie i w którym PR, a co jeszcze czeka. Odpowiada na pytanie, czy coś trzeba poprawić. Zapisuj tu tylko ten stan, a dowody (zrzuty, wyniki CI) dawaj do PR.

Inne pliki:
- `design/traceability.json` — ID ekranów kanonicznych.
- `design/screen-occurrences.json` — w których planszach i plikach powtarza się dany ekran.
- `design/AGENTS.md` — zasady pracy z Penpotem.

Ostatnia aktualizacja: 26.11.2026, na podstawie odczytu pliku Scenariusze Mobile i PR #472/#474.

## 1. Zasady (obowiązują każdego agenta)

1. **Najpierw sprawdź ten rejestr.** Przed zmianą makiety lub kodu UI odszukaj ekran w sekcjach 2–4.
   - Pozycja oznaczona „tak” z datą i PR jest zrobiona. Nie rób jej drugi raz.
   - Jeśli makieta wygląda inaczej, sprawdź najpierw, czy rozbieżność nie jest opisana w sekcji 4.
2. **Każdy ekran ma jedną planszę kanoniczną:**
   - ADM-\*, PUB-\*, OVR-\*, ACC-\*, TEN-\* i MKT-01 są w pliku **Ekrany** (M i D);
   - PLT-\* są w planszach `PLT-…` plików **Scenariusze Mobile** (M) i **Scenariusze Desktop** (D);
   - ID są w `traceability.json`.

   Plansze `FLOW-MVP-*` to kopie ekranów w określonym stanie. Pokazują dane i stan, ale nie definiują wyglądu.
3. **Kolejność zmian:**
   1. Decyzja (PRD 3.1, D-xx).
   2. Wzorzec wspólny (sekcja 2).
   3. Plansza kanoniczna.
   4. Wszystkie wystąpienia z `screen-occurrences.json`, we wszystkich plikach.
   5. Aplikacja.
   6. Wpis w tym rejestrze.

   Nie poprawiaj samej kopii scenariusza tak, żeby różniła się od wzorca. Jeśli wzorzec ma się zmienić, zmień go najpierw i przenieś zmianę wszędzie.
4. **Jeden wzorzec, jeden wygląd.** Elementy z sekcji 2 (nagłówek, menu, tytuł, marginesy, karty, pole czatu, kalendarz) muszą wyglądać tak samo w każdym pliku i w aplikacji. Jeśli nie zdążysz przenieść zmiany wszędzie, wpisz brakujące miejsca do kolumny danego pliku jako „nie”.
5. **Aplikacja ma wspólne komponenty.** Ten sam kod obsługuje kilka plansz, np. `vehicle-list` służy ADM-05 i FLOW-MVP-11/03, a `chat-panel` służy TEN-11 i wszystkim stanom FLOW-MVP-06.
   - Zmiana pod planszę scenariusza jest zmianą ekranu kanonicznego, więc sprawdź oba.
   - Nie dodawaj stylów działających tylko w jednym scenariuszu.
6. **Decyzje mają pierwszeństwo nad makietą** (makiety bywają nieaktualne). Rozbieżność, której nie poprawiasz, zapisz w sekcji 4. Nie zmieniaj makiety, żeby ukryć różnicę w aplikacji.
7. **Zapisuj po każdej rundzie, w tej samej zmianie:**
   - zaktualizuj sekcje 2–5: stan, datę, plik i PR/SHA;
   - przy nowym pliku lub nowej stronie uzupełnij `screen-occurrences.json`;
   - jedna runda to jedna linia w sekcji 5.
8. **Nagłówek i dolne menu zmieniasz wyłącznie w komponencie wzorca** na planszy „00 — Wzorce mobilne (komponenty)” w danym pliku. Instancji nie odłączaj. Na nowej planszy wstaw instancję i nadpisz tylko tytuł. Ta sama zmiana musi trafić do wzorców w każdym pliku, który je ma (sekcja 2, pierwszy wiersz).
9. **Plik Scenariusze Desktop nie ma jeszcze spisu wystąpień.** Przed pierwszą poprawką odczytaj listę plansz strony 15, przypisz każdej `screen` tak samo jak dla Mobile i zapisz wynik w JSON.

Oznaczenia: **tak** — zrobione i obejrzane na renderze; **nie** — do zrobienia; **?** — nie sprawdzono; **n/d** — nie dotyczy.

## 2. Wzorce wspólne

| Wzorzec | Ustalenie | Ekrany | Sc. Mobile | Sc. Desktop | Aplikacja |
|---|---|---|---|---|---|
| Komponenty wzorców (nagłówek i dolne menu) | Tylko instancje komponentów z planszy „00 — Wzorce mobilne (komponenty)” w danym pliku: 3 nagłówki (firma online, firma offline, superadmin), 5 menu firmy (Start, Pojazdy, Czat, Więcej, Start + nowa wiadomość), 3 menu superadmina. Tytuł strony to nadpisanie tekstu w instancji. | **nie** | tak, 26.11 (189 instancji na 96 planszach) | n/d | n/d |
| Nagłówek mobilny panelu firmy | Po lewej tytuł strony (16/600). Po prawej chip „● Online” (offline: ikona WifiOff, „Offline”, ramka 2 px) i awatar 40 px z ikoną CircleUserRound zamiast inicjałów. Linia tylko na dole. Wzorcem jest aplikacja (`panel-shell.tsx`). | **nie**: mały szary tytuł sekcji, awatar „AN” | tak, 25.11 (97 plansz) | n/d (pasek boczny) | tak |
| Nagłówek mobilny superadmina | Tytuł strony i awatar „SA”, bez chipa | n/d | tak, 25.11 | „SA” ujednolicone 23.11 | tak, #474 `4b13c72c` (inicjały w CSS, axe) |
| Tytuły stron (np. „Flota · Alfa Campers”) | Takie same jak w aplikacji, lista w sekcji 6 | **nie** | tak, 25.11 | ? | tak |
| Dolne menu panelu firmy | Start \| Pojazdy \| Czat \| Więcej; ikony Lucide; aktywna pozycja w ciemnym kafelku; nieprzeczytane jako kropka 8 px przy „Czat” | tak, 23.11 | tak, 25.11 (95 plansz) | n/d | tak, #472 |
| Dolne menu superadmina | Firmy \| Wiadomości \| Więcej | n/d | tak, 25.11 | n/d | tak |
| Arkusz „Więcej” (OVR-17) | Kalendarz floty, Dziennik zmian, Status usługi, Ustawienia, Konto, Zainstaluj aplikację, Wyloguj | tak, 23.11 | ? | ? | tak, #472 |
| Menu „Profil” superadmina (PLT-UM) | Arkusz z uchwytem i wierszem tożsamości SA | n/d | tak | ? | tak, #474 |
| Siatka strony mobile | Margines 16 px; tytuł strony 32/700; 16 px między nagłówkiem a treścią | **nie**: część ma 24 px, np. ADM-05 | tak, 26.11 | n/d | tak, #474 `ee27a485`, `fbed5c63`, `4ba1611b` |
| Karta kontekstu superadmina | „Zarządzasz firmą: …”, linia o aktorze, „← Wróć do karty firmy” | n/d | tak | ? | tak, #474 |
| Status | Tekst oraz ikona lub ramka; pigułka szeroka według treści | tak, 23.11 (~120) | tak, 25.11 (63) | ? | tak |
| Ikony | Lucide zamiast znaków (‹ › ! ✓ × ⊘, litery w pasku) | tak, 23.11 | tak, 26.11 | ? | tak |
| Czat: tytuł i pole wiadomości | Tytuł 32/700; pole i „Wyślij” po prawej, w karcie | tytuł tak; pole ? | tak, 26.11 | ? | tak, #474 `fdc48bd4` (32/700; podpowiedź nad polem w panelu firmy, w skrzynce pod polem — #435) |
| Kalendarz miesiąca w panelu | Siatka 7 kolumn mieści się w karcie (7 × 43 px przy 390 px); strzałki miesiąca bez ramki | tak | tak, 26.11 | ? | tak, #474 `047d320e` |
| Logowanie i MFA | Logo do lewej, Flex, margines 16 px, przyciski z ramką jak F02-07A | ? | tak, 26.11 (20 ekranów) | ? | tak, #474 `4c19ff8c`, `fbed5c63` (16 px; PLT-08 ze znakiem) |
| Strona pojazdu (PUB-03): termin | D-44: bez pól „Od/Do”, termin tylko w kalendarzu | ? (PUB-03 M ma inną galerię i kartę wyniku) | tak, 26.11 | ? | tak |
| Dane przykładowe | Administratorka „Anna Nowak”; superadmin „SA”; bez prawdziwych nazwisk | tak, 23.11 | tak | tak, 23.11 | tak |
| Nazwy | Pulpit, Okres próbny, Nazwa w adresie, czas polski, Dodaj blokadę, Dziennik zmian | tak, 23.11 | tak, 23.11 | tak, 23.11 | tak, #472 |

## 3. Ekrany: gdzie są i w jakim stanie

Kody wystąpień w Scenariuszach Mobile (`F06-02` = `FLOW-MVP-06 / M / 02`). ID plansz są w `design/screen-occurrences.json`. Dla Scenariuszy Desktop odczytu jeszcze nie ma.

| Ekran | Kod aplikacji | Wystąpienia w Sc. Mobile | Makieta | Aplikacja | Otwarte |
|---|---|---|---|---|---|
| ADM-01 Logowanie firmy | `auth/auth-flow.tsx` | F02-06, F03-04, F10-05B | Ekrany 23.11; Mobile 26.11 | #472, #474 | nagłówek/siatka Ekranów |
| ACC-04 Aktywacja | `auth/activation-flow.tsx` | F02-04…05B (6), F03-02, F12-02, F12-02A | Mobile 26.11 | #474 `4c19ff8c` | — |
| ACC-07 MFA i kody | `auth/auth-flow.tsx` | F02-07…07J1 (17), F03-05; PLT-10 M ×11 | Mobile 26.11 | #474 | Ekrany ? |
| ADM-04 Pulpit | `admin/dashboard.tsx` | F02-08, F09-06 | Ekrany 23.11; Mobile 26.11 | #472 | nagłówek Ekranów |
| ADM-05 Lista pojazdów | `admin/vehicle-list.tsx`, `platform/company-fleet.tsx` | F11-03 | Ekrany 23.11; Mobile 26.11 | #472, #474 `9098c87c` | Ekrany: margines 24 px, nagłówek; aplikacja: pasek „Flota firmy” zamiast „Flota · {nazwa}” |
| ADM-06 Dodaj pojazd | `admin/vehicle-form.tsx` | F04-03 | Mobile: F04-03 przebudowany 26.11, układ płaski | #472 (ADM-06, sekcje) | sekcja 4: F04-03 ≠ ADM-06 |
| ADM-07 Edycja i zdjęcia | `admin/vehicle-form.tsx`, `admin/vehicle-photos.tsx` | F04-04…12 (10), F08-04, F08-05, F11-04, F11-05 | Mobile 26.11 | #472, #474 `ac8007f1` | — |
| ADM-08 Podgląd pojazdu | brak dla administratora (jest `platform/company-preview.tsx`) | F04-10 | Mobile 26.11 (D-44) | **brak ekranu**; podgląd SA `4ba1611b` | osobne issue |
| ADM-09 Kalendarz pojazdu | `admin/vehicle-calendar.tsx` | F11-06, F11-07D2, F11-08 | Ekrany 23.11; Mobile 26.11 | #472, #474 `047d320e`, `ee27a485` | panel „Wybrana blokada” (sekcja 4) |
| OVR-06/07/08 Blokada | `admin/vehicle-calendar.tsx` | F11-07, F11-07C1–C3, F11-07D1 | Ekrany 23.11 (dialogi); Mobile 26.11 | #472 | — |
| ADM-10 Kalendarz floty | `admin/fleet-calendar.tsx` | — | Ekrany 23.11 | #472 | przełącznik na telefonie (sekcja 4) |
| ADM-11–14 Ustawienia | `settings/*` | — | **nie**: wariant tylko do odczytu (D-01) | #472 (odczyt) | przebudowa makiet |
| ADM-15/16 Konto, sesje | `account/*` | — | Ekrany 23.11 | #472 | — |
| ADM-17 Dziennik zmian | `audit/audit-log.tsx` | F11-09, F11-07D3 | Ekrany 23.11; Mobile 26.11 | #472, #474 `2a88dd8f`, `4ba1611b` | teksty ADM-17 w Ekranach |
| ADM-18 Offline | `public/admin/offline.html`, `panel/panel-shell.tsx` | — | Ekrany 23.11 („Offline”) | #472 | — |
| TEN-04 Status usługi | `panel/service-status.tsx` | F03-06, F07-03, F08-01, F08-03, F08-03B | Mobile 26.11 | #472, #474 `74e1b8b7`, `80503760`, `ee27a485` | tytuł karty i miejsce przycisku czatu (F03-06) |
| TEN-11 Czat firmy | `chat/chat-panel.tsx` | F06-01…03, F06-07, F06-08, F08-06 (11) | Ekrany 23.11; Mobile 26.11 | #472, #474 `fdc48bd4` | podtytuł różni się między plikami (Ekrany) |
| PLT-01-02 Lista firm | `platform/company-list.tsx` | kanon, F10-03, F10-04, F11-01 | Mobile 26.11 | #474 `940c2e9a`, `4ba1611b` | — |
| PLT-03 Karta firmy | `platform/company-card.tsx`, `company-ops.tsx`, `company-domain.tsx`, `company-diagnostics.tsx` | kanon + 6 stanów diag; F03-01/03, F07-01…02, F08-07, F09-01…03E, F10-01…08, F11-02, F11-10, F12-01, F12-04…07 (31) | Mobile 26.11 | #474 `9ccbcadc`, `865ac7e1` | karta bez edycji danych (sekcja 4) |
| PLT-04 Dodaj firmę | `platform/new-company-form.tsx` | F02-01…03C (9) | Mobile 26.11 | #474 `130f1132` | — |
| PLT-08 Logowanie SA | `auth/auth-flow.tsx` | kanon | Mobile 26.11 | #474 `fbed5c63` | „Pokaż” jako ikona oka (spójnie z F02-04) |
| PLT-09 Wiadomości | `platform/message-inbox.tsx`, `chat/chat-panel.tsx` | kanon ×2, F06-04…06 (6) | Mobile 26.11 | #474 `4390bc89`, `ec1e16d6`, `fdc48bd4` | bez wyszukiwania i „Online” (sekcja 4); podpowiedź pod polem (#435) |
| PLT-10 Konto SA | `account/*` | kanon + 11 wariantów MFA | Mobile 26.11 | #474 | tytuł „Konto”, układ ADM-15 (#471) |
| PUB-01 Strona główna | `public/public-home.tsx` | F08-08, F09-05, F12-08 | Ekrany 23.11 | #472 | — |
| PUB-01-02 pusta oferta | `public/public-home.tsx` | F02-09, F12-03 | Mobile 26.11 | #474 `bfd20747` | — |
| PUB-03 Strona pojazdu | `app/pojazdy/[slug]/page.tsx`, `public/availability-panel.tsx`, `public/vehicle-gallery.tsx` | F04-13, F04-13a/b, F05-04…04d (5) | Mobile 26.11 (D-44); Ekrany: inna galeria i karta wyniku | #472, #474 `f139ba22`, `0c9b36e1` | ujednolicić PUB-03 w Ekranach z F05-04 |
| OVR-03 Wybór terminu | `public/availability-panel.tsx` | F05-01…03c (6) | Mobile 26.11 (bez pól dat) | #474 | aplikacja: kalendarz w treści strony zamiast nakładki |
| OVR-04 Kontakt | `public/contact-sheet.tsx` | F05-05, F05-05b, kontakt bez dat | Mobile 26.11 | #474 (`<dialog>`) | — |
| PUB-09 Strona wyłączona | `public/state-page.tsx` | F08-02 | Mobile 26.11 | #474 `bfd20747` | — |
| OVR-13 Niezapisane zmiany | `panel/unsaved-changes-dialog.tsx` | F02-OVR-13, FLOW09 odrzuć | ? | istnieje | — |

## 4. Stałe rozbieżności i decyzje (nie poprawiać ponownie)

- **D-44:** na stronie pojazdu i w nakładkach terminu nie ma pól „Od/Do”. Formularz blokady w panelu ma pola dat.
- **D-01:** ADM-11–14 są dla administratora firmy tylko do odczytu. Makiety z edytorem są nieaktualne. Do zrobienia jest wariant makiety tylko do odczytu.
- **F04-03 a ADM-06:** obowiązuje formularz z sekcjami według ADM-06 (#471). Płaski F04-03 jest starszy.
- **ADM-08:** chroniony podgląd pojazdu dla administratora firmy nie istnieje (ma go tylko superadmin). To brakująca funkcja, nie kwestia wyglądu; potrzebne osobne issue.
- **Poza PRD, nie budujemy bez decyzji właściciela:**
  - panel „Wybrana blokada” (ADM-09 i F11-06 go pokazują);
  - przełącznik „Według pojazdu / Według daty” w ADM-10;
  - „Podgląd” i „Zapisz i kontynuuj” w formularzu pojazdu;
  - zrzuty ekranu w hero MKT-01.
- **PLT:**
  - „Czat (1)” bez licznika, bo API go nie podaje;
  - skrzynka bez wyszukiwania i bez pigułki „Online”;
  - karta firmy bez edycji danych i uploadów.
- **Teksty i nagłówek publiczny:**
  - zostaje „Zapisałem kody” (tak jak w aplikacji);
  - nagłówek publiczny bez linków „O nas” i „Kontakt” (test `public-vehicle.spec.ts`);
  - bez Messengera (ADM-12);
  - suwak 0–12 (D-22);
  - limity 120/320 znaków.

## 5. Historia rund

| Data | Plik / kod | Zakres | Ślad |
|---|---|---|---|
| 23.11 | Penpot | Podział na 4 pliki: System, Ekrany, Sc. Mobile, Sc. Desktop | `docs/plans/penpot-podzial-plikow.md` |
| 23.11 | Ekrany | Etykiety przycisków (~340), Lucide w pasku i statusach, dolne menu, arkusz „Więcej”, 12 dialogów, polskie nazwy, minimum 12 px, dane osobowe, „Offline” | sesja orkiestratora |
| 23.11 | Sc. Desktop, Sc. Mobile | Teksty, polskie nazwy, 12 px, etykiety, wysokość 14 plansz (Desktop), „SA” | sesja orkiestratora |
| 23–24.11 | Aplikacja | Dopasowanie do Ekranów; CI 9/9, e2e 105/105 przy `d4d073e` | PR #472, porównanie `Auterva-qa/471` |
| 25.11 | Aplikacja | Dopasowanie do **starych** plansz Sc. Mobile (przed poprawkami z 25–26.11) | PR #474 `7361d978` |
| 25–26.11 | Sc. Mobile | Wzorce z sekcji 2; Flex na planszach absolutnych; D-44; 0 błędów w skanie 179 plansz | porównanie `Auterva-qa/473/mockup.html` |
| 26.11 | Aplikacja | Dopasowanie do poprawionych plansz Sc. Mobile; CI lokalne exit 0, e2e 105/105 przy `b76fee75` | PR #474, porównanie `Auterva-qa/473/cmp-v3` |
| 26.11 | Sc. Mobile | Nagłówki i menu jako instancje 11 komponentów wzorców (189 instancji). Kanoniczna PLT-03 dostała menu superadmina zamiast starego 4-pozycyjnego z „Pulpit”. | plansza `00 — Wzorce mobilne (komponenty)` |

Wniosek z 26.11: PR #474 dopasowano do kopii scenariuszy, zanim poprawiono wzorce. Plik Ekrany nie dostał wzorców poprawionych w Scenariuszach. Ten sam ekran był więc poprawiany dwa razy i według dwóch różnych wzorów. Stąd zasady 2–4 i sekcja 2.

## 6. Kolejka

1. **Ekrany:** przenieść z sekcji 2 nagłówek, tytuły i siatkę 16 px na plansze M. Ujednolicić PUB-03 M z F05-04. Zrobić warianty ADM-11–14 tylko do odczytu. Poprawić teksty ADM-17 i TEN-11.
2. **Aplikacja, PR #474:** dopasowanie zrobione 26.11 (`b76fee75`, CI zielone). Zostały CR i QA, a drobne różnice są w kolumnie „Otwarte” w sekcji 3.
3. **Sc. Desktop:** spis plansz do `screen-occurrences.json`, potem przegląd wzorców z sekcji 2.
4. **Wspólne komponenty:** decyzja właściciela (sekcja 7).
5. Commit `design/traceability.json`, `design/README.md`, `docs/plans/penpot-podzial-plikow.md` oraz tego rejestru.
6. Osobne issue dla ADM-08.

Tytuły stron w aplikacji (wzorzec dla makiet):
- stałe: Firmy, Dodaj firmę, Wiadomości, Czat z Autervą, Ustawienia, Ustawienia firmy, Status usługi, Pulpit;
- z nazwą: „Flota · {nazwa}”, „Edycja pojazdu · {nazwa}”, „Kalendarz pojazdu · {nazwa}”, „Dziennik zmian · {nazwa}”;
- karta firmy ma za tytuł nazwę firmy.

## 7. Wspólne komponenty ekranów (propozycja)

**Problem.** Po podziale pliku instancje w plikach Ekrany i Scenariusze wskazują własne, zamrożone kopie komponentów. Zmiana w pliku System do nich nie dociera. Nagłówki i menu w Sc. Mobile są teraz kopiami odłączonymi od komponentu (95 + 97). Każda zmiana wzorca wymaga więc ręcznej poprawki we wszystkich trzech plikach.

**Decyzja 26.11 (właściciel: „najprościej i najwydajniej”):** wzorce są lokalnymi komponentami w każdym pliku. Wtyczka MCP nie daje dostępu do komponentów biblioteki „System” z innego pliku (podłączona biblioteka zwraca 0 komponentów), a kształtów nie da się przenieść między plikami przez API. Plik Mobile ma je od 26.11, plik Ekrany jest następny. Biblioteka współdzielona zostaje opcją na później.

**Pierwotna propozycja:**
1. W pliku System zrobić komponenty wzorców z sekcji 2:
   - `MobileHeader` (firma online/offline, superadmin);
   - `BottomNav` (firma: 4 aktywne pozycje; superadmin: 3);
   - `MoreSheet`, `PageTitle`, `SuperadminContextCard`, `ChatComposer`, `MonthCalendar`, `StatusPill`, `VehicleCardAdmin`, `AuthShell`.
2. Opublikować System jako bibliotekę współdzieloną i podłączyć ją do plików Ekrany, Sc. Mobile i Sc. Desktop.
3. Podmienić odłączone kopie na instancje.

Potem zmiana wzorca to jedna edycja w Systemie i „Aktualizuj” w każdym pliku.

**Do sprawdzenia przed wdrożeniem:**
- podłączenie biblioteki przez API wtyczki (`penpot.library.connectLibrary`) albo ręcznie w interfejsie;
- próba na jednej planszy;
- koszt podmiany (~600 plansz).

Wariant tańszy: wzorce jako komponenty lokalne w każdym pliku. Wtedy zmiana trafia do trzech miejsc zamiast setek.
