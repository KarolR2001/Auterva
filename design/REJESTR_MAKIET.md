# Rejestr makiet i dopasowania aplikacji

Ten plik opisuje bieżący stan prac nad makietami Penpota i dopasowaniem do nich aplikacji. Każdy wiersz mówi, co już poprawiono, gdzie i w którym PR, a co jeszcze czeka. Odpowiada na pytanie, czy coś trzeba poprawić. Zapisuj tu tylko ten stan, a dowody (zrzuty, wyniki CI) dawaj do PR.

Inne pliki:
- `design/traceability.json` — ID ekranów kanonicznych.
- `design/screen-occurrences.json` — w których planszach i plikach powtarza się dany ekran.
- `design/AGENTS.md` — zasady pracy z Penpotem.

Ostatnia aktualizacja: 27.11.2026: chrome we wszystkich trzech plikach (Ekrany strona 03, Sc. Mobile, Sc. Desktop) to instancje biblioteki System; `BlockForm` w Systemie według aplikacji.

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
8. **Nagłówek, dolne menu, pasek boczny i nagłówek strony zmieniasz wyłącznie w komponentach pliku System** (strona 01). System jest opublikowany jako biblioteka współdzielona. W pozostałych plikach przyjmij aktualizację biblioteki („Aktualizuj”) i nie odłączaj instancji. Na nowej planszy wstaw instancję z biblioteki System, wybierz wariant (role, viewport, active) i nadpisz tylko tytuł.
9. **Plik Scenariusze Desktop nie ma jeszcze spisu wystąpień.** Przed pierwszą poprawką odczytaj listę plansz strony 15, przypisz każdej `screen` tak samo jak dla Mobile i zapisz wynik w JSON.

Oznaczenia: **tak** — zrobione i obejrzane na renderze; **nie** — do zrobienia; **?** — nie sprawdzono; **n/d** — nie dotyczy.

## 2. Wzorce wspólne

