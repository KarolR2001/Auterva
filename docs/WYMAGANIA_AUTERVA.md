# Auterva — wymagania funkcjonalne i niefunkcjonalne

Stan analizy: **22.10.2026**. Obowiązuje **PRD 3.1 z superadminem i wieloma firmami**, zgodnie z bieżącym poleceniem właściciela. Dokument opisuje wymagania, nie wykonaną aplikację.

## 1. Źródła i priorytety

- **V31 — podstawa:** [kanoniczny PRD 3.1](product/PRD.md), zwłaszcza zatwierdzone U3/U4 z §5.2A–5.4. Treść źródłowa ma preambułę z aktualną hierarchią dokumentów.
- **V30 — historia zmian:** `Auterva_PRD_MVP_Uproszczony_v3_ROBOCZY.md`, archiwum poza repozytorium. Otwarte pytania rozstrzygnięte w V31 nie są ponownie otwierane; odziedziczone reguły są zapisane poniżej.
- **V2 — wycofany szerszy zakres:** `Auterva_PRD_SaaS_Multi_Tenant_v2.md`, archiwum poza repozytorium; §8 rozlicza wszystkie funkcje zachowane i wycofane.
- **B1 — odziedziczone szczegóły:** [BASELINE_FLEET.md](product/BASELINE_FLEET.md). Zachowano treść bazowego PRD 1.0 pod preambułą; niesprzeczne wymagania floty, dostępności i jakości nadal obowiązują pod V31.
- **Design:** [SPEC wraz z decyzjami DEC](design/SPEC.md), [kontrakty komponentów](../design/handoff/components.md), [zachowanie responsywne](../design/handoff/responsive.md) i [traceability](../design/traceability.json). Dokładne strony, boardy, komponenty i ID z odczytu Penpota 22.10.2026 są w [architekturze — załącznik A](ARCHITEKTURA_AUTERVA.md#załącznik-a-dokładne-ścieżki-w-penpocie).
- **P:** potwierdzone; **B:** odziedziczone z pierwotnym priorytetem; **R:** rekomendacja; **T:** projekt wymaganej ochrony technicznej. `SHOULD/P1`, `opcjonalne` i `po MVP` nie oznaczają obowiązkowego pierwszego wydania.
- Identyfikatory `C-F`, `C-N` i `C-R` porządkują poniższy katalog; oryginalne `REQ-MVP`, `FR-*`, `UC-*`, `TEST-MVP` pozostają odwołaniami do źródeł. Samo istnienie makiety nie podnosi priorytetu funkcji.
- Numery § przy `C-*` odnoszą się do V31, chyba że wskazano V30/DEC. „PRD 1.0” w części odziedziczonej oznacza B1.

## 2. Wymagania funkcjonalne aktualnej wersji z superadminem

### Obszary i role

- **C-F001 [P]** Udostępnić publiczny onepage Autervy dla firm wynajmujących pojazdy. Źródło: §2.1 REQ-MVP-01, §3.1.
- **C-F002 [P]** Udostępnić osobny uwierzytelniony panel superadmina Autervy; przykład hosta: `app.auterva.example`. Źródło: §2.1 REQ-MVP-02, §3.1.
- **C-F003 [P]** Każda firma ma dedykowany host panelu; przykład: `alfa.sites.auterva.example`. Źródło: §2.1 REQ-MVP-03, §3.1.
- **C-F004 [P]** Oferta firmy działa publicznie bez logowania na własnej domenie lub publicznym adresie Autervy. Źródło: §2.1 REQ-MVP-04, §2.4 REQ-MVP-24.
- **C-F005 [P]** Publiczny odwiedzający przegląda ofertę i dostępność bez tworzenia konta. Źródło: §2.1 REQ-MVP-06.
- **C-F006 [P]** Uzgodnienie wynajmu odbywa się telefonicznie poza systemem. Źródło: §2.1 REQ-MVP-07.
- **C-F007 [P/B]** Firma ręcznie oznacza niedostępność pojazdów po uzgodnieniu terminu. Źródło: §2.1 REQ-MVP-07, §2.2.
- **C-F008 [P]** Role funkcjonalne to superadmin Autervy oraz administrator firmy. Źródło: §6.1.
- **C-F009 [P]** Po aktywacji firma ma dokładnie jedno aktywne konto administratora. Źródło: §2.4 REQ-MVP-22, §6.1.
- **C-F010 [P]** Jedno konto administratora obsługuje wyłącznie jedną firmę. Źródło: §5.2 Q-04, §6.1.
- **C-F011 [P]** Adres e-mail jest globalnie unikalny dla kont Autervy. Źródło: §5.2A Q-04A, §6.1.
- **C-F012 [P]** Druga firma tego samego właściciela przechodzi osobną prerejestrację, zaproszenie i rejestrację konta z innym e-mailem. Źródło: §10.4.
- **C-F013 [P]** Administrator firmy nie uzyskuje dostępu do panelu superadmina. Źródło: §3.1, §15.3, TEST-MVP-03.
- **C-F014 [P]** Administrator firmy zarządza wyłącznie danymi własnej firmy. Źródło: §6.2–6.3.
- **C-F015 [P]** Superadmin tworzy i edytuje metadane firmy oraz jej konfigurację usługi. Źródło: §6.2, §9.2.
- **C-F016 [P]** Superadmin obsługuje flotę, media, blokady i dozwolone dane każdej firmy z widoków zagnieżdżonych pod kartą wybranej firmy. Źródło: REQ-MVP-27, §6.4, §9.1.
- **C-F017 [P]** Superadmin wykonuje operacje jako superadmin, bez logowania jako administrator klienta. Źródło: §6.4, §15.14, TEST-MVP-50.
- **C-F018 [P]** Zagnieżdżona obsługa zachowuje identyfikację wybranej firmy i powrót do jej karty. Źródło: §9.1, §15.14.

### Uruchomienie firmy, zaproszenia i konto

- **C-F019 [P]** Pierwszy kontakt potencjalnego klienta Autervy jest telefoniczny. Źródło: REQ-MVP-08, §7.1.
- **C-F020 [P]** Auterva przedstawia wygląd publicznej strony przed prerejestracją firmy. Źródło: REQ-MVP-09, §7.1.
- **C-F021 [P]** Akceptacja materiałów odbywa się poza aplikacją, przed prerejestracją. Źródło: §5.2B Q-05A, §7.2, DEC-014.
- **C-F022 [P]** Superadmin przygotowuje firmę, jedno konto administratora, adres panelu i adres oferty. Źródło: §7.1, §7.3.
- **C-F023 [P]** Superadmin przygotowuje publiczne logo, dane, treści, osobne treści prawne firmy i Autervy, wiele materiałów hero oraz zdjęcia firmy. Źródło: decyzja właściciela 23.10.2026, REQ-MVP-10, §7.1.
- **C-F024 [P]** Superadmin przyznaje opłacony okres lub jednorazowy trial. Źródło: REQ-MVP-13/15, §7.1.
- **C-F025 [P]** Superadmin wysyła administratorowi firmy zaproszenie e-mailem. Źródło: REQ-MVP-11, §7.1.
- **C-F026 [P]** Zaproszenie prowadzi do panelu właściwej firmy i właściwego adresata. Źródło: §3.3, §7.4.
- **C-F027 [P]** Zaproszenie jest jednorazowe i ważne 7 dni. Źródło: REQ-MVP-30, §5.2B Q-14, DEC-018.
- **C-F028 [P]** Ponowne wysłanie zaproszenia unieważnia poprzedni niewykorzystany link. Źródło: §5.2B Q-14, §18.4, DEC-018.
- **C-F029 [P/B]** Administrator ustawia dane dostępu i hasło na ekranie aktywacji wskazującym firmę i e-mail zaproszenia. Źródło: §7.4, §15.7.
- **C-F030 [P]** Sam zapis firmy nie publikuje witryny i nie uruchamia trialu. Źródło: §7.3, §15.5.
- **C-F031 [P]** Wysłanie albo otwarcie e-maila i samo otwarcie linku nie kończą rejestracji, nie uruchamiają trialu ani publikacji. Źródło: §7.3–7.4, §20 TEST-MVP-15.
- **C-F032 [P]** Pierwsze skuteczne zakończenie rejestracji na serwerze aktywuje konto i uruchamia publikację, jeżeli pozwala na nią okres i konfiguracja domeny. Źródło: REQ-MVP-25, §7.4–7.5.
- **C-F033 [P]** Pierwsze skuteczne zakończenie rejestracji rozpoczyna trial, tylko jeżeli superadmin go przyznał. Źródło: REQ-MVP-21, §7.1, §8.6.
- **C-F034 [P/T]** Ponowienie tworzenia firmy lub aktywacji nie tworzy drugiej firmy, drugiego konta ani drugiego początku trialu. Źródło: §7.3–7.4, TEST-MVP-13/16/44.
- **C-F035 [P/R/T]** Błąd wysyłki zaproszenia zachowuje zapisaną firmę i pozwala ponowić samą wysyłkę. Źródło: §7.3, §9.3.
- **C-F036 [P/R/T]** Interfejs odróżnia sukces zapisu firmy od sukcesu wysyłki zaproszenia. Źródło: §7.3, §9.3.
- **C-F037 [P/R]** Ekran aktywacji obsługuje link poprawny, wykorzystany, wygasły, anulowany i błędny oraz błąd sieci, zapis w toku i sukces. Źródło: §7.4.
- **C-F038 [P/R]** Wynik aktywacji pokazuje rzeczywistą gotowość publicznej strony; trwająca konfiguracja otrzymuje stan oczekiwania. Źródło: §7.4, §15.7.
- **C-F039 [P]** Pierwsza publikacja nie wymaga pierwszego pojazdu ani dodatkowego ręcznego przycisku publikacji firmy. Źródło: REQ-MVP-25, §7.5.
- **C-F040 [P]** MFA jest wymagane przy dostępie superadmina i administratora firmy. Źródło: REQ-MVP-30, §5.2B Q-14, §18.7, DEC-018.
- **C-F041 [B]** Zachować logowanie, reset hasła, ustawienie nowego hasła, profil, zmianę hasła i wylogowanie administratora. Źródło: §13.2 ADM-01/02/03/15.
- **C-F042 [B]** Reset hasła działa dla właściwego konta i hosta oraz pokazuje neutralny wynik bez ujawnienia istnienia konta. Źródło: §13.2 ADM-02, TEST-MVP-19.
- **C-F043 [B]** Zachować obsługę aktywnych sesji i świadome potwierdzenie zakończenia sesji zgodnie z bazowym priorytetem. Źródło: §13.2 ADM-16, §13.3 OVR-19.
- **C-F044 [P/B]** Koniec opłaty nie blokuje logowania, resetu hasła, MFA ani innych funkcji bezpieczeństwa konta. Źródło: §6.3, §13.2 ADM-15.

### Okres usługi i widoczność

- **C-F045 [P]** Rozliczenia pozostają poza aplikacją; wpis daty nie stanowi potwierdzenia otrzymania przelewu. Źródło: REQ-MVP-12, §7.1.
- **C-F046 [P]** Tylko superadmin ustawia, przedłuża i skraca opłacony okres; administrator firmy odczytuje te dane. Źródło: §6.2, §8.5.
- **C-F047 [P]** Nie wolno wyznaczyć przyszłej daty rozpoczęcia opłaconego okresu. Źródło: §5.2A Q-07A, §8.7.
- **C-F048 [P]** Data „opłacono do” obejmuje wskazany dzień włącznie w `Europe/Warsaw`. Źródło: REQ-MVP-20, §8.2.
- **C-F049 [P]** Publiczna widoczność wygasa o początku następnego dnia lokalnego; brak karencji. Źródło: §8.2.
- **C-F050 [P]** Trial trwa dokładnie 336 godzin od pierwszej skutecznej rejestracji, niezależnie od zmiany czasu. Źródło: §5.2B Q-03A, §8.6, DEC-013.
- **C-F051 [P]** Każda firma może skorzystać tylko z jednego trialu. Źródło: §5.2A Q-03C, §8.6.
- **C-F052 [P]** Trial nie zaczyna się w momencie utworzenia firmy, wysłania zaproszenia, GET linku, nieudanej aktywacji lub logowania. Źródło: §5.2 Q-03, §7.4.
- **C-F053 [P]** Refresh, resend, retry i ponowne logowanie nie resetują i nie przedłużają trialu. Źródło: §8.6, TEST-MVP-23/44.
- **C-F054 [P]** Publiczna witryna działa w trakcie jednorazowego trialu. Źródło: §5.2A Q-03B, §5.2B Q-03A; stary zapis §8.6 jest sprzeczny.
- **C-F055 [P]** Koniec trialu wyłącza całą publiczną stronę przy braku ważnej opłaty, zachowując pełny panel i czat niearchiwizowanego administratora. Jeśli opłata pozostaje ważna, wygaśnięcie trialu nie zmienia widoczności. [Tabela stanów i granic](contracts/service-periods-kpi-reminders.md) rozdziela oba okresy. Źródło: §5.2A Q-01A, §8.7, D-14.
- **C-F056 [P]** Gdy firma nie ma już ważnego okresu publicznego działania, wyłączona jest cała witryna i oferta, a nie wyłącznie lista pojazdów. Historyczne zdarzenie wygaśnięcia nie może unieważnić późniejszego przedłużenia; przy nakładaniu okresów obowiązuje efektywna data z D-14. Źródło: REQ-MVP-19, §8.3, §12.3.
- **C-F057 [P/T]** Wyłączenie obejmuje home, listę, szczegóły, kontakt, kalendarz, API oferty i wszystkie własne/testowe adresy. Źródło: §8.3, §12.3, TEST-MVP-42.
- **C-F058 [P]** Po końcu okresu administrator nadal dodaje i edytuje flotę, media, blokady i dozwolone dane oraz korzysta z chronionego podglądu i czatu. Źródło: §8.1, TEST-MVP-41.
- **C-F059 [P]** Wygaśnięcie okresu nie przełącza panelu na read-only, nie unieważnia sesji i nie przerywa poprawnego zapisu. Źródło: §6.3, §8.1, TEST-MVP-25/43.
- **C-F060 [P]** Wygaśnięcie okresu nie archiwizuje firmy i nie tworzy blokad zajętości pojazdów. Źródło: §8.5/8.7, §9.5.
- **C-F061 [P]** Publikacja pojazdu w panelu nie obchodzi wyłączenia publicznej strony. Źródło: §8.1/8.3, §13.3 OVR-09.
- **C-F062 [P]** Przedłużenie po przerwie automatycznie przywraca publiczną stronę przy poprawnej domenie i niezarchiwizowanej firmie; wyjątek stanowi przywrócenie z archiwum. Źródło: §5.2A Q-07B, §8.5.
- **C-F063 [P]** Administrator widzi osobno rodzaj okresu, datę końcową, rzeczywisty stan okresu, publiczny adres i widoczność witryny. Źródło: REQ-MVP-14, §8.1.
- **C-F064 [P]** Trial nie jest oznaczany jako opłacona usługa; konkretnej daty nie zastępuje sam licznik pozostałych dni. Źródło: §8.1; V30 §8.1.
- **C-F065 [P]** Po wygaśnięciu panel pokazuje zauważalny nieblokujący komunikat: „Konto aktywne. Publiczna oferta jest obecnie wyłączona. Skontaktuj się z Autervą w sprawie uruchomienia okresu usługi.” oraz wejście do czatu. Źródło: REQ-MVP-19, §8.3, §15.8, D-11.
- **C-F066 [P/B]** Banner nie zasłania formularza, nie usuwa wprowadzonych danych i nie podszywa się pod wygaśnięcie sesji. Źródło: §8.3, §13.3 OVR-13/14.
- **C-F067 [P]** Administrator otrzymuje przypomnienia o końcu efektywnego trialu/opłaty w panelu i e-mailem o 09:00 `Europe/Warsaw` 7 dni wcześniej, 1 dzień wcześniej i w dniu wygaśnięcia. Po zmianie okresu harmonogram jest przeliczany, a zadanie po awarii nadrabiane najwyżej raz. [Kontrakt slotów, wersji i retry](contracts/service-periods-kpi-reminders.md) podaje także przypadki DST. Źródło: decyzja właściciela 23.10.2026, REQ-MVP-31, §5.2B Q-15, DEC-019.

### Lista firm, archiwum i publiczna konfiguracja

- **C-F068 [P]** Domyślna lista superadmina zawiera firmy niezarchiwizowane, w tym firmy z wygasłą opłatą. Źródło: REQ-MVP-28, §9.4.
- **C-F069 [P]** Filtr „Pokaż zarchiwizowane” dołącza archiwum do listy. Źródło: §9.4–9.5.
- **C-F070 [P]** Wyszukiwanie działa zarówno bez archiwum, jak i z archiwum. Źródło: §9.4.
- **C-F071 [P]** Stan archiwizacji jest odrębny od rejestracji, opłacenia/trialu i widoczności strony. Źródło: §8.7, §9.4.
- **C-F072 [P]** Dashboard superadmina pokazuje dokładnie dwa główne KPI: niezarchiwizowane firmy z aktywnym opłaconym okresem i niezarchiwizowane firmy w trialu. Gdy oba okresy są ważne, firma trafia tylko do KPI opłaconego; archiwum z przyszłą opłatą jest dostępne osobno, ale nie zwiększa tych KPI. [Tabela stanów](contracts/service-periods-kpi-reminders.md) rozdziela KPI od widoczności strony. Źródło: decyzja właściciela 23.10.2026, §5.2A Q-11, §15.4.
- **C-F073 [P]** Superadmin archiwizuje firmę; panel nie udostępnia trwałego usuwania firmy. Źródło: REQ-MVP-28, §9.5, DEC-017.
- **C-F074 [P]** Archiwizacja zachowuje firmę, flotę, blokady, zdjęcia i historię rozmowy. Źródło: §9.5, §18.8.
- **C-F075 [P]** Archiwizacja blokuje logowanie administratora firmy i wyłącza wszystkie jej publiczne adresy. Źródło: §5.2A Q-10A, §9.5.
- **C-F075-T [T]** Archiwizacja odbiera także możliwość kolejnych operacji w już otwartej sesji administratora i zamyka/unieważnia jego WebSocket; superadmin zachowuje dostęp do archiwum. To projekt egzekwowania aktualnych uprawnień, nie wyłącznie ukrycie formularza logowania.
- **C-F076 [P]** Superadmin może odnaleźć i obejrzeć zarchiwizowaną firmę przez filtr archiwum. Źródło: §9.5.
- **C-F077 [P]** Przywrócenie firmy z archiwum ponownie umożliwia logowanie. Źródło: §5.2A Q-10A.
- **C-F078 [P]** Po przywróceniu z archiwum i opłaceniu widoczność publiczną odblokowuje superadmin. Źródło: §5.2A Q-10A, §9.5.
- **C-F079 [P]** Samo włączenie filtra archiwum nie przywraca firmy ani nie zmienia okresu lub publikacji. Źródło: §9.5, TEST-MVP-52.
- **C-F080 [P]** MVP nie uruchamia automatycznego trwałego kasowania danych po archiwizacji, wygaśnięciu opłaty ani końcu trialu. Źródło: §5.2B Q-10B, §18.8, DEC-017.
- **C-F081 [P]** Wyłącznie superadmin zmienia publiczne logo, dane firmy, treści, SEO, treści prawne i materiały white-label. Administrator firmy nie edytuje tych pól; może zarządzać własną flotą i operacyjną ofertą pojazdów. [Macierz D-01](contracts/company-settings-and-vehicle-publication.md) obowiązuje także bezpośrednie API. Źródło: decyzja właściciela 23.10.2026, REQ-MVP-23, §6.2, §10.3, TEST-MVP-47.
- **C-F082 [P]** Publiczne materiały firmy nie zmieniają kolorów, fontów, ikon, loginu ani wyglądu panelu. Źródło: §5.2B Q-05A, §16.1, DEC-014.
- **C-F083 [P]** Administrator widzi logo tylko do odczytu i zgłasza jego zmianę przez czat. Źródło: §10.3, §13.2 ADM-11.
- **C-F084 [P]** Administrator nie zmienia okresu, trialu ani hosta panelu. Źródło: §10.3.
- **C-F085 [P/B]** Zachować dane firmy, telefon, kanały kontaktu, SEO i treści prawne; w MVP wszystkie te pola zapisuje wyłącznie superadmin. Administrator firmy ma odczyt, a operacyjnie zmienia flotę, pojazdy, zdjęcia pojazdów i blokady własnej firmy. [Macierz pól](contracts/company-settings-and-vehicle-publication.md) rozstrzyga historyczne uprawnienia FR-ADM-060–063. Źródło: decyzja właściciela 23.10.2026, §6.2, §9.2, §13.2 ADM-11–14.
- **C-F086 [P]** Brak własnej domeny nie blokuje startu: oferta używa `{slug}.{publicDomainAutervy}`, oddzielnie od hosta panelu. Źródło: REQ-MVP-24, §3.1, DEC-015.
- **C-F087 [P]** Klient kupuje własną domenę; Auterva przekazuje instrukcję DNS i weryfikuje routing oraz TLS. Źródło: §5.2B Q-06A/B, DEC-015.
- **C-F088 [P]** Po aktywacji własnej domeny dotychczasowy publiczny adres Autervy przekierowuje na nią. Źródło: §5.2B Q-06A/B, DEC-015.
- **C-F089 [P]** Wpisanie domeny nie jest potwierdzeniem jej gotowości ani publikacją strony. Źródło: §9.2–9.3.

### Oferta, flota i dostępność odziedziczone z bazy

- **C-F090 [B]** Zachować stronę główną oferty firmy, listę pojazdów, szczegóły, galerię, dostępność, kontakt i dokumenty prawne. Źródło: §2.2, §12.2.
- **C-F091 [B]** Lista zachowuje filtry, sortowanie, filtr terminów oraz stany loading/empty/error/retry. Źródło: §13.1 PUB-02.
- **C-F092 [B]** Linki oferty zachowują firmę, domenę i wybrane daty. Źródło: V30 §13.1 PUB-02; zachowane przez V31 §2.2.
- **C-F093 [B]** Szczegóły pojazdu zachowują galerię, parametry, kalendarz oraz wynik dostępności. Źródło: §13.1 PUB-03.
- **C-F094 [P/B]** Dostępność jest informacyjna i wymaga potwierdzenia przez firmę. Źródło: §2.2.
- **C-F095 [B]** Niekompletny pojazd można zapisać jako szkic. Źródło: §2.2.
- **C-F096 [B/P]** Publikacja pojazdu wymaga dotychczasowych warunków kompletności oraz niepustego pełnego opisu. Niekompletny pojazd pozostaje szkicem, niezależnie od stanu całej firmy. Źródło: decyzja właściciela 23.10.2026, §2.2, §13.3 OVR-09.
- **C-F097 [B]** Zachować dodawanie, edycję, ukrywanie i archiwizację pojazdu. Źródło: §13.2 ADM-06/07.
- **C-F098 [B]** Zachować dodawanie i zarządzanie zdjęciami oraz ochronę zdjęcia głównego przy usuwaniu. Źródło: §13.2 ADM-07, §13.3 OVR-12.
- **C-F099 [B]** Zachować chroniony podgląd publicznej prezentacji pojazdu, także po końcu okresu firmy. Źródło: §8.1, §13.2 ADM-08.
- **C-F100 [B]** Kalendarz pojazdu pozwala dodawać, edytować i usuwać ręczne blokady. Źródło: §13.2 ADM-09, §13.3 OVR-06/07.
- **C-F101 [B]** Kalendarz floty pozostaje funkcją SHOULD, jeżeli został objęty realizowanym zakresem; nie promować go automatycznie do MUST. Źródło: §13.2 ADM-10.
- **C-F102 [B]** Daty zajętości obejmują całe dni, z końcem zakresu włącznie; zakres jednego dnia jest poprawny. Źródło: §2.2, TEST-MVP-27.
- **C-F103 [B]** Dwa równoczesne nakładające się zapisy nie mogą utworzyć sprzecznych blokad pojazdu. Źródło: TEST-MVP-28.
- **C-F104 [P/B]** Równoczesna edycja przez administratora i superadmina wykrywa konflikt zamiast cicho nadpisywać dane. Źródło: §6.4, TEST-MVP-51.
- **C-F105 [B]** Notatka blokady jest prywatna i nie wymaga danych najemcy. Źródło: §10.1, §13.2 ADM-09.
- **C-F106 [P]** Publiczne kanały kontaktu firmy to telefon, WhatsApp i e-mail. Źródło: §5.2A Q-12, §12.2, §13.3 OVR-04.
- **C-F107 [P/B]** Kontakt nie tworzy rezerwacji, płatności ani konta klienta i nie blokuje kalendarza. Źródło: §2.2, TEST-MVP-29.
- **C-F108 [P]** Aktywna strona bez opublikowanych pojazdów pokazuje estetyczną zapowiedź przyszłej oferty. Źródło: REQ-MVP-25, §7.5, §15.13.
- **C-F109 [P/R]** Pusta oferta nie pokazuje fikcyjnych aut, 404, informacji o nieopłaceniu ani filtrów udających wyniki. Źródło: §7.5, §15.13.
- **C-F110 [P]** Publikacja pierwszego pojazdu zastępuje zapowiedź standardową ofertą bez ponownej rejestracji lub aktywacji firmy. Źródło: §7.5, §15.13.
- **C-F111 [P/B]** Rozróżnić pustą aktywną ofertę, brak wyników filtrowania, błąd sieci i witrynę wyłączoną. Źródło: §13.1 PUB-02, §15.13.
- **C-F112 [B]** Polityka prywatności i warunkowe zasady wynajmu dotyczą konkretnej wypożyczalni; nie zastępują regulaminu platformy. Źródło: §13.1 PUB-05/06.
- **C-F113 [B]** Publiczne 404 prowadzi do oferty własnej firmy, o ile strona pozostaje aktywna. Źródło: §13.1 PUB-07.
- **C-F114 [P/B]** Wyłączenie firmy ma pierwszeństwo przed publicznym 404 i innymi stanami umożliwiającymi boczne wejście do oferty. Źródło: §13.1 PUB-07, §15.11.

### Czat

- **C-F115 [P]** Administrator firmy prowadzi prywatną rozmowę z Autervą o usłudze; czat nie jest kanałem publicznym dla najemców. Źródło: REQ-MVP-16, §11.1.
- **C-F116 [P]** Czat obsługuje tekst bez załączników i uploadu. Źródło: REQ-MVP-26, §11.1/11.5.
- **C-F117 [P]** Nowe wiadomości czatu nie generują powiadomień e-mail. Źródło: REQ-MVP-26, §11.1/11.5.
- **C-F118 [P]** Nowe wiadomości mają widoczny wskaźnik w panelu, również gdy czat jest schowany pod „Więcej”. Źródło: §10.2, §11.3, TEST-MVP-48.
- **C-F119 [P]** Rozmowy aktualizują się w czasie rzeczywistym przez WebSocket. Źródło: §5.2A Q-08A, §11.5.
- **C-F120 [P]** Czat pokazuje stan pisania; zdarzenie wygasa po 3 sekundach i jest ograniczone do jednego na sekundę. Źródło: §5.2A Q-08A, §11.5; sprzeczny fragment §11.2 jest historyczny.
- **C-F121 [P]** Czat pokazuje status wysłania i odczytania. Źródło: §5.2A Q-08A, §11.5; sprzeczny §15.9 nie zmienia zatwierdzenia.
- **C-F122 [P]** Szkic wiadomości jest trwale przechowywany lokalnie i przypisany do pary `(accountId, conversationId)`; przetrwa zamknięcie karty i ponowne uruchomienie przeglądarki. Źródło: REQ-MVP-29, §5.2B Q-08A, DEC-016.
- **C-F123 [P]** Zmiana firmy zachowuje jej szkic bez dialogu blokującego; powrót odtwarza treść. Wylogowanie usuwa wszystkie szkice tego konta. Źródło: §11.4, DEC-016.
- **C-F124 [P]** Szkic nigdy nie przechodzi ani nie zostaje wysłany do innej firmy po zmianie rozmowy. Źródło: §11.4, TEST-MVP-31.
- **C-F125 [P]** Administrator czyta i wysyła wiadomości także po końcu trialu i opłaty. Źródło: §11.1, §15.9.
- **C-F126 [P]** Archiwizacja zachowuje historię czatu, a blokada logowania uniemożliwia dostęp administratora do czasu przywrócenia. Źródło: §11.1/11.4.
- **C-F127 [P/R/T]** Znacznik nowych wiadomości znika po faktycznym pokazaniu wiadomości w rozmowie przez około 500 ms, a nie po preloadzie lub wejściu na dashboard. Źródło: §11.3.
- **C-F128 [P/R/T]** Nowa wiadomość nie przewija siłą użytkownika czytającego historię; interfejs udostępnia akcję „Nowe wiadomości”. Źródło: §11.3.
- **C-F129 [R/B]** Historia pokazuje nadawcę i czas wiadomości. Źródło: §11.3.
- **C-F130 [R/T]** „Wysłano” oznacza trwały zapis wiadomości potwierdzony przez serwer. Źródło: §11.5.
- **C-F131 [R/T]** Ponowienie niepewnej wysyłki używa tej samej tożsamości operacji i nie duplikuje wiadomości. Źródło: §11.5, TEST-MVP-30.
- **C-F132 [R/B]** Obsłużyć pustą historię, loading, błąd historii/retry, sending/sent/failed, niepewny wynik, utratę i odzyskanie połączenia oraz utratę sesji. Źródło: §11.3, §5.2A Q-08A, §15.10.
- **C-F133 [R/B]** Błąd sieci lub wysyłki nie usuwa wpisanej wiadomości i nie pokazuje fałszywego sukcesu. Źródło: §15.9.
- **C-F134 [R]** Po stronie superadmina lista rozmów pokazuje firmę, ostatnią wiadomość, czas i wskaźnik nowych. Źródło: §11.4.
- **C-F135 [R]** Wejście do wiadomości z karty firmy otwiera dokładnie jej rozmowę. Źródło: §11.4, §15.10.
- **C-F136 [R]** Nagłówek i pole odpowiedzi stale wskazują odbiorcę. Źródło: §11.4, §15.10.
- **C-F137 [R]** Czat desktopowy ma listę i rozmowę obok siebie; mobile pokazuje osobno listę i rozmowę z powrotem. Źródło: §11.4.

### Marketing, PWA i wspólne stany

- **C-F138 [P]** Onepage prezentuje system, korzyści i kontakt; nie przedstawia wspólnej floty wypożyczalni. Źródło: REQ-MVP-01, §12.1.
- **C-F139 [P]** Onepage nie publikuje ceny ani obietnicy publicznego trialu. Źródło: §5.2A Q-12.
- **C-F140 [P]** Treści MKT-01 i PUB-01 opisują możliwości i korzyści bez sugerowania rezerwacji lub płatności online. Źródło: §12.1–12.2, DEC-020.
- **C-F141 [P/B]** Nie używać fikcyjnych opinii, klientów ani niepopartych danych o wzroście przychodów. Źródło: §12.1, §15.2.
- **C-F142 [P/B]** Materiały DEMO są odróżnione od faktycznych zdjęć floty i nie ujawniają prywatnych danych rzeczywistych firm. Źródło: §12.4, §15.2.
- **C-F143 [P]** Instalowalna PWA panelu firmy pozostaje w pierwszym wydaniu. Źródło: §5.2A Q-13, §13.2 ADM-18.
- **C-F144 [P/B]** PWA jest przypisana do odrębnego hosta panelu konkretnej firmy. Źródło: §4, §13.3 OVR-15.
- **C-F145 [B]** PWA nie zapisuje mutacji offline ani nie sugeruje sukcesu zapisu floty, wiadomości lub dat bez serwera. Źródło: §13.2 ADM-18, §13.3 OVR-16.
- **C-F146 [B]** Aktualizacja PWA chroni niezapisane dane. Źródło: §13.3 OVR-16.
- **C-F147 [B]** Wygaśnięcie sesji, brak uprawnień, wygaśnięcie usługi i archiwizacja są odrębnymi stanami. Źródło: §13.2 ADM-19, §13.3 OVR-14.
- **C-F148 [B]** Panel ma 404 z powrotem do właściwej firmy oraz błąd z retry i identyfikatorem zgłoszenia. Źródło: §13.2 ADM-20/21.
- **C-F149 [B]** Link do czatu w błędzie panelu jest dostępny tylko przy ważnej sesji i dopuszczonym dostępie. Źródło: §13.2 ADM-21.
- **C-F150 [B]** Zachować dialog niezapisanych zmian w formularzach firmy i operacyjnych widokach superadmina; nie stosować go do zmiany rozmowy ze szkicem. Źródło: §13.3 OVR-13.
- **C-F151 [B]** Zachować audyt zmian firmy z rzeczywistym aktorem oraz istniejący priorytet jego interfejsu. Źródło: §13.2 ADM-17, §14 PLT-06.

## 3. Szczegółowe wymagania floty, dostępności i PWA odziedziczone z B1

### Publiczna oferta firmy — PRD 1.0 §12

- **FR-PUB-001:** home firmy: nazwa/logo, opis usługi, „Zobacz pojazdy”, wyróżnione pojazdy, przewagi i skrócony kontakt; szybki formularz dat opcjonalny. W 3.1 to oferta wypożyczalni, odrębna od MKT-01 Autervy; pusta flota ma wariant zapowiedzi, a upływ okresu wyłącza całą ofertę.
- **FR-PUB-002 — SHOULD:** administrator może wyróżnić pojazd; home prezentuje skonfigurowaną liczbę wyróżnionych, przykładowo 3–6. Przykład 3–6 nie jest zatwierdzonym sztywnym limitem.
- **FR-PUB-003:** szybki wybór od/do prowadzi do floty dostępnej przez cały zakres; formularz na home opcjonalny, sprawdzanie zakresu MUST.
- **FR-PUB-010 — MUST:** publicznie wyłącznie `PUBLISHED`, bez archiwum; 3.1 dodaje zgodny host firmy i kontrolę okresu/publicznej widoczności.
- **FR-PUB-011:** karta: zdjęcie główne, nazwa handlowa, kategoria, miejsca, skrzynia, skrót opisu/cechy, opcjonalna cena „od”, szczegóły; dostępność tylko dla wybranych dat.
- **FR-PUB-012:** filtry: zakres dat, kategoria, minimum miejsc, skrzynia; klawiatura i mobile. Liczba sztuk/typ nadwozia są przyszłym rozszerzeniem.
- **FR-PUB-013:** sortowanie rekomendowane przez admina i nazwa A–Z; cena rosnąco/malejąco opcjonalna, jeśli używane są ceny.
- **FR-PUB-014:** brak wyników: komunikat, wyczyść filtry, zmień termin, kontakt po alternatywę; odróżnić od nieopublikowanej floty i wyłączonej strony.
- **FR-PUB-015:** dla około 100 pojazdów dopuszczalna pełna przefiltrowana lista; kontrakt danych gotowy na paginację.
- **FR-PUB-020 — MUST:** galeria: główne i pozostałe zdjęcia, dotyk, klawiatura, alt, bez ładowania wszystkich dużych obrazów naraz.
- **FR-PUB-021:** szczegóły: marka/model/nazwa, podany rok, kategoria, miejsca, opcjonalne drzwi, skrzynia, paliwo/napęd, bagaż, wyposażenie, pełny opis i opcjonalne warunki.
- **FR-PUB-022 — opcjonalne ceny:** superadmin przełącza osobno dla każdej firmy, czy ta firma może prezentować ceny. Przy włączonej opcji cena pojazdu jest opcjonalna i może oznaczać cenę „od”, wycenę indywidualną albo brak ceny; przy wyłączonej opcji ceny nie są publiczne. Brak pustej sekcji i „0 zł”. Brak wyliczenia i rozliczania wynajmu.
- **FR-PUB-023 — MUST:** kalendarz co najmniej bieżącego i następnego miesiąca, kolejne miesiące, legenda, stany z tekstem/symbolem, bez dat przeszłych i bez typu/powodu blokady; czytelność mobile.
- **FR-PUB-024 — MUST:** walidacja dat; koniec ≥ początek; cały zakres w aktywności auta; brak choćby jednego dnia kolizji.
- **FR-PUB-025 — MUST:** wynik dostępny: pojazd, daty, zastrzeżenie informacyjności/wymaganego potwierdzenia i kontakt.
- **FR-PUB-026 — MUST:** wynik niedostępny: brak dostępności w całym zakresie, zmiana dat, powrót do aut dostępnych w tych datach, opcjonalny kontakt; bez ujawnienia przyczyny.
- **FR-PUB-030:** publiczny kontakt obejmuje telefon, WhatsApp i e-mail. Wszystkie trzy kanały są dostępne, jeśli firma podała dane; Messenger/inny kanał pozostaje poza MVP.
- **FR-PUB-031 — MUST:** przycisk kontaktu otwiera telefon, WhatsApp i e-mail; mobilnie wygodne są wszystkie kanały, na desktopie także kopiowanie danych.
- **FR-PUB-032 — MUST:** wiadomość kontaktowa zawiera wybrany pojazd i termin.
- **FR-PUB-033 — MUST:** użycie kontaktu nie tworzy klienta, rezerwacji ani blokady; formularz zapisujący leady poza MVP.
- **FR-PUB-040:** kontakt: dane firmy, godziny, kanały, opcjonalnie mapa/adres.
- **FR-PUB-041 — MUST:** opublikowana polityka prywatności przygotowana/zatwierdzona dla działalności; po wygaśnięciu cały publiczny obszar firmy podlega bramce 3.1.
- **FR-PUB-042 — opcjonalne:** regulamin/zasady wynajmu jako treść lub link.

### Konto i dashboard firmy — PRD 1.0 §13.1–13.3

- **FR-ADM-001 — MUST:** e-mail/hasło; 3.1 osobny host firmy i osobny host superadmina.
- **FR-ADM-002 — MUST:** bez publicznej rejestracji; 3.1 aktywacja wyłącznie przez zaproszenie superadmina.
- **FR-ADM-003 — MUST:** bezpieczne sesje, unieważnienie przy wylogowaniu/zmianie hasła/świadomym zakończeniu; koniec opłaty/trialu nie unieważnia sesji firmy.
- **FR-ADM-004 — MUST:** neutralne błędy bez potwierdzania istnienia e-maila.
- **FR-ADM-005 — MUST:** ograniczanie nieudanych logowań przez rate limit/opóźnienie/dodatkową weryfikację.
- **FR-ADM-006 — SHOULD:** reset e-mailem; w bazie alternatywą bezpieczna udokumentowana procedura ręczna. 3.1 zachowuje ekran resetu i TEST-MVP-19; nie utożsamiać z zaproszeniem.
- **FR-ADM-007 — PODNIESIONE w 3.1 do MUST/P:** MFA obowiązkowe dla admina firmy i superadmina; baza miała SHOULD/P1.
- **FR-ADM-010:** dashboard firmy: aktywne pojazdy, opublikowane, niedostępne dziś, najbliższe blokady, dodaj auto/blokadę. W 3.1 dochodzą okres, stan publiczny i czat. Ograniczenie platformowego dashboardu do dwóch KPI nie usuwa tych statystyk floty firmy.
- **FR-ADM-011 — opcjonalne:** ostrzeżenia brak zdjęcia/opisu, nieopublikowany szkic, brak kontaktu, problem publikacji/synchronizacji.
- **FR-ADM-020 — MUST lista:** tabela desktop/karty mobile; miniatura, nazwa, publikacja, bieżąca dostępność, ostatnia zmiana, akcje.
- **FR-ADM-021:** szukanie nazwy, filtry publikacji/kategorii/aktywności/bieżącej dostępności.
- **FR-ADM-022:** kolejność publiczna ustawiana liczbą lub przeciąganiem; przeciąganie nie jedyną dostępną metodą.

### Pojazdy i media — PRD 1.0 §13.4–13.5

- **FR-ADM-030 — MUST CRUD:** nazwa, marka, model, wariant, kategoria, rok, krótki/pełny opis, miejsca/drzwi, skrzynia, paliwo, kolor, bagaż, wyposażenie, opcjonalna cena/jednostka, `availableFrom`, opcjonalne `availableTo`, kolejność, wyróżnienie, publikacja.
- **FR-ADM-031 — MUST:** `DRAFT`, `PUBLISHED`, `UNPUBLISHED`, `ARCHIVED`; pojazd z historią archiwizowany zamiast trwałego kasowania. To osobny cykl od archiwizacji firmy.
- **FR-ADM-032 — MUST:** walidacja klient/serwer; publikacja wymaga nazwy, slugu unikalnego w firmie, kategorii, krótkiego **i pełnego niepustego opisu**, ≥1 gotowego zdjęcia, dokładnie jednego głównego zdjęcia, miejsc jeśli stosowne i poprawnej aktywności. Kolizję bazowej listy z `Vehicle.description` §17.3 rozstrzyga D-02. [Tabela walidacji i przykłady](contracts/company-settings-and-vehicle-publication.md).
- **FR-ADM-033 — MUST:** zapis niekompletnego szkicu; publikacja dopiero po walidacji.
- **FR-ADM-034 — SHOULD:** chroniony preview szkicu; w 3.1 dostępny też po końcu okresu, bez upublicznienia danych.
- **FR-ADM-035:** slug generowany z nazwy i edytowalny; po publikacji przekierowanie starego slugu albo świadome potwierdzenie skutku. Automatyczne redirecty są SHOULD; w 3.1 unikalność w firmie.
- **FR-ADM-040 — MUST:** upload wielu zdjęć naraz, do maksymalnie 30 zdjęć przypisanych do jednego pojazdu.
- **FR-ADM-041 — MUST:** JPEG/PNG/WebP; HEIC tylko opcjonalnie z konwersją; odrzucanie fałszywego typu, zbyt dużych/niebezpiecznych plików. Maksymalny rozmiar jednego pliku to 10 MB, a maksymalne wymiary to 12 000 × 12 000 px.
- **FR-ADM-042 — MUST:** zoptymalizowane warianty zdjęć; zachowywanie oryginału opcjonalne.
- **FR-ADM-043 — MUST:** dokładnie jedno zdjęcie główne, w kontekście istniejących zdjęć/publikacji; szkic bez zdjęć jest dozwolony.
- **FR-ADM-044 — MUST:** zmiana kolejności zdjęć.
- **FR-ADM-045:** domyślny alt z nazwy pojazdu, możliwy do poprawienia.
- **FR-ADM-046 — MUST:** potwierdzenie usunięcia; ostatniego głównego zdjęcia opublikowanego auta nie wolno usunąć bez zamiennika/cofnięcia publikacji.

### Blokady i ustawienia — PRD 1.0 §13.6–13.9

- **FR-ADM-050 — MUST:** prywatny kalendarz z wolnymi/zajętymi dniami, typem, granicami, notatką i źródłem blokady.
- **FR-ADM-051 — MUST:** dodanie blokady: auto, od/do, typ, opcjonalne `reference` i `internalNote`.
- **FR-ADM-052 — MUST:** `RESERVED` (uzgodnione poza systemem), `MAINTENANCE`, `BLOCKED`, `OTHER`; każdy publicznie identycznie niedostępny.
- **FR-ADM-053 — MUST:** pełne dni bez godzin, koniec włącznie; 10–12 obejmuje 10, 11, 12.
- **FR-ADM-054 — MUST:** edycja/usuwanie ręcznej blokady z audytem.
- **FR-ADM-055 — MUST:** brak nakładających blokad jednego auta; konflikt zatrzymuje zapis, wskazuje istniejący wpis, umożliwia anulowanie/przejście do edycji. Scalanie tego samego typu opcjonalne.
- **FR-ADM-056:** szybka blokada mobile: auto → daty → typ → zapis, bez rozbudowanego procesu.
- **FR-ADM-057 — SHOULD:** zbiorczy kalendarz floty firmy: pojazdy × dni/tygodnie; mobile może stosować listę. 3.1 jawnie utrzymuje SHOULD, bez globalnej floty wszystkich firm.
- **FR-ADM-058 — MUST:** po każdej mutacji blokady nowy publiczny odczyt jest aktualny, cache unieważniony.
- **FR-ADM-060:** nazwa firmy, publiczne logo, opis, adres, obszar i godziny pozostają do odczytu dla administratora firmy; zapisuje je wyłącznie superadmin w kontekście tej firmy. Obowiązuje [macierz D-01](contracts/company-settings-and-vehicle-publication.md), także dla bezpośredniego API.
- **FR-ADM-061:** publiczny telefon, e-mail i WhatsApp pozostają do odczytu dla administratora firmy; zapisuje je wyłącznie superadmin. Historyczna sugestia edycji w ADM-11/12 nie nadaje prawa do mutacji.
- **FR-ADM-062:** tytuł/opis SEO, liczba wyróżnionych, firmowy przełącznik widoczności cen, domyślny kontakt i zastrzeżenie dostępności pozostają do odczytu dla administratora firmy; zapisuje je wyłącznie superadmin. Paleta, fonty i ikony nie są ustawieniami firmy.
- **FR-ADM-063:** treści/linki polityki prywatności i regulaminu firmy pozostają do odczytu dla administratora firmy; zapisuje je wyłącznie superadmin. Dokumenty prawne Autervy są odrębne.
- **FR-ADM-070 — minimum audytu MUST; pełny ekran SHOULD:** login/logout, utworzenie/zmiana auta, publikacja/ukrycie/archiwizacja, CRUD blokady, ustawienia kontaktu, hasło, sesje. 3.1 dodaje tworzenie/archiwizację firmy, okresy, domeny, branding, zaproszenia i działania superadmina z prawdziwym aktorem.
- **FR-ADM-071:** UTC, aktor, akcja, typ/ID obiektu, bezpieczne podsumowanie; IP wyłącznie uzasadnione z retencją; bez haseł/tokenów. Audyt dopisywany, nieedytowalny w zwykłym panelu.
- **FR-ADM-080:** zmiana hasła z aktualnym hasłem lub ponownym uwierzytelnieniem.
- **FR-ADM-081 — SHOULD:** przegląd aktywnych sesji i zakończenie pozostałych; 3.1 sesje jednej firmy, bez praw do platformy/drugiej firmy.
- **FR-ADM-082 — MUST:** wylogowanie unieważnia bieżącą sesję i wraca do loginu właściwego obszaru.

### PWA — PRD 1.0 §14/24, aktualizacja 3.1 Q-13

- **FR-PWA-001 — MUST:** instalowalne PWA panelu firmy; manifest: nazwa, short name, ikony 192×192/512×512 i maskable, theme/background, `display: standalone`, start w panelu `/admin`. Technicznie start_url musi należeć do scope: architektura przyjmuje oba `/admin/` i zgodny routing. 3.1 osobny origin firmy; nie centralna PWA multi-firm z v2.
- **FR-PWA-002 — MUST:** produkcyjne HTTPS.
- **FR-PWA-003 — MUST:** start dashboard przy ważnej sesji lub login po wygaśnięciu; archiwizacja firmy odbiera dostęp, sam koniec okresu nie.
- **FR-PWA-004 — MUST:** offline ekran i retry; ewentualny neutralny shell; brak zapisu/synchronizacji offline i fikcyjnego sukcesu, także w czacie.
- **FR-PWA-005:** dostępna aktualizacja SW z bezpiecznym refresh, ochrona niezapisanych formularzy.
- Push jest **po MVP**. Prywatne HTML/RSC/API nie powinny trafiać do cache SW; wersjonowane JS/CSS/ikony mogą cache-first, mutacje network-only, neutralny fallback. Wylogowanie czyści/unieważnia prywatny stan.

### Reguły domenowe i kontrakty

- PRD 1.0 §9/15: dostępność = aktywność minus blokady, nigdy zapis dziennych rekordów „wolny”; domknięty zakres dat, jeden dzień poprawny; kolizja iff `block.startDate <= requestedEnd && block.endDate >= requestedStart`.
- Publiczne daty ≥ „dzisiaj” w Europe/Warsaw; admin widzi historię, dodanie w przeszłości ostrzega. Brak `availableTo` oznacza otwarty koniec; horyzont 18–24 miesięcy jest przykładową opcją UI, nie ustalonym limitem.
- Wycofanie auta przez status, bez nieskończonej blokady. Aktualne dane i ochrona konfliktów także przy równoczesnym zapisie. Prywatne `type`, `internalNote`, `reference`, źródło/dane techniczne niedostępne publicznie.
- UUID niezależne od nazw; dostępność SQL `DATE`/LocalDate, audyt UTC/TIMESTAMPTZ. Encja rezerwacji dopiero w przyszłości, nie rozbudowa prywatnej notatki.
- Ograniczenia: `startDate <= endDate`, `availableFrom <= availableTo`, relacja zdjęcie/blokada → właściwy pojazd tej samej firmy, unikalne pary wyposażenia, transakcyjne główne zdjęcie, indeksy statusu/kolejności/featured/dat/audytu. W 3.1 slugi i przekierowania unikalne per firma.
- Publiczny kontrakt: lista z filtrami, szczegóły po slugu, kalendarz od/do, zakres dla jednego/wielu aut, publiczny settings DTO. Każda administracyjna operacja ma serwerową autoryzację i Zod; Server Actions albo Route Handlers nie zmieniają reguł domeny.
- Stabilne błędy: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `VEHICLE_NOT_FOUND`, `VEHICLE_NOT_PUBLISHED`, `AVAILABILITY_CONFLICT`, `INVALID_DATE_RANGE`, `DATE_OUTSIDE_VEHICLE_WINDOW`, `IMAGE_UPLOAD_FAILED`, `PUBLISHING_REQUIREMENTS_NOT_MET`, `RATE_LIMITED`, `INTERNAL_ERROR`; bez stack trace, z requestId i fieldErrors.
- Techniczne limity dostępności: maksymalny zakres zapytania to 365 dni; limity ruchu są per źródło, aktora i operację. Nie mylić z handlowymi limitami pakietów wycofanymi z 3.1.
- Bazowe limity ruchu MVP: logowanie/MFA 5 nieudanych prób na konto i 15 minut oraz 20 prób na adres IP i 15 minut; reset hasła, zaproszenie i resend 3 żądania na konto i godzinę oraz 20 na adres IP i godzinę; uwierzytelnione odczyty API 120/minutę na konto i firmę, mutacje 60/minutę; publiczna dostępność 60/minutę na adres IP; wysyłanie wiadomości czatu 30/minutę na konto z krótkim burstem 10. Przekroczenie zwraca `429 RATE_LIMITED` z `Retry-After`; wartości są konfigurowalne i podlegają weryfikacji w teście obciążenia.
- Ochrona edycji równoczesnej admin/superadmin: kontrolowana wersja rekordu i konflikt, bez cichego nadpisania (3.1 §6.4/TEST-MVP-51).

### Dziesięć bazowych przypadków użycia

- **UC-01:** spełniający warunki `PUBLISHED` widoczny na liście z poprawnym zdjęciem, nazwą i parametrami; w 3.1 tylko przy aktywnej widoczności firmy.
- **UC-02:** `UNPUBLISHED` znika z listy, bezpośredni URL kontrolowany/404, dane pozostają w panelu.
- **UC-03:** aktywny od 1.09, brak blokad 10–12.09 → dostępny, kontakt z kontekstem.
- **UC-04:** blokada 11–13.09, zapytanie 10–12.09 → niedostępny bez przyczyny.
- **UC-05:** blokada 10–12.09 włącznie → 12.09 zajęty, 13.09 wolny przy braku dalszej blokady.
- **UC-06:** istniejąca 10–12.09, nowa 11–15.09 → zapis zablokowany i wskazany konflikt.
- **UC-07:** bez zdjęcia możliwy szkic, niemożliwa publikacja.
- **UC-08:** offline PWA → ekran offline, brak fikcyjnego zapisu.
- **UC-09:** niezalogowany `/admin/pojazdy` → login i brak prywatnych danych w HTML/API; w 3.1 również separacja hostów i firm.
- **UC-10:** zapis blokady na wolny termin → następne publiczne sprawdzenie niedostępny bez ręcznego czyszczenia cache.

## 4. Wymagania niefunkcjonalne wersji z superadminem

### Izolacja, autoryzacja i sesje

- **C-N001 [P]** Dane firm i Autervy są odseparowane i chronione. Źródło: REQ-MVP-17.
- **C-N002 [T]** Każda operacja serwerowa weryfikuje rolę, firmę, sesję i obszar hosta. Źródło: §3.4, §18.1.
- **C-N003 [T]** Host wybiera obszar i kontekst, ale nie nadaje uprawnień; `organizationId` z klienta nie jest dowodem dostępu. Źródło: §3.4.
- **C-N004 [T]** Izolacja obejmuje relacje rekordów, media, rozmowy, cache i zadania w tle. Źródło: §17.3–17.4, §18.1.
- **C-N005 [T]** Brak lub konflikt kontekstu kończy się odmową; nie wybiera się pierwszej firmy z bazy. Źródło: §18.1.
- **C-N006 [T]** Podmiana ID pojazdu, obrazu, blokady lub rozmowy nie umożliwia odczytu/zapisu innej firmy ani nie ujawnia prywatnego istnienia zasobu. Źródło: §18.1, TEST-MVP-05/06/07.
- **C-N007 [T]** Publiczny host nie wystawia logowania firmy ani endpointów administracyjnych, również pod `/admin` i `/api/admin`. Źródło: §3.4, TEST-MVP-09.
- **C-N008 [T]** Nieznany host odpowiada neutralnie bez danych firmy, loginu platformy, identyfikatora tenanta i listy klientów. Źródło: §12.3, §15.12.
- **C-N009 [T]** Sesja administratora firmy nie staje się sesją superadmina po podmianie hosta, cookie lub tokenu. Źródło: §6.3, §18.2.
- **C-N010 [T]** Cookies sesji mają `Secure`, `HttpOnly`, adekwatne `SameSite` i nie korzystają z szerokiego `Domain`; `__Host-` jest rekomendacją warunkową. Źródło: §18.2.
- **C-N011 [T]** Wylogowanie i odebranie uprawnień działa również dla bezpośrednich endpointów. Źródło: §18.2.
- **C-N012 [T]** Mutacje weryfikują dozwolony Origin i stosują ochronę CSRF. Źródło: §18.3.
- **C-N013 [T]** Nie zezwalać na credentialed CORS dla dowolnych siostrzanych subdomen. Źródło: §18.3.
- **C-N014 [T]** GET, preload i skan linku nie aktywują konta, nie publikują firmy i nie kasują danych. Źródło: §18.3.
- **C-N015 [T]** Tokeny zaproszenia/resetu są losowe, jednorazowe, bezpiecznie przechowywane i chronione przed zgadywaniem. Źródło: §7.4, §18.4.
- **C-N016 [T]** Linki tokenów powstają z zatwierdzonego adresu panelu, nie dowolnego nagłówka Host. Źródło: §18.4.
- **C-N017 [T]** Tokeny nie trafiają do logów, referrera ani zbędnej analityki. Źródło: §18.4; V30 §7.4.
- **C-N018 [P/T]** Superadmin nie ustawia znanego sobie hasła klienta i nie odczytuje jego hasła. Źródło: §7.3.
- **C-N019 [T]** Pełna rola superadmina nie zapewnia odczytu sekretów, dowolnego SQL, superużytkownika PostgreSQL lub kasowania audytu. Źródło: §6.2, §18.7.
- **C-N020 [T]** Sekrety bazy, poczty i domen pozostają poza repozytorium, przeglądarką i makietami; środowiska mają odrębne poświadczenia. [Macierz środowisk](contracts/environments-hosts-operations.md). Źródło: §18.7.

### Dane, cache i trwałość

- **C-N021 [R/T]** Pojazdy, zdjęcia, okresy zajętości, ustawienia, przekierowania slugów i audyt mają jednoznacznego właściciela — firmę. Źródło: §17.3.
- **C-N022 [R/T]** Powiązanie dziecka z pojazdem nie może łączyć różnych firm. Źródło: §17.3.
- **C-N023 [R/T]** Slug pojazdu jest unikalny w firmie, a nie globalnie. Źródło: §17.3, TEST-MVP-11.
- **C-N024 [R/T]** Host panelu i host publiczny mają jednoznaczne przypisanie w platformie; próba zajęcia używanego hosta nie zmienia właściciela. Źródło: §17.3, TEST-MVP-12.
- **C-N025 [R/T]** Ustawienia oferty są przypisane do firmy; nie stanowią wspólnego singletonu klientów. Źródło: §17.2–17.3.
- **C-N026 [R/T]** Pierwsza rejestracja i start trialu są utrwalone raz i odporne na retry. Źródło: §17.2–17.3.
- **C-N027 [R/T]** Historia zajętości nie jest kopiowana między firmami ani modyfikowana zmianą okresu usługi. Źródło: §17.3.
- **C-N028 [T]** Publiczne odczyty zawierają tylko opublikowane dane oferty, dozwolone media/kontakt i informacyjną dostępność. Źródło: §17.4.
- **C-N029 [P/B/T]** Prywatne notatki, referencje i typ blokady, dane okresu usługi oraz czat nie trafiają do publicznego HTML/API/cache. Źródło: §13.2 ADM-09, §17.4, TEST-MVP-02/08.
- **C-N030 [T]** Publiczne odczyty nie wykorzystują prywatnej sesji do rozszerzania danych. Źródło: §17.4.
- **C-N031 [T]** Klucze cache oddzielają firmy i obszary public/private; same tagi unieważniania nie wystarczają. Źródło: §17.4.
- **C-N032 [T]** Widoczność jest sprawdzana przy odczycie serwerowym i cache; zadanie raz dziennie nie jest jedynym mechanizmem wygaszania. Źródło: §8.5, TEST-MVP-43.
- **C-N033 [T]** Wyłączenie oferty uwzględnia cache i CDN mediów; nie obiecuje cofnięcia kopii już pobranych przez odwiedzającego. Źródło: §18.6.
- **C-N034 [B/T]** Upload sprawdza limity i typ pliku; logo/obrazy nie mogą dostarczać wykonywanego kodu. Źródło: §18.6.
- **C-N035 [T]** Media publiczne i robocze/prywatne mają odpowiednią odrębną politykę dostępu; prefiks z ID firmy nie jest zabezpieczeniem. Źródło: §18.6.
- **C-N036 [T]** Opisy i czat nie wykonują HTML/skryptów. Źródło: §11.5, §18.6, TEST-MVP-32.
- **C-N037 [T]** Nie kopiować pełnej korespondencji do logów aplikacji ani szczegółów audytu. Źródło: §11.5, §13.3 OVR-18.
- **C-N038 [T/P]** Limity techniczne długości i ruchu czatu muszą być jawnie konfigurowane. Maksymalna wiadomość ma 4 000 znaków, a bazowy limit wysyłania to 30 wiadomości/minutę na konto z burstem 10. Sposób liczenia, odmowa i fixture: [kontrakt D-04/D-05](contracts/technical-limits-and-mfa-bootstrap.md). Źródło: decyzja właściciela 23.10.2026, §11.5.
- **C-N039 [B/T]** Audyt zapisuje tworzenie/archiwizację firmy, zmiany okresu, domeny, materiałów publicznych, zaproszeń, praw i operacji floty. Źródło: §18.7.
- **C-N040 [B/T]** Audyt wskazuje faktycznego aktora, rolę, docelową firmę, działanie, czas i bezpieczne poprzednie/nowe wartości. Źródło: §8.5, §17.2, §18.7.
- **C-N041 [B/T]** Backupy, test odtworzenia i separacja staging/production pozostają wymagane. [Plan backupu i restore](contracts/environments-hosts-operations.md). Źródło: §18.8.
- **C-N042 [B/T]** Odtworzenie jednej firmy nie nadpisuje danych innych firm. Źródło: §18.8, TEST-MVP-39.
- **C-N043 [R/T]** Migracja istniejących danych wymaga potwierdzonego przypisania do firm, kopii i sprawdzonego odtworzenia. Źródło: §17.5.
- **C-N044 [R/T]** Obsługa drugiej realnej firmy może ruszyć dopiero po objęciu izolacją schematu, odczytów, mutacji, storage/cache i po testach A/B. Źródło: §17.5, §22.1.
- **C-N045 [R/T]** Rollback nie może wrócić do wersji traktującej dane wszystkich firm jako jednej firmy. Źródło: §17.5.
- **C-N046 [P]** Brak automatycznego purge nie oznacza nieskończonej retencji backupów; wyjątkowe obowiązki prawne pozostają procedurą poza panelem. [Retencja kopii](contracts/environments-hosts-operations.md). Źródło: §5.2B Q-10B, §18.8.

### Interfejs, dostępność i jakość

- **C-N047 [P/B]** Wspólne strony i panele używają jednej monochromatycznej palety, Inter Variable, Lucide i siatki odstępów 4 px. Źródło: §16.1, DEC-014.
- **C-N048 [P/B]** Nie udostępniać konfiguracji kolorów, fontów, ikon lub dowolnego HTML/CSS/JS klienta. Źródło: §16.1/16.3, DEC-014.
- **C-N049 [B]** Zachować wspólne komponenty, focus, geometrię i istniejące stany interakcji; nie tworzyć biblioteki osobno dla każdej firmy. Źródło: §16.1/16.3.
- **C-N050 [B/T]** Kontrast i stany hover/focus/disabled muszą pozostać czytelne, w tym rozróżnienie dostępności kalendarza. Źródło: §16.3.
- **C-N051 [P/R]** Wskaźnik nowych wiadomości ma tekst dostępnościowy, nie jest wyłącznie kropką lub kolorem. Źródło: §11.3.
- **C-N052 [B]** Administrator ma pełne funkcje na mobile. Źródło: §16.4.
- **C-N053 [B]** Główne makiety obejmują 390×844 i 1440×1024; kontrola obejmuje 320, 430, 768, 1024 i 1920 px. Źródło: §16.4.
- **C-N054 [B]** Status usługi, czat, klawiatura ekranowa i dolna nawigacja nie zasłaniają pól lub sticky CTA. Źródło: §15.9, §16.4.
- **C-N055 [B]** Zachować ruch 120/180/240 ms i `prefers-reduced-motion`. Źródło: §16.4.
- **C-N056 [B/R]** Stosowne widoki obsługują loading, empty, error/retry, saving, walidację, unauthorized i offline. Źródło: §15.1.
- **C-N057 [B/T]** Błędy publiczne nie ujawniają stack trace, prywatnych danych operatora, danych innej firmy lub przyczyny finansowej wyłączenia. Źródło: §8.3, §13.1 PUB-08, §15.11.
- **C-N058 [T]** Gotowość domeny wymaga rzeczywistego routingu i TLS, z certyfikatem obejmującym odpowiedni poziom subdomeny. [Kontrakt hostów](contracts/environments-hosts-operations.md). Źródło: §3.4, §7.3.
- **C-N059 [B/T]** Transport rozmów i danych prywatnych jest szyfrowany; historyczny V30 §11.5 wprost wskazuje HTTPS. [Plan TLS i WSS](contracts/environments-hosts-operations.md). Źródło: V30 §11.5; V31 §18.2/18.6.
- **C-N060 [B/T]** Zachować bazowe wymagania wydajności, SEO, dostępności cyfrowej, PWA i bezpieczeństwa; 3.1 nie zastępuje ich parametrami SaaS. Źródło: §1.3, §2.2, §20.
- **C-N061 [B/T]** Plan 55 scenariuszy TEST-MVP-01–55 rozszerza regresję floty i dostępności z bazowego PRD §29. Źródło: §20.
- **C-N062 [T]** Testy rzeczywistego runtime muszą objąć izolację A/B, granice czasu/DST, pocztę, DNS/TLS, MFA i WebSocket. Źródło: §20, §22.2–22.3.
- **C-N063 [P/B]** Penpot jest źródłem mapowania ekranów; realne page/board/component ID należy odczytać, a brak odnotować bez fikcyjnych identyfikatorów. Źródło: §21.1.
- **C-N064 [B]** Zachować edytowalne natywne komponenty, instancje i tokeny; nie zastępować biblioteki screenshotami. Źródło: §21.4.
- **C-N065 [B/T]** Wynik statycznej makiety nie jest dowodem działania backendu, autoryzacji, poczty, DNS/TLS, WebSocket ani backupu. Źródło: §22.3, §24.5.
- **C-N066 [B/T]** Dostarczenie zdarzeń czatu w czasie rzeczywistym ma docelowo p95 ≤2 s przy normalnym obciążeniu; test obejmuje reconnect i wiele instancji procesu.

## 5. Mierzalne wymagania jakościowe i eksploatacyjne z B1

### Wydajność, skala, odporność — PRD 1.0 §21/27/28

- **NFR-PERF-001:** publiczne Core Web Vitals p75, osobno mobile/desktop: LCP ≤2,5 s; INP ≤200 ms; CLS ≤0,1.
- **NFR-PERF-002:** przy normalnym obciążeniu: availability check server p95 ≤500 ms; zapis blokady p95 ≤800 ms bez uploadu; lista ≤100 aut p95 ≤600 ms.
- **NFR-PERF-003:** ograniczać publiczny JS i Client Components, logikę nieinteraktywną wykonywać na serwerze; brak konkretnego budżetu kB.
- **NFR-PERF-004:** responsywne obrazy, `sizes`, nowoczesny format, lazy loading poniżej pierwszego ekranu, znane wymiary przeciwdziałające CLS, limit pliku po optymalizacji; liczby MB/pikseli nie ustalono.
- **§21.2:** bazowy profil: ≥100 pojazdów, 100 000 okresów historycznych/przyszłych, 10 000–100 000 odsłon/miesiąc, równolegli klienci i kilku adminów. W 3.1 liczba adminów zastąpiona jednym na firmę + superadmin. Skala globalna wielu firm wymaga osobnego profilu; nie przenosić automatycznie 100 firm z v2 jako zatwierdzonego celu.
- **§21.3:** miesięczna dostępność ≥99,9% jako cel produktu, kontrolowany błąd/offline, retry odczytu, brak utraty danych wskutek awarii jednego procesu. Nie jest podpisanym SLA.
- **§27:** logi strukturalne: poziom/czas/środowisko/requestId/operacja/wynik/bezpieczne ID; w 3.1 również firma i aktor/obszar. Monitoring wyjątków, API, renderu, SW, uploadu, DB/storage.
- Alerty: niedostępność, wzrost 5xx, DB, nieudane kopie, nieudane loginy, limit storage, migracje; healthcheck rozróżnia proces i zależności, bez ujawnienia konfiguracji/sekretów.
- Backup DB i mediów co najmniej codziennie, z retencją 30 dni; kopie są logicznie oddzielone i szyfrowane. Cel RPO wynosi 24 h, a RTO 4 h. Zdjęcia mają wersjonowanie/ochronę usunięcia i możliwość restore.
- Okresowy rzeczywisty test odtworzenia wykonuje się na środowisku nieprodukcyjnym; procedura obejmuje odtworzenie jednej firmy bez nadpisywania innych. Właściciel/operator odpowiada za procedurę i jej test.
- Logi bezpieczeństwa i audytowe przechowuje się 365 dni, zwykłe logi aplikacyjne 30 dni. Archiwizacja firm 3.1 nie oznacza bezterminowych backupów i nie uruchamia purge.

### Dostępność, UX, zgodność — PRD 1.0 §21.4–21.9/25

- WCAG 2.2 AA w mającym zastosowanie zakresie: klawiatura, widoczny fokus, semantyczne nagłówki/landmarki, etykiety, przypisane błędy, alt, kontrast, status nie tylko kolor, zoom ≥200%, brak wymuszonej orientacji, reduced-motion.
- Kalendarz z alternatywnym tekstowym/natywnym wyborem dat. Zalecany cel dotykowy około 44×44 CSS px; to ergonomia projektowa, nie twierdzenie o wszystkich kryteriach AA.
- Mobile-first i pełne kluczowe funkcje admina na telefonie. Baza: 320, 360–430, 768–1024, 1280–1440, ≥1920 px; 3.1/SPEC główne 390×844 i 1440×1024 oraz kontrola 320/430/768/1024/1920.
- Aktualne stabilne Chrome/Edge/Firefox/Safari, Chrome Android, Safari iOS; różnice instalacji PWA nie ograniczają działania panelu w przeglądarce.
- Polska, polski, PLN, `dd.MM.yyyy`, Europe/Warsaw, poniedziałek; UI teksty możliwe do wydzielenia do słownika, bez obowiązku dodatkowego języka.
- Formularze zachowują dane po walidacji, każda mutacja ma loading, blokada wielokrotnego submit, jednoznaczny sukces, potwierdzenie destrukcji, ostrzeżenie niezapisanej edycji. Wyjątek 3.1: szkic czatu zachowany per rozmowa bez dialogu przy zmianie rozmowy.
- Kluczowe akcje widoczne na telefonie; sidebar desktop, dolna/zwijana nawigacja mobile, duże kontrolki, spójny feedback. Formularz auta: dane, techniczne, opis/wyposażenie, cena, zdjęcia, aktywność, publikacja/SEO; błędy prowadzą do pola, również w akordeonach.
- Kalendarz: kliknięcie/zakres → blokada, kliknięcie istniejącej → szczegóły/edycja, mobile lista okresów, skróty dziś/następny miesiąc/dat.
- Styl wynikający z SPEC/3.1: jasna monochromatyczna paleta, Inter Variable, Lucide, skala 4 px, semantyczne tokeny, brak dark mode; 120/180/240 ms i reduced motion. Kolorowe statusy §25.3 bazy są nadpisane przez SPEC.
- SEO: unikalne title/description, czytelne URL, canonical, sitemap, robots, OG, schema firmy/oferty, renderowana treść bez klientowego JS, redirecty slugów; admin/preview noindex i poza sitemap. W 3.1 per publiczny host firmy i bramka całej oferty po końcu okresu.

### Bezpieczeństwo i prywatność — PRD 1.0 §22/23

- Hashowanie haseł sprawdzoną biblioteką; min. 12 znaków albo polityka siły; menedżer haseł i wklejanie dozwolone; Secure/HttpOnly/SameSite, rotacja/unieważnienie, rate limit, neutralne błędy; MFA z 3.1 obowiązkowe, reauth krytycznych operacji.
- Serwerowa autoryzacja każdego odczytu i zapisu admina; UI/proxy nie zastępują kontroli. 3.1: poprawny host+obszar+firma+sesja+rola, także RSC/API/prefetch, WebSocket i zasoby przez ID.
- Zod na serwerze, tekst/bezpieczny Markdown; brak surowego HTML lub ścisła sanitacja, ORM/parametry SQL, własne klucze plików, bez używania niezweryfikowanej nazwy użytkownika.
- Upload: limity rozmiaru/liczby/wymiarów, magic bytes, odrzucone/sanityzowane SVG, własne objectKey, izolowane przetwarzanie, brak wykonywania uploadu; AV opcjonalny przy rozszerzeniu formatów.
- CSP, `nosniff`, `frame-ancestors`, Referrer-Policy, Permissions-Policy, HSTS; CORS bez wildcard z credentials/adminem. CSRF i trusted Origin; same-site subdomeny nie są wystarczającą izolacją.
- Prywatne odpowiedzi bez publicznego cache CDN/SW; logout czyści stan. Sekrety poza repo/clientem, osobne per środowisko, rotacja, najmniejsze uprawnienia, ograniczone klucze storage.
- Projekt/testy według adekwatnych OWASP ASVS; nie deklarować formalnej zgodności bez audytu.
- Minimalizacja: brak danych najemców w bazie; dane adminów, logi, publiczne kontakty przedsiębiorcy; prywatne notatki bez zbędnych danych osobowych.
- Opis administratora danych, celów/podstaw, retencji, zabezpieczeń, umów powierzenia, praw osób, privacy by design/default; zatwierdzone dokumenty dla konkretnej działalności/dostawców. To wymaganie produktu, nie opinia prawna.
- Prywatnościowa analityka; mechanizm zgód tylko jeśli wybrane narzędzia go wymagają. Nie wysyłać notatek, e-maili adminów, tokenów, treści wiadomości i przyczyn blokad.
- Zalecane zdarzenia analityczne: `page_view`, `vehicle_list_view`, `vehicle_view`, `availability_check_started`, `availability_check_result`, `contact_clicked`, `filter_applied`, `no_results_viewed`. Konwersja: kontakt po sprawdzeniu dat. Analityka panelu opcjonalna, audyt odrębny; 3.1 nie dodaje przychodowych KPI platformy.

### Utrzymanie, jakość i odbiór — PRD 1.0 §20.5/21.10/29–30/37–39

- Ścisły TypeScript, uzasadnienie `any`, moduły domeny niezależne od UI, migracje w repo, dokumentacja env, krytyczne testy, wspólne błędy/logi i review przed produkcją.
- Przypięty lockfile i Node, stabilne wersje, RC/beta wyłącznie po decyzji, regularne security updates, regresja major upgrades; numery technologii z bazy są propozycjami, nie stanem instalacji.
- Cztery środowiska: development, preview, staging, production; osobne DB/storage/sekrety. Brak produkcyjnych danych w fixture.
- CI PR: lockfile install, lint/format, typecheck, unit, integracja, production build, skan zależności/sekretów, wybrane E2E preview, raport.
- Deploy: chroniona gałąź, build, kontrolowana migracja, smoke/healthcheck, rollback app i procedura migracji. Migracje reviewed, bez niekontrolowanego kasowania, expand-contract dużych zmian, backup przed ryzykowną, sprawdzenie na staging.
- Unit dostępności: brak blokad/jeden dzień/przed/po/częściowe/pełne przecięcie/styki/kilka blokad/poza aktywnością/otwarty koniec/błędne daty/zmiana dnia Warsaw.
- Integracja: czysta migracja, publikacja, unikalność slugów, konflikt blokad, główne zdjęcie transakcyjnie, autoryzacja, unieważnienie sesji/cache, zły upload, audyt; 3.1 rozszerza o izolację, czas, pocztę, domeny, MFA, czat.
- E2E publiczne: home→lista→filtry→szczegóły→galeria→daty wolne/zajęte→kontakt, brak wyników, mobile, klawiatura. Admin: dobre/złe loginy, odmowa bez sesji, szkic, brak publikacji bez danych, zdjęcia, publikacja, CRUD/konflikt blokady, ukrycie, ustawienia, logout, mobile.
- PWA: manifest/ikony/instalacja/start/sesja/offline/brak fake save/aktualizacja/logout; rzeczywisty Android+iOS. A11y: axe + klawiatura + VoiceOver + TalkBack + zoom/kontrast/kalendarz. Wydajność: Lighthouse CI SHOULD, produkcyjne Web Vitals, docelowe rekordy i współbieżność, bundle, obrazy na słabej sieci.
- Security testy: dependencies/secrets, IDOR, CSRF, XSS, rate limit, upload, prywatny cache, storage; podstawowy pentest przed produkcją lub płatnościami.
- DoD: kryteria, obie walidacje, loading/empty/success/error, mobile/desktop/klawiatura, prywatność, testy adekwatne do ryzyka, lint/typecheck, logowanie, brak regresji budżetu, staging, dokumentacja.
- Gotowość MVP: kluczowe flow działają, brak wycieku, aktualny cache, działające PWA, CI, responsive/a11y/security, monitoring/alerty, kopie i próba/procedura restore, publiczne prawne/firmowe informacje, brak błędów krytycznych/wysokiego ryzyka.
- Fixture staging: ≥6 aut różnych kategorii; opublikowany wolny/zablokowany, szkic, ukryty, bez ceny/z ceną; graniczne scenariusze bez faktycznie kolidujących rekordów; testowy admin bez dostępu prod.

## 6. Szczegółowy kontrakt design systemu

Źródła: SPEC §4–7, §12–16; handoff motion/responsive; aktualne makiety Penpot. Wymagania dotyczą również superadmina.

- **DS-N01:** paleta wyłącznie `#151515`, `#424242`, `#737373`, `#a5a5a5`, `#f2f2f2` i zatwierdzone alfa. `#737373` na `#f2f2f2` nie służy zwykłemu tekstowi; `#a5a5a5` nie służy aktywnym kontrolkom/treści.
- **DS-N02:** tokeny w trzech warstwach: prymitywy → semantyka → komponent; jeden manifest JSON i generowany CSS. Nazwa tokenu ma to samo znaczenie w kodzie i Penpocie.
- **DS-N03:** Inter Variable, grubości 400/500/600/700, cyfry tabelaryczne dla dat/cen; tekst główny 16/24 px. Biblioteczne Inter Tight jest fallbackiem Penpota, nie zmianą fontu aplikacji.
- **DS-N04:** odstępy na bazie 4 px; standardowe pole/przycisk 48 px, dotyk minimum 44×44 px, odstęp między celami 8 px; kompaktowe kontrolki desktopowe minimum 40 px.
- **DS-N05:** promienie pól/przycisków 8 px, kart 12 px, galerii 16 px; focus 2 px z offsetem 2 px. Pozostałe wartości według tokenów, bez przypadkowych wartości komponentowych.
- **DS-N06:** Lucide z dostępnymi nazwami akcji; dekoracyjne ikony ukryte dla czytnika. Status ma tekst oraz ikonę/obramowanie, nigdy sam kolor.
- **DS-N07:** zmiana szerokości reorganizuje treść, nie skaluje całego ekranu. Sprawdzać 320/390/768/1024/1440/1920 px oraz 430 px według V31. Brak poziomego przewijania całej strony; oś kalendarza może mieć kontrolowany scroll.
- **DS-N08:** publiczne siatki/kontenery według SPEC §4.8 i najnowszego kontraktu danego ekranu. Zagnieżdżona flota: jedna kolumna do 767, dwie kolumny kart 768–1279, tabela od 1280; shell admina maks. 1600 px przy 1920.
- **DS-N09:** wiadomości superadmina: osobna lista i rozmowa poniżej 1024 px, split-view od 1024. Klawiatura ekranowa i safe area nie zasłaniają pola ani wysyłki.
- **DS-N10:** ekran ma właściwe dla niego `loading`, `empty`, `no-results`, `error/retry`, `saving`, `conflict`, `offline`, `unauthorized`; te stany nie tworzą odrębnych tras.
- **DS-N11:** podczas sprawdzania dat/błędu nie pokazywać poprzedniego pozytywnego wyniku. Spóźniona odpowiedź nie zastępuje wyniku nowszego zapytania.
- **DS-N12:** maksymalnie jedna główna akcja w logicznym panelu. Stan loading zachowuje sensowną etykietę i blokuje powtórny zapis; nieaktywny przycisk publikacji ma wyjaśnienie braków.
- **DS-N13:** etykieta pola zawsze widoczna; wymagane/opcjonalne opisane; błędy powiązane przez ARIA i podsumowanie prowadzące do pól; błąd nie znika bez poprawy. Walidacja otwiera sekcję zawierającą błędne pole.
- **DS-N14:** dialog/sheet zarządza fokusem, ma tytuł, dostępną akcję zamknięcia i przywraca fokus do wyzwalacza. Escape/click-outside nie może bez ostrzeżenia zniszczyć danych ani odsłonić prywatnego widoku po wygaśnięciu sesji.
- **DS-N15:** operacja destrukcyjna wskazuje nazwę obiektu, skutek i odwracalność; neutralne anulowanie jest bezpieczną akcją. Nie potwierdzać zapisu timerem prototypu.
- **DS-N16:** kalendarz obsługuje strzałki, zmianę miesiąca, Enter/Space, pełną dostępną nazwę daty/stanu, ogłoszenie zakresu i alternatywne pola dat.
- **DS-N17:** galeria działa gestem i przyciskami, z alt, licznikiem oraz klawiaturą w lightboxie. Zmiana kolejności zdjęć ma akcje klawiaturowe; nie jest wyłącznie przeciąganiem.
- **DS-N18:** fotografie zachowują proporcje; karty pojazdów 3:2. Podglądy UI używają `contain` lub zgodnych proporcji; nie obcinać kontrolek jak zwykłego zdjęcia `cover`.
- **DS-N19:** upload ma osobny postęp/błąd pliku i ponowienie; błąd jednego zdjęcia nie kasuje reszty. Limity formatów/liczby/MB widoczne przed wyborem; placeholdery `[MB]`/`[liczba]` nie trafiają do produkcji.
- **DS-N20:** motion 120/180/240 ms; animacje nie blokują CTA/fokusu, nowa interakcja przerywa poprzednią. Reduced motion usuwa przesunięcia/zoom, bez autoplay, scroll hijackingu i dekoracyjnych pętli.
- **DS-N21:** skip link, landmarki, logiczne nagłówki, pełna klawiatura, zoom 200%, kontrola odstępów tekstu i niezasłanianie fokusu. Nie uznawać statycznej makiety lub automatu za pełny odbiór WCAG.
- **DS-N22:** publiczny white-label pokazuje logo i treści wypożyczalni; MKT pokazuje Autervę. Prywatny pasek kontekstu superadmina występuje tylko w chronionym podglądzie/obsłudze firmy.
- **DS-N23:** próbne zdjęcia, numery telefonów, terminy i nazwy firm DEMO nie są danymi produkcyjnymi; treści prawne i finalne materiały wymagają dostarczenia.

## 7. Propozycje realizacyjne ze źródeł — status R

- **C-R001** Zachować modularny monolit, jeden kod i wspólne moduły auth, floty, dostępności, mediów, okresów i rozmów; nie jest to decyzja o wdrożonej architekturze. Źródło: §17.1.
- **C-R002** Proponowane trasy panelu firmy: `/admin/login`, `/admin`, `/admin/pojazdy`, `/admin/ustawienia`; `/` może prowadzić do startu panelu. Źródło: §3.2.
- **C-R003** Proponowane trasy superadmina: `/login`, `/`, `/firmy`, `/firmy/nowa`, `/firmy/[id]`, `/wiadomosci`. Źródło: §3.2.
- **C-R004** Trasy oferty: `/`, `/pojazdy`, `/pojazdy/[slug]`, `/kontakt` i dokumenty prawne. Źródło: §3.2.
- **C-R005** Robocza trasa zaproszenia: `/admin/zaproszenie/[token]`; ostateczny kontrakt zależy od auth. Źródło: §3.2.
- **C-R006** Zagnieżdżona flota superadmina może używać `/firmy/[id]/zarzadzanie/pojazdy`. Źródło: §9.1.
- **C-R007** Główna nawigacja superadmina: Firmy i Wiadomości; konto/wylogowanie w menu, KPI nad listą. Źródło: §9.1.
- **C-R008** Formularz firmy zawiera nazwę, e-mail zaproszenia, slug/host panelu, domeny i gotowość, materiały publiczne oraz okres; nazwa nie zmienia automatycznie sluga. Źródło: §9.2.
- **C-R009** Slug panelu jest unikalny i wyklucza nazwy techniczne; host jest wyliczany z kontrolowanego sluga, a nie dowolnym URL-em. Źródło: §9.2.
- **C-R010** E-mail administratora i publiczny e-mail kontaktowy są osobnymi przeznaczeniami danych. Źródło: §9.2.
- **C-R011** Formularz obsługuje pusty/częściowy stan, konflikt e-maila/sluga, błędną domenę, niegotowy routing/TLS, niepoprawny okres/logo, zapis i błąd wysyłki. Źródło: §5.2A Q-04A, §15.5.
- **C-R012** Dopuszczalne osobne akcje „Zapisz firmę” i „Wyślij zaproszenie” albo wspólna akcja z dwoma wynikami. Źródło: §9.3.
- **C-R013** Ekran okresu pokazuje bieżące/nowe wartości i skutki skrócenia; bez tekstu „Płatność przyjęta”. Źródło: §8.5.
- **C-R014** Po aktywacji zalecane potwierdzenie i przejście do logowania; automatyczna sesja nie została osobno zatwierdzona. Źródło: §7.4.
- **C-R015** Dialog archiwizacji podaje nazwę i skutki: zachowanie danych, blokadę loginu, wyłączenie adresów i ukrycie na domyślnej liście. Źródło: §9.5.
- **C-R016** Jeden trwały wątek rozmowy na firmę; liczebność jest propozycją minimalnego modelu, nie osobną decyzją właściciela. Źródło: §11.2.
- **C-R017** Neutralny ekran wyłączonej strony może komunikować „Ta strona jest obecnie niedostępna”; wyłączenie nie wymaga kasowania DNS/TLS. Źródło: §8.3, §15.11.
- **C-R018** Onepage może mieć hero, korzyści, proces, realny podgląd DEMO, FAQ, kontakt i stopkę; szczegółowy układ pozostaje R. Źródło: §12.1.
- **C-R019** Prywatna notatka operatora jest opcjonalna, niewidoczna dla klienta i nie przechowuje sekretów. Źródło: §9.2.
- **C-R020** Opcjonalne PostgreSQL RLS stanowi dodatkową warstwę; nie zastępuje autoryzacji aplikacji i wymaga testów poolingu/kontekstu transakcji. Źródło: §18.5.
- **C-R021** Model może obejmować Organization, mapowanie hostów, użytkownika, zaproszenie, okres, publiczne materiały, ustawienia, rozmowę/wiadomość i audyt; nie wynika z tego jedna tabela na każdy wiersz. Źródło: §17.2.
- **C-R022** Granicę opłaty reprezentować jako początek kolejnego dnia lokalnego; nie dodawać sztywnych 24 h do dowolnego UTC. Źródło: §8.2.

## 8. Poza bieżącym MVP

- **C-X001** Brak rezerwacji internetowych, płatności najemców i kont klientów wynajmu. Źródło: §2.1, §4.
- **C-X002** Brak publicznej rejestracji firm i samoobsługowego tworzenia organizacji. Źródło: §4.
- **C-X003** Brak zespołów, dodatkowych kont firmowych, ról OWNER/OPERATOR i przełącznika firm. Źródło: §4, §10.4.
- **C-X004** Brak planów START/PRO, uprawnień pakietowych i handlowych limitów floty. Źródło: §4.
- **C-X005** Brak checkoutu, Stripe, kart, faktur, portalu rozliczeń, upgrade/downgrade i płatności w aplikacji. Źródło: §4.
- **C-X006** Brak cen planów, VAT, kont bankowych, sald, MRR i terminów księgowych w konfiguracji firmy. Źródło: §9.2.
- **C-X007** Brak samoobsługowego zakupu domeny lub kreatora DNS u klienta. Źródło: §14 TEN-03.
- **C-X008** Brak edytora motywu, indywidualnych kolorów, fontów, ikon i kodu klienta. Źródło: §16.1/16.3, DEC-014.
- **C-X009** Brak portalu akceptacji designu i obowiązkowego checkboxa akceptacji materiałów. Źródło: §7.2, DEC-014.
- **C-X010** Brak automatycznej karencji i powtórnego trialu. Źródło: §4, §5.2A Q-03C, §8.2.
- **C-X011** Brak blokady panelu wyłącznie z powodu końca opłaty/trialu. Źródło: §5.2A Q-01A, §8.1.
- **C-X012** Brak ręcznej pierwszej publikacji firmy i obowiązku dodania pierwszego auta przed startem strony. Źródło: §7.5.
- **C-X013** Brak automatycznego purge i akcji „Usuń firmę na zawsze”. Źródło: §9.5, DEC-017.
- **C-X014** Brak ticketingu, SLA, botów, reakcji, komunikatora audio/wideo i obecności online. Źródło: §4, §11.2; typing/read są jednak zatwierdzone w Q-08A.
- **C-X015** Brak załączników i powiadomień e-mail czatu; zaproszenia/reset/przypomnienia usługi pozostają. Źródło: §11.1, §11.5.
- **C-X016** Brak globalnej floty wszystkich firm i impersonation. Źródło: §6.4, §9.1.
- **C-X017** Brak CRM, dokumentów wynajmu, marketplace’u i hierarchii oddziałów. Źródło: §4, §17.2.
- **C-X018** Brak kolejki mutacji offline, background sync i centralnej PWA przełączającej firmy. Źródło: §4, §13.2 ADM-18, §13.3 OVR-16.
- **C-X019** Brak obowiązku mikroserwisów, Kubernetes, silnika billingu, wideo/3D lub nowej biblioteki animacji. Źródło: §16.4, §17.1.
- **C-X020** Brak automatycznego awansu odziedziczonych SHOULD/P1 do MUST. Źródło: §1.3, §13, §13.2 ADM-10.

### Funkcje przyszłe wskazane w B1

- COULD po stabilizacji: najbliższy wolny termin, kopiowanie blokad, blokowanie wielu aut naraz, dodatkowe kanały kontaktu, prosty formularz zapytania, eksport kalendarza, dodatkowy język.
- Etap zapytań: formularz leadu, zapis klienta, statusy, tymczasowy hold z expiry, potwierdzenie e-mail, panel zapytań.
- Rezerwacje: osobna Booking, klient/daty/status/cena/waluta/źródło/expiry/historia; transakcja/izolacja/constraint/idempotency key i ponowna walidacja.
- Płatności: zaliczka/całość/kaucja, operator, podpisane idempotentne webhooki, oddzielne statusy płatności/rezerwacji, opóźnione/nieudane płatności, zwroty i audyt finansowy.
- Dalsza automatyzacja: SMS/e-mail, przypomnienia wynajmu, dokumenty/umowy/faktury, kalendarze/import, sezonowe ceny, rabaty/kody, wiele lokalizacji, raporty.
- Poza MVP również: konta/panel najemcy, program lojalnościowy, GPS, szkody, harmonogram pracowników, natywne aplikacje, offline writes/background sync, marketplace/page builder/dowolny CSS i integracje bez decyzji.
- Multi-tenancy było WON’T w bazie 1.0; w aktualnym 3.1 jest wymagane do oddzielenia wielu firm, lecz nie oznacza powrotu funkcji SaaS 2.0.

### Rozliczenie zakresu SaaS 2.0

<details>
<summary>Wszystkie 36 FR-SAS: zachowanie, zastąpienie lub odroczenie</summary>

Poniższy katalog zachowuje wszystkie 36 identyfikatorów FR-SAS, ale nie aktywuje ich dawnego zakresu.

- **FR-SAS-001/002:** kontekst i izolacja pozostają jako REQ-MVP-17; v2 model membership i obowiązkowy RLS nie są decyzją P3.1. 3.1 §18.5 RLS to R/T; runtime nie może omijać wybranego zabezpieczenia.
- **FR-SAS-003:** role OWNER/ADMIN/OPERATOR wycofane; zastąpione SUPERADMIN_AUTERVA/ADMIN_FIRMY.
- **FR-SAS-004:** wiele firm/kart jednego konta i switcher wycofane; jeden admin↔jedna firma, e-mail globalnie unikalny. Superadmin nadal musi mieć związany z operacją kontekst firmy.
- **FR-SAS-005:** assisted provisioning zachowane, uproszczone do prerejestracji przez superadmina + 7-dniowe jednorazowe zaproszenie.
- **FR-SAS-006:** samoobsługowa rejestracja/zakładanie firm wycofane.
- **FR-SAS-007/008/009:** zespół, zaproszenia pracowników, role, transfer OWNER i samoobsługowe odejście wycofane; jedno konto, aktywacja i bezpieczeństwo zostają.
- **FR-SAS-010:** bezpieczeństwo/reset/sesje zachowane; MFA obowiązkowe dla obu ról 3.1, bez historycznej dobrowolności ADMIN/OPERATOR.
- **FR-SAS-011:** ręczna osobna publikacja całej strony i checklist z ≥1 opublikowanym autem zastąpione automatyczną publikacją po skutecznej rejestracji, dozwoloną pustą ofertą i bramką okresu.
- **FR-SAS-012:** ustawienia scoped zachowane; branding publiczny edytuje superadmin, bez samoobsługowego edytora klienta.
- **FR-SAS-013:** motywy white-label S2 wycofane; monochromatyczna paleta wspólna, zmienne tylko logo/dane/treści/zdjęcia.
- **FR-SAS-014/015:** adres publiczny i custom domain potrzebne już w 3.1, obsługuje Auterva; dawny publiczny host `{firma}.sites...` jest teraz panelem firmy. Publiczny testowy host `{slug}.{publicDomainAutervy}` jest osobny; zakup domeny przez klienta, DNS/routing/TLS + przekierowanie przez Autervę.
- **FR-SAS-016:** centralny panel/PWA multi-firm wycofane; app→superadmin, panel/PWA na osobnym hoście firmy.
- **FR-SAS-017/018:** START/PRO, feature entitlements, handlowe limity aktywnych aut/zespołu/storage i rezerwacje slotów wycofane. Zachować tylko uzasadnione ograniczenia techniczne, bez fikcyjnych limitów planu.
- **FR-SAS-019/020:** ręczny/automatyczny abonament jako billing platformy wycofany; w 3.1 tylko zapis opłaconej daty końcowej przez superadmina, bez kwot, podatków, faktur, kart, salda, Stripe/checkout/portalu.
- **FR-SAS-021:** FULL/GRACE/READ_ONLY/NONE wycofane jako blokady komercyjne panelu. Koniec trialu/opłaty wyłącza publiczną ofertę, zachowuje pełny panel/czat, bez 7-dniowej karencji; archiwizacja osobno blokuje login.
- **FR-SAS-022/023:** upgrade/downgrade/portal nabywcy/dokumenty rozliczeń wycofane.
- **FR-SAS-024:** samoobsługowy eksport odłożony; bezpieczna operacyjna obsługa praw/eksportu danych pozostaje potrzebna, bez narzucania nowego ekranu.
- **FR-SAS-025:** DeletionRequest, 7 dni cofania i purge wycofane; archiwizacja zachowuje firmę, flotę, media, blokady, czat; brak automatycznego kasowania i „Usuń na zawsze”.
- **FR-SAS-026:** oddzielny operator na ops i ograniczenie do metadanych zastąpione superadminem na app z pełnym zagnieżdżonym zarządzaniem firmą pod własną tożsamością; audyt/MFA/separacja nadal obowiązują.
- **FR-SAS-027:** 60-minutowe granty pomocy/ograniczony support read-only wycofane; tekstowy WebSocket chat TEN-11/PLT-09 i bezpośrednie uprawnienia superadmina, bez impersonation.
- **FR-SAS-028/029/030/031/032:** izolacja cache/jobs, reguły dat/floty, a11y/mobile, monitoring/restore i bezpieczne wdrożenie nadal sensowne; nie przenosić automatycznie bardziej rozbudowanych ekranów i parametrów S1/S2.
- **FR-SAS-033:** rozdział treści prawnych platformy/firmy pozostaje; dane nabywcy, rozbudowane wersjonowanie zgód handlowych/portal akceptacji poza uproszczonym zakresem.
- **FR-SAS-034/035/036:** bezpieczne media, prawdziwy aktor audytu, realne mapowanie ID Penpota i dowody weryfikacji pozostają; plan makiet ≠ implementacja/test.

Historyczne liczby v2, niezatwierdzone jako aktualny zakres: START 10 aut/3 osoby/2 GiB; PRO 50/10/10 GiB; transfer OWNER 48 h; invitation 7 dni (nowa wersja potwierdza tę samą wartość dla aktywacji admina); trial 14 dni od innego zdarzenia (3.1 zastępuje 336 h od rejestracji); GRACE 7 dni; eksport min. 30 dni po zakończeniu, paczka 24 h, link 5 min; usunięcie 7 dni cofania, purge ≤72 h, backup 30 dni; grant pomocy 60 min; 100 organizacji × średnio 50 aut i ≥500 000 okresów; RPO ≤1 h/RTO ≤4 h. Żadnej z tych liczb poza jawnie potwierdzonymi w 3.1 nie wpisywać jako obowiązującej bez oznaczenia propozycji.

Historyczne scenariusze v2 (15): UC-SAS-01 assisted startup; 02 multi-company; 03 dirty switch; 04 team invite; 05 role revoke; 06 owner transfer; 07 last plan slot; 08 checkout pending; 09 GRACE/READ_ONLY; 10 downgrade; 11 custom domain; 12 appearance; 13 central PWA; 14 export/deletion; 15 support grant. Ich aktualne następstwo jest opisane w FLOW-MVP-01–12 i TEST-MVP-01–55; nie uznawać 64 T-SAS za obowiązujące testy wydania 3.1 bez selekcji.

</details>

## 9. Rozstrzygnięte rozbieżności i otwarte decyzje

### Obowiązujące rozstrzygnięcia

- Wersja z superadminem i wieloma firmami zastępuje historyczny zakaz multi-tenancy w dawnej bazie i DEC-002. Kanoniczny PRD i instrukcje implementacji wskazują wersję 3.1; treści źródłowych PRD nie przepisywano.
- Publiczny trial jest potwierdzony, jednorazowy i trwa 336 godzin; zapis „jeżeli opłacalne” w V31 §8.6 jest pozostałością historyczną. Trial nadal wymaga uprzedniego przyznania przez superadmina.
- WebSocket, typing i read są potwierdzone przez Q-08A; przeczące im §11.2/15.9 są nieaktualne.
- Brak indywidualnych kolorów wynika z U4/DEC-014; §16.3 nie rozszerza white-labelu o motyw.
- MFA jest obowiązkowe dla obu ról; wcześniejsze P1 oraz stary router auth nie wyznaczają aktualnego priorytetu.
- Konto firmy pozostaje jedno; starsza otwarta decyzja o wielu administratorach z handoffu została rozstrzygnięta przez V31.
- Decyzje właściciela z 23.10.2026 rozstrzygają D-01, D-02, D-04 i D-05. Szczegóły macierzy, publikacji, limitów i bootstrapu są kanoniczne dla implementacji MVP 3.1.
- Decyzje właściciela z 27.10.2026 rozstrzygają D-16–D-27 (środowiska, materiały, limity, preview, archiwum, przypomnienia, SEO, hosty i przekierowania).
- Decyzje właściciela z 28.10.2026 rozstrzygają D-28–D-32 (profil bez zakupu, kontrole lokalne, retencja podstawy odblokowania, wielu wykonawców w roli, najbliższy wolny termin i zbiorcze blokady).
- Decyzje właściciela z 10.11.2026 rozstrzygają D-33–D-50 (TOTP, makiety PUB, TEN, PLT i ADM, dokumenty prawne, hasło, opis trialu, eksport kalendarza i danych, wejścia do blokad zbiorczych i ekran kalendarza zewnętrznego) i potwierdzają D-28.

### Do ustalenia przed implementacją danego obszaru

- **D-01 — rozstrzygnięte 23.10.2026:** administrator firmy ma odczyt danych kontaktowych, publicznych, SEO i prawnych, lecz nie może ich zapisywać. Superadmin zapisuje te pola oraz logo, hero, publiczne zdjęcia i branding. Administrator i superadmin mogą zarządzać pojazdami, ich zdjęciami oraz blokadami w kontekście firmy; serwer odmawia pozostałych mutacji niezależnie od UI. [Macierz pól i bezpośredniego API](contracts/company-settings-and-vehicle-publication.md).
- **D-02 — rozstrzygnięte 23.10.2026:** publikacja pojazdu wymaga dotychczasowych pól kompletności oraz pełnego, niepustego opisu. Pojazd niespełniający walidacji pozostaje szkicem. [Tabela walidacji klient/serwer i fixture](contracts/company-settings-and-vehicle-publication.md).
- **D-03 — rozstrzygnięte 23.10.2026:** kategorie definiuje superadmin. Cena pojazdu jest opcjonalna, a superadmin ma osobny dla każdej firmy przełącznik pokazywania/ukrywania cen. Publiczny kontakt obejmuje telefon, WhatsApp i e-mail. Adres jest pełny i ma mapę. Treści prawne Autervy i firmy są osobnymi treściami. Hero obsługuje wiele obrazów, logo i tekst.
- **D-04 — rozstrzygnięte 23.10.2026:** pojazd ma maksymalnie 30 zdjęć; jedno zdjęcie maksymalnie 10 MB i 12 000 × 12 000 px; wiadomość czatu maksymalnie 4 000 znaków; zakres dostępności maksymalnie 365 dni. Bazowe limity ruchu opisano przy C-N038 i są konfigurowalne po teście obciążenia; nie są limitami handlowymi. Granice i reakcje serwera określa [kontrakt D-04/D-05](contracts/technical-limits-and-mfa-bootstrap.md).
- **D-05 — rozstrzygnięte 23.10.2026:** MVP ma dokładnie jednego superadmina. Pierwsze konto tworzy jednorazowa interaktywna komenda administracyjna uruchamiana tylko przy pustej bazie; hasło nie trafia do argumentów ani repozytorium, konto wymaga enrolmentu TOTP i jednorazowych kodów odzyskania. Odzyskanie dostępu wymaga ręcznej procedury właściciela, unieważnienia sesji i pełnego audytu. Przebieg i testy: [kontrakt D-04/D-05](contracts/technical-limits-and-mfa-bootstrap.md).
- **D-06 — rozstrzygnięte 23.10.2026:** archiwizowana firma nie wchodzi do dwóch głównych KPI, nawet z przyszłą datą opłaty; może być pokazana osobno. Firma jest liczona najwyżej raz, a przy trialu i opłacie jednocześnie KPI traktuje ją zgodnie z efektywnym okresem. [Tabela stanów i KPI](contracts/service-periods-kpi-reminders.md).
- **D-07 — rozstrzygnięte 23.10.2026:** przypomnienia są wysyłane o 09:00 `Europe/Warsaw` w terminach 7 dni, 1 dzień i dzień wygaśnięcia. Po przedłużeniu lub skróceniu harmonogram przelicza się od nowa; po awarii worker nadrabia zaległe zdarzenie najwyżej raz. DST jest liczone w strefie produktu. [Kontrakt harmonogramu i retry](contracts/service-periods-kpi-reminders.md).
- **D-08 — rozstrzygnięte 23.10.2026:** szkic czatu jest trwały w lokalnym storage przeglądarki, osobno dla `(accountId, conversationId)`, przetrwa restart karty/przeglądarki i jest usuwany przy wylogowaniu. Nie ma wysyłki offline. `typing` wygasa po 3 s i jest wysyłany najwyżej raz na sekundę. `read` zapisuje się po widoczności wiadomości przez około 500 ms. Docelowe p95 dostarczenia realtime wynosi maksymalnie 2 s.
- **D-09 — rozstrzygnięte dla etapu startowego 23.10.2026:** development/preview używa hostów dostawcy, bez zakupu domeny. Darmowy [Render](https://render.com/docs/free) może służyć wyłącznie do krótkotrwałych preview; darmowa baza Render nie jest produkcyjna (usypianie usługi, efemeryczny dysk, baza wygasa po 30 dniach i nie ma backupów). Media przechowuje się w [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/), a DNS/TLS obsługuje Cloudflare. Produkcja przechodzi na zarządzany kontener Node, zarządzany PostgreSQL z backupami/PITR i pocztę transakcyjną, gdy preview ma zostać użyte przez klientów. Faktyczna domena produkcyjna pozostaje do wpisania przez właściciela; nie używać domen `.example` jako konfiguracji. [Macierz i bramki wyceny](contracts/environments-hosts-operations.md) doprecyzowują wykonanie, nie zatwierdzają płatnego planu.
- **D-10 — rozstrzygnięte 23.10.2026:** RPO 24 h, RTO 4 h, backup DB/mediów codziennie z retencją 30 dni, logi bezpieczeństwa/audyt 365 dni, zwykłe logi aplikacyjne 30 dni. Właściciel/operator odpowiada za procedurę restore i jej okresowy test. [Runbook odbioru](contracts/environments-hosts-operations.md) rozróżnia wymagany cel od faktycznie zmierzonego odtworzenia.
- **D-11 — rozstrzygnięte 23.10.2026:** po wygaśnięciu usługi konto i panel pozostają aktywne, a panel pokazuje: „Konto aktywne. Publiczna oferta jest obecnie wyłączona. Skontaktuj się z Autervą w sprawie uruchomienia okresu usługi.” Flota i czat pozostają dostępne. [Przykład aktywacji po opłacie](contracts/service-periods-kpi-reminders.md).
- **D-12 — projekt a kod:** [ADR-0002](adr/0002-version-validation.md) zamknięto dla wyboru przypiętych wersji i lokalnej próby zgodności Next.js, PostgreSQL, auth/MFA, izolacji A/B, WebSocket i produkcyjnego builda PWA. Minimalny scaffold oraz fixture testowe nie są implementacją pełnych modułów produktu, CI ani wdrożenia; ograniczenia i komendy są w ADR i README. Historyczny demonstrator nie jest źródłem wersji.
- **D-13 — mapowanie Penpota:** 7 nieodnalezionych odwołań do boardów OVR-14/15/17 oraz 52 puste cele interakcji; dokładny wykaz w załączniku A architektury. Nie oznacza to usunięcia tych funkcji z wymagań.
- **D-14 — rozstrzygnięte 23.10.2026:** firma jest publiczna, jeśli ma ważny trial lub ważny okres opłacony. Przy obu okresach główny stan pokazuje „opłacono do”; firma jest liczona tylko raz w KPI, a przypomnienia dotyczą okresu wyznaczającego faktyczną datę wygaśnięcia. Wygaśnięcie trialu nie odcina ważnej opłaty. [Reguła efektywnej granicy](contracts/service-periods-kpi-reminders.md).
- **D-15 — nazwa typu blokady:** B1, komponenty i traceability używają `MAINTENANCE`, natomiast `SERVICE` było rozbieżną etykietą historycznego scenariusza makiety (dawny handoff ekranów, usunięty z repozytorium). Kanoniczny typ domenowy to `MAINTENANCE`, etykieta UI „Serwis”; nie dodawać drugiego typu tylko z powodu makiety.

#### Decyzje właściciela z 27.10.2026

Rozstrzygają pytania zebrane podczas CR/QA Stage 3. Gdy decyzja zmienia zachowanie, wskazane issue zmienia kod i kontrakt razem; do tego czasu kontrakt opisuje stan bieżący.

- **D-16 — środowiska (#90, #10):** CI (GitHub Actions z pełnymi bramkami), ochrona `main` i darmowe krótkotrwałe preview powstają w #10 bez czekania na budżet. Płatny staging i produkcja wymagają osobnej zgody właściciela na wariant i budżet w #90 przed pierwszym zakupem; #90 nie blokuje #10.
- **D-17 — materiały (#81, #6):** materiały Autervy i pierwszej firmy pochodzą z Penpota; czego tam nie ma, Frontend generuje zgodnie z PRD 3.1 i makietami (teksty, kategorie, meta/alt, robocze dokumenty prawne, syntetyczne zdjęcia/logo). Matryca #81 oznacza źródło każdego elementu („Penpot” / „wygenerowane wg PRD”). Wygenerowane elementy mogą być używane w implementacji, fixture i preview; akceptacja do publikacji pozostaje według kryteriów #81. Bez fikcyjnych opinii, wyników, rezerwacji i płatności. Publikacja produkcyjna wymaga osobnej zgody na wdrożenie.
- **D-18 — domena:** na razie, bez zakupu, używana jest darmowa domena; docelową domenę właściciel może wskazać później. Uzupełnia D-09 i nie zmienia jeszcze [kontraktu środowisk](contracts/environments-hosts-operations.md). Wybrana strefa musi obsłużyć hosty marketingu, `app`, paneli i publicznych aliasów oraz wildcard z D-26; jeśli darmowy wariant tego nie zapewnia albo wymaga płatnego certyfikatu, decyzja wraca do właściciela (#90).
- **D-19 — budżet odczytu superadmina (#150):** jeden klucz `api:read:{actor}:platform` niezależnie od firmy, w której kontekście pracuje superadmin; prywatny kalendarz dostępności używa tego samego klucza. Pobieranie zdjęć w panelu i preview ma osobny, konfigurowalny budżet żądań (jednostkę ustala #150). Zmienia [kontrakt D-04/D-05](contracts/technical-limits-and-mfa-bootstrap.md) w #150.
- **D-20 — preview (#46):** katalog i strona główna podglądu pokazują tylko `PUBLISHED`; szkic i ukryty pojazd mają podgląd pojedynczego pojazdu; zarchiwizowany pojazd nie ma podglądu. [Kontrakt preview](contracts/preview.md).
- **D-21 — blokady archiwalnego pojazdu (#38):** dodanie i edycja dają `409 BLOCK_VEHICLE_ARCHIVED`; usunięcie jest dozwolone i audytowane. [Kontrakt blokad](contracts/availability-blocks.md).
- **D-22 — media publiczne firmy (#30):** logo 1 (nowe zastępuje poprzednie), hero do 5, zdjęcia marki do 12, `featuredVehicleCount` 0–12.
- **D-23 — zarchiwizowana firma (#151):** superadmin w jej kontekście zapisuje ustawienia, media publiczne, flotę, zdjęcia i blokady, z audytem wskazującym archiwum. Czat pozostaje tylko do odczytu (`409 CHAT_ORGANIZATION_ARCHIVED`). Administrator nadal nie loguje się, strona publiczna pozostaje wyłączona. Zastępuje regułę odmowy zapisu w archiwum w kontraktach wymienionych w #151 (m.in. [flota](contracts/fleet-crud-publication.md), [media](contracts/media-upload-processing.md), [archiwizacja](contracts/company-archive-restore.md)).
- **D-24 — przypomnienia (#54):** brak administratora z MFA lub aktywnego hosta panelu w chwili slotu kończy intencję jako `SKIPPED` bez ponowień; doręczenie zapisuje status intencji/zadania, nie `AuditLog`; okno ponowień przy częściowej awarii wynosi około 3 h. [Kontrakt przypomnień](contracts/service-reminders.md).
- **D-25 — publiczne SEO i ruch (#40, #154):** limity 120/min/IP dla oferty i 600/min/IP dla mediów, konfigurowalne i weryfikowane w teście obciążenia; schema.org `AutoRental` oraz `["Product","Car"]` bez `offers`; `noindex` dla list z filtrem/sortem/kursorem, pustej oferty i stron prawnych bez tekstu; panele, API i preview pozostają `noindex`. Media publiczne są indeksowane (bez `X-Robots-Tag`), a host marketingu ma `robots.txt` i `sitemap.xml` — realizuje #154. [Kontrakt SEO](contracts/public-offer-seo.md).
- **D-26 — hosty nowej firmy (#152):** host panelu i publiczny alias pod domenami Autervy są aktywne od prerejestracji; operator zapewnia wildcard DNS/TLS obu baz. Aktywny alias nie publikuje oferty: strona publiczna działa tylko w ważnym trialu lub okresie opłaconym i bez archiwum. Domena własna klienta nadal wymaga weryfikacji i jawnej aktywacji (#23). Zmienia [kontrakt prerejestracji](contracts/company-onboarding-invitations.md) i [kontrakt środowisk](contracts/environments-hosts-operations.md) w #152.
- **D-27 — przekierowanie sluga (#153):** zmiana sluga opublikowanego pojazdu zapisuje przekierowanie 308 ze starego adresu (FR-ADM-035 w MVP).

#### Decyzje właściciela z 28.10.2026

- **D-28 — profil i budżet (#90):** profil z planu w [#90](https://github.com/KarolR2001/Auterva/issues/90) (m.in. 2 firmy po 100 pojazdów i 100 000 okresów, 100 000 odsłon/mies., szczyt 25 żądań/s przez 15 minut, 20 połączeń WS) jest przyjęty jako testowy. Bez zakupów: brak zgody na płatny staging i produkcję. #90 i zadania od niego zależne czekają na osobną zgodę (D-16); prace lokalne trwają.
- **D-29 — kontrole bez GitHub Actions (#10):** workflow „CI” pozostaje wyłączony przez właściciela. Do jego ponownego włączenia ten sam zestaw kontroli co joby `.github/workflows/ci.yml` (m.in. `prisma validate`, lint, typecheck, unit, integracja z bootstrapem, build, E2E, audyt zależności, skan sekretów i budowa czterech obrazów) wykonuje się lokalnie, z lokalnym środowiskiem kontenerów (np. Colima), na drzewie zawierającym aktualny `main`, przed merge; wynik z SHA trafia do PR. Procedura: [CI, tryb lokalny](development/CI.md#tryb-lokalny-d-29). Zmienia D-16 w części CI; zestaw kontroli się nie zmniejsza.
- **D-30 — retencja podstawy odblokowania (#183):** wyjątek od retencji 365 dni (D-10): najnowszy wpis `COMPANY_RESTORED_FROM_BACKUP` firmy nie jest usuwany po 365 dniach, dopóki konto z jego wykazu pozostaje zablokowane przez restore. Alert `AUDIT_UNLOCK_BASIS_HELD` przypomina operatorowi o przeglądzie. [Kontrakt retencji](contracts/audit-retention-operations.md).
- **D-31 — wielu wykonawców w roli:** w roli Frontend i Backend może pracować równolegle wielu agentów; każdy podejmuje następne gotowe issue według Order i zależności. Jedno issue ma jednego wykonawcę, a każdy wykonawca najwyżej jedno issue w implementacji lub poprawce. Przejęcie cudzego issue odbywa się według zasad przejęcia z [workflow](development/WORKFLOW.md). Limit „najwyżej jedno In progress na rolę” zostaje zniesiony; CR orkiestratora i niezależne QA obowiązują bez zmian.

- **D-32 — najbliższy wolny termin i zbiorcze blokady (#70, opcjonalne, poza obowiązkowym MVP):** właściciel zatwierdził 28.10.2026 rekomendacje P1–P7 z [kontraktu](contracts/availability-nearest-and-bulk-blocks.md): horyzont 180 dni (stała serwera); najbliższy termin publicznie, obliczany na żądanie dla jednego pojazdu, bez wsadu w pierwszym kroku; zapis zbiorczy domyślnie wszystko albo nic z `dryRun`, a częściowy zapis (`SKIP`) tylko jawnie, z dokładną listą zapisanych i odrzuconych aut; najwyżej 50 aut w żądaniu; `internalNote` nie jest kopiowana bez jawnego `copyNote`; kopiowanie z przesunięciem dat (`shiftDays`) w kolejnym kroku, najpierw zbiorcze utworzenie i kopia na te same daty; wymagany `idempotencyKey` (UUID) z receiptem ważnym 24 h. Implementacja w osobnych zadaniach API i FE; nowe stany UI wymagają makiety Penpota przed kodem. Bez rezerwacji online i zapisu offline.

#### Decyzje właściciela z 10.11.2026

- **D-28 — potwierdzenie (#90):** nadal bez zakupu płatnego stagingu i produkcji; prace lokalne trwają.
- **D-33 — rotacja TOTP (#254):** samodzielna rotacja TOTP w pełnej sesji nie wchodzi do MVP 3.1. Obecne ścieżki to kody odzyskania i odzyskanie przez superadmina.
- **D-34 — obszar odbioru (#257):** „Obszar odbioru” i obszar działania są usunięte z makiety PUB-04; adres i mapa (D-03) wystarczają. Bez nowych pól.
- **D-35 — galeria na home (#209):** galeria redakcyjna jest usunięta z makiety PUB-01; strona główna pokazuje logo, hero, wyróżnione pojazdy i katalog. DTO bez zmian.
- **D-36 — dokumenty prawne (#232):** w PUB-05/06 konwencja `## ` w treści plain text daje numerowane nagłówki i spis treści (z escapowaniem, bez HTML). Datę aktualizacji ustawia serwer, a strona pokazuje publiczne „Ostatnia aktualizacja” (#325). Eyebrow i lead są stałe; link powrotny do pojazdu działa przez `?vehicle`.
- **D-37 — hasło (#240):** serwer egzekwuje wyłącznie długość 12–256 (#22); wielka litera, cyfra i znak specjalny są zalecane, nie blokujące (#252). Makieta do dostosowania.
- **D-38 — opis okresu próbnego (#297):** ekrany opisują trial jako „14 dni”; logika bez zmian: dokładnie 336 h od rejestracji administratora (U4) (#326).
- **D-39 — TEN-04 (#297):** wiersz „Konto administratora” jest usunięty z makiety TEN-04.
- **D-40 — eksport kalendarza i danych firmy (#79, opcjonalne, COULD):** właściciel zatwierdził 10.11.2026 rekomendacje E1–E7, E9 i E11–E14 z [kontraktu](contracts/calendar-and-company-export.md). E8: okno eksportu na prośbę po archiwizacji lub zakończeniu współpracy wynosi **30 dni**. E10: prywatny feed **nigdy** nie zawiera typu blokady. Kolejność: prywatny feed (#327), potem eksport (#328). Nowe stany UI wymagają makiety Penpota przed kodem.
- **D-41 — dane kontaktowe przy tworzeniu firmy (PLT-04, #334, #335):** formularz „Dodaj firmę” ma opcjonalne pola kontaktu (telefon, publiczny e-mail, adres), zapisywane do ustawień firmy w tej samej transakcji co firma. Makieta zostaje; Backend i Frontend rozszerzają aplikację.
- **D-42 — lista pojazdów (ADM-05, #336, #337):** filtry „Kategoria” i „Ostatnia zmiana”, podsumowanie statusów w nagłówku oraz mobilny układ „Edytuj · Terminy · Więcej” z „Filtry/Sortuj” trafiają do API i aplikacji. Makieta zostaje.
- **D-43 — sesje superadmina (PLT-10):** rządzi [kontrakt #72](contracts/account-operations.md): superadmin widzi i kończy swoje sesje. [Handoff konta platformy](../design/handoff/platform-account.md) opisuje kartę/link do sesji; makieta do dostosowania.
- **D-44 — termin na PUB-03 (#338):** z aplikacji znikają pola dat „Od/Do” i stan „Minął” w legendzie; termin wybiera się wyłącznie w kalendarzu. [SPEC](design/SPEC.md) dostosowany.
- **D-45 — siła hasła (#339):** miernik „Siła hasła” (słabe/średnie/silne) pozostaje w makietach i trafia do formularzy hasła w aplikacji; jest informacyjny i nie blokuje zapisu (D-37).
- **D-46 — checklista hasła:** osobna zalecana pozycja „Małe i wielkie litery”; makiety do dostosowania.
- **D-47 — zakres prywatnego feedu (#327):** prywatny feed iCal obejmuje wyłącznie pojazdy `PUBLISHED`; szkice, nieopublikowane i zarchiwizowane są pominięte. Zob. [kontrakt](contracts/calendar-and-company-export.md).
- **D-48 — wejście do zbiorczego blokowania (#217):** w nagłówku kalendarza floty (ADM-10) obok „Szybka blokada” jest przycisk „Blokada zbiorcza”, a w szczegółach pojedynczej blokady akcja „Kopiuj na inne auta” (te same daty). Stany zbiorczego blokowania są w makietach (ADM-10 `state=bulk-*`); wejścia dorysuje agent Penpota. Zob. [kontrakt](contracts/availability-nearest-and-bulk-blocks.md).
- **D-49 — ekran „Kalendarz zewnętrzny” (ADM-22, #355):** ekran jest pozycją w nawigacji Ustawień firmy. Zawiera objaśnienie, że Kalendarz Google odświeża subskrypcję co kilka godzin, Apple co 5–60 minut, a o dostępności rozstrzyga panel. Zob. [wdrożenie feedu](contracts/calendar-feed-implementation.md).
- **D-50 — „Ostatnia zmiana” na liście pojazdów (ADM-05, #337, doprecyzowanie D-42):** przycisk sortowania jak w makiecie — „Ostatnia zmiana ↓” przełącza kolejność (najnowsze / najstarsze), bez pól dat w pasku narzędzi; pasek w jednym rzędzie. Parametry API `updatedFrom/updatedTo` z #336 pozostają, bez UI.

## 10. Co warto dodać — propozycje, poza obowiązkowym zakresem

- **Najpierw: kontrola jakości oferty.** Lista brakujących zdjęć/opisów/kontaktu i przypomnienie o weryfikacji dostępności. Rozwija opcjonalny FR-ADM-011 i ogranicza błędne zapytania klientów.
- **Najpierw: diagnostyka uruchomienia firmy.** Na karcie firmy czytelne przyczyny problemów DNS/TLS i niedostarczenia zaproszenia/przypomnienia; dane techniczne wyłącznie dla operatora. Rozwija istniejące statusy, bez nowego panelu integracji.
- **Następnie: najbliższy wolny termin.** Po negatywnym sprawdzeniu pokazać kolejny dostępny zakres z ustalonym horyzontem; nadal wyłącznie informacja i kontakt. Alternatywne dostępne pojazdy są już częścią bazowego flow.
- **Następnie: kopiowanie i zbiorcze blokowanie aut.** Przydatne przy serwisie/urlopie; podsumowanie konfliktów i jednoznaczna polityka częściowego zapisu przed wdrożeniem.
- **Następnie: eksport kalendarza oraz danych firmy.** Ułatwia pracę poza Autervą i przenoszenie danych; osobne zakresy publiczne/prywatne, kontrola uprawnień i termin ważności linku. Discovery #79 zatwierdzone jako D-40 ([kontrakt](contracts/calendar-and-company-export.md)).
- **Później: dodatkowy język publicznej oferty.** Korzysta z przygotowanej lokalizacji; wymaga tłumaczeń rzeczywistych treści i SEO, bez przebudowy paneli.
- Rezerwacje online, płatności, CRM i zespoły wymagają osobnej decyzji produktowej; nie są drobnym dodatkiem do obecnego modelu.

## 11. Kryterium kompletności dokumentacji i następny odbiór

- Analiza źródłowa objęła pięć plików PRD, z czterema różnymi treściami. Repozytorium zachowuje kanoniczny V31 i BASELINE_FLEET; historia V2/V30 nie jest zależnością implementacji. Zachowane i wycofane wymagania są rozliczone w tym dokumencie.
- Katalog zachowuje 71 identyfikatorów bazowych FR, 10 UC, 4 NFR-PERF oraz odniesienia do 31 REQ-MVP i 55 scenariuszy TEST-MVP z V31 §20. Scenariusze testowe są planem odbioru, nie wynikami testów.
- Pełne pokrycie katalogu nie oznacza gotowości wszystkich kontraktów do implementacji: D-12, D-13 i D-15 pozostają ustaleniami projektowymi i mapowaniem. D-01–D-11 i D-14 mają rozstrzygnięcie z 23.10.2026, D-16–D-27 z 27.10.2026, D-28–D-32 z 28.10.2026, a D-33–D-50 (oraz potwierdzenie D-28) z 10.11.2026.
- Dla każdego wdrażanego przekroju uzupełnić mapowanie wymaganie → board Penpota → kod → trwały test w `design/traceability.json`. Aktualny dokument nie dopisuje fikcyjnych ścieżek kodu ani zaliczonych testów.
- Odbiór aplikacji wymaga [quality gates](quality-gates.md), w tym rzeczywistego PostgreSQL, izolacji firm, współbieżności, MFA, poczty, WebSocket, hostów i PWA production build.