| Wzorzec | Ustalenie | Ekrany | Sc. Mobile | Sc. Desktop | Aplikacja |
|---|---|---|---|---|---|
| Komponenty wzorców w pliku **System** (jedyne źródło, biblioteka współdzielona od 26.11) | `AdminTopbar` (viewport × status × role: firma online/offline/update, superadmin „SA”; desktop „Panel / {tytuł}”, mobile sam tytuł; bez wyszukiwarki), `AdminBottomNavigation` (active × notification × role: Start/Pojazdy/Czat/Więcej, Firmy/Wiadomości/Więcej, kropka), `AdminSidebar` (role × active: Pulpit, Pojazdy, Czat z Autervą, Ustawienia, Konto / Firmy, Wiadomości, Konto), `PageHeader` (tytuł 32/700 mobile, 40/600 desktop, opis 14). Wzór: `src/components/panel/panel-shell.tsx`, `panel.module.css`, `ui/page-header.module.css`. Plansze używają tylko instancji z biblioteki System; tytuł to nadpisanie `Topbar / Title`. | strona 03: **tak, 27.11** (100 `AdminTopbar`, 51 `AdminBottomNavigation`, 51 `AdminSidebar` zamiast odłączonych kopii, 2 `PageHeader`); strona 02: **tak, 27.11** (70 `PublicHeader`/`PublicFooter` strony firmy + 2 w „Hero” PUB-01; nazwa firmy, telefon i stopka prawna zachowane; na desktopie margines nagłówka nadpisany do 120 px, a przy planszach 1320 px do 60 px, czyli do krawędzi treści). Prototyp P-01 (odłożony) bez zmian | **tak, 27.11** (97 `AdminTopbar`, 93 `AdminBottomNavigation`; lokalne wzorce i plansza `00 — Wzorce mobilne` usunięte) | **tak, 27.11** (91 `AdminTopbar`, 106 `AdminSidebar`, 62 `PageHeader` z zachowanymi tekstami; nagłówek dodany na 7 planszach superadmina) | n/d |
| Nagłówek mobilny panelu firmy | Po lewej tytuł strony (16/600). Po prawej chip „● Online” (offline: ikona WifiOff, „Offline”, ramka 2 px) i awatar 40 px z ikoną CircleUserRound zamiast inicjałów. Linia tylko na dole. Wzorcem jest aplikacja (`panel-shell.tsx`). | tak, 27.11 (instancje System) | tak, 25.11 (97 plansz) | n/d (pasek boczny) | tak |
| Nagłówek mobilny superadmina | Tytuł strony i awatar „SA”, bez chipa | n/d | tak, 25.11 | „SA” ujednolicone 23.11 | tak, #474 `4b13c72c` (inicjały w CSS, axe) |
| Tytuł strony panelu (`PageHeader`) | Instancja `PageHeader` z Systemu: okruszki 14 #151515, tytuł 32/700 (M) / 40/600 (D), opis 14 #424242, bez własnego marginesu; na telefonie 16 px pod paskiem (`shellMain` padding 16) | M: **tak, 27.11** dla ADM-10 (8), ADM-11–16, ADM-22 (8) — luźne teksty zastąpione instancją; ADM-09, ADM-17 czekają na decyzję o kopiach; ADM-18–21 to ekrany stanu (bez `PageHeader`, jak w aplikacji) | nie (luźne teksty 32/700) | tak, 27.11 | tak |
| Tytuły stron (np. „Flota · Alfa Campers”) | Takie same jak w aplikacji, lista w sekcji 6. Tytuł w nagłówku to tytuł powłoki (`PanelShell title`), np. „Flota firmy”, „Edycja pojazdu”, „Kalendarz pojazdu”, „Dziennik zmian firmy”, nazwa firmy na karcie; tytuł z nazwą firmy jest w PageHeader | nagłówek tak, 27.11; PageHeader **nie** | tak, 25.11 | nagłówek tak, 27.11; PageHeader ? | tak |
| Dolne menu panelu firmy | Start \| Pojazdy \| Czat \| Więcej; ikony Lucide; aktywna pozycja w ciemnym kafelku; nieprzeczytane jako kropka 8 px przy „Czat”. Aktywna pozycja jak w aplikacji: kalendarz pojazdu i floty → Pojazdy; Dziennik, Status usługi, Ustawienia, Konto → Więcej | tak, 27.11 (instancje System; usunięte zdublowane menu w ADM-09/10 i TEN-11) | tak, 25.11 (95 plansz) | n/d | tak, #472 |
| Dolne menu superadmina | Firmy \| Wiadomości \| Więcej; także superadmin w kontekście firmy (ADM-22 superadmin-context) | tak, 27.11 (ADM-22) | tak, 25.11 | n/d | tak |
| Arkusz „Więcej” (OVR-17) | Kalendarz floty, Dziennik zmian, Status usługi, Ustawienia, Konto, Zainstaluj aplikację, Wyloguj | tak, 23.11 | ? | ? | tak, #472 |
| Menu „Profil” superadmina (PLT-UM) | Arkusz z uchwytem i wierszem tożsamości SA | n/d | tak | ? | tak, #474 |
| Siatka strony mobile | Margines 16 px; tytuł strony 32/700; 16 px między nagłówkiem a treścią; nagłówek 64 px, dolne menu 80 px przy dolnej krawędzi | nagłówek 64 i menu 80 na wszystkich 75 planszach M **tak, 27.11**; margines 16: ADM-01, 04, 05, 07, 09, 10–17, 22, ACC-04, ACC-07, TEN-04, TEN-11 tak; ADM-02, 03, 06 tak, 27.11 | tak, 26.11 | n/d | tak, #474 `ee27a485`, `fbed5c63`, `4ba1611b` |
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
| OVR-06/07/08 Blokada | `admin/vehicle-calendar.tsx`, `ui/dialog.tsx`, `admin/fleet-calendar.tsx` (szybka blokada) | F11-07, F11-07C1–C3, F11-07D1 | System `BlockForm` według aplikacji **tak, 27.11** (12 wariantów); Ekrany **tak, 27.11** (10 nakładek to instancje `BlockForm`; OVR-08 single/multiple = wariant `conflict`, bo aplikacja pokazuje jeden kolidujący wpis; połączenia prototypu odtworzone); Mobile 26.11 (stary układ) | #472 | kopie F11-07… w Sc. Mobile i kalendarze w Sc. Desktop |
| ADM-10 Kalendarz floty | `admin/fleet-calendar.tsx` | — | Ekrany 23.11 | #472 | przełącznik na telefonie (sekcja 4) |
| ADM-11–14 Ustawienia | `settings/settings-readonly.tsx`, `legal-documents.tsx`, `settings-extras.tsx` | — | M: **tylko do odczytu, 27.11** (Alert z Systemu, karta sekcji, lista etykieta/wartość, kanały, SEO, dokumenty prawne, panel „Podgląd publiczny”; dane Alfa Campers); D: **tylko do odczytu, 27.11** (PageHeader D, nawigacja 240 + kolumna 856, karta sekcji z ramką 24/40, dane w 2 kolumnach, SEO z boczną kolumną 296) | #472 (odczyt) | System: zakładka „Wygląd” i „Kontakt • 2” w `SettingsNavigation`; ekran ADM „Wygląd publiczny” nie ma planszy |
| ADM-15/16 Konto, sesje | `account/account-view.tsx`, `account/sessions-view.tsx` | — | ADM-15 i ADM-16 M/D przebudowane 27.11 według aplikacji | #472 | — |
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

- **Logowanie firmy (decyzja właściciela 27.11):** teksty jak w aplikacji — „Panel administratora”, „Zaloguj się do panelu”, „Zarządzaj flotą i dostępnością. Po haśle potwierdzisz logowanie kodem MFA.”, pole „E-mail” / „Adres przypisany do konta” / „admin@firma.pl”, „Nie pamiętasz hasła? Zresetuj je →”, stopka „MFA wymagane • brak publicznej rejestracji”. Wcześniejsza wersja makiety („Zaloguj się” + nazwa firmy) jest nieaktualna.
- **Formularz blokady (27.11, właściciel zlecił wybór wersji bliższej PRD i prostszej dla użytkownika):** makiety według aplikacji (`vehicle-calendar.tsx`). Okno „Dodaj okres niedostępności” / „Edytuj blokadę” z opisem „Pojazd: {nazwa}. Daty obejmują całe dni…”; bez pola „Pojazd” (pojazd wynika z kalendarza); pola „Od” (podpowiedź o formacie), „Do (włącznie)”, „Typ” („Serwis” według D-15, nie „Serwis lub naprawa”), „Numer odniesienia (opcjonalnie)”, „Notatka prywatna (opcjonalnie)”; przyciski „Zamknij” i „Dodaj blokadę” / „Zapisz zmiany”, bez stałego napisu „Niezapisane zmiany” (aplikacja pyta „Odrzucić wpisane dane?” przy zamykaniu). Konflikt (FR-ADM-055) jako żółte ostrzeżenie w formularzu z „Przejdź do istniejącego wpisu” i „Zmień daty” — osobne okno OVR-08 jest nieaktualne. Szybka blokada (FR-ADM-056) to wybór pojazdu i „Dalej”, potem zwykły formularz. „Kopiuj na inne auta” (D-48): desktop w nagłówku okna, telefon jako przycisk na całą szerokość nad „Usuń blokadę”. `BlockDetailsPanel` (podgląd blokady bez edycji) nie istnieje w aplikacji — kliknięcie blokady otwiera edycję.
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
| 26.11 | System | `AdminTopbar` (8 wariantów), `AdminBottomNavigation` (14), `AdminSidebar` (8), `PageHeader` według aplikacji; System opublikowany jako biblioteka | strona 01 Systemu |
| 27.11 | Ekrany | ADM-15 i ADM-16 M/D według `account-view.tsx` / `sessions-view.tsx`: zakładki „Profil i hasło” / „Aktywne sesje • 3”, karty profilu i hasła, karta MFA; bieżąca sesja jako ciemna karta z etykietą, „Inne urządzenia”, „Zakończ wszystkie pozostałe sesje (2)” z ostrzeżeniem; „Odśwież listę” w nagłówku strony | render 4 plansz |
| 27.11 | Ekrany | ADM-02 i ADM-03 M z układu ADM-01 (BrandLogo, Flex 16 px, tytuł 32/700) z tekstami z `reset-flow.tsx` (kontekst „Odzyskiwanie dostępu”, przycisk, link powrotu, notka). ADM-06 M z układu ADM-07 w stanie nowego szkicu (`vehicle-form.tsx`: „Nowy szkic • niezapisany”, „Niekompletny szkic”, „Zapisz szkic”, bez „Zarządzaj publikacją”). | render ADM-02, 03, 06 |
| 27.11 | Ekrany | 10 plansz M (ADM-01, 04, 05, 07, 09, 17, ACC-04, ACC-07, TEN-04, TEN-11) z treścią poprawionych kopii Sc. Mobile pod starymi ID; ADM-05/09/17 przestawione na panel firmy; 31 `FormField` przepiętych na System | render ADM-01, 05, 07, 09, 15, TEN-04, TEN-11 |
| 27.11 | System | `Alert`, `FormField`, `SettingsNavigation` według `ui.module.css` i `settings.module.css` (szczegóły w kolejce) | render wariantów |
| 27.11 | Ekrany | ADM-11–14 M i D przebudowane na podgląd tylko do odczytu według `settings-readonly.tsx` (D-01): Alert z Systemu, bez pól, przycisku „Zapisz” i statusu zapisu; dane Alfa Campers zamiast „Auterva”. Decyzja właściciela 27.11: „teraz, w tej rundzie”. | render 8 plansz |
| 27.11 | Ekrany | OVR-06/07/08 i OVR-07 delete-confirm (10 nakładek M/D) jako instancje `BlockForm` z Systemu pod starymi ID; plansze potwierdzenia odłączone od starego `Dialog`; połączenia prototypu z przycisków odtworzone („Zamknij”, „Dodaj blokadę” → konflikt, „Usuń blokadę” → potwierdzenie, „Zapisz zmiany” → ADM-09 saved, „Kopiuj na inne auta” → ADM-10 bulk-copy, „Przejdź do istniejącego wpisu” → OVR-07, „Zmień daty” → zamknięcie) | render OVR-06 M, OVR-07 delete M, OVR-08 D; brak nakładania plansz |
| 27.11 | System | `BlockForm` (12 wariantów: dodawanie, edycja, szybka blokada, zapisywanie, konflikt, usunięcie × M/D) przebudowany według `vehicle-calendar.tsx`, `fleet-calendar.tsx` i `ui/dialog.tsx` (decyzja w sekcji 4): okno 640 px / arkusz 390 px, pola `FormField` z Systemu. Nowe warianty w Systemie: `TextInput` type=select/date/textarea (wypełnione i wyłączone, ikony Lucide chevron-down i calendar), `FormField` support=none, `Button` destructive/tertiary sm, `Alert` warning action=buttons. Prawdziwe imię i adres w danych przykładowych Systemu (`BlockDetailsPanel`, `AuditDetails`, `AccountSummary`, `MenuTrigger`) zamienione na „Anna Nowak” / „Anna DEMO”, „AN”, `anna.nowak@example.test` | render 6 wariantów, odczyt pozycji wszystkich 12 |
| 27.11 | System | 44 warianty formularzy złożonych z układem absolutnym → Flex (procedura `absToFlex`: wiersze z elementów na tej samej wysokości, mediana odstępów, wysokość według treści) | odczyt pozycji BlockForm D, ReauthenticationDialog |
| 27.11 | System | `LoginForm` mobile: teksty z aplikacji (decyzja właściciela). Warianty desktop (400 px) i stany 4 formularzy auth zbudowane z wersji mobile: logowanie (w toku, błąd, limit, wygasła sesja), reset (wysyłanie, wysłano, limit, błąd), nowe hasło (różne hasła, zapisywanie, wygasły link, sukces), MFA (błąd, usługa niedostępna, kod odzyskania, błąd kodu odzyskania) | render LoginForm M/D, stany; odczyt tekstów TwoFactor |
| 27.11 | Sc. Mobile | 9 odłączonych formularzy logowania/MFA zastąpionych instancjami `LoginForm`/`TwoFactorForm` z Systemu (teksty i widoczność stanów przywrócone) | render F02-07, F02-07B |
| 27.11 | Ekrany | ADM-01, ADM-02, ADM-03, ACC-07: odłączone formularze zastąpione instancjami `LoginForm`, `ResetPasswordRequest`, `SetNewPasswordForm`, `TwoFactorForm` z Systemu; TEN-04 D: `PageHeader` na 280 px / y 104 | render ADM-01, ACC-07, TEN-04 D |
| 27.11 | System | Decyzja właściciela 27.11: poprawione formularze przeniesione z Ekranów (kopiowanie). `LoginForm`, `ResetPasswordRequest`, `SetNewPasswordForm`, `TwoFactorForm` — warianty mobile — mają treść z ADM-01, ADM-02, ADM-03, ACC-07 (te same ID komponentów); pola to `FormField`, przyciski główne `Button` z Systemu, reszta odłączona z osieroconych komponentów Sc. Mobile | render LoginForm, TwoFactorForm |
| 27.11 | Sc. Desktop | Czat firmy FLOW-MVP-06/02…08 D: kolumna od 280 px (aplikacja: `.chat` max 760 px przy krawędzi treści), tytuł 32/600 | render FLOW-MVP-06/08 |
| 27.11 | Sc. Desktop | Krawędzie treści 280–1400 px jak `shellMain` (padding 40): 178 elementów (szerokie dopasowane, wąskie przesunięte), grupa akcji kalendarza SA przesunięta o 16 px, panel „Wybrana blokada” 20 px od krawędzi karty | render FLOW-MVP-11/06, PLT-01-02; odczyt pozycji FLOW-MVP-12/04 |
| 27.11 | Sc. Desktop | Po aktualizacji biblioteki: 62 `PageHeader` (bez marginesu) wyrównane do krawędzi treści planszy i y 104; 7 kontenerów Flex z marginesem 48 → 40; 5 plansz „Status usługi” na `AdminSidebar active=none` | render FLOW-MVP-11/06, 10/04, 06/02O |
| 27.11 | System, Ekrany | System: `PageHeader` mobile bez marginesu i z wysokością według treści, okruszki #151515, tytuł 32/700; `PublicHeader` tylko linia na dole, desktop 1440 px z marginesem 120. Ekrany (po „Aktualizuj”): 21 plansz M z tytułem jako instancją `PageHeader` i 16 px pod paskiem; 25 nagłówków 72→64 px i 14 dolnych menu 88→80 px (treść przesunięta). | render ADM-10 M bulk-select, ADM-11 M, ADM-15 M, ADM-22 M list |
| 27.11 | Ekrany | TEN-04 M/D: odtworzony PageHeader („Status usługi”, „Napisz do Autervy”; M: 32/700 i przycisk z ramką jak w aplikacji). ADM-17 D i TEN-04 D na `AdminSidebar active=none`. Strona 02: nagłówki i stopki strony firmy przepięte na System (bez „Dostępność”, „O nas”, „Kontakt”), 15 martwych obszarów prototypu dla usuniętych linków usunięte. Przy okazji przepięte też P-02 D (3 plansze, odłożony prototyp). | render TEN-04 M/D, PUB-01 D, PUB-02 M, PUB-03 D |
| 27.11 | System | `AdminSidebar` ma wariant `role=company, active=none` (strony spoza paska: Dziennik zmian, Status usługi). `PublicHeader` według `public-chrome.tsx`: desktop tylko „Pojazdy” + „Skontaktuj się” po prawej (bez Dostępność, O nas, Kontakt), menu mobile: Strona główna, Pojazdy, Kontakt, Polityka prywatności, bez przycisku. `PublicFooter`: bez podtytułu, linki Pojazdy, Kontakt, Polityka prywatności. | render wariantów na stronie 01 |
| 27.11 | Sc. Mobile | Podłączony System; 189 instancji lokalnych wzorców i 1 osierocony nagłówek (FLOW-MVP-11/07D1, tło nakładki) przepięte z zachowanym tytułem; „Start + nowa wiadomość” → wariant z kropką. Usunięte 8 ukrytych starych menu (FLOW-MVP-02) i plansza `00 — Wzorce mobilne` z 11 komponentami lokalnymi. | render PLT-01-02, FLOW-MVP-06/01, FLOW-MVP-08/03 |
| 27.11 | Sc. Desktop | Podłączony System; 259 instancji przepiętych (91 nagłówków, 106 sidebarów, 62 PageHeader; teksty PageHeader przywrócone po ścieżce warstw). Superadmin: wariant `platform`, tytuły powłoki z aplikacji; panel firmy: Pulpit, Pojazdy, Status usługi (bez aktywnej pozycji), Czat z Autervą. Usunięte: 8 zdublowanych sidebarów (FLOW-MVP-02), 6 nakładek „Czat z Autervą” (FLOW-MVP-06). 16 sidebarów wydłużonych do wysokości planszy. Nagłówek dodany na PLT-01-02, PLT-10 (×3), FLOW-MVP-10/03, 10/04, 11/01 (treść niżej o 72 px). | render FLOW-MVP-02/01, 04/05, 06/02O, 10/04, 11/06, PLT-10 |
| 27.11 | Ekrany, strona 03 | Podłączony System; 153 instancje chrome przepięte (`swapComponent`) z zachowanym tytułem, 51 odłączonych sidebarów zastąpionych instancjami. Tytuły mobile = tytuł desktopu („Panel administracyjny” → „Treść”, „Wiadomości” → „Czat z Autervą”). ADM-22 superadmin-context: wariant `platform`, tytuł „Ustawienia firmy”. Aktywna pozycja menu według aplikacji (ADM-18–21 i A-02 → Pojazdy). Usunięte duplikaty menu (ADM-09/10 ×11, TEN-11 M i D). | render ADM-04 D, ADM-05 M, ADM-10 M, ADM-17 D, ADM-18 M, ADM-22 M/D, TEN-11 M |

Wniosek z 26.11: PR #474 dopasowano do kopii scenariuszy, zanim poprawiono wzorce. Plik Ekrany nie dostał wzorców poprawionych w Scenariuszach. Ten sam ekran był więc poprawiany dwa razy i według dwóch różnych wzorów. Stąd zasady 2–4 i sekcja 2.

## 6. Kolejka

1. **Ekrany:** nagłówek, menu i sidebar zrobione 27.11 (instancje System). Zostały: siatka 16 px i tytuły 32/700 na planszach M, PUB-03 M jak F05-04, warianty ADM-11–14 tylko do odczytu, teksty ADM-17 i TEN-11. Strona 02: nagłówki i stopki przepięte 27.11. Uwaga: marketing Autervy (MKT) ma w aplikacji własny nagłówek i stopkę (`marketing-page.tsx`) — instancji na planszach MKT nie przepinać na nagłówek strony firmy.
   - System: `PublicHeader` desktop ma ramkę ze wszystkich stron (aplikacja: tylko linia na dole) i margines 32 px (Ekrany nadpisują go do 120/60 px). Poprawić w Systemie i przyjąć aktualizację.
   - **System, zrobione 27.11:** `Alert` (ikony Lucide info/check/triangle/circle-alert 20 px, X zamiast „×”, akcja podkreślona bez „→”, tytuł 14/700, wysokość według treści), `FormField` (bez wewnętrznego marginesu, wysokość według treści), `SettingsNavigation` (Flex, 6 zakładek jak w aplikacji: Firma/Kontakt/Wygląd/SEO/Prawne/Kalendarz; desktop pełne nazwy w ramce 16 px; nowe warianty `active=appearance`; bez „• 2”). Do przyjęcia w Ekranach przez „Aktualizuj” i przepięcie osieroconych instancji.
   - **System, 27.11:** `PageHeader` desktop (default i compact) bez marginesu, wysokość według treści, wyrównanie do góry, szerokość 1120 jak obszar treści w aplikacji. Sc. Desktop przyjęło zmianę 27.11 (62 instancje wyrównane do krawędzi treści planszy, y 104). TEN-04 D w Ekranach poprawione 27.11 (280 px, y 104, karta 32 px niżej).
   - **System, 27.11:** w 83 komponentach złożonych z polami (`LoginForm`, `SetNewPasswordForm`, `TwoFactorForm`, `BlockForm`, formularze ustawień, dialogi…) elementy `FormField` rozciągnięte na całą szerokość pola. Zostają puste odstępy pionowe tam, gdzie komponent ma układ absolutny, a `LoginForm` ma stare teksty („Zaloguj się do panelu”). Warianty mobile `LoginForm`, `ResetPasswordRequest`, `SetNewPasswordForm`, `TwoFactorForm` zrobione 27.11 (treść z poprawionych ekranów). Na ADM-01/02/03 i ACC-07 w Ekranach formularze są instancjami tych komponentów (27.11). Sc. Mobile 27.11: 9 kopii jako instancje z przywróconymi tekstami i widocznością (F02-06, F03-04 logowanie; F02-07, 07A, 07B, 07C, F03-05, PLT-10 Seven i C — MFA). Zostają odłączone: PLT-08 (logowanie SA, inna struktura), F10-05B (z komunikatem o archiwizacji), pozostałe stany MFA o innej strukturze (07D…07J), archiwalne „Restore #132”; warianty desktop i stany zrobione 27.11 (LoginForm 5, ResetPasswordRequest 5, SetNewPasswordForm 5, TwoFactorForm 5; komunikaty z `auth-flow.tsx`/`reset-flow.tsx`, `Alert`/`Button`/`FormField` z Systemu); pozostałe formularze złożone: 27.11 przebudowane na Flex 44 warianty z układem absolutnym (BlockForm ×12, ChangePasswordForm ×6, ReauthenticationDialog ×4, FormSection ×8, SEOFields ×4, LegalContentEditor ×4, BlockDetailsPanel ×4, Combobox ×3) — elementy w tej samej linii łączone w wiersze, odstępy z dotychczasowego układu, instancje z wysokością według treści, usunięte techniczne etykiety „DS-…”. Treść tych formularzy nie była jeszcze porównana z aplikacją (np. `BlockForm` z `vehicle-calendar.tsx`) — osobna runda, potem przepięcie osieroconych instancji na planszach (nakładki OVR-06/07/08, ustawienia SA).
   - **Zrobione 27.11 — 10 plansz M z kopii Sc. Mobile:** treść wklejonych plansz przeniesiona do starych plansz kanonicznych (te same ID, więc `traceability.json` bez zmian i zachowane 26 połączeń prototypu prowadzących do nich). ADM-05/09/17: nagłówek i menu firmy, tytuły „Pojazdy”/„Dziennik zmian”, usunięta karta kontekstu superadmina. ADM-07: bez komunikatu o wyłączonej stronie (to stan FLOW-MVP-08), status „Pojazd jest publiczny. Zmiany pojawią się po zapisaniu.”. Penpot przy wklejaniu między plikami usunął połączenia wychodzące z tych plansz — do odtworzenia przy pracy nad prototypami A-01/A-02/A-04.
   - `FormField`: 31 samodzielnych instancji w Ekranach przepiętych na System z zachowaniem tekstów (ADM-01, 02, 03, 06, 07, 15, ACC-04, ACC-07, M i D). 113 zagnieżdżonych w innych komponentach (`LoginForm`, nakładki, `screens/`) przepnie się dopiero z tymi komponentami.
   - ADM-15 M/D: **zrobione 27.11** według `account/account-view.tsx` i `account.module.css` (zakładki, karta profilu z polem „Nazwa” i „Zapisz nazwę”, bieżąca sesja, „Wyloguj się” na dole; karta „Zmiana hasła” — na telefonie bez ramki, na desktopie z ramką i polami w 2 kolumnach; karta MFA; `FormField` i `Button` z Systemu).
   - (archiwalne) Decyzja 27.11: właściciel kopiuje 10 poprawionych plansz ze Sc. Mobile do Ekranów (ADM-01 ← FLOW-MVP-02/M/06, ADM-04 ← FLOW-MVP-09/M/06, ADM-05 ← FLOW-MVP-11/M/03, ADM-07 ← FLOW-MVP-08/M/04, ADM-09 ← FLOW-MVP-11/M/06, ADM-17 ← FLOW-MVP-11/M/09, ACC-04 ← FLOW-MVP-02/M/04, ACC-07 ← FLOW-MVP-02/M/07A, TEN-04 ← FLOW-MVP-07/M/03, TEN-11 ← FLOW-MVP-06/M/08). Agent potem: chrome firmy zamiast superadmina tam, gdzie kopia jest w kontekście SA (ADM-05, 09, 17), nazwy plansz, nowe ID w `traceability.json`, usunięcie starych plansz.
   - `FormField`: osierocone kopie w Ekranach mają wewnętrzny margines 20 px (pole zaczyna się na 36 px zamiast 16, np. ADM-11, ADM-15). Poprawić komponent w Systemie według aplikacji i przepiąć instancje z zachowaniem tekstów.
   - Odstęp między `PageHeader` a zakładkami/treścią na ADM-11–16 to 37 px; sprawdzić z aplikacją (gap sekcji).
   - Pozostałe instancje w Ekranach (~620: `Button`, `FormField`, „Variant Set”, `Dialog`, `StatusBadge`, `AdminMoreMenu` …) nadal wskazują osierocone kopie. Przepinać dopiero po zmianie danego komponentu w Systemie, bo podmiana kasuje nadpisane teksty.
2. **Aplikacja, PR #474:** dopasowanie zrobione 26.11 (`b76fee75`, CI zielone). Zostały CR i QA, a drobne różnice są w kolumnie „Otwarte” w sekcji 3.
3. **Sc. Desktop:** krawędzie treści wyrównane 27.11 do 280–1400 px (178 elementów na planszach absolutnych; 7 kontenerów Flex: margines 40 i elementy na pełną szerokość; PLT-01-02: wiersz Gamma Car wstawiony pod Beta Van). Czat firmy FLOW-MVP-06 D (8 plansz): kolumna 760 px od 280 (było 320) i tytuł 32/600 jak `chat.module.css` — zrobione 27.11. Zostaje: wnętrza komponentów z układem absolutnym, spis plansz do `screen-occurrences.json`. Uwaga: plik jest ciężki — eksport dużych plansz przekracza limit, a partie > 15 zmian usypiają kartę.
4. Osobne issue dla ADM-08.
5. **Blokada w scenariuszach:** Ekrany zrobione 27.11. Zostały kopie F11-07, F11-07C1–C3, F11-07D1 w Sc. Mobile i nakładki blokady w kalendarzach Sc. Desktop — zastąpić instancjami `BlockForm` z Systemu. Sprawdzić tam nadpisania z prawdziwym imieniem (w Systemie i Ekranach strona 03 usunięte 27.11).

Tytuły stron w aplikacji (wzorzec dla makiet):
- stałe: Firmy, Dodaj firmę, Wiadomości, Czat z Autervą, Ustawienia, Ustawienia firmy, Status usługi, Pulpit;
- z nazwą: „Flota · {nazwa}”, „Edycja pojazdu · {nazwa}”, „Kalendarz pojazdu · {nazwa}”, „Dziennik zmian · {nazwa}”;
- karta firmy ma za tytuł nazwę firmy.

## 7. Wspólne komponenty ekranów (propozycja)

**Problem.** Po podziale pliku instancje w plikach Ekrany i Scenariusze wskazują własne, zamrożone kopie komponentów. Zmiana w pliku System do nich nie dociera. Nagłówki i menu w Sc. Mobile są teraz kopiami odłączonymi od komponentu (95 + 97). Każda zmiana wzorca wymaga więc ręcznej poprawki we wszystkich trzech plikach.

**Decyzja 26.11 (właściciel): jedno źródło w pliku System.**
- Spis plików wykazał, że komponenty chrome (`AdminTopbar`, `AdminBottomNavigation`, `AdminSidebar`, `PageHeader`, `PublicHeader`, `PublicFooter`) od początku są w Systemie.
- Instancje w Ekranach i Sc. Desktop mają te same ID komponentów, ale wskazują osieroconą kopię we własnym pliku, bez głównej wersji. Dlatego poprawki trafiały do kopii.
- System opublikowano jako bibliotekę, a komponenty zaktualizowano do wzoru z aplikacji z zachowaniem ID.
- Pliki podłączają System (`library.connectLibrary`) i przepinają instancje (`swapComponent`). Tytuł i aktywną pozycję trzeba odczytać przed podmianą i nadać po niej.
- Lokalne wzorce w Sc. Mobile usunięte 27.11 po przepięciu na System.
- `swapComponent` kasuje nadpisania. Tytuł nagłówka ustaw ponownie; w innych komponentach (np. `PageHeader`) zapisz teksty i widoczność warstw po ścieżce nazw przed podmianą i nadaj je po niej.
- Podmieniaj partiami po ≤ 20 instancji z krótką przerwą. 27.11 partia ~70 przekroczyła limit czasu wtyczki, a odświeżenie karty skasowało niezapisane ~80 podmian.

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
