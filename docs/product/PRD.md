> **Kanoniczny PRD projektu — MVP 3.1 z superadminem.** Przeniesiony 22.10.2026 z pliku `Auterva_PRD_MVP_Uproszczony_v3_1.md`. Poniżej preambuły zachowano niezmienioną treść źródłową; jej historyczne nazwy plików nie oznaczają dodatkowych aktualnych źródeł.

## Pierwszeństwo i aktualne lokalizacje

- Zakres produktu określają nowsze zatwierdzone odpowiedzi **U3/U4, §5.2A–5.4**, następnie niesprzeczne P/B. Aktualny produkt obejmuje superadmina i wiele odseparowanych firm.
- Niezmienione reguły floty, dat, zdjęć, jakości i bazowe FR/UC: [BASELINE_FLEET.md](BASELINE_FLEET.md). Dawne założenia single-tenant, liczby administratorów i opcjonalnego MFA są historyczne.
- Kontrakt wyglądu i zatwierdzone decyzje designu: [SPEC](../design/SPEC.md). Synteza obowiązujących wymagań i jawne rozbieżności: [WYMAGANIA_AUTERVA.md](../WYMAGANIA_AUTERVA.md). Projekt technologiczny i rzeczywiste ID Penpota: [ARCHITEKTURA_AUTERVA.md](../ARCHITEKTURA_AUTERVA.md).
- Wcześniejsze `Auterva_PRD_MVP_Uproszczony_v3_ROBOCZY.md` i `Auterva_PRD_SaaS_Multi_Tenant_v2.md` są materiałami historycznymi poza repozytorium, nie zależnościami implementacji.
- Znane pozostałości źródłowe rozstrzygają U3/U4: publiczny trial trwa 336 godzin; czat ma WebSocket, typing i read; kolory pozostają wspólne. Sprzeczne akapity §8.6, §11.2/15.9 i §16.3 nie zmieniają tych zatwierdzeń. Trial wymaga uprzedniego przyznania przez superadmina.
- Pozostałe niejednoznaczności, w tym macierz pól edytowanych przez firmę i przejście trial→paid, pozostają jawnie w rejestrze D dokumentu wymagań. Nie wybierać wariantu na podstawie starego fragmentu.
- Historyczne instrukcje przenosin i projektowania w §21–24 opisują powstanie dokumentu. Aktualna ścieżka tego źródła to `docs/product/PRD.md`; repozytorium zawiera dokumentację i kontrakty designu, bez aplikacji, manifestu zależności i lockfile.
- Pochodzenie i hashe źródła oraz dokumentu z preambułą: [source-provenance.json](../source-provenance.json).

---

# Auterva — PRD 3.1: uproszczony SaaS z obsługą przez superadmina

> **Wersja:** 3.1 — aktualizacja po odpowiedziach i zatwierdzeniu rekomendacji właściciela.  
> **Data opracowania wersji bazowej:** 12 października 2026 r.  
> **Data aktualizacji dokumentu:** 12 października 2026 r.  
> **Zakres:** cztery obszary produktu, ręczne uruchamianie firm, opłacony okres publicznej widoczności, trial 14 dni, oferta pojazdów i czat z Autervą.  
> **Cel dokumentu:** zastąpić zbyt rozbudowany zakres PRD SaaS 2.0 i wskazać dokładne poprawki istniejących makiet.  
> **Nie jest to:** potwierdzenie wykonania kodu ani testów działającej aplikacji.

**Najważniejsza zmiana:** Auterva ma być prosta funkcjonalnie. Firma kontaktuje się telefonicznie z Autervą, otrzymuje prezentację wyglądu, akceptuje ją poza procesem aplikacyjnym, a superadmin przygotowuje firmę, publiczne logo/dane/treści/zdjęcia, okres usługi i wysyła zaproszenie e-mailem. Firma samodzielnie zarządza ofertą i ręcznymi blokadami terminów. Wszystkie rozliczenia pozostają poza aplikacją.

**Status dokumentu:** odpowiedzi właściciela oraz siedem uzupełniających rekomendacji zostały włączone do wymagań, zachowania ekranów, modelu danych, przepływów i testów. Koniec opłaconego okresu wyłącza publiczną ofertę i wszystkie jej adresy, **nie ogranicza jednak dotychczasowych funkcji konta administratora firmy**. Firmę można archiwizować, nie trwale usuwać przez panel.

**Granica pracy:** dokument określa wymagania produktu, a rzeczywiste identyfikatory i wynik inspekcji makiet są utrzymywane w `design/traceability.json` oraz dokumentach handoff. Nie jest to dowód działania backendu, autoryzacji, poczty, DNS, TLS ani WebSocketów.

## Spis treści

1. [Źródła i znaczenie oznaczeń](#s01)
2. [Potwierdzony zakres](#s02)
3. [Cztery obszary i adresy](#s03)
4. [Co usuwamy z pierwszego zakresu SaaS 2.0](#s04)
5. [Zatwierdzone odpowiedzi właściciela](#s05)
6. [Role i granice dostępu](#s06)
7. [Proces od rozmowy do uruchomienia firmy](#s07)
8. [Opłacony okres, trial i widoczność](#s08)
9. [Panel superadmina — pola i operacje](#s09)
10. [Panel firmy — najważniejsze zmiany](#s10)
11. [Czat firmy z Autervą](#s11)
12. [Onepage Autervy i publiczna oferta firmy](#s12)
13. [Zmiany wszystkich istniejących ekranów i overlayów](#s13)
14. [Co zrobić z makietami rozszerzenia SaaS 2.0](#s14)
15. [Specyfikacja widoków rozszerzenia](#s15)
16. [Komponenty, kolorystyka i responsywność](#s16)
17. [Prosta architektura i model danych](#s17)
18. [Zabezpieczenia i kryteria techniczne](#s18)
19. [Przepływy do połączenia w prototypie](#s19)
20. [Testy i kryteria akceptacji](#s20)
21. [Jak edytować istniejący projekt w Penpocie](#s21)
22. [Kolejność realizacji i warunki odbioru](#s22)
23. [Instrukcja dla agenta i dokumentacji repozytorium](#s23)
24. [Źródła, zakres aktualizacji i karta dalszych decyzji](#s24)

<a id="s01"></a>
## 1. Źródła i znaczenie oznaczeń

### 1.1. Podstawa

- **[U1]** opis uproszczonego systemu przekazany przez właściciela: cztery obszary, onboarding przez superadmina, zaproszenie, płatności poza aplikacją, okres usługi, trial i czat.
- **[U2]** dziewięć odpowiedzi właściciela uzupełniających [U1]: wygaśnięcie, koniec dnia, start trialu, jedno konto na firmę, publiczny branding, domena zastępcza i automatyczna publikacja, czat tekstowy, pełna obsługa firmy przez superadmina oraz archiwizacja.
- **[U3]** odpowiedzi właściciela z 12 października 2026 r. doprecyzowujące
  koniec trialu, pojedynczy trial, unikalność e-maila, brak przyszłej daty
  startu, automatyczne wznowienie, realtime czatu, skutki archiwizacji,
  statystyki, kanały kontaktu i PWA.
- **[U4]** zatwierdzenie rekomendacji z 12 października 2026 r.: 336 godzin
  trialu, uproszczony white-label bez własnych kolorów, kontrakt domen,
  szkic per rozmowa, brak purge w MVP, ważność zaproszenia/MFA oraz
  harmonogram przypomnień.
- **[U]** łącznie [U1], [U2], [U3] i [U4]; w kwestiach doprecyzowanych nowsza
  odpowiedź właściciela ma pierwszeństwo.
- **[B1]** `PRD_system_wynajmu_pojazdow(3).md`, wewnętrzna wersja 1.0 — funkcje floty, dostępności, panelu i zabezpieczeń.
- **[B2]** `Auterva_specyfikacja_makiet_i_design_system(2).md`, wewnętrzna wersja 1.0 — istniejący katalog ekranów, komponentów i stanów.
- **[B3]** `Auterva_PRD_SaaS_Multi_Tenant_v2.md` — poprzednia, szersza propozycja SaaS; materiał porównawczy, nie źródło automatycznie obowiązujących nowych funkcji.
- **[W1]–[W6]** dokumentacja techniczna w rozdziale 24 — uzasadnia zabezpieczenia, nie rozstrzyga decyzji biznesowych.

### 1.2. Statusy zapisów

| Oznaczenie | Znaczenie | Co wolno zrobić |
|---|---|---|
| **P — potwierdzone** | Wynika wprost z [U] | Uwzględnić w zakresie i projekcie |
| **B — zachowane z bazy** | Obecne wymaganie [B1]/[B2], niesprzeczne z [U] | Zachować dotychczasową funkcję i jej priorytet |
| **R — rekomendacja** | Nowa propozycja sposobu realizacji, układu lub uproszczenia | Przedstawić jako propozycję; nie traktować jako decyzji właściciela |
| **Q — do potwierdzenia** | Brakuje rozstrzygnięcia wpływającego na działanie | Zadać wskazane pytanie; nie wybierać wariantu samodzielnie |
| **T — zabezpieczenie techniczne** | Proponowany sposób spełnienia żądanej ochrony danych | Zaprojektować zabezpieczenie; nie deklarować, że zostało wdrożone/testowane |

Szczegółowe kompozycje ekranów, proponowane nowe nazwy pól, ścieżki i wewnętrzne modele są **R**, chyba że zapis ma oznaczenie P lub B. Pozwala to opisać kompletny projekt do oceny bez dopisywania właścicielowi decyzji, których nie podjął.

Potwierdzenie jednego pytania nie zatwierdza pozostałych rekomendacji. Nie ma domyślnego „tak” przez brak odpowiedzi.

### 1.3. Pierwszeństwo i zachowanie plików

Aktualne wymagania [U] zastępują sprzeczne propozycje [B3]. Nie odwracamy znaczenia hostów do wariantu z PRD 2.0. Nie włączamy jego samoobsługi, pakietów, rozliczeń, zespołów i przełączania organizacji tylko dlatego, że były opisane wcześniej.

Niezmienione zasady pojazdów, dat, galerii, bezpieczeństwa i dostępności cyfrowej pozostają w [B1]/[B2]. Ich uproszczenie wymaga jawnej decyzji, a nie cichego usunięcia.

Oryginał `Auterva_PRD_MVP_Uproszczony_v3_ROBOCZY.md` pozostaje niezmieniony jako wersja historyczna. Proponowane miejsce aktualnej wersji w repozytorium: `docs/product/PRD_MVP_Uproszczony_v3_1.md`. Nie wolno traktować Q-03A, Q-05A, Q-06A/B, Q-08A, Q-10B, Q-14 ani Q-15 jako nadal nierozstrzygniętych tylko dlatego, że zachowano ich historyczne identyfikatory.

<a id="s02"></a>
## 2. Potwierdzony zakres

### 2.1. Wymagania bez dopowiadania

| ID | Wymaganie P wynikające z [U] |
|---|---|
| REQ-MVP-01 | Publiczny onepage Autervy przedstawia system dla firm wynajmujących pojazdy, korzyści i sposób kontaktu. |
| REQ-MVP-02 | Superadmin ma osobny panel obejmujący firmy, dodawanie, edycję, archiwizację zamiast trwałego usuwania oraz statystyki. Pełna obsługa floty konkretnej firmy jest zagnieżdżona pod jej kartą. |
| REQ-MVP-03 | Administrator firmy loguje się na dedykowanej subdomenie tej firmy. |
| REQ-MVP-04 | Publiczna oferta firmy jest dostępna bez logowania pod jej publiczną domeną. |
| REQ-MVP-05 | Firma zarządza pojazdami i własnymi danymi. |
| REQ-MVP-06 | Odwiedzający przegląda ofertę i dostępność; nie zakłada konta, nie płaci i nie rezerwuje w aplikacji. |
| REQ-MVP-07 | Rezerwacja jest uzgadniana telefonicznie, a firma ręcznie oznacza zajęte terminy. |
| REQ-MVP-08 | Potencjalny klient Autervy kontaktuje się początkowo telefonicznie. |
| REQ-MVP-09 | Wygląd komponentów jest przedstawiany firmie przed dodaniem jej do systemu; uruchamianie następuje po akceptacji. |
| REQ-MVP-10 | Superadmin wykonuje prerejestrację i przygotowuje publiczne logo, dane, treści oraz zdjęcia firmy. |
| REQ-MVP-11 | Superadmin wysyła do firmy zaproszenie e-mailem. |
| REQ-MVP-12 | Wszystkie płatności początkowo odbywają się poza systemem. |
| REQ-MVP-13 | Superadmin określa opłacony okres publicznego działania i widoczności firmy. Po jego końcu panel administratora zachowuje dotychczasowe funkcje, a cała strona publiczna jest wyłączona. |
| REQ-MVP-14 | Administrator widzi, do którego dnia włącznie usługa jest opłacona, oraz osobny aktualny stan publicznej strony. |
| REQ-MVP-15 | Superadmin ma możliwość nadania trialu na 14 dni. |
| REQ-MVP-16 | Administrator firmy ma możliwość kontaktu przez czat z superadminem Autervy. |
| REQ-MVP-17 | Dane poszczególnych firm oraz dane Autervy muszą być odpowiednio chronione i odseparowane. |
| REQ-MVP-18 | Należy rozszerzyć i uprościć istniejące makiety Penpota, a nie tworzyć niezależny produkt od zera. |

### 2.2. Co pozostaje z istniejącego produktu

**B:** lista i szczegóły pojazdów, zdjęcia, filtr terminów, publiczny kalendarz, szkice i publikacja pojazdów, ręczne blokady, ustawienia firmy, kontrola dostępu, responsywność, stany błędów oraz ochrona prywatnych powodów blokady.

**B:** daty wynajmu są całodniowe; końcowy dzień wlicza się do zakresu. **P [U2/U4]:** data „opłacono do” również obejmuje cały wskazany dzień, w projektowej strefie `Europe/Warsaw`. Trial rozpoczyna się przy pierwszym skutecznym zakończeniu rejestracji administratora przez zaproszenie i trwa dokładnie 336 godzin.

**B:** niekompletny pojazd można zapisać jako szkic. Widoczność pojazdu w ofercie wymaga spełnienia dotychczasowych warunków publikacji.

**B:** dostępność ma charakter informacyjny i wymaga potwierdzenia przez właściciela. Nie powstaje nowa encja rezerwacji ani klienta wynajmu.

### 2.3. Czego nie nazywać rozbudową SaaS w tym MVP

Wielu klientów biznesowych nie oznacza od razu marketplace’u, edytora stron, samoobsługowego zakupu, rozbudowanych ról, automatycznego fakturowania i rozliczania każdej sztuki pojazdu. Funkcje komercyjne w pierwszym wydaniu ograniczają się do zarządzania firmą, jej konfiguracją, czasem usługi i kontaktem z Autervą.

### 2.4. Doprecyzowania potwierdzone w wersji 3.1

| ID | Decyzja P wynikająca z [U2] |
|---|---|
| REQ-MVP-19 | Po końcu opłaconego okresu cała publiczna oferta i wszystkie publiczne ścieżki firmy są wyłączone. Administrator nadal może korzystać z dotychczasowych funkcji konta, w tym zarządzać flotą i pisać do Autervy. Panel pokazuje wyraźny komunikat o niewidoczności strony. |
| REQ-MVP-20 | „Opłacono do [data]” obejmuje cały wskazany dzień. Wygaśnięcie następuje dopiero po jego zakończeniu. |
| REQ-MVP-21 | Trial trwa dokładnie 336 godzin od pierwszego skutecznego zarejestrowania administratora przez link z e-maila. Publiczna strona działa podczas trialu. |
| REQ-MVP-22 | Każda firma ma jedno konto administratora, bez dodatkowych kont i bez przełączania firm. Druga firma oznacza odrębny proces nowego klienta Autervy. |
| REQ-MVP-23 | Wyłącznie superadmin zmienia publiczne logo, dane, treści i zdjęcia firmy. Kolory, ikony, czcionki oraz wygląd panelu pozostają wspólne i niezmienne. Akceptacja materiałów odbywa się poza aplikacją. |
| REQ-MVP-24 | Firma bez własnej domeny korzysta z adresu `{slug}.{publicDomainAutervy}`, odrębnego od hosta panelu. Własną domenę kupuje klient; Auterva zapewnia instrukcję DNS, walidację routingu i TLS oraz przekierowanie adresu testowego po aktywacji domeny własnej. |
| REQ-MVP-25 | Skuteczna rejestracja administratora z zaproszenia automatycznie uruchamia publikację publicznej strony, z uwzględnieniem okresu usługi i warunkowej decyzji o trialu. Brak opublikowanych pojazdów nie blokuje publikacji strony; pokazuje ona estetyczną zapowiedź przyszłej oferty. |
| REQ-MVP-26 | Czat firma–Auterva jest tekstowy, bez załączników i bez e-mailowych powiadomień o wiadomościach. Nowe wiadomości są sygnalizowane wewnątrz panelu, np. kropką przy sekcji czatu. |
| REQ-MVP-27 | Superadmin może przeglądać, dodawać, edytować i wykonywać dozwolone operacje usuwania danych operacyjnych każdej firmy. Dostęp jest zagnieżdżony pod kartą wybranej firmy; nie rozbudowuje głównego menu o flotę wszystkich klientów. Archiwizacja firmy, ochrona sekretów i audyt nadal obowiązują. |
| REQ-MVP-28 | Firmy nie są trwale usuwane przez panel. Archiwizacja zachowuje ich dane, a superadmin domyślnie widzi firmy niezarchiwizowane; opcja „Pokaż zarchiwizowane” ujawnia również archiwum. |
| REQ-MVP-29 | Niewysłany szkic czatu jest przechowywany lokalnie osobno dla każdej rozmowy, zachowuje się przy przełączaniu firmy i nie wymaga dialogu blokującego. |
| REQ-MVP-30 | Zaproszenie administratora jest jednorazowe i ważne 7 dni. Ponowne wysłanie unieważnia poprzedni niewykorzystany link. MFA jest obowiązkowe dla superadmina i administratora firmy. |
| REQ-MVP-31 | Administrator firmy otrzymuje przypomnienia o końcu trialu lub opłaconego okresu w panelu i e-mailem 7 dni wcześniej, 1 dzień wcześniej oraz w dniu wygaśnięcia. |

<a id="s03"></a>
## 3. Cztery obszary i adresy

### 3.1. Podział potwierdzony

Adresy zachowują znaczenie podane przez właściciela. Są przykładami, nie potwierdzeniem zakupu domen, konfiguracji DNS czy TLS.

| Obszar | Przykładowy host z wymagań | Odbiorca | Dostęp |
|---|---|---|---|
| Onepage Autervy | `auterva.example` | Wypożyczalnie zainteresowane systemem | Publiczny |
| Panel superadmina | `app.auterva.example` | Superadmin Autervy | Uwierzytelniony; brak dostępu adminów firm |
| Panel konkretnej firmy | `alfa.sites.auterva.example` | Administrator firmy Alfa | Uwierzytelniony, tylko dane Alfy |
| Oferta konkretnej firmy | `wynejem-alfa.example` albo publiczna domena testowa Autervy | Potencjalny najemca pojazdu | Publiczny, bez kont, w okresie publicznej widoczności |

`wynejem-alfa.example` zachowuje pisownię przykładu użytkownika. Docelowe adresy należy ustalić przed wdrożeniem. Nie należy wyszukiwać ani rejestrować tych nazw w ramach pracy nad PRD.

**Nie zamieniać ról:** w tym wariancie `alfa.sites.auterva.example` nie jest publiczną stroną firmy, a `app.auterva.example` nie jest wspólnym panelem firm.

**P [U2/U4]:** gdy firma nie ma własnej domeny, Auterva uruchamia jej ofertę pod `{slug}.{publicDomainAutervy}`. Jest to faktyczny publiczny adres firmy, nie host jej panelu, nie baza staging i nie obejście daty opłacenia. Własną domenę kupuje klient. Auterva przekazuje instrukcję DNS, waliduje routing i TLS, a po aktywacji domeny własnej przekierowuje na nią dotychczasowy adres testowy.

### 3.2. Ścieżki minimalizujące zmiany — R

Na hoście firmy można zachować istniejące ścieżki `/admin/login`, `/admin`, `/admin/pojazdy`, `/admin/ustawienia`. Wejście na sam `/` prowadziłoby do właściwego startu panelu, zamiast pokazywać publiczną flotę.

Na hoście superadmina proponujemy `/login`, `/`, `/firmy`, `/firmy/nowa`, `/firmy/[id]`, `/wiadomosci`. To inne trasy i uprawnienia niż istniejący panel floty.

Na domenie publicznej zachowujemy `/`, `/pojazdy`, `/pojazdy/[slug]`, `/kontakt` i istniejące dokumenty prawne. Onepage dotyczy strony **Autervy**, nie narzuca zamiany pełnej oferty wypożyczalni na jeden ekran.

Zaproszenie prowadzi na panel właściwej firmy. Robocza ścieżka: `/admin/zaproszenie/[token]`. Dokładny kontrakt musi wynikać z wybranej implementacji uwierzytelniania.

### 3.3. Dozwolone przejścia

| Początek | Akcja | Wynik |
|---|---|---|
| Onepage Autervy | Kontakt telefoniczny | Rozmowa poza systemem; bez tworzenia konta |
| E-mail zapraszający | Aktywacja | Panel firmy wskazanej w zaproszeniu, nie panel superadmina |
| Panel firmy | „Otwórz ofertę firmy” | Jej domena publiczna, o ile konfiguracja i publikacja są gotowe |
| Publiczna oferta | „Zadzwoń” | Kontakt telefoniczny; bez zapisu rezerwacji |
| Panel firmy | „Czat z Autervą” | Rozmowa dotycząca tej firmy |
| Panel superadmina | Wiadomości firmy | Ta sama rozmowa widziana od strony Autervy |

**R:** onepage nie powinien mieć przycisku „Logowanie do firmy”, który otwiera `app.auterva.example`. Nie istnieje tam panel firmy. Można podać instrukcję „Zaloguj się pod adresem z zaproszenia”; wyszukiwarka firm i centralny login nie zostały zamówione.

### 3.4. Domeny a bezpieczeństwo — T

Host identyfikuje obszar oraz firmę, lecz nie nadaje praw. Serwer musi dodatkowo zweryfikować sesję i przypisanie konta. Nie może ufać `organizationId` przesłanemu przez klienta jako dowodowi uprawnienia.[W1]

Na domenie publicznej nie wystawiamy firmowych endpointów administracyjnych i logowania, także pod przypadkowym `/admin` czy `/api/admin`. Oddzielne hosty muszą prowadzić przez kontrolę obszaru na serwerze, nie tylko różnić się menu.

Sesje powinny być związane z właściwym hostem i obszarem, a nie współdzielone przez `Domain=.auterva.example`. Samo ograniczenie cookie do hosta nie zastępuje serwerowej kontroli sesji i firmy.[W2]

Dla przykładowego `alfa.sites.auterva.example` certyfikat `*.auterva.example` nie pokrywa dodatkowego poziomu. Trzeba zapewnić właściwy certyfikat, np. dla `*.sites.auterva.example` lub konkretnych hostów. To kontrola techniczna, nie wybór dostawcy hostingu.[W6]

<a id="s04"></a>
## 4. Co usuwamy z pierwszego zakresu SaaS 2.0

„Usuwamy z zakresu” oznacza odłączenie od aktywnych prototypów i backlogu MVP. Nie oznacza automatycznego kasowania istniejących makiet lub danych.

| Element [B3] | Zakres po aktualizacji |
|---|---|
| Centralny panel firm pod `app` | Zastąpiony panelami na subdomenach firm |
| Publiczna rejestracja i „Utwórz organizację” | Poza pierwszym wydaniem; firmy tworzy superadmin |
| Samoobsługowy onboarding firmy | Zastąpiony konfiguracją przez superadmina i zaproszeniem |
| Przełącznik organizacji, konto zarządzające wieloma firmami | Wyłączone z MVP: jedna firma ma jednego admina, a jego konto obsługuje tylko tę firmę. Druga firma przechodzi odrębne uruchomienie. |
| OWNER/ADMIN/OPERATOR i samodzielne zarządzanie zespołem | Nie przenosić automatycznie; potwierdzone role to superadmin oraz admin firmy |
| Pakiety START/PRO, uprawnienia zależne od planu | Nie ma zatwierdzonych pakietów; nie projektować ich jako działających |
| Liczniki „10/50 pojazdów w planie” | Nie dodawać fikcyjnych limitów; odróżniać ograniczenia techniczne od handlowych |
| Checkout, Stripe, karty, faktury, portal rozliczeniowy, upgrade/downgrade | Poza systemem w pierwszym wydaniu |
| Własna domena dopiero w S2 | Publiczny adres jest potrzebny od uruchomienia: własna domena albo `{slug}.{publicDomainAutervy}`. Klient kupuje domenę własną; Auterva obsługuje instrukcję DNS, walidację routingu/TLS i przekierowanie po aktywacji. |
| Edytor motywu u klienta | Usunąć: tylko superadmin zmienia publiczne logo, dane, treści i zdjęcia. Kolory, panele, czcionki i ikony nie są personalizowane. |
| Automatyczna 7-dniowa karencja i terminy retencji z PRD 2.0 | Nie przenosić: płatna widoczność kończy się z końcem ostatniego opłaconego dnia, panel działa dalej. Archiwizacja nie uruchamia automatycznego kasowania. |
| Jedna centralna PWA wielu firm | Nie pasuje do nowego układu hostów; PWA pozostaje instalowalne wyłącznie dla panelu firmy zgodnie z Q-13. |
| Rozbudowany system sesji pomocy/impersonation | Nie dodawać: superadmin wykonuje pełną obsługę firmy w zagnieżdżonych widokach pod własną tożsamością, bez logowania jako klient. |
| Oddzielny system ticketów i SLA | Nie został zamówiony; potrzebny jest kontakt przez czat |
| Rezerwacje, płatności najemców, CRM, dokumenty wynajmu | Nadal poza zakresem |

**B/T:** nie usuwamy izolacji danych, kontroli uprawnień, resetu dostępu, audytu działań krytycznych, kopii zapasowych i testów dlatego, że UI jest prostsze. Sam rozbudowany ekran audytu lub eksportu samoobsługowego może być odłożony; zdolność bezpiecznej obsługi danych nie znika.

<a id="s05"></a>
## 5. Zatwierdzone odpowiedzi właściciela

### 5.1. Mapowanie numeracji odpowiedzi

Odpowiedzi zostały przypisane **według znaczenia**, a nie mechanicznie według ostatniego numeru. Właściciel połączył domenę i pierwszą publikację w odpowiedzi oznaczonej Q-06; od tego miejsca numeracja jego odpowiedzi jest przesunięta względem pierwotnego rejestru.

| Pozycja w najnowszej wiadomości | Temat | ID zachowane z PRD 3.0 |
|---|---|---|
| 1 — Q-01 | Koniec opłaconego okresu | Q-01 |
| 2 — Q-02 | Ostatni opłacony dzień | Q-02 |
| 3 — Q-03 | Start i publiczny zakres trialu | Q-03 |
| 4 — Q-04 | Jeden admin i jedna firma | Q-04 |
| 5 — Q-05 | Wyłącznie publiczna personalizacja przez superadmina | Q-05 |
| 6 — Q-06 | Domena testowa oraz publikacja po rejestracji | Q-06 i Q-07 |
| 7 — Q-07 | Czat tekstowy | Q-08 |
| 8 — Q-08 | Pełna obsługa firmy przez superadmina | Q-09 |
| 9 — Q-09 | Archiwizacja zamiast usuwania firmy | Q-10 |

Dalej w dokumencie **Q-08 oznacza czat, Q-09 uprawnienia superadmina, a Q-10 archiwizację**. Nie zmieniamy historycznych ID ekranów i testów.

### 5.2. Zrozumiały zapis otrzymanych odpowiedzi — P [U2]

| ID źródłowe | Przyjęte rozstrzygnięcie | Konsekwencja dla makiet i działania |
|---|---|---|
| **Q-01** | Po wygaśnięciu **opłaconego okresu** oferta przestaje być publiczna i wyłączony jest cały publiczny adres firmy. Administrator zachowuje dotychczasowe funkcje konta oraz kontakt z Autervą. Widzi komunikat, że jego oferta i strona nie są publicznie widoczne. | Nie projektować płatnego wylogowania, panelu read-only ani blokady dodawania/edycji pojazdów wyłącznie z powodu końca opłaty. Banner w shellu, ADM-04 i TEN-04; publiczna blokada obejmuje wszystkie podstrony i API oferty. |
| **Q-02** | „Opłacono do 31 października” oznacza korzystanie z publicznej widoczności przez cały 31 października. | Wyświetlać „do [data] włącznie”. W strefie Europe/Warsaw koniec dnia jest granicą widoczności. Dostęp do panelu nie wygasa razem z ofertą — patrz Q-01. |
| **Q-03** | Trial liczymy od pierwszego skutecznego zarejestrowania admina przez link przesłany e-mailem. Publiczna strona działa podczas trialu. | Początkiem nie jest utworzenie firmy, wysyłka e-maila, otwarcie linku ani późniejsze logowanie. Dokładny czas 336 godzin określa Q-03A, a domenę testową Q-03B/Q-06A/B. |
| **Q-04** | Jedna firma ma jednego administratora, bez dodatkowych kont. Jedno konto admina obsługuje jedną firmę. Druga firma przechodzi osobny proces jako nowy klient Autervy. | Bez zespołów, zapraszania pracowników i przełącznika organizacji. Konto oraz operacje są jednoznacznie związane z firmą. |
| **Q-05** | Tylko superadmin edytuje logo, dane, treści i zdjęcia publicznej strony firmy. Kolory, czcionki, ikony oraz panel pozostają wspólne. | Usunąć edycję marki z panelu firmy. Personalizować zawartość PUB, nie system wizualny ADM/ACC/TEN. |
| **Q-06** | Brak własnej domeny nie blokuje uruchomienia: firma otrzymuje adres `{slug}.{publicDomainAutervy}`. | Host panelu pozostaje osobny. Klient może później kupić własną domenę, a Auterva obsługuje instrukcję DNS, walidację i przekierowanie. |
| **Q-07** | Publikacja następuje automatycznie po zakończonej rejestracji admina z zaproszenia. Nawet przy pustej flocie publiczna strona pokazuje estetyczną zapowiedź, że oferta pojawi się wkrótce. | Nie wymagać przycisku „Opublikuj całą stronę” ani pierwszego pojazdu jako warunku uruchomienia witryny. Nadal osobno obowiązują warunki publikacji każdego pojazdu. Warunkowy trial z Q-03 nie staje się bezwarunkowy. |
| **Q-08** | Prosty czat tekstowy firma–Auterva, bez załączników i bez powiadomień e-mail o wiadomościach. Nowe wiadomości sygnalizowane tylko w aplikacji, np. kropką przy sekcji czatu. | TEN-11, PLT-09 i nawigacja mają stan „nowa wiadomość”. Bez spinacza, uploadu w czacie i ustawień alertów mailowych. Zaproszenia i reset hasła nadal używają e-maila. |
| **Q-09** | Superadmin ma pełny dostęp do obsługi każdej firmy: przeglądanie, dodawanie, edycja i dozwolone usuwanie danych. Funkcje te muszą być zagnieżdżone tak, by nie utrudniały jego najważniejszych ścieżek. | „Firmy → konkretna firma → Zarządzanie firmą” prowadzi do istniejących widoków floty, kalendarza i ustawień. Zachować kontekst firmy, powrót oraz audyt superadmina; bez przejmowania tożsamości klienta. |
| **Q-10** | Nie usuwamy danych firmy; archiwizujemy firmę. Superadmin domyślnie widzi firmy aktywne w sensie niezarchiwizowanych, a po włączeniu widoczności archiwum także zarchiwizowane. | Akcja „Archiwizuj firmę”, zachowanie danych i filtr „Pokaż zarchiwizowane”. „Niezarchiwizowana” nie oznacza automatycznie „opłacona” ani „publicznie widoczna”. |

Odpowiedź o pełnym dostępie superadmina nie znosi szczegółowej decyzji „archiwizujemy, nie usuwamy firmy”. Nie oznacza również podglądu haseł lub usuwania zapisów audytu.

### 5.2A. Dalsze odpowiedzi właściciela — P [U3]

| ID | Przyjęte rozstrzygnięcie | Konsekwencja dla makiet i działania |
|---|---|---|
| **Q-01A** | Po zakończeniu trialu obowiązuje ta sama podstawowa zasada co po zakończeniu opłaconego okresu. | Publiczna strona jest wyłączona, natomiast niearchiwizowany admin zachowuje pełny panel i czat. |
| **Q-03B** | Publiczna strona jest włączona podczas trialu. Gdy firma nie ma własnej domeny, korzysta z publicznej domeny testowej Autervy. | Usunąć warunek „po analizie opłacalności” z aktywnego flow trialu. |
| **Q-03C** | Firma może otrzymać tylko jeden trial. Po jego zakończeniu trzeba zakończyć współpracę albo przejść na opłacony okres. | Brak akcji „Nadaj kolejny trial” i brak automatycznego resetu trialu. |
| **Q-04A** | Jeden adres e-mail może należeć tylko do jednego konta w Autervie. | Druga firma wymaga również innego adresu e-mail administratora; walidacja konfliktu musi być pokazana w PLT-04. |
| **Q-07A** | Nie dopuszczamy przyszłej daty rozpoczęcia opłaconego okresu. | Formularz nie projektuje planowanego startu w przyszłości; usuwa to wcześniejszy wariant oczekiwania na datę startu. |
| **Q-07B** | Przedłużenie okresu po przerwie automatycznie ponownie pokazuje publiczną stronę, o ile firma nie jest zarchiwizowana i konfiguracja domeny jest poprawna. | Zwykłe wznowienie nie wymaga drugiego przycisku publikacji. Wyjątek po przywróceniu z archiwum opisuje Q-10A. |
| **Q-08A** | Czat działa w czasie rzeczywistym przez WebSocket, pokazuje stan pisania i odczytania, a niewysłany szkic jest lokalny dla konkretnej rozmowy i zachowuje się przy zmianie firmy bez dialogu blokującego. | TEN-11/PLT-09 wymagają stanów `typing`, `sent`, `read`, utraty i odzyskania połączenia oraz osobnego szkicu per rozmowa. |
| **Q-10A** | Archiwizacja blokuje logowanie admina firmy i wyłącza jej publiczną stronę/domenę. Przywrócenie ponownie umożliwia logowanie. Publiczną widoczność po przywróceniu i opłaceniu odblokowuje superadmin. | Potrzebne osobne potwierdzenie przywrócenia; stan po przywróceniu nie może automatycznie ominąć kontroli superadmina. |
| **Q-11** | Na teraz dashboard pokazuje wyłącznie firmy z opłaconym okresem oraz firmy w trialu. | Bez metryk przychodu, odwiedzin, pojazdów i rozbudowanej analityki. Inne stany pozostają dostępne w filtrach/listach, ale nie jako główne KPI. |
| **Q-12** | Publiczna oferta firmy udostępnia telefon, WhatsApp i e-mail. Onepage Autervy pokazuje wyłącznie kontakt, bez ceny i publicznej obietnicy trialu. | OVR-04/PUB-04 mają trzy kanały; MKT-01 prowadzi do kontaktu, nie do checkoutu, cennika ani rejestracji. |
| **Q-13** | Instalowalna PWA panelu firmy pozostaje w pierwszym wydaniu. | Zachować i dostosować ADM-18 oraz OVR-15/16 do osobnego hosta panelu firmy. |

### 5.2B. Zatwierdzone rekomendacje uzupełniające — P [U4]

| ID | Zatwierdzone rozstrzygnięcie | Konsekwencja dla makiet i działania |
|---|---|---|
| **Q-03A** | Trial trwa dokładnie 336 godzin od pierwszego skutecznego zakończenia rejestracji administratora. | Koniec jest chwilą czasu, nie końcem czternastego dnia kalendarzowego; zmiana czasu nie skraca ani nie wydłuża trialu. |
| **Q-05A** | White-label obejmuje publiczne logo, dane, treści i zdjęcia firmy, bez indywidualnych kolorów. Akceptacja materiałów odbywa się poza aplikacją. | PLT-03/04 nie zawierają selektora kolorów ani obowiązkowego checkboxa akceptacji. |
| **Q-06A/B** | Publiczny adres testowy ma schemat `{slug}.{publicDomainAutervy}`. Własną domenę kupuje klient; Auterva zapewnia instrukcję DNS, walidację routingu i TLS oraz przekierowanie adresu testowego po aktywacji domeny własnej. | Panel pokazuje oba adresy i ich stan, ale nie tworzy kreatora zakupu domeny dla klienta. |
| **Q-08A** | Niewysłany szkic jest lokalny dla rozmowy, zachowuje się przy przełączaniu firmy i nie otwiera dialogu blokującego. | Szkic nigdy nie przechodzi do innego odbiorcy; powrót do rozmowy przywraca jej treść. |
| **Q-10B** | MVP nie wykonuje automatycznego purge danych firmy. Zwykłą operacją panelową jest wyłącznie archiwizacja. | Brak harmonogramu trwałego kasowania i brak przycisku „Usuń na zawsze”; wyjątkowe obowiązki prawne są procedurą poza panelem. |
| **Q-14** | Zaproszenie jest jednorazowe, ważne 7 dni, a resend unieważnia poprzedni niewykorzystany link. MFA jest obowiązkowe dla superadmina i admina firmy. | PLT/ACC pokazują termin i wynik resend; oba obszary logowania wymagają drugiego składnika. |
| **Q-15** | Przypomnienia o końcu trialu lub opłaconego okresu są wysyłane w panelu i e-mailem 7 dni wcześniej, 1 dzień wcześniej oraz w dniu wygaśnięcia. | Harmonogram dotyczy komunikatów usługi, nie wiadomości czatu. |

### 5.3. Rozstrzygnięte części poprzednich pytań

Poniższe punkty zostały zatwierdzone przez właściciela w [U4] i stanowią kontrakt dla makiet oraz implementacji.

| ID uzupełniające | Rozstrzygnięcie | Kontrakt |
|---|---|---|
| **Q-03A** | Dokładnie 336 godzin od rejestracji. | Przechowywać start jako zdarzenie czasu; prezentować lokalnie w `Europe/Warsaw`. |
| **Q-05A** | Logo, dane, treści i zdjęcia; bez własnych kolorów; akceptacja poza aplikacją. | Jeden system wizualny i brak dodatkowego procesu akceptacji w UI. |
| **Q-06A/B** | `{slug}.{publicDomainAutervy}` oraz własna domena kupowana przez klienta. | Auterva obsługuje instrukcję DNS, walidację routingu/TLS i przekierowanie. |
| **Q-08A** | Lokalny szkic per rozmowa, zachowany bez dialogu blokującego. | Zmiana rozmowy nie przenosi ani nie wysyła treści. |
| **Q-10B** | Brak automatycznego purge w MVP. | Archiwizacja jest jedyną zwykłą operacją panelową dotyczącą cyklu życia firmy. |

### 5.4. Pytania z wersji 3.0 rozstrzygnięte przez [U4]

| ID | Rozstrzygnięcie | Konsekwencja |
|---|---|---|
| **Q-14** | Zaproszenie jest jednorazowe i ważne 7 dni; resend unieważnia poprzednie. MFA obowiązuje superadmina i admina firmy. | Zaproszenia i oba loginy muszą mieć odpowiadające stany, komunikaty i testy. |
| **Q-15** | Przypomnienia w panelu i e-mailem: 7 dni, 1 dzień oraz dzień wygaśnięcia. | Zakaz e-mailowych powiadomień czatu pozostaje bez zmian. |

### 5.5. Zasady dalszej pracy

Makiety i kod nie czekają już na ponowne zatwierdzanie Q-03A, Q-05A, Q-06A/B, Q-08A, Q-10B, Q-14 ani Q-15. Należy stosować wartości z §5.2B–5.4 bez rozszerzania ich o dodatkowe warianty.

Wersja 3.1 nie jest zatwierdzeniem kolejnych triali ani dodatkowych funkcji handlowych. Nie dodajemy decyzji wykraczających poza jawnie zapisany kontrakt.

<a id="s06"></a>
## 6. Role i granice dostępu

### 6.1. Role funkcjonalne

**P:** `SUPERADMIN_AUTERVA` zarządza Autervą i ma pełną obsługę każdej firmy. `ADMIN_FIRMY` obsługuje wyłącznie własną wypożyczalnię. Osoba przeglądająca ofertę nie ma konta.

**P [U2/U4]:** jedna firma ma dokładnie jedno aktywne konto administratora po zakończeniu rejestracji; w prerejestracji konto może oczekiwać na aktywację. Nie ma dodatkowych kont, zespołów ani przełącznika firm. Druga firma wymaga osobnego uruchomienia jako nowy klient i innego, globalnie unikalnego adresu e-mail administratora.

Liczba kont superadmina nie została określona. Nie wyprowadzać jej z reguły „jeden admin na firmę”.

### 6.2. Macierz uprawnień

| Operacja | Superadmin | Admin własnej firmy | Publiczny odwiedzający |
|---|---|---|---|
| Utwórz nową firmę | Tak P, po uzgodnieniu wyglądu | Nie | Nie |
| Edytuj metadane firmy na platformie | Tak P | Nie | Nie |
| Edytuj dane kontaktowe i ofertowe firmy | Tak P, w kontekście wybranej firmy | Tak P/B, tylko własnej | Nie |
| Wgraj/zmień publiczne logo, dane, treści i zdjęcia | Tak P | Nie; kontakt przez czat | Nie |
| Zmień indywidualny font, ikony lub motyw panelu firmy | Nie jest funkcją tego MVP | Nie | Nie |
| Ustaw/przedłuż okres publicznej widoczności | Tak P | Nie | Nie |
| Nadaj trial | Tak P; jeden trial, dokładnie 336 godzin od skutecznej rejestracji | Nie | Nie |
| Zobacz datę opłacenia/trialu i stan oferty | Tak P | Tak P, własna firma | Nie |
| Dodaj/edytuj pojazdy, zdjęcia i blokady | Tak P, przez zagnieżdżone widoki firmy | Tak P/B, własna firma, także po końcu opłaconego okresu | Nie |
| Wykonaj dozwolone usuwanie zdjęć/blokad i archiwizację pojazdu | Tak P, zgodnie z bazowymi regułami domeny | Tak B, własna firma, także po końcu opłaty | Nie |
| Zobacz prywatne notatki blokad | Tak P, konkretna firma | Tak B, własna firma | Nie |
| Korzystaj z czatu firma–Auterva | Tak P, rozmowy firm | Tak P, własna rozmowa, także po końcu opłaty | Nie |
| Archiwizuj firmę | Tak P, bez trwałego kasowania | Nie | Nie |
| Pokaż firmy zarchiwizowane | Tak P, po włączeniu filtra | Nie | Nie |
| Usuń trwale firmę wraz z danymi | Nie ma takiej akcji w tym MVP | Nie | Nie |
| Odczytaj statystyki platformy | Tak P, zestaw Q-11 | Nie | Nie |
| Zobacz publiczną ofertę po końcu opłaconego okresu | Nie przez publiczny adres; można użyć chronionego podglądu | Nie przez publiczny adres; chroniony podgląd pozostaje | Nie |
| Wykonaj rezerwację/płatność w aplikacji | Nie | Nie | Nie |

**T:** pełne uprawnienia aplikacyjne superadmina nie oznaczają roli superużytkownika PostgreSQL, podglądu haseł/kluczy ani możliwości usunięcia śladów audytu. Konkretna decyzja o archiwizacji firmy ma pierwszeństwo przed ogólnym „superadmin może usuwać”.

### 6.3. Sesja admina firmy

Firma wynika z zatwierdzonego mapowania hosta i przypisania konta. Konto Alfy nie obsłuży Bety po podmianie subdomeny, ID lub cookie. Brak konta globalnego wybierającego aktywną organizację w menu.

**R/T:** wykorzystać istniejący mechanizm auth, ale wymusić relację: jedno aktywne konto firmowe ↔ jedna firma. Fizyczny model tabel jest decyzją implementacyjną, nie uzasadnieniem dodania zespołów.

Koniec opłaty nie unieważnia sesji admina, nie blokuje logowania, resetu hasła, floty ani czatu. Wygaśnięcie samej sesji, odebranie uprawnienia ze względów bezpieczeństwa oraz ewentualne skutki archiwizacji to osobne przypadki.

### 6.4. Superadmin działa jako superadmin, nie jako klient — P/R/T

**P:** wejście do obsługi floty następuje po wyborze firmy; nie tworzy się globalnego menu samochodów wszystkich klientów.

**R/T:** operacje wykonywać w obszarze superadmina pod jego własną sesją. Nagłówek pokazuje „Zarządzasz firmą: [nazwa]”, host jej oferty i powrót do karty firmy. Rejestrować aktora jako superadmina, nie podpisywać jego zmian nazwiskiem admina firmy. W każdym zapisie sprawdzać wybrane `organizationId` i zgodność wszystkich powiązanych rekordów.

Równoczesna edycja pojazdu przez admina firmy i superadmina wymaga wykrycia konfliktu według istniejących zasad, nie cichego nadpisania. Samo otwarcie czatu nie uruchamia dodatkowych uprawnień — wynikają one z roli superadmina.

<a id="s07"></a>
## 7. Proces od rozmowy do uruchomienia firmy

### 7.1. Przebieg po odpowiedziach właściciela

| Krok | Osoba / zdarzenie | Czynność | Rezultat |
|---|---|---|---|
| 1 | Przedstawiciel firmy | Poznaje onepage Autervy i dzwoni | Rozmowa handlowa poza aplikacją |
| 2 | Auterva | Przedstawia wygląd publicznych komponentów/strony | Materiał do akceptacji, jeszcze nie aktywna firma |
| 3 | Firma | Akceptuje wygląd | Można rozpocząć prerejestrację |
| 4 | Superadmin | Przygotowuje firmę, jedno konto admina, publiczne logo/dane/treści/zdjęcia, host panelu oraz publiczny adres | Własna domena lub `{slug}.{publicDomainAutervy}`; cały system wizualny pozostaje stały |
| 5 | Superadmin | Wpisuje opłacony okres albo wybiera trial 14 dni | Płatna data końcowa obejmuje cały dzień; trial oczekuje na rejestrację |
| 6 | Superadmin | Wysyła zaproszenie na e-mail administratora | Adresat dostaje link do właściwego panelu |
| 7 | Administrator firmy | Skutecznie kończy rejestrację z zaproszenia, ustawiając dane dostępu | Konto zostaje aktywowane; jeżeli nadano trial, to jest zdarzenie jego startu |
| 8 | System po rejestracji | Automatycznie uruchamia publikację strony zgodnie z okresem oraz zatwierdzoną polityką publicznego trialu | Bez dodatkowego przycisku publikowania firmy; przy pustej flocie estetyczna zapowiedź |
| 9 | Administrator firmy | Dodaje i publikuje własne pojazdy, zarządza danymi i dostępnością | Publiczna oferta zastępuje zapowiedź, gdy są opublikowane pojazdy i obowiązuje widoczność |
| 10 | Najemca / firma | Uzgadniają wynajem telefonicznie; firma ręcznie dodaje blokadę | Termin widoczny jako niedostępny; brak rezerwacji lub płatności w aplikacji |

**P:** rozliczenia pozostają poza systemem. Wpis „opłacono do” odnotowuje decyzję superadmina, nie potwierdza technicznie przelewu.

**Zatwierdzone wyjątki:** publiczna strona działa podczas trialu, a przyszła data rozpoczęcia opłaconego okresu jest niedozwolona. Brak pojazdów nie blokuje publikacji.

### 7.2. Akceptacja wyglądu bez dodatkowego portalu

**P/B:** firma akceptuje przedstawione materiały poza aplikacją przed prerejestracją. Personalizacja dotyczy publicznego logo, danych, treści i zdjęć; kolory, panel, ikony oraz czcionki pozostają stałe.

**P/R:** prezentacja może korzystać z istniejących makiet i komponentów. Akceptacja materiałów odbywa się poza aplikacją; nie budować portalu, checkboxa ani obowiązkowego pola potwierdzenia w PLT-03/04.

Materiał nie ujawnia danych innej firmy. Zmiana zaproponowanej konfiguracji nie może oznaczać dowolnego przeprojektowania wspólnej biblioteki.

### 7.3. Bezpieczna prerejestracja

**P/R/T:**
- Sam zapis firmy i wysłanie e-maila nie publikują strony ani nie rozpoczynają trialu.
- Prerejestracja przygotowuje jedno konto admina; ponowienie nie tworzy drugiego konta lub drugiej firmy.
- Błąd wysyłki pozostawia zapisaną firmę i możliwość ponowienia zaproszenia.
- „Zapisano firmę” oraz „Wysłano zaproszenie” to odrębne wyniki.
- Superadmin nie ustawia znanego sobie hasła klienta i nie odczytuje jego hasła.
- Własna domena nie jest warunkiem aktywacji; przed uruchomieniem należy mieć poprawny publiczny adres własny lub testowy.
- Problemu z DNS/TLS nie należy maskować komunikatem, że strona już jest dostępna.

### 7.4. Rejestracja administratora przez zaproszenie

**P/B/R:** ekran wykorzystuje dotychczasowe kontrolki hasła. Pokazuje nazwę firmy, e-mail z zaproszenia i pola ustawienia hasła. Panel aktywacji ma wspólny wygląd Autervy; nie przejmuje motywu publicznej oferty.

**P/T:** link jest jednorazowy, losowy, ważny 7 dni i związany z właściwą firmą oraz adresatem. Ponowne wysłanie unieważnia poprzedni niewykorzystany link. Wzorce ochrony linków z [W3] pozostają techniczną podstawą, nie potwierdzeniem wdrożenia.

**P/T:** otwarcie linku, jego podgląd przez skaner pocztowy i nieudana walidacja nie oznaczają rejestracji. Start trialu oraz zdarzenie automatycznej publikacji są powiązane z **pierwszym potwierdzonym przez serwer zakończeniem formularza rejestracji**. Ponowienie tej samej operacji nie tworzy drugiego początku trialu.

Warianty: link poprawny, wykorzystany, wygasły, anulowany, błędny; błąd sieci; zapis w toku; sukces. Przy sukcesie podać rzeczywisty stan publicznej strony. Jeśli uruchamianie techniczne jeszcze trwa, użyć stanu oczekiwania i bezpiecznego ponowienia, a nie fikcyjnego „strona działa”.

**R:** po rejestracji pokazać potwierdzenie i przejście do logowania. Automatyczna sesja po rejestracji nie została osobno potwierdzona; nie jest konieczna do uruchomienia trialu i publikacji.

### 7.5. Pierwsza publikacja i pusta oferta — P [U2]

Nie wymagać pierwszego pojazdu, ukończenia dodatkowego onboardingu ani ręcznego „Opublikuj stronę”. Po skutecznej rejestracji, przy dopuszczonej publicznej widoczności, strona może być dostępna z pustą flotą.

**R — propozycja treści:**

> **Nasza oferta pojawi się wkrótce**  
> Przygotowujemy dla Ciebie ofertę pojazdów. Zajrzyj ponownie wkrótce.

Na makiecie pozostawić zatwierdzone publiczne logo, dane, treści i zdjęcia, spokojną wspólną kompozycję oraz niezbędną nawigację. Nie wstawiać fikcyjnych pojazdów, błędu 404 ani komunikatu o nieopłaceniu. Kontakt obejmuje telefon, WhatsApp i e-mail zgodnie z Q-12.

Gdy pojawi się pierwszy pojazd spełniający warunki publikacji, standardowa oferta wykorzystuje już istniejące `PUB-01` i `PUB-02`. Zapowiedź pustej oferty to ich wariant, nie kolejna aplikacja ani nowy moduł.

<a id="s08"></a>
## 8. Opłacony okres, trial i widoczność

### 8.1. Dwa niezależne aspekty: konto i strona

**P [U2]:** opłacony okres określa publiczną widoczność oferty. Jego wygaśnięcie **nie wyłącza konta admina ani jego dotychczasowych funkcji**. Administrator nadal może dodawać i edytować pojazdy, zarządzać zdjęciami, ręcznymi blokadami i własnymi danymi, korzystać z chronionego podglądu oraz czatu.

Nie nadawać z tego powodu trybu read-only, nie unieważniać sesji i nie blokować zapisu kończącego się po dacie opłaty. Zmiana statusu pojazdu na „Opublikowany” nie obchodzi jednak blokady całej publicznej strony.

Panel pokazuje osobno:
- rodzaj okresu: opłacony albo próbny;
- datę końcową oraz rzeczywisty stan okresu;
- publiczny adres: własny lub testowy;
- widoczność strony: widoczna, wyłączona po końcu opłaty lub inny jawnie opisany stan;
- wejście do rozmowy z Autervą.

Trial nie może być oznaczony jako opłacony. Nie wolno sprowadzić wszystkich informacji do jednego badge’a „aktywna”.

### 8.2. Koniec opłaconego dnia — P i proponowana realizacja T

**P:** „Opłacono do 31.10.2026” obejmuje cały 31 października 2026 r. w przyjętej dla produktu strefie `Europe/Warsaw`. Publiczna widoczność kończy się po zakończeniu tego dnia; nie o jego początku ani o godzinie zapisania przez superadmina.

**R/T:** granicę techniczną można zapisać jako początek następnego dnia lokalnego, a porównanie czasu wykonać względem tej wyłącznej granicy. Należy obliczać ją w strefie, zamiast dodawać sztywne 24 godziny do dowolnej daty UTC. Przykład wymogu:

```text
Opłacono do: 31.10.2026 włącznie, Europe/Warsaw
31.10.2026, koniec dnia: okres jeszcze obejmuje ten dzień
01.11.2026, 00:00 Europe/Warsaw: publiczna widoczność już wygasła
Panel admina: nadal działa zgodnie z dotychczasowymi uprawnieniami
```

Nie dodajemy niezatwierdzonej karencji. Ewentualna późniejsza zmiana tej reguły wymaga nowej decyzji.

### 8.3. Zachowanie po wygaśnięciu opłaty — P

**Publicznie:** brak całej oferty i pozostałej treści strony firmy pod wszystkimi obsługiwanymi publicznymi adresami, nie tylko ukrycie kart na stronie głównej. Bezpośredni link do pojazdu, publiczny kalendarz i API oferty nie mogą ominąć wygaszenia. To samo dotyczy adresu testowego Autervy. Panel firmy pozostaje dostępny na osobnym hoście.

**W panelu:** dotychczasowe funkcje są dostępne. Dodać stale zauważalny, nieblokujący banner. Nie przykrywać nim formularza ani nie usuwać wprowadzanych danych.

**R — treść bannera:**

> **Twoja strona publiczna jest wyłączona**  
> Opłacony okres zakończył się [data] z końcem dnia. Oferta Twojej firmy nie jest obecnie widoczna pod adresem [publiczny adres]. Możesz nadal zarządzać pojazdami i danymi firmy. Napisz do Autervy w sprawie przedłużenia.

Akcja: **„Napisz do Autervy”**. Własny przycisk publikacji pojazdu nie jest przyciskiem opłacenia lub wznowienia witryny. Przy statusie pojazdu można dopisać: „Opublikowany w panelu; strona firmy jest obecnie wyłączona”.

**R/T:** „wyłączony adres” oznacza wymaganie braku publicznej treści. Nie jest poleceniem automatycznego usunięcia domeny/DNS/TLS. Neutralna odpowiedź aplikacji bez oferty może realizować to wymaganie; szczegóły techniczne i tekst publicznego stanu trzeba przedstawić jako projekt, nie jako dodatkową decyzję właściciela. Nie ujawniać publicznie faktu zaległości ani danych rozliczeniowych.

### 8.4. Minimalne stany bez silnika subskrypcji — R

| Oś | Minimalne rozróżnienie | Uwagi |
|---|---|---|
| Rejestracja | przygotowana / zaproszona / zakończona | Pierwsza skuteczna rejestracja uruchamia trial, jeśli nadano go firmie |
| Okres publicznej usługi | opłacony / trial; od, do, wygasły | Nie jest stanem sesji ani wszystkich uprawnień panelu |
| Widoczność publiczna | oczekuje na rejestrację / widoczna / wyłączona | Pusta flota to stan treści widocznej strony, nie jej wyłączenie |
| Archiwizacja | niezarchiwizowana / zarchiwizowana | Nie kasuje danych; nie jest równoznaczna z końcem opłaty |
| Bezpieczeństwo | dozwolony dostęp / niezależne ograniczenie bezpieczeństwa | Nie wolno przedstawiać ograniczenia bezpieczeństwa jako skutku zwykłego końca opłaty |

Nazwy modeli i enumów są R. Zachowania potwierdzone w §5 są P. Nie ma potrzeby budowania pięciu osobnych ekranów.

### 8.5. Zmiana okresu przez superadmina

**P:** okres ustawia lub przedłuża superadmin, a firma wyłącznie go odczytuje. Płatności pozostają poza aplikacją.

**R — formularz:** bieżący rodzaj i daty; nowy opłacony okres lub przygotowanie trialu; opis końca dnia; podsumowanie skutku; „Zapisz okres”. W trialu nie wybierać arbitralnego startu — źródłem jest rejestracja. Wyjątkowe nadanie kolejnego trialu nie jest zatwierdzone.

Przy skróceniu do daty już zakończonej pokazać: „Publiczna strona zostanie wyłączona; administrator zachowa dostęp do panelu”. Zachować informację o aktorze oraz poprzednim i nowym okresie. Nie pisać „Płatność przyjęta”.

**T:** kontrolować publiczną widoczność przy odczycie serwera i cache, nie wyłącznie w zadaniu wykonywanym raz dziennie. Wygaśnięcie nie usuwa danych ani nie dodaje sztucznej blokady kalendarza. Zapis floty i czatu po końcu opłaty jest dozwolony, o ile nie ma innej przyczyny odmowy.

**Q-07B:** po przedłużeniu okresu po przerwie publiczna strona wraca automatycznie, jeśli firma nie jest zarchiwizowana, a konfiguracja domeny jest poprawna.

### 8.6. Trial 14 dni

**P:** trial wybiera superadmin. Początek to pierwsze skuteczne zakończenie rejestracji admina przez link z e-maila. Firma w prerejestracji nie zużywa trialu przed tym zdarzeniem.

**P — warunek:** strona publiczna ma działać także podczas trialu, **jeżeli będzie to opłacalne dla Autervy**. Nie ma jeszcze danych lub potwierdzenia, które pozwalają uznać tę opłacalność za rozstrzygniętą. Nie obiecujemy bezwarunkowego publicznego trialu na onepage lub w e-mailu.

**Potwierdzone:** trial trwa dokładnie 336 godzin od pierwszej skutecznej rejestracji, jest jednorazowy, uruchamia publiczną stronę i po zakończeniu podlega tej samej regule widoczności co koniec opłaconego okresu.

**T:** utrwalić początek tylko raz. Otwarcie wiadomości, GET skanera, nieskuteczna rejestracja, refresh i ponowne logowanie nie rozpoczynają nowego okresu. Ponowienie zakończonej operacji zwraca ten sam rezultat.

### 8.7. Macierz najważniejszych przypadków

| Przypadek | Panel administratora | Publiczna strona | Status decyzji |
|---|---|---|---|
| Prerejestracja, brak ukończonej rejestracji | Ekran zaproszenia/aktywacji | Nie uruchomiono jej przez sam zapis firmy | P/T |
| Rejestracja zakończona, opłacony okres już trwa, brak pojazdów | Pełne funkcje | Automatycznie widoczna, elegancki komunikat „oferta wkrótce” | P |
| Rejestracja zakończona, opłacony okres trwa, pojazdy opublikowane | Pełne funkcje | Zwykła publiczna oferta | P/B |
| Ostatni opłacony dzień | Pełne funkcje | Widoczna do końca dnia | P |
| Koniec opłaconego okresu | Pełne dotychczasowe funkcje i czat; banner | Cały publiczny adres i oferta wyłączone | P |
| Brak własnej domeny | Bez zmiany | Publiczny adres testowy Autervy, z tymi samymi warunkami widoczności | P |
| Trial po rejestracji | Obsługa firmy w ramach trialu | Publiczna widoczność przez dokładnie 336 godzin | P |
| Koniec trialu | Pełny panel i czat pozostają dostępne | Cała publiczna strona jest wyłączona | Q-01A |
| Rejestracja przed przyszłą płatną datą startu | Niedozwolona — brak planowania przyszłego startu | Pierwsza publikacja wynika z zakończonej rejestracji/trialu | Q-07A |
| Wznowienie po płatnej przerwie | Panel działał przez cały czas | Automatyczny powrót przy poprawnej domenie i braku archiwizacji | Q-07B |
| Archiwizacja | Logowanie admina zablokowane do przywrócenia | Wszystkie publiczne adresy wyłączone; po przywróceniu i opłaceniu widoczność odblokowuje superadmin | Q-10A; dane pozostają P |

Archiwizacja, pusta oferta, wygasła sesja i koniec opłaty muszą pozostać odrębnymi stanami. Nie automatyzować archiwizacji po upływie opłaconego okresu.

<a id="s09"></a>
## 9. Panel superadmina — pola i operacje

### 9.1. Najmniejsza nawigacja i zagnieżdżona obsługa firmy

**P [U2]:** pełna obsługa danych firm nie może utrudniać głównych zadań superadmina.

**R — główny poziom:** „Firmy” i „Wiadomości”; podstawowe statystyki w górnej części listy/pulpitu; konto oraz wylogowanie w menu. Bez globalnych sekcji „Samochody wszystkich firm”, „Blokady wszystkich firm”, „Płatności” czy „Zespoły”.

**R — drugi i trzeci poziom:**

```text
Panel Auterva
├── Firmy
│   ├── Lista firm + „Pokaż zarchiwizowane”
│   ├── Dodaj firmę
│   └── [Wybrana firma — PLT-03]
│       ├── Dane / Adresy / Wygląd publiczny
│       ├── Okres usługi / Zaproszenie / Archiwizacja
│       ├── Wiadomości tej firmy
│       └── Zarządzanie firmą
│           ├── Pojazdy → Dodaj / Edytuj / Zdjęcia / Publikacja
│           ├── Kalendarz → Dodaj / Edytuj / Usuń ręczną blokadę
│           └── Dane oferty / Kontakt / SEO / Treści
└── Wiadomości → Rozmowa z wybraną firmą
```

W zagnieżdżonych ekranach pokazać breadcrumbs „Firmy → [nazwa] → Pojazdy → [pojazd]” i stały powrót „Wróć do karty firmy”. Na telefonie ten sam zakres jest dostępny przez krótkie menu sekcji firmy. Nie powielać w głównym sidebarze pozycji osobno dla każdego klienta.

Operacje te używają istniejących komponentów `ADM-*` jako widoków uruchomionych **w kontekście superadmina**, nie jako potajemnej sesji klienta. Dokładne podścieżki, np. `/firmy/[id]/zarzadzanie/pojazdy`, są propozycją R.

### 9.2. Formularz dodania/edycji firmy

Poniższe szczegółowe pola i układ to R realizujące potwierdzone operacje. Nie wszystkie muszą być wymagane w prerejestracji.

| Sekcja / pole | Kto wprowadza | Znaczenie i walidacja |
|---|---|---|
| Nazwa firmy | Superadmin | Rozpoznawalna nazwa klienta Autervy; nie wymuszać automatycznej zmiany sluga |
| Nazwa publiczna | Superadmin / później firma B | Można użyć dotychczasowego pola; nie budować trzech nazw, gdy klient nie potrzebuje rozróżnienia |
| Telefon kontaktowy | Superadmin / firma B | Kanał uzgodnień i publiczny telefon, z rozróżnieniem przeznaczenia, jeśli są różne |
| E-mail zaproszenia | Superadmin | Adres administratora firmy; nie jest automatycznie publicznym kontaktem |
| Slug panelu | Superadmin | Składa zatwierdzony host firmy; unikalny w platformie; wykluczone nazwy techniczne |
| Host panelu | Wyliczany | Pole podglądu np. `alfa.sites.auterva.example`; nie dowolny URL |
| Domena publiczna | Superadmin | Własna domena albo testowy publiczny adres Autervy. Samo wpisanie nie publikuje strony; zwykła publikacja następuje po skutecznej rejestracji admina. |
| Stan konfiguracji domeny | System / operator techniczny | Gotowa albo wymagająca działania; potwierdzona kontrola i TLS, nie fikcyjny zielony znacznik |
| Logo publiczne | Wyłącznie superadmin | Zatwierdzony plik dla strony publicznej; ponowne wykorzystanie uploadu. Nie zmienia loginu ani motywu panelu firmy. |
| Wygląd publiczny | Wyłącznie superadmin | Logo, dane, treści i zdjęcia. Kolory, fonty i ikony są stałe; panel zawsze ma wspólny styl. |
| Akceptacja wyglądu | Poza aplikacją | Akceptacja przed prerejestracją jest wymagana, lecz nie powstaje dodatkowe pole ani proces w panelu. |
| Rodzaj dostępu | Superadmin | Opłacony / trial 14 dni |
| Okres | Superadmin / reguła trialu | Opłacono do wskazanego dnia włącznie. Trial startuje po pierwszej rejestracji i kończy się dokładnie po 336 godzinach. |
| Stan publicznej strony | Wyliczany/systemowy | Automatyczna pierwsza publikacja po rejestracji; koniec trialu/opłaty wyłącza wszystkie publiczne adresy. Wznowienie jest automatyczne przy poprawnej domenie i braku archiwizacji; po przywróceniu z archiwum odblokowuje superadmin. |
| Dane firmy dla oferty | Firma B oraz superadmin P | Istniejące pola opisu, adresu, godzin, kontaktu i treści prawnych. Superadmin edytuje je w zagnieżdżonym kontekście firmy. |
| Notatka operatora | Opcjonalna R | Nie jest treścią czatu; brak dostępu klienta; nie przechowywać sekretów |

**Nie dodawać automatycznie:** ceny planu, VAT, numeru faktury, danych karty, numeru konta bankowego, salda, automatycznego MRR ani terminów księgowych. Są poza potwierdzonym zakresem.

### 9.3. Dwie odrębne akcje kończące

**R:** `Zapisz firmę` oraz `Wyślij zaproszenie` mogą być odrębnymi przyciskami. Pozwala to przygotować konfigurację i upewnić się, że właściwy e-mail otrzyma właściwy adres.

Dopuszczalna kompozycja „Zapisz i wyślij zaproszenie” powinna pokazywać dwa rezultaty. Gdy firma została zapisana, a poczta nie wyszła, interfejs nie może sugerować, że trzeba ponowić całe tworzenie.

Przy niedokończonym routingu nie oznaczać firmy jako gotowej do publikacji. Brak własnej domeny rozwiązuje przygotowany publiczny adres testowy, nie brak adresu. Rejestracja automatycznie uruchamia witrynę i dokładnie 336 godzin trialu; przyszła płatna data startu jest niedozwolona.

### 9.4. Lista firm, archiwum i statystyki

**P:** domyślna lista pokazuje firmy niezarchiwizowane. Opcja **„Pokaż zarchiwizowane”** uwzględnia również firmy zarchiwizowane. W obu stanach działa wyszukiwanie. Zarchiwizowaną firmę oznaczyć wyraźnym badge’em; nie mieszać jej z firmą, której jedynie skończyła się opłata.

Słowo „aktywne” w opisie listy właściciela oznacza tu **nieprzeniesione do archiwum**. Aby uniknąć niejasności, makieta powinna rozróżniać „Niezarchiwizowana”, „Okres opłacony/trial/wygasły” oraz „Strona widoczna/wyłączona”. Firma z wygasłą opłatą nie znika automatycznie z domyślnej listy.

**R — tabela/karta:** nazwa, host panelu, publiczny adres własny/testowy, stan zaproszenia, rodzaj i data okresu, publiczna widoczność, znacznik archiwum oraz wejście do rozmowy/karty firmy.

**R do Q-11:** dashboard pokazuje wyłącznie firmy z aktywnym opłaconym okresem i firmy w trialu. Inne statusy pozostają dostępne w filtrach/listach; nie dodawać fikcyjnych przychodów ani kolejnych KPI.

### 9.5. Archiwizacja zamiast usuwania firmy — P

Superadmin ma akcję **„Archiwizuj firmę”**, nie „Usuń na zawsze”. Archiwizacja zachowuje rekord firmy oraz związane dane, w tym flotę, blokady, zdjęcia i historię rozmowy. Nie uruchamia kaskadowego kasowania ani automatycznej likwidacji konta.

Po operacji firma znika z domyślnej listy niezarchiwizowanych. Po włączeniu **„Pokaż zarchiwizowane”** jest ponownie dostępna do odnalezienia i podglądu przez superadmina. Filtr nie jest funkcją przywracania i nie zmienia jej statusu.

**R — dialog:** nazwa firmy, informacja o zachowaniu danych, blokadzie logowania admina, wyłączeniu publicznych adresów i ukryciu na domyślnej liście, „Anuluj” oraz „Archiwizuj firmę”. Przywrócenie odblokowuje logowanie, a widoczność publiczną po opłaceniu odblokowuje superadmin.

Zwykłe wygaśnięcie opłaty nie archiwizuje firmy. Archiwizacja nie jest usuwaniem pojedynczej ręcznej blokady lub zdjęcia w ramach dotychczasowych funkcji floty. W MVP nie ma automatycznego purge danych firmy ani panelowej akcji trwałego usunięcia.

<a id="s10"></a>
## 10. Panel firmy — najważniejsze zmiany

### 10.1. Co zostaje

**B:** dotychczasowy dashboard, pojazdy, formularze, galeria, kalendarz i ręczne blokady oraz ustawienia danych firmy. Nie zmieniać ich w system rezerwacji i obsługi klientów.

W polu prywatnej notatki nadal nie ma konieczności wpisywania danych najemcy. Telefoniczna rezerwacja jest poza systemem; wpis w kalendarzu reprezentuje zajętość, nie umowę.

### 10.2. Co dokładamy do wspólnego układu

**P/R:**
- nazwa firmy i jej adres jako identyfikacja kontekstu, bez indywidualnego motywu panelu;
- „Opłacono do [data] włącznie” albo „Okres próbny do [ustalony koniec]”;
- wejście do informacji o usłudze;
- pozycja „Czat z Autervą” ze znacznikiem nowych wiadomości;
- adres publiczny oraz jego aktualny stan;
- po końcu opłaty nieblokujący banner o wyłączonej publicznej stronie.

W stanie aktywnym data jest spokojnym elementem informacji, nie reklamą pakietów. Po wygaśnięciu bannera nie należy mylić z utratą sesji. Wszystkie dotychczasowe operacje panelu pozostają dostępne. Kliknięcie linku do wyłączonej domeny nie może potajemnie udostępnić oferty; użytkownik powinien znać stan przed przejściem.

**R:** na mobile zachować główne wejścia do pojazdów i kalendarza. Czat i status usługi można umieścić w „Więcej” oraz dać skrót na dashboardzie. Gdy czat znajduje się w „Więcej”, znacznik nowej wiadomości musi być zauważalny także bez otwierania tego menu. Wygląd wskaźnika, np. kropka z etykietą dostępnościową, jest realizacją potwierdzonego wymagania.

### 10.3. Dane firmy versus konfiguracja usługi i wyglądu

Admin firmy nadal edytuje własne dane i ofertę zgodnie z bazą. **Nie może** zmienić opłaconego okresu, trialu, hosta panelu ani publicznego logo i zawartości zarządzanej przez Autervę. Zmiany uzgadnia na czacie z Autervą.

W `ADM-11` usunąć aktywny upload logo i zastąpić go podglądem aktualnego publicznego logo, informacją „Publiczną zawartość strony zmienia Auterva” oraz linkiem „Napisz w sprawie zmiany”. Nie tworzyć drugiego źródła tego samego logo. W `ADM-13` zachować dozwoloną treść/SEO bez edytora kolorów.

Personalizacja publiczna nie zmienia panelu ani loginu; czcionki i ikony są wspólne. Chroniony podgląd `ADM-08` może pokazywać publiczny motyw wewnątrz wydzielonego podglądu, bez zmiany jego administracyjnej otoczki.

### 10.4. Jedna firma i jeden administrator — P

Nie ma wyboru firmy, zarządzania członkami, dodawania pracowników ani wspólnego konta przełączającego wypożyczalnie. Druga firma tego samego człowieka to osobny klient Autervy: kontakt → przygotowanie przez superadmina → odrębne zaproszenie → odrębne konto i host.

Każde konto wymaga innego, globalnie unikalnego adresu e-mail zgodnie z Q-04A. Konto Alfy nie daje dostępu do Bety.

<a id="s11"></a>
## 11. Czat firmy z Autervą

### 11.1. Zakres potwierdzony — P

To prywatny kontakt administratora firmy z superadminem Autervy w sprawie usługi. Nie jest to publiczny czat z najemcą ani kanał systemowych rezerwacji.

Czat jest **tekstowy, bez załączników i bez powiadomień e-mail o nowych wiadomościach**. Nową korespondencję sygnalizuje element wewnątrz aplikacji, np. kropka przy pozycji czatu. Brak e-mailowych alertów czatu nie usuwa e-maili zaproszenia i resetu hasła.

Po końcu trialu lub opłaconego okresu admin nadal pisze i czyta wiadomości. Archiwizacja blokuje logowanie admina, ale zachowuje historię zgodnie z Q-10A.

### 11.2. Minimalny model rozmowy — R

Jedna trwała rozmowa dotycząca firmy, tekstowe wiadomości i historia. Firma widzi tylko swoją rozmowę, superadmin listę rozmów firm. Nie dodawać tematów ticketów, botów, reakcji, statusu „pisze”, obecności online, komunikatora audio/wideo ani edytora załączników.

Potwierdzenia „odczytano” nie zostały zamówione. Wewnętrzny znacznik nowych wiadomości jest wymagany, ale nie wymusza pokazywania nadawcy dokładnego czasu odczytu przez drugą stronę.

### 11.3. Widok firmy — TEN-11

**R/B:** nagłówek „Czat z Autervą”, identyfikacja firmy, historia z nadawcą i czasem, pole „Napisz wiadomość do Autervy…” i przycisk „Wyślij”. Brak spinacza i ustawień e-mailowych alertów.

Stany: brak wiadomości, ładowanie, błąd historii, wysyłanie, trwały zapis, błąd/niepewny wynik z ponowieniem, nowe wiadomości w czasie czytania historii oraz utrata sieci/sesji. Koniec opłaty nie wyłącza kompozytora.

**R:** przy nowych wiadomościach pokazać kropkę przy „Czat z Autervą”, również przez sygnalizację na „Więcej”, jeśli tam ukryto sekcję. Zapewnić tekst dostępnościowy „Nowe wiadomości od Autervy”; sam kolor/kropka nie może być jedyną informacją dla czytnika.

**P/R/T:** znacznik wygaszać po faktycznym pokazaniu nowych wiadomości w rozmowie, nie po samym wejściu na dashboard lub preloadzie. Gdy użytkownik czyta stare wiadomości, nie przewijać go siłą do końca; pokazać „Nowe wiadomości”. Szkic jest lokalny dla rozmowy i przywracany po powrocie.

### 11.4. Widok superadmina — PLT-09

**R:** lista firm z ostatnią wiadomością, czasem i znacznikiem nowych. Wybrana rozmowa ma stały nagłówek firmy oraz pole odpowiedzi. Kliknięcie czatu z karty Alfy otwiera Alfę, nie ostatnią rozmowę z innym klientem.

Desktop: lista i rozmowa obok siebie. Mobile: lista, potem rozmowa na pełnym ekranie z powrotem. Nie dodawać rozmów na globalnej liście floty lub w prywatnych notatkach pojazdu.

Szkic do Alfy nie może zostać wysłany do Bety po zmianie zaznaczenia. Przełączenie zachowuje osobny lokalny szkic bez dialogu blokującego; powrót do Alfy przywraca jej treść. Archiwizacja zachowuje historię, ale blokuje logowanie admina firmy do czasu przywrócenia.

### 11.5. Zachowanie techniczne i ograniczenia — T/R

Wiadomość jest potwierdzona jako wysłana dopiero po trwałym zapisie na serwerze. Ponowienie po timeout używa tej samej tożsamości operacji, aby nie tworzyć duplikatów. Nie gwarantować czasu odpowiedzi człowieka z Autervy.

Każdy odczyt i zapis weryfikuje rolę, firmę i rozmowę. Podmiana `conversationId` nie udostępnia cudzej historii. Tekst nie wykonuje HTML/skryptów; nie kopiować całych rozmów do logów aplikacji.

**P:** nie implementować uploadu ani kolejki powiadomień e-mail dla czatu. Aktualizacje rozmowy, wskaźnik pisania oraz status odczytu działają przez WebSocket. Wymaganie kropki w aplikacji nie rozszerza zakresu o osobny system powiadomień.

Nie wymyślać handlowych limitów wiadomości. Techniczne limity długości/ruchu wymagają jawnej konfiguracji. Reguła archiwizacji zachowuje rozmowę; MVP nie wykonuje automatycznego purge historii firmy.

<a id="s12"></a>
## 12. Onepage Autervy i publiczna oferta firmy

### 12.1. Onepage Autervy — proponowany układ R

1. **Header:** logo Autervy, odnośniki do sekcji, „Skontaktuj się”.
2. **Hero:** system dla wypożyczalni, krótko „Twoja oferta pojazdów i dostępność w jednym miejscu”; telefoniczne CTA oraz obietnica indywidualnego uruchomienia.
3. **Korzyści:** prezentacja oferty, wygodne zarządzanie flotą, podgląd zajętych terminów, dostęp na telefonie. Nie deklarować procentowych wyników biznesowych bez danych.
4. **Jak to działa:** rozmowa → prezentacja/akceptacja wyglądu → konfiguracja przez Autervę → zaproszenie → zarządzanie ofertą.
5. **Podgląd produktu:** istniejące, rzeczywiste makiety DEMO panelu i oferty; nie tworzyć fałszywych opinii i klientów.
6. **Korzyści i FAQ:** pokazać, jak klient sprawdza ofertę i termin, jak firma potwierdza szczegóły telefonicznie oraz jak Auterva przygotowuje gotowy dostęp.
7. **Kontakt:** telefon, WhatsApp i e-mail; onepage Autervy prowadzi do rozmowy/prezentacji bez ceny i publicznej obietnicy trialu.
8. **Stopka:** informacje o Autervie i właściwe informacje prawne. Forma udostępnienia dokumentów nie tworzy kolejnego procesu biznesowego.

Onepage promuje narzędzie, nie wspólną flotę wszystkich wypożyczalni. Treści opisują możliwości i korzyści, zamiast eksponować listę braków systemu. Nie zamieniać `PUB-01` istniejącej firmy w stronę sprzedażową platformy.

### 12.2. Oferta wypożyczalni

**P/B:** zachowujemy pełny dotychczasowy katalog: strona główna, lista pojazdów, szczegóły i galeria, dostępność, kontakt i dokumenty. Publiczny klient nie widzi danych o wykupionej usłudze, korespondencji z Autervą ani konta admina.

**P:** telefoniczny kontakt i ręczne blokowanie terminu po uzgodnieniu. Widoczna akcja może brzmieć „Zadzwoń w sprawie terminu” zamiast sugerującego automatyzm „Zarezerwuj”.

**P [Q-12]:** zachować telefon, WhatsApp i e-mail. Nie włączać systemowego formularza rezerwacji przez reinterpretację słowa „kontakt”.

**P [U4]:** teksty `PUB-01` mają promować wybór pojazdu, przejrzysty podgląd terminów i bezpośrednią pomoc firmy. Nie budować sekcji wokół komunikatów „brak rezerwacji” lub „brak automatu”; prawidłowy model kontaktu opisać pozytywnie i bez sugerowania zapisu online.

### 12.3. Pusta oferta, wygaśnięcie i problem konfiguracji

**P — pusta flota po rejestracji:** strona jest publiczna, jeśli może działać w danym okresie. Pokazuje estetyczną zapowiedź przyszłej oferty, a nie błąd. Robocza treść: „Nasza oferta pojawi się wkrótce. Przygotowujemy dla Ciebie ofertę pojazdów. Zajrzyj ponownie wkrótce.” Szczegółowa kompozycja w §7.5 i §15.13.

**P — koniec opłaconego okresu:** cała publiczna strona jest wyłączona. Nie może pozostać dostępna lista, szczegóły, kontakt, kalendarz ani publiczne API z ofertą pod bocznym adresem. Zakres dotyczy zarówno własnej domeny, jak i domeny testowej. W panelu pozostaje pełna praca i czat.

**R — odpowiedź publiczna po wyłączeniu:** neutralny ekran/odpowiedź bez treści firmy, np. „Ta strona jest obecnie niedostępna”. Nie ujawniać kwot, terminu opłaty ani przyczyny administracyjnej. Pustej, lecz aktywnej oferty nie przekierowywać na ten ekran.

**T:** nieznany host nie może pokazywać pierwszej firmy z bazy. Błąd DNS/TLS jest odrębny od kontrolowanego ekranu aplikacji. Adres testowy wymaga takiej samej separacji danych i kontroli widoczności jak domena własna.

**P:** publiczna strona działa przez dokładnie 336 godzin trialu. Sama nazwa „domena testowa” nie oznacza, że wolno publikować ofertę po jego wygaśnięciu.

### 12.4. Zdjęcia i wygląd

Nie ma nowego wymagania generowania kolejnego pakietu fotografii. Wykorzystać już zaakceptowane zasoby. Materiały demonstracyjne muszą być odróżnione od faktycznych zdjęć floty. Zmiana logo lub treści nie powinna usuwać galerii ani danych pojazdów.


<a id="s13"></a>
## 13. Zmiany wszystkich istniejących ekranów i overlayów

Podstawa identyfikatorów: [B2], rozdziały 8–13. Poniższe instrukcje nie potwierdzają, że dany board rzeczywiście istnieje. Najpierw wykonać mapowanie do istniejącego Penpota. Zachować pierwotny priorytet MUST/SHOULD/P1, jeśli [U] go jawnie nie zmienia.

**Wspólna zmiana 3.1:** wszystkie PUB korzystają z publicznego motywu firmy i podlegają blokadzie po końcu opłaty; wszystkie ADM/TEN/ACC zachowują wspólny wygląd panelu. Wygaśnięcie opłaty dokłada banner do panelu, ale nie odbiera jego funkcji. Superadmin wykorzystuje widoki operacyjne jako zagnieżdżone warianty na swojej sesji, z jawną nazwą firmy i powrotem do PLT-03.

### 13.1. Osiem publicznych widoków

| ID | Zachować | Zmienić / uzupełnić |
|---|---|---|
| **PUB-01** | Układ oferty wypożyczalni, hero, pojazdy, daty, kontakt | Publiczne logo, dane, treści i zdjęcia przygotowane przez superadmina; wspólne kolory/fonty/ikony. Po rejestracji z pustą flotą: wariant „Nasza oferta pojawi się wkrótce”. Po końcu opłaty cała strona wyłączona. Nie używać tego ekranu jako MKT-01. |
| **PUB-02** | Lista, filtry, sortowanie, empty/loading/error | Oferta tylko właściwej firmy. Dodać odrębne stany: aktywna firma bez opublikowanych pojazdów — zapowiedź; filtry bez wyników — reset filtrów; koniec opłaty — publiczna strona wyłączona. |
| **PUB-03** | Galeria, parametry, kalendarz, wynik dostępności | Telefoniczny CTA; brak rezerwacji i klienta w bazie. Brak danych o okresie usługi Auterva. Nie oznaczać dni po końcu usługi jako zajętych przez automatyczne blokady. |
| **PUB-04** | Dane firmy, telefon, WhatsApp, e-mail, godziny, opcjonalny adres/mapa | Trzy zatwierdzone kanały kontaktu. Czat z Autervą nie trafia na publiczną stronę wypożyczalni. |
| **PUB-05** | Układ polityki prywatności firmy | Treść dotyczy konkretnej wypożyczalni, nie globalnej polityki platformy. Wskazać prawdziwy proces zatwierdzenia treści. |
| **PUB-06** | Warunkowy regulamin/zasady wynajmu | Nie mieszać z umową abonamentową Autervy. Nie dodawać checkoutu ani zgód do nieistniejącej rezerwacji. |
| **PUB-07** | 404 i powrót do oferty | Gdy strona jest aktywna, powrót tylko do jej publicznej domeny. Po końcu opłaty wspólna blokada całej strony ma pierwszeństwo — 404 nie może udostępniać alternatywnego wejścia do oferty. |
| **PUB-08** | Błąd, retry, bezpieczny kontakt | Nie ujawniać danych operatora, stack trace ani statusu płatności firmy. Przy braku bezpiecznych ustawień nie wstawiać danych innej firmy. |

### 13.2. Dwadzieścia jeden widoków panelu firmy

| ID | Poprawka do makiety i działania |
|---|---|
| **ADM-01 — logowanie** | Host firmy, stały wspólny wygląd Autervy, nazwa firmy jako tekst. Bez rejestracji publicznej i selektora firm. Poprawny login nadal działa po końcu opłaconego okresu; banner pojawia się po wejściu do panelu. |
| **ADM-02 — reset** | Dotychczasowy formularz na hoście właściwej firmy, neutralny wynik i reset tylko przypisanego konta. Adres e-mail jest globalnie unikalny i wskazuje dokładnie jedno konto. |
| **ADM-03 — nowe hasło** | Zachować walidację i ważność tokenu; powrót do ADM-01 firmy. Nie mylić tokenu resetu z zaproszeniem aktywacyjnym ACC-04. |
| **ADM-04 — dashboard** | Dodać „Opłacono do [data] włącznie / Trial do [koniec]”, stan publicznego adresu i skrót do czatu z kropką nowych wiadomości. Po końcu opłaty pełny dashboard z bannerem, a nie ekran blokujący. |
| **ADM-05 — lista pojazdów** | Zachować pełną obsługę własnej floty, także po końcu opłaty. Wtedy banner wyjaśnia wyłączenie publicznej strony. Bez liczników pakietowych z 2.0. Wariant superadmina zagnieżdżony pod konkretną firmą. |
| **ADM-06 — nowy pojazd** | Zachować formularz i dodawanie także po końcu opłaty. Admin firmy nie wybiera tenanta. Superadmin otwiera ten sam formularz w jawnie wybranym kontekście firmy, nie w globalnej flocie. |
| **ADM-07 — edycja** | Zachować dane, publikację, ukrycie i archiwizację pojazdu także po końcu opłaty. Status „Opublikowany” nie przywraca wygasłej witryny. Dodać kontekst superadmina oraz obsługę konfliktu równoczesnej edycji bez podszywania się pod klienta. |
| **ADM-08 — preview** | Zachować chroniony podgląd publicznej zawartości, także po końcu opłaty. Tylko obszar preview pokazuje logo/dane/treści/zdjęcia firmy; otoczka i kolory pozostają wspólne. Publiczny adres nie staje się przez preview dostępny dla innych. |
| **ADM-09 — kalendarz pojazdu** | Ręczne blokady, edycja, usuwanie i konflikty pozostają dostępne po końcu opłaty. Superadmin korzysta z wariantu w karcie firmy. Publicznie brak typu/notatki; gdy witryna wyłączona, nie ma też publicznego kalendarza. |
| **ADM-10 — kalendarz floty** | Zachować, jeśli już objęty realizowanym zakresem; nie zmieniać priorytetu SHOULD. Nie wprowadzać osi zbiorczej dla wszystkich firm. |
| **ADM-11 — dane firmy** | Zachować własne dane i telefon. Usunąć upload/zmianę logo z uprawnień firmy: pokazać publiczne logo tylko do wglądu i „Napisz do Autervy w sprawie zmiany”. Jednym źródłem logo zarządza superadmin. |
| **ADM-12 — kanały kontaktu** | Telefon, WhatsApp i e-mail są publicznymi kanałami firmy. Czat wsparcia ma osobne wejście i nie jest kanałem publicznego kontaktu najemcy. |
| **ADM-13 — prezentacja/SEO** | Zachować ustawienia treści i SEO w bazowym zakresie, również po końcu opłaty. Brak edytora kolorów, fontów i ikon po stronie firmy. Personalizacja tylko u superadmina i tylko dla strony publicznej. |
| **ADM-14 — treści prawne** | Zachować treści firmy i preview. Nie dodawać samodzielnego edytowania regulaminu Autervy. Nie generować „zatwierdzonych” treści prawnych. |
| **ADM-15 — konto** | Jedno konto admina jednej firmy; hasło, profil, obowiązkowe MFA i wylogowanie. Bez zespołów, OWNER/OPERATOR i przełącznika organizacji. Koniec opłaty nie blokuje bezpieczeństwa konta. |
| **ADM-16 — sesje** | Zachować dotychczasowy zakres. Każda sesja firmowa związana jest z tym kontem i tą firmą; nie daje dostępu do app ani drugiej firmy. Wylogowanie nie jest zmianą opłaconego okresu. |
| **ADM-17 — audyt** | Tylko historia danej firmy. Zmiana wykonana przez superadmina ma właściwego aktora, nie tożsamość admina firmy. Pełny dostęp superadmina nie zezwala na usuwanie śladów audytu. |
| **ADM-18 — offline** | Zachować instalowalną PWA panelu firmy zgodnie z Q-13. Brak fałszywego zapisu offline dotyczy także wiadomości i zmian dat. |
| **ADM-19 — uprawnienia/sesja** | Zachować wygaśnięcie sesji i rzeczywisty brak praw. Koniec trialu/opłaty pozostawia pełny panel z bannerem; archiwizacja blokuje logowanie do czasu przywrócenia. |
| **ADM-20 — 404 panelu** | Zachować kontekst właściwej firmy i bezpieczny powrót. Nie przekierowywać do app superadmina. |
| **ADM-21 — błąd panelu** | Zachować retry i identyfikator zgłoszenia. Link do czatu tylko przy działającej sesji oraz dopuszczonym dostępie. |

### 13.3. Dwadzieścia overlayów

| ID | Zmiana |
|---|---|
| **OVR-01 — menu publiczne** | Linki wewnątrz publicznej oferty firmy; bez menu SaaS i czatu wsparcia. |
| **OVR-02 — filtry** | Wyłącznie oferta danej firmy; zachować istniejący zakres filtrów. |
| **OVR-03 — daty** | Zachować daty wynajmu. Osobny formularz okresu wyjaśnia „opłacono do dnia włącznie”; trial zaczyna się po rejestracji i trwa dokładnie 336 godzin. |
| **OVR-04 — kontakt** | Telefon, WhatsApp i e-mail. Nie zamieniać go w rezerwację ani w chat z Autervą. |
| **OVR-05 — lightbox** | Zachować; wszystkie zdjęcia należą do właściwej firmy i opublikowanego pojazdu. |
| **OVR-06 — dodaj blokadę** | Zachować i udostępniać także po końcu opłaty. Admin działa w swojej firmie; superadmin w kontekście firmy otwartej z PLT-03. Brak ogólnego wyboru cudzej firmy w formularzu admina. |
| **OVR-07 — edytuj blokadę** | Zachować; brak cross-tenant odczytu także z podmienionym ID. |
| **OVR-08 — konflikt** | Pokaż tylko konflikty własnego pojazdu; nie ujawniaj blokad innej firmy. |
| **OVR-09 — publikacja pojazdu** | Nie jest aktywacją konta ani publikacją całej witryny. Pierwsza publikacja strony następuje automatycznie po rejestracji. Po końcu opłaty zapisana publikacja pojazdu nie odblokowuje domeny. |
| **OVR-10 — ukrycie pojazdu** | Zachować; nie ukrywa automatycznie całej strony i konta firmy. |
| **OVR-11 — archiwizacja pojazdu** | Zachować jako operację dotyczącą pojazdu. Oddzielić od archiwizacji całej firmy; w obu kontekstach jawnie nazwać obiekt i faktyczne skutki. |
| **OVR-12 — usuń zdjęcie** | Zachować ochronę zdjęcia głównego. Nie kasować logo lub mediów innych firm. |
| **OVR-13 — niezapisane zmiany** | Wykorzystać w edycji firmy i zagnieżdżonych formularzach superadmina. Koniec opłaty nie kasuje formularza. Szkic czatu pozostaje lokalny dla rozmowy i nie używa tego dialogu przy przełączaniu firmy. |
| **OVR-14 — sesja wygasła** | Tylko rzeczywiste wygaśnięcie sesji. Koniec opłaty nigdy nie otwiera tego dialogu ani nie wymusza ponownego logowania. |
| **OVR-15 — instalacja PWA** | Zachować board i dopasować do osobnego hosta panelu firmy oraz zatwierdzonej nazwy aplikacji. |
| **OVR-16 — aktualizacja PWA** | Nie usuwać boardu. Chronić niezapisane dane i nie sugerować kolejki zapisów offline. |
| **OVR-17 — user menu / Więcej** | Status usługi i czat ze znacznikiem nowych wiadomości; brak zespołów, przełączania firmy, edytora motywu i płatności. Wspólny wygląd niezależnie od klienta. |
| **OVR-18 — szczegóły audytu** | Odróżnić audit firmy i operatora. Brak treści haseł, tokenów i pełnego czatu. |
| **OVR-19 — zakończ sesję** | Zachować świadome potwierdzenie zakresu; operacja nie zmienia okresu usługi. |
| **OVR-20 — preview SEO** | Właściwa domena i firma; brak mieszania onepage Autervy z ofertą wypożyczalni. |

<a id="s14"></a>
## 14. Co zrobić z makietami rozszerzenia SaaS 2.0

Nie renumerować istniejących boardów bez potrzeby. Poniższe mapowanie obejmuje katalog 32 pozycji [B3]. „Odłożyć” oznacza przeniesienie do obszaru poza aktywnym MVP lub odłączenie prototypu, nie skasowanie.

| ID z 2.0 | Działanie teraz |
|---|---|
| **MKT-01** | Zachować i uprościć do onepage, telefonicznego kontaktu i przedstawienia systemu. |
| **MKT-02** | Osobny cennik/wybór planu odłożyć; MKT-01 prowadzi do kontaktu i prezentacji bez publicznej ceny. |
| **MKT-03** | Zachować potrzebne informacje prawne jako treści; nie mnożyć procesów akceptacji. |
| **MKT-04** | Osobny portal demo odłożyć; prezentację i akceptację istniejących materiałów zachować poza procesem aplikacyjnym. |
| **ACC-01** | Rejestrację publiczną odłączyć od MVP. |
| **ACC-02** | Nie tworzyć osobnego etapu potwierdzenia e-maila automatycznie; ustalić jego potrzebę w implementacji zaproszenia. |
| **ACC-03** | Wybór firmy odłączyć od MVP: konto obsługuje jedną firmę. Druga firma to osobna prerejestracja i konto, nie nowa pozycja selektora. |
| **ACC-04** | Zachować na hoście firmy w wspólnym stylu panelu. Pierwsze skuteczne zakończenie rejestracji jest startem trialu i wyzwala publikację strony, również pustej; uwzględnić jawny warunek publicznego trialu. |
| **ACC-05** | Samodzielne utworzenie firmy odłączyć; zastępuje je PLT-04. |
| **ACC-06** | Rozbudowany onboarding firmy odłożyć; wykorzystać istniejący empty state dashboardu i formularz pierwszego pojazdu. |
| **ACC-07** | Zachować jako materiał bezpieczeństwa; MFA jest obowiązkowe dla superadmina i admina firmy. |
| **ACC-08** | Samoobsługowe przekazanie własności odłożyć. |
| **TEN-01** | Zespół i zaproszenia pracowników odłączyć: dokładnie jedno konto administratora na firmę. |
| **TEN-02** | Usunąć edytor u admina firmy. Przenieść edycję publicznego logo/danych/treści/zdjęć do PLT-03/04; kolory, fonty, ikony i panel pozostają stałe. |
| **TEN-03** | Kreator domen u klienta odłożyć. Superadmin przygotowuje `{slug}.{publicDomainAutervy}` albo domenę własną klienta, prowadzi walidację DNS/TLS i ustawia przekierowanie po aktywacji domeny własnej. |
| **TEN-04** | Uprościć do statusu usługi: opłacona data włącznie, trial, publiczny adres i stan witryny. Po końcu opłaty komunikat o niewidoczności oraz czynny czat, bez blokady panelu. |
| **TEN-05** | Rozliczenia/faktury odłączyć od pierwszego wydania. |
| **TEN-06** | Zmianę planu odłożyć. |
| **TEN-07** | Wynik płatności odłożyć. |
| **TEN-08** | Samoobsługowe zamykanie/rozliczanie odłączyć. Firma jest archiwizowana przez superadmina bez trwałego kasowania; logowanie i publiczna strona są wtedy wyłączone. |
| **TEN-09** | Czasowy dostęp diagnostyczny odłożyć. Nie udawać, że to nowy czat; czat dostaje osobne TEN-11. |
| **TEN-10** | Nie wymagać ręcznej pierwszej publikacji: następuje po rejestracji. W dashboardzie wystarczy status strony, domeny i pustej/publikowanej floty. |
| **PUB-09** | Wykorzystać jako projekt neutralnej niedostępności całej strony po końcu opłaty. Nie ujawniać przyczyny finansowej. Nie używać do aktywnej pustej oferty. |
| **PUB-10** | Zachować neutralny stan nieznanego hosta jako zabezpieczenie routingu. |
| **PLT-01** | Pulpit superadmina przenieść na app; ograniczyć do dwóch KPI: firmy opłacone i firmy w trialu. |
| **PLT-02** | Lista firm na app; domyślnie niezarchiwizowane, z przełącznikiem „Pokaż zarchiwizowane”. Osobno pokazać archiwizację, opłatę i widoczność. |
| **PLT-03** | Karta firmy: dane, publiczny wygląd, okres, domena, zaproszenie, archiwizacja i czat. Dodać zagnieżdżone „Zarządzanie firmą” z pełną obsługą jej floty i danych. |
| **PLT-04** | Zachować jako prerejestrację po wcześniejszej akceptacji wyglądu. |
| **PLT-05** | Duże centrum zadań/integracji odłożyć; problemy zaproszenia/domeny pokazywać na karcie firmy. |
| **PLT-06** | Wykorzystać istniejący prosty audyt, jeśli jest gotowy. Rejestrowanie krytycznych zmian pozostaje niezależnie od bogactwa ekranu. |
| **PLT-07** | Sesje pomocy/granty odłożyć. Pełna obsługa konkretnej firmy działa jako zagnieżdżony obszar superadmina, bez impersonation i bez podszywania się pod konto klienta. |
| **PLT-08** | Logowanie operatora przenieść z ops na app; izolować od ADM-01. |

**Dwa nowe identyfikatory widoków:** `TEN-11` — czat firmy z Autervą; `PLT-09` — wiadomości firm po stronie superadmina. Liczba dodatkowych boardów wynika ze stanów i responsive, nie z potrzeby wymyślania nowych funkcji.

<a id="s15"></a>
## 15. Specyfikacja widoków rozszerzenia

### 15.1. Wspólny kontrakt makiety — R/B

Każdy projekt opisuje: rolę, host, źródłowe wymaganie, stan dostępu, zawartość, główną akcję, błędy oraz wersję M/D. Wariant zależny od pytania oznaczać odpowiednim Q.

Bazowe stany B: loading, empty, error/retry, saving, validation, unauthorized i offline — tylko tam, gdzie mają zastosowanie. Nie powielać całej makiety dla każdego hovera. Stany biznesowe muszą być pokazane w kontekście, nie tylko wymienione w opisie.

### 15.2. MKT-01 — onepage Autervy

**Podstawa:** REQ-MVP-01, 08–09. **R:** układ rozdziału 12.1.

Na mobile treść i telefoniczny CTA przed dużą ilustracją. Na desktopie możliwy dwukolumnowy hero z zatwierdzonym zrzutem produktu. Menu przewija do sekcji; aktywne CTA nie prowadzi do rejestracji ani panelu superadmina.

Makieta ma zawierać końcowe polskie teksty robocze bez niepotwierdzonych deklaracji liczby klientów, wzrostów przychodu czy „rezerwacji online”. Warstwa marketingowa nie pokazuje prywatnych ekranów rzeczywistych firm.

**Odbiór:** odbiorca rozumie, że kupuje narzędzie do prowadzenia oferty, a założenie firmy odbywa się przez kontakt z Autervą.

### 15.3. PLT-08 — logowanie superadmina

**Podstawa:** REQ-MVP-02, 17. **Host:** `app.auterva.example`.

Wykorzystać anatomy istniejącego loginu, lecz oznaczyć „Panel Auterva”. Nie tworzyć wspólnego wyboru „firma/superadmin” po stronie klienta. Brak publicznej rejestracji operatora.

P/R: login, hasło, obowiązkowe MFA, błędne dane, ograniczenie prób i odzyskanie dostępu zgodne z uzgodnioną procedurą. Nie dodawać przycisku, który umożliwia dowolnej osobie utworzenie superadmina.

**Odbiór T:** konto firmy jest odrzucane na hoście platformy, nawet jeśli poda prawidłowe firmowe hasło.

### 15.4. PLT-01 / PLT-02 — pulpit i lista firm

**Podstawa:** REQ-MVP-02, 28. Pulpit może pozostać nagłówkiem listy i pokazuje dokładnie dwa KPI zatwierdzone w Q-11.

**P:** dodać „Pokaż zarchiwizowane”. Bez zaznaczenia widoczne są niezarchiwizowane firmy, także te z wygasłą opłatą. Po zaznaczeniu również archiwum. Filtr archiwum nie zmienia dat ani nie przywraca firmy.

**R:** nazwa, host panelu, publiczny adres, stan rejestracji, opłacony/trial/wygasły okres i osobny stan publicznej widoczności. Znacznik archiwum oraz nowych wiadomości nie mogą być jednym badge’em. Kliknięcie prowadzi do PLT-03, a skrót rozmowy do właściwego PLT-09.

Mobile: czytelne karty i filtr; desktop: tabela. Stany: brak firm, brak wyników, loading/error, prerejestracja, opłacona, trial warunkowy, opłata wygasła, archiwalna, archiwum widoczne.

**Odbiór:** zarchiwizowana firma nie znika z systemu; można ją odszukać po włączeniu filtra. Samo wygaśnięcie opłaty nie ukrywa jej na domyślnej liście.

### 15.5. PLT-04 — dodaj firmę

**Podstawa:** REQ-MVP-09–13, 15, 20–25.

**R:** jeden formularz: „Firma i jedno konto administratora”, „Adres panelu i adres publiczny”, „Wygląd publiczny”, „Okres usługi”. Pola według §9.2, bez zespołów i klientowego onboardingu.

W sekcji publicznej zawartości: logo, dane, treści i zdjęcia pokazane w preview z użyciem wspólnego buttona, karty i headera. **Brak** wyboru kolorów, fontu, ikon i personalizacji panelu. Motyw admina nie jest polem formularza.

Domena własna jest opcjonalna, jeśli przygotowano publiczny adres testowy Autervy. Nie używać w jego miejsce `alfa.sites.auterva.example`, bo to host panelu.

Dla płatnego okresu pokazać „Do dnia włącznie”. Dla trialu: **„336 godzin od zakończenia rejestracji administratora”**, bez ręcznego pola daty rozpoczęcia. Publiczna strona działa podczas tego jednorazowego trialu.

Stany: pusty/częściowy, zajęty slug, błędny e-mail/domena, niegotowy routing/TLS, zły okres, błędne logo/kontrast, zapis, błąd wysyłki i potwierdzenie zapisu.

**Odbiór:** zapis prerejestracji i e-mail nie rozpoczynają trialu ani publikacji. Formularz uprzedza, że skuteczna rejestracja uruchomi publiczną stronę, również z pustą flotą, w ramach zatwierdzonych warunków okresu.

### 15.6. PLT-03 — karta firmy, konfiguracja i obsługa

**Podstawa:** REQ-MVP-02, 10–15, 19–28.

**R:** nagłówek z nazwą, hostem panelu, publicznym adresem własnym/testowym i niezależnymi stanami rejestracji, okresu, widoczności oraz archiwizacji. Główne sekcje: dane/adresy, publiczny wygląd, okres, zaproszenie. Rozmowa jest łatwo dostępna.

**P:** tylko tutaj, po stronie superadmina, edytujemy publiczne logo, dane, treści i zdjęcia. Zapis nie zmienia wspólnego systemu wizualnego ani motywu admina. Opłacona data końcowa obejmuje cały dzień; po jej końcu panel firmy pozostaje funkcjonalny, lecz publiczna strona jest wyłączona.

**P/R — zagnieżdżenie:** „Zarządzanie firmą” prowadzi do floty, formularza pojazdu, mediów, kalendarzy i ustawień tej firmy. Główne menu superadmina pozostaje małe. Wszędzie widoczne „Zarządzasz firmą: [nazwa]” oraz powrót do PLT-03. Szczegóły wariantu opisuje §15.14.

**Archiwizacja:** „Archiwizuj firmę” w działaniach dodatkowych, nie „Usuń na zawsze”. Po archiwizacji zachowujemy dane, blokujemy logowanie admina i wyłączamy publiczne adresy; na liście firma jest dostępna przez filtr. Przywrócenie odblokowuje login, a widoczność publiczną po opłaceniu odblokowuje superadmin.

**Odbiór:** superadmin może dotrzeć do pełnej obsługi Alfy bez szukania jej w globalnej flocie i bez opuszczania swojej roli. Zmiany są przypisane do niego w audycie.

### 15.7. ACC-04 — rejestracja i aktywacja konta firmy

**Podstawa:** REQ-MVP-03, 11, 21–25.

**P/R/B:** wspólny wygląd panelu, nazwa firmy, e-mail adresata, nowe hasło, potwierdzenie i „Aktywuj konto”. Nie wymagamy ponownego wgrywania logo, zakupu domeny, wyboru planu ani utworzenia kolejnego konta.

**P:** dopiero skuteczne zakończenie rejestracji na serwerze uruchamia zdarzenie pierwszej publikacji i, jeśli przyznano trial, jego początek. Samo otwarcie linku nie robi żadnej z tych rzeczy.

Przy rejestracji uprzedzić o publicznym uruchomieniu strony. Sukces dla aktywnego opłaconego okresu lub trialu i pustej floty pokazuje publiczny adres z informacją, że ofertę można teraz uzupełnić; nie wymaga „Opublikuj firmę”. Nie projektować przyszłej daty startu.

**R — tekst sukcesu dla spełnionych warunków:** „Konto zostało aktywowane. Twoja strona publiczna jest już dostępna. Dodaj pojazdy, aby uzupełnić ofertę.” Nie pokazywać tego tekstu, gdy routing jeszcze nie działa.

**Odbiór:** jedna rejestracja, jedno konto firmy, jeden start trialu, brak ponownej publikacji przez odświeżenie. Wariant publicznego trialu jest zgodny z osobną zatwierdzoną decyzją.

### 15.8. TEN-04 — okres usługi i publiczna widoczność

**Podstawa:** REQ-MVP-14–15, 19–21.

**R:** prosty widok/sekcja: nazwa firmy, rodzaj okresu, „Opłacono do [data] włącznie”, adres publiczny własny/testowy, status „Strona widoczna/wyłączona”, link do czatu.

**P:** po końcu płatnego okresu admin widzi komunikat o wyłączonej ofercie, ale nie traci możliwości zarządzania kontem, flotą i danymi. Przycisk „Napisz w sprawie przedłużenia” prowadzi do działającego TEN-11. Brak checkoutu, cen pakietów, dokumentów płatniczych lub przycisku odblokowania za płatność w aplikacji.

**Warianty:** aktywny płatny okres, ostatni opłacony dzień, po końcu opłaty z bannerem, trial oczekujący na rejestrację po stronie superadmina i aktywny trial. Przyszła data startu jest niedozwolona; koniec trialu wyłącza stronę publiczną przy zachowaniu pełnego panelu i czatu.

**Odbiór:** wygaśnięcie nie przełącza panelu na read-only. Publiczny adres oraz informacja, że cała strona jest wyłączona, są widoczne i zrozumiałe.

### 15.9. TEN-11 — czat z Autervą

**Podstawa:** REQ-MVP-16, 19, 26.

Tekstowa rozmowa zgodnie z §11: historia, nadawca/czas, „Napisz wiadomość do Autervy…” i „Wyślij”. **Bez załączników oraz e-mailowych alertów**. W nawigacji pokazujemy wskaźnik nowych wiadomości, np. kropkę z opisem dostępnościowym.

Mobile: kompozytor ponad klawiaturą, bez kolizji z dolną nawigacją. Desktop: czytelna kolumna wiadomości. Nowa wiadomość nie przerywa czytania historii. Nie dodajemy wskaźników „online” lub „odczytano” tylko dlatego, że biblioteka je oferuje.

Po końcu opłaty czat pozostaje w pełni dostępny. Przy błędzie nie usuwać wpisanej treści ani nie pokazywać pozornego sukcesu. Szkic jest lokalny dla rozmowy i zachowany przy jej zmianie; trwałe szkice offline nie są zamówione.

**Odbiór:** nowe wiadomości są zauważalne w panelu, nie generują e-maili i nie otwierają dostępu do innych firm.

### 15.10. PLT-09 — wiadomości firm

**Podstawa:** REQ-MVP-16, 26–27.

**R:** lista rozmów z kropką nowych wiadomości i wybrana rozmowa. Nagłówek oraz pole odpowiedzi stale wskazują firmę. Wejście z PLT-03 otwiera dokładnie tę firmę.

Prosty tekst, bez załączników, powiadomień e-mail i modułu ticketów. Firma z wygasłym opłaconym okresem nadal może pisać; superadmin nadal może odpowiadać.

Szkic nie przechodzi do nowego odbiorcy po kliknięciu innej firmy. Jest zachowany osobno dla poprzedniej rozmowy bez dialogu blokującego. Archiwizacja nie usuwa historii rozmowy, lecz blokuje logowanie admina firmy do czasu przywrócenia.

Stany: brak rozmów, wyszukiwanie bez wyników, nowe wiadomości, loading/error, sending/sent/failed, firma z wygasłą opłatą i zachowana historia archiwalna.

**Odbiór:** treść, odbiorca i `organizationId` są zgodne, a wysyłka jest przypisana do faktycznej tożsamości superadmina.

### 15.11. PUB-09 oraz banner panelu — koniec opłaconego okresu

**Podstawa:** REQ-MVP-19–20. Decyzja o końcu **opłaconego** okresu jest potwierdzona.

**PUB-09 — R:** neutralny stan wyłączonej całej strony, bez publicznej oferty, danych firmy i informacji o opłacie. Obejmuje również bezpośrednie wejścia do podstron. Proponowany tekst: „Ta strona jest obecnie niedostępna”. Nie robić z niego bannera nad nadal działającą ofertą.

**Panel — P/R:** pozostawić istniejący ekran, formularze i akcje, dodać nieblokujący banner opisany w §8.3 oraz stan TEN-04. Nie tworzyć ekranu „Zapłać, aby odzyskać dostęp do panelu”.

**ADM-19:** zachować wyłącznie rzeczywiste problemy uprawnień i sesji. Nie używać do blokowania konta za koniec trialu/opłaty; archiwizacja jest jedynym zatwierdzonym stanem blokującym logowanie admina firmy.

**Odbiór:** w tej samej chwili najemca nie pobiera publicznej oferty, a zalogowany admin nadal zapisuje pojazd i wysyła wiadomość. Nie zmienia się samoczynnie status archiwizacji firmy.

### 15.12. PUB-10 — host nieznany

**T/R:** neutralny stan bez danych firm. Nie wyświetlać losowej oferty, loginu platformy, wewnętrznego tenant ID ani listy zarejestrowanych klientów. Jest to stan routingu, nie kolejna strona marketingowa.

### 15.13. PUB-01/PUB-02 — oferta pojawi się wkrótce

**Podstawa:** REQ-MVP-25. Wariant istniejących stron, bez nowego numeru PUB.

**Warunek P:** konto admina zostało zarejestrowane, strona może być publiczna, lecz nie ma opublikowanych pojazdów. Zero pojazdów nie blokuje uruchomienia strony.

**R — mobile:** publiczny header z firmowym logo, czytelny tytuł „Nasza oferta pojawi się wkrótce”, krótki opis, delikatny element graficzny/ikona ze wspólnego zestawu oraz pozostałe bezpieczne elementy strony. Bez pustej siatki, nieaktywnych filtrów udających wyniki i fikcyjnych aut.

**R — desktop:** analogiczna treść w dopracowanej, spokojnej kompozycji z przestrzenią; to ten sam motyw firmy, nie ogólny błąd Autervy. Font i ikony pozostają wspólne.

Odróżnić stan od: braku wyników po filtrach, błędu sieci oraz wyłączonej strony po końcu opłaty. Dodanie i publikacja pierwszego pojazdu uruchamia standardową treść oferty bez nowej rejestracji.

### 15.14. Zagnieżdżone ADM-* wewnątrz PLT-03 — obsługa przez superadmina

**Podstawa:** REQ-MVP-27. Nie jest to nowy globalny panel floty ani drugie konto klienta.

**R:** wykorzystać istniejące widoki listy, formularza, zdjęć, kalendarza i danych firmy. Otoczyć je kontekstem: „Firmy → Alfa → Zarządzanie firmą”, ze stałą identyfikacją i powrotem do PLT-03. Główna nawigacja Autervy nadal obejmuje najważniejsze sekcje platformy.

Wymagane demonstracje w makietach:
1. PLT-02 → PLT-03 Alfy → „Zarządzanie firmą” → lista pojazdów Alfy.
2. Dodanie/edycja pojazdu i zdjęć, z powrotem do tej samej karty firmy.
3. Odczyt prywatnej blokady, jej edycja/usunięcie zgodnie z domeną.
4. Zmiana danych publicznej oferty bez zmiany tożsamości operatora.
5. Równoczesna zmiana przez admina i superadmina — czytelny konflikt, bez cichego nadpisania.
6. Właściwa identyfikacja superadmina w audycie.

Nie dodawać nowej kopii wszystkich komponentów. Adnotacja boardu ma wskazywać „wariant superadmina / firma Alfa”, a nie sugerować zalogowania jako admin Alfy.

<a id="s16"></a>
## 16. Komponenty, kolorystyka i responsywność

### 16.1. Wykorzystać bibliotekę zamiast tworzyć nową

**B:** Inter Variable, bazowe odstępy 4 px, Lucide, istniejąca geometria, focus, stany, responsive oraz łagodne animacje. Nie budować od nowa przycisków, inputów, dialogów, kart, tabel, uploadu i formularzy dat.

**P [U4]:** superadmin przygotowuje i później edytuje wyłącznie publiczne logo, dane, treści i zdjęcia. Kolory, ikony i czcionki pozostają wspólne. Wszystkie strony publiczne oraz panele firm, ich loginy, aktywacje kont i czat używają tego samego systemu wizualnego. Monochromatyczna paleta z [B2] obowiązuje w całym MVP.

### 16.2. Nowe kompozycje — propozycja R

| ID robocze | Kompozycja | Wykorzystuje / stany |
|---|---|---|
| DS-MVP-001 | Identyfikacja firmy | W panelu nazwa/adres w stałym stylu; publicznie BrandLogo z konfiguracji firmy. Nie nadawać panelowi publicznego motywu. |
| DS-MVP-002 | Podsumowanie okresu | Card, StatusBadge i daty; opłacony/trial/koniec opłaty, stan witryny oraz nieblokujący banner. |
| DS-MVP-003 | Formularz okresu | DateInput/Select; koniec opłaconego dnia włącznie, początek trialu od rejestracji i koniec dokładnie po 336 godzinach. |
| DS-MVP-004 | Karta/wiersz firmy | RecordCard/DataTable; okres, rejestracja, widoczność i archiwum jako osobne informacje; filtr „Pokaż zarchiwizowane”. |
| DS-MVP-005 | Konfiguracja publicznej zawartości | LogoUploader, dane, treści, zdjęcia i preview wyłącznie u superadmina. Bez wyboru kolorów, czcionek, ikon i motywu admina. |
| DS-MVP-006 | Stan zaproszenia | Alert, akcje; niewysłane/wysłane/błąd/aktywowane |
| DS-MVP-007 | Historia czatu | Lista wiadomości, nadawca, czas; loading/empty/retry |
| DS-MVP-008 | Pole wiadomości | Textarea, Button, feedback; sending/sent/failed |
| DS-MVP-009 | Lista rozmów i wskaźnik nowych | SearchInput/RecordCard, kropka przy czacie i dostępnościowy opis nowych wiadomości; brak e-mailowych alertów. |
| DS-MVP-010 | Stan publicznej strony | Status domeny oraz publikacji; automatyczny start po rejestracji, publiczna zapowiedź pustej oferty albo wyłączenie po końcu opłaty. |

Nazwy i numery najpierw sprawdzić w aktualnym repo/plikach, aby nie nadpisać wcześniej użytych ID. Lista nie wymusza dziesięciu niezależnych technicznych komponentów, gdy można użyć istniejącej kompozycji.

### 16.3. Publiczny motyw firmy i stały panel — P/R/T

**P:** zmieniane są logo i dozwolone kolory tokenów publicznej strony. Czcionki i zestaw ikon pozostają zawsze wspólne. Wszystkie panele administratorów firm zachowują ten sam motyw, również po zmianie publicznej identyfikacji.

**R/T:** utrzymywać wspólną bibliotekę i dwa zakresy stylów:
- panel Autervy/admina — stałe bazowe tokeny;
- publiczna oferta konkretnej firmy — logo, dane, treści i zdjęcia firmy w ramach wspólnych tokenów wizualnych.

Publiczny preview w panelu dostaje własny zakres stylowania wewnątrz podglądu; nie zmienia nawigacji, formularzy ani czatu wokół niego. Nie tworzyć osobnego CSS/forka aplikacji dla każdej firmy.

**P/R:** wykorzystywać wspólne semantyczne kolory akcji, tekstu na akcji i akcentu. Nie udostępniać selektora kolorów, fontów i ikon ani dowolnego HTML/CSS/JS.

**B/T:** sprawdzać kontrasty oraz stany hover/focus/disabled. Konfiguracja marki nie może zniszczyć czytelności kalendarza lub rozróżnienia dostępności. Zmiana publicznego logo firmy A nie modyfikuje firmy B ani żadnego panelu.

**R:** dialog archiwizacji oraz pusta zapowiedź korzystają z istniejących ConfirmDialog i EmptyState. Nie wymagają kolejnego zestawu przycisków, kolorów czy animacji.

### 16.4. Widoki i ruch

**B:** główne M 390×844 i D 1440×1024, kontrola 320 px, 430 px, 768 px, 1024 px oraz 1920 px. Pełna funkcjonalność admina na mobile. Dodany status usługi i czat nie mogą zasłonić istniejących pól i sticky CTA.

**B:** motion 120/180/240 ms i reduced motion z [B2]. W tym uproszczeniu nie ma nowej potrzeby wideo, efektów 3D, osobnej biblioteki animacji czy rozbudowanego demonstratora. Zachować dotychczasowy ruch, jeśli nie koliduje z czytelnością i działaniem.

**R:** w Penpocie odpowiedzi systemu i przepływy czatu można pokazać kontrolowanymi stanami. Nie deklarować na podstawie prototypu, że wiadomości są faktycznie przesyłane lub że działa autoryzacja.


<a id="s17"></a>
## 17. Prosta architektura i model danych

### 17.1. Architektura referencyjna — R, nie wykonana decyzja wdrożeniowa

Zachować obecny modularny monolit, jeden rozwijany kod i istniejący stos z [B1], o ile stan repozytorium go potwierdza. Cztery obszary pod różnymi hostami nie wymagają czterech osobnych produktów ani repozytorium dla każdej firmy.

Proponowany podział wewnętrzny:
- marketing Autervy;
- operacje platformy;
- administracja własną firmą;
- oferta publiczna firmy;
- wspólne moduły floty, dostępności, mediów, auth, dostępu czasowego i rozmów.

Nie wprowadzać mikroserwisów, Kubernetes, silnika uprawnień pakietowych, billing engine lub realtime tylko dlatego, że produkt jest SaaS.

Dokładne wersje Next.js, React, Prisma i auth trzeba sprawdzić w istniejących plikach. Nazwa biblioteki z PRD nie jest dowodem jej zainstalowania lub zgodności z nowym modelem hostów.

### 17.2. Minimalne rozszerzenia modelu — R

| Obszar danych | Minimalna informacja | Czego nie dokładamy |
|---|---|---|
| Firma / Organization | ID, nazwa, identyfikacja panelu, metadane, stan i data archiwizacji | Trwałego kasowania firmy z panelu, oddziałów i marketplace’u |
| Przypisanie hosta | Host, typ `PLATFORM_ADMIN` / `COMPANY_ADMIN` / `COMPANY_PUBLIC`, firma jeśli dotyczy, stan konfiguracji | Publiczna lista wszystkich klientów |
| Użytkownik i przypisanie | Jedno aktywne konto admina na firmę, konto przypisane do jednej firmy; osobne uprawnienie superadmina | Zespołów, wspólnego konta wielu firm i ról OWNER/OPERATOR |
| Zaproszenie | Firma, adresat, bezpieczne dane tokenu, ważność, użycie/anulowanie, wysyłka | Drugiego równoległego mechanizmu, jeśli biblioteka już to zapewnia |
| Okres usługi | Firma, tryb opłacony/trial, opłacona data końcowa włącznie, start trialu z pierwszej rejestracji, autor zmian | Blokowania panelu za sam koniec opłaty; cen, faktur, kart i pakietów |
| Wygląd | Publiczne logo, dane, treści i zdjęcia firmy, edytowalne tylko przez superadmina | Indywidualnych kolorów/fontów/ikon, motywu panelu i kodu klienta |
| Ustawienia oferty | Istniejące SiteSettings przypisane do firmy | Globalnego singletonu dla wszystkich wypożyczalni |
| Rozmowa / wiadomość | Firma, nadawca, treść tekstowa, kolejność/czas i stan do wskaźnika nowych wiadomości | Załączników, e-mailowych alertów, ticketów i SLA |
| Audyt | Aktor, obszar, firma, działanie, czas i bezpieczna zmiana | Haseł, pełnych tokenów i pełnych kopii czatu |

Nie przesądza to o jednej tabeli na każdy wiersz. Wykorzystać istniejące modele auth, ale egzekwować potwierdzoną liczebność kont. `organizationId` jest potrzebne dla każdej firmy niezależnie od tego, że ma ona tylko jednego admina. Adres e-mail administratora jest globalnie unikalny zgodnie z Q-04A.

**R/T — konsekwencje danych:** zachować jedno trwałe zdarzenie pierwszej rejestracji (np. `firstAdminRegisteredAt`), z którego wynika `trialStartsAt`; oddzielić koniec publicznego okresu od ważności konta; archiwizację zapisać jako stan bez usuwania rekordów; publiczny adres testowy mapować do tej samej firmy, co jej własną domenę. Są to propozycje pól, nie gotowa migracja.

### 17.3. Zmiany danych istniejących — R/T

`Vehicle`, `VehicleImage`, `AvailabilityPeriod`, `SiteSettings`, przekierowania slugów i audyt muszą mieć jednoznaczne powiązanie z firmą. Powiązanie dziecka z pojazdem nie może łączyć organizacji A z pojazdem B.

Proponowane ograniczenia:
- slug pojazdu unikalny **w firmie**, nie globalnie;
- host panelu oraz domena publiczna przypisane jednoznacznie w platformie;
- obrazy i blokady powiązane z pojazdem tej samej firmy;
- `SiteSettings` jednoznacznie przypisane do firmy;
- identyfikator ponawianej wiadomości nie pozwala zapisać jej dwukrotnie;
- firma po rejestracji ma jedno aktywne konto admina, a konto nie jest przypisywane do drugiej firmy;
- archiwizacja zachowuje powiązania firmy, floty i rozmowy;
- pierwsza rejestracja i start trialu nie mogą być ponownie nadpisane przez retry.

Historia zajętości nie jest kopiowana między firmami. Przesunięcie daty dostępu do Autervy nie zmienia automatycznie zakresów blokad pojazdów.

### 17.4. Publiczne versus prywatne odczyty — T

Publiczny host zwraca tylko zatwierdzone dane publiczne: opublikowane pojazdy, zdjęcia oferty, kontakt i informację o dostępności. Nie korzysta z sesji superadmina ani admina firmy do „wygodnego wspólnego odczytu”.

Przegląd platformy i pełna obsługa konkretnej firmy odbywają się przez jawne operacje superadmina, związane z firmą otwartą w zagnieżdżonej nawigacji. Konto firmy nie zyskuje z tego powodu globalnego dostępu. Treść czatu nigdy nie jest częścią publicznych ustawień.

**P/T:** po końcu opłaty zablokować wszystkie publiczne odczyty oferty, także na domenie testowej. Nie używać tej samej blokady do odmowy prywatnej edycji floty lub wysłania czatu; te funkcje konta pozostają dostępne. Stan konta, publiczna widoczność i archiwizacja to odrębne kontrole.

Cache strony, funkcji serwerowych, listy zdjęć i wyników wyszukiwania rozróżnia firmę oraz obszar public/private. Sam dopisek do tagu unieważniania bez właściwego klucza odczytu nie daje izolacji.

### 17.5. Migracja bez utraty dotychczasowej pracy

R:
1. Sprawdzić realny stan implementacji — nie zakładać, że poza makietami istnieje produkcyjna baza.
2. Jeśli jest tylko design, zaktualizować kontrakty przed pierwszą migracją.
3. Jeśli istnieją dane, przypisać obecne rekordy do konkretnej firmy na podstawie potwierdzonego mapowania; bez zgadywania właściciela.
4. Przygotować bezpieczną kopię i sprawdzony plan odtworzenia.
5. Rozszerzyć schemat, odczyty, mutacje, cache i storage, zanim zostanie dodana druga realna firma.
6. Przetestować A/B i dopiero wtedy aktywować obsługę wielu klientów.
7. Nie wykonywać rollbacku do wersji, która odczytuje wszystkie dane jak dane pojedynczej firmy.

<a id="s18"></a>
## 18. Zabezpieczenia i kryteria techniczne

To propozycja zabezpieczeń T na potrzeby REQ-MVP-17, nie opis już działającego systemu. Jest odrębna od niepotwierdzonych zasad handlowych. Niewielka liczba ekranów nie zwalnia z kontroli danych.

### 18.1. Izolacja między firmami

Serwer potwierdza firmę dla każdej operacji, a nie tylko przy logowaniu. Sprawdzenie obejmuje także relacje, pliki, rozmowy i zadania działające poza obsługą żądania. Brak lub konflikt kontekstu kończy się odmową, nie wyborem pierwszej firmy z bazy.[W1]

Test kontrolny: użytkownik Alfy podmienia ID pojazdu, zdjęcia lub rozmowy na ID Bety. Odczyt i zapis pozostają niedozwolone. Odpowiedź nie ujawnia prywatnego istnienia zasobu.

### 18.2. Sesje i hosty

Proponowane cookies: `Secure`, `HttpOnly`, właściwe `SameSite`, bez szerokiego atrybutu Domain. Gdy pasuje do implementacji, prefiks `__Host-` dodatkowo wiąże cookie z ograniczeniami przeglądarki. Weryfikować obszar sesji i firmę na serwerze; nie traktować samej nazwy cookie jako kontroli dostępu.[W2]

Oddzielić logowanie operatora i klienta. Kopia tokenu admina firmy nie może stać się sesją superadmina na `app`. Wylogowanie i odebranie uprawnienia muszą działać również na bezpośrednich endpointach.

### 18.3. CSRF i zaufanie do subdomen

`SameSite` nie rozdziela automatycznie zaufania między siostrzanymi subdomenami. Weryfikować dozwolony Origin i stosować adekwatną ochronę CSRF dla mutacji. Nie zezwalać na credentialed CORS dla dowolnych `*.auterva.example`; zaufanie do całej rodziny hostów rozszerza ryzyko.[W4]

Żądanie z publicznej oferty lub panelu innej firmy nie powinno móc wysłać administracyjnej mutacji w cudzej sesji. Żadne pobranie GET, preload ani skan linku nie powinny aktywować konta, publikować firmy lub usuwać danych.

### 18.4. Zaproszenia i odzyskiwanie hasła

Linki generować na podstawie zatwierdzonego adresu panelu, nie dowolnego nagłówka Host. Stosować jednorazowe, bezpiecznie przechowywane tokeny, ograniczoną ważność i ochronę przed masowym zgadywaniem. Ekrany tokenów nie powinny przekazywać ich dalej przez referrer ani zbędną analitykę.[W3]

Nowa wysyłka, anulowanie zaproszenia i zmiana adresata muszą mieć zdefiniowane skutki. Ponowne wydanie unieważnia poprzedni niewykorzystany link, a każde zaproszenie jest ważne 7 dni. Początek trialu to pierwsze skuteczne zakończenie rejestracji. Ponowne wysłanie e-maila nie rozpoczyna go ani nie odnawia.

### 18.5. Dodatkowa izolacja bazy

R/T: przy wspólnej bazie można zastosować PostgreSQL RLS jako dodatkową warstwę. Rola wykonywania żądań tenantowych nie powinna omijać RLS. Właściciel tabeli, superużytkownik i `BYPASSRLS` wymagają szczególnej uwagi; kontekst tenanta przy poolingu wiązać z transakcją i czyścić po jej zakończeniu.[W5]

RLS nie zastępuje weryfikacji konta i praw w aplikacji. Implementacja wymaga testów rzeczywistego runtime; samo dopisanie polityki SQL do PRD nie potwierdza bezpieczeństwa.

### 18.6. Media, zawartość i wiadomości

B/T: ograniczenia uploadu, weryfikacja typu i bezpieczne renderowanie. Logotyp klienta nie może dostarczać wykonywanego kodu. Media firmy nie są bezpieczne tylko dlatego, że ścieżka zaczyna się od jej ID — potrzebna jest odpowiednia polityka dostępu.

Publiczne zdjęcia oferty i prywatne/robocze materiały rozróżnić. Po usunięciu lub wyłączeniu oferty uwzględnić cache, CDN i wcześniej pobrane kopie; nie obiecywać cofnięcia danych już zapisanych przez odwiedzającego.

Tekst czatu wyświetlać bez interpretacji jako HTML. Załączniki i e-mailowe powiadomienia czatu są wyłączone z zakresu P — nie implementować ich przez sam fakt dostępności w bibliotece.

### 18.7. Dane Autervy i pełny dostęp superadmina do firmy

**P:** superadmin może obsługiwać wszystkie dane operacyjne firmy w zagnieżdżonych widokach. **T:** zachować jego własną tożsamość, kontekst wskazanej firmy i audyt. Nie wyłączać zabezpieczeń wszystkich endpointów tylko dlatego, że operator ma pełne uprawnienia.

Hasła, klucze pocztowe i sekrety bazy/domen nie są elementem „pełnej edycji firmy”. Pozostają poza repozytorium, przeglądarką i makietami. Nie udostępniać dowolnego SQL ani usuwania śladów audytu.

**B/T:** rejestrować tworzenie i archiwizowanie firm, zmiany okresu, domen, publicznego wyglądu, zaproszeń, praw i operacyjne zmiany floty. W audycie odróżniać `ADMIN_FIRMY` od `SUPERADMIN_AUTERVA` oraz wskazywać docelową firmę.

**P:** MFA jest obowiązkowe dla superadmina i administratora firmy. Pełna rola operacyjna nie pozwala omijać drugiego składnika.

### 18.8. Backup, archiwum i cykl życia danych

**P:** archiwizacja firmy nie kasuje jej danych ani rozmowy. Nie uruchamia automatycznego purge po upływie opłaty/trialu. Wgląd w firmy archiwalne zapewnia filtr w panelu superadmina.

**B/T:** kopie zapasowe, test odtworzenia i separacja staging/production pozostają. Wspólny backup nie jest automatycznie mechanizmem odtworzenia jednej firmy; odzyskanie nie może nadpisać danych pozostałych klientów.

**P:** Q-10A określa blokadę logowania/publicznej strony po archiwizacji i przywrócenie kontrolowane przez superadmina. MVP nie ma automatycznego purge ani panelowej akcji trwałego usunięcia. Nie jest to obietnica bezterminowego przechowywania wszystkich backupów ani rozstrzygnięcie każdej sytuacji prawnej poza zwykłym panelem.

Właściwe warunki usługi, prywatności i retencji wymagają oceny dla rzeczywistej działalności. Ten dokument nie jest opinią prawną ani deklaracją zgodności.

<a id="s19"></a>
## 19. Przepływy do połączenia w prototypie

Identyfikatory `FLOW-MVP-*` oznaczają proponowane scenariusze do weryfikacji, nie nowe moduły produktu. Q w ścieżce blokuje finalny wariant, nie pracę nad pozostałymi ekranami.

| ID | Przebieg | Co ma być widoczne |
|---|---|---|
| FLOW-MVP-01 | MKT-01 → rozmowa telefoniczna → prezentacja/akceptacja poza aplikacją → PLT-04 | Rozdzielenie sprzedaży od systemowej rejestracji; brak formularza zakładania firmy przez klienta |
| FLOW-MVP-02 | PLT-04 → zapis firmy → PLT-03 → e-mail → ACC-04 → zakończona rejestracja → panel firmy i publiczna strona | Host właściwej firmy, wspólny styl panelu, osobny wynik poczty i automatyczna publikacja przy spełnionych warunkach okresu |
| FLOW-MVP-03 | PLT-03 → trial oczekujący → pierwsza rejestracja z zaproszenia → TEN-04 | Początek trialu z rejestracji; dokładnie 336 godzin publicznego działania; nie startuje od wysłania/otwarcia e-maila |
| FLOW-MVP-04 | ACC-04 → publiczna zapowiedź pustej oferty → ADM-06 → zdjęcia i publikacja pojazdu → zwykłe PUB-01/02 | Brak pojazdów nie blokuje strony i nie wymaga ręcznej pierwszej publikacji firmy |
| FLOW-MVP-05 | PUB-02 → PUB-03 → dostępność → telefon → ADM-09/OVR-06 → publiczny wynik niedostępny | Rezerwacja odbywa się poza systemem; klient nie dokonuje zapisu |
| FLOW-MVP-06 | ADM-04/TEN-04 → TEN-11 → PLT-09 → odpowiedź → znacznik nowych w panelu → TEN-11 | Wyłącznie tekst; bez załączników i mailowych alertów czatu; realtime, status odczytu i szkic per rozmowa; wiadomości dostępne także po końcu okresu |
| FLOW-MVP-07 | PLT-03 → przedłuż okres → TEN-04 | Zmieniona data, brak udawanego przelewu/checkoutu |
| FLOW-MVP-08 | Koniec opłaconego dnia → wyłączona publiczna strona + pełny panel z bannerem → TEN-11 | Publiczny brak oferty na wszystkich adresach; zapis floty i czat nadal działają; ponowne uruchomienie po przerwie Q-07B |
| FLOW-MVP-09 | PLT-03 → publiczne logo/dane/treści/zdjęcia → preview i strona firmy → panel firmy | Zmiana dotyczy tylko publicznej zawartości danej firmy; kolory, fonty, ikony i panel pozostają bez zmian |
| FLOW-MVP-10 | PLT-03 → Archiwizuj firmę → lista niezarchiwizowanych → Pokaż zarchiwizowane | Dane zachowane; firma dostępna w archiwum. Dodatkowe skutki konta/widoczności Q-10A |
| FLOW-MVP-11 | PLT-02 → PLT-03 Alfy → Zarządzanie firmą → ADM-* w kontekście superadmina → PLT-03 | Dodawanie/edycja/dozwolone usuwanie zagnieżdżone pod firmą, właściwy aktor i powrót, bez globalnego menu floty |
| FLOW-MVP-12 | Brak własnej domeny → `{slug}.{publicDomainAutervy}` → rejestracja → pusta lub pełna oferta → późniejsza domena własna | Odrębność panelu i adresu publicznego; zakup domeny przez klienta, walidacja DNS/TLS i przekierowanie po aktywacji |

Pocztę, telefon i wiadomości w samym Penpocie można symulować. Symulacja ma być opisana i nie jest testem dostarczalności ani dowodem, że backend działa. Testy prototypów nie wykonują prawdziwych połączeń lub usunięć.

<a id="s20"></a>
## 20. Testy i kryteria akceptacji

Każdy scenariusz ma przejść na odpowiednim poziomie: domena, integracja, E2E albo przegląd makiety. Poniższa lista to **plan**, nie wynik wykonanych testów.

| ID | Scenariusz | Oczekiwany rezultat |
|---|---|---|
| TEST-MVP-01 | Otwórz cztery wskazane hosty | Każdy realizuje swoją rolę; app nie jest panelem Alfy |
| TEST-MVP-02 | Wejście niezalogowane do obu typów panelu | Brak prywatnych danych w HTML, API i cache |
| TEST-MVP-03 | Konto Alfy próbuje wejść do app | Brak prawa superadmina |
| TEST-MVP-04 | Konto Alfy otwiera panel Bety | Brak dostępu do danych Bety |
| TEST-MVP-05 | Podmień ID pojazdu na cudzy w odczycie | Brak wycieku, nawet przy prawidłowej sesji Alfy |
| TEST-MVP-06 | Podmień ID w edycji/usunięciu blokady/zdjęcia | Brak zapisu w innej firmie |
| TEST-MVP-07 | Podmień ID rozmowy | Brak dostępu do cudzego czatu |
| TEST-MVP-08 | Pobierz publiczną ofertę | Tylko opublikowane dane firmy, bez notatek, okresu usługi i czatu |
| TEST-MVP-09 | Otwórz /admin lub admin API na publicznej domenie | Brak administracyjnego dostępu na tym obszarze |
| TEST-MVP-10 | Nieznany host kieruje do aplikacji | Neutralna odmowa/stosowny brak strony, bez domyślnego klienta |
| TEST-MVP-11 | Ten sam slug pojazdu u dwóch firm | Dozwolony przy poprawnym firmowym kontekście |
| TEST-MVP-12 | Próba zajęcia już przypisanego hosta | Odrzucona; nie zmienia właściciela domeny |
| TEST-MVP-13 | Zapis prerejestracji ponowiony po timeout | Jedna firma, czytelny rzeczywisty rezultat |
| TEST-MVP-14 | Firma zapisana, poczta nie wysłana | Można ponowić zaproszenie bez tworzenia drugiej firmy |
| TEST-MVP-15 | Link otwiera skaner pocztowy/GET | Nie aktywuje konta i nie rozpoczyna trialu |
| TEST-MVP-16 | Poprawna pierwsza rejestracja z zaproszenia | Jedno konto właściwej firmy; wyzwala start trialu, jeśli nadany, i automatyczną publikację w zatwierdzonym zakresie. Nie publikuje sam GET. |
| TEST-MVP-17 | Token wykorzystany, starszy po resend, anulowany albo starszy niż 7 dni | Brak ponownej aktywacji; kontrolowany komunikat bez ujawniania wrażliwych danych |
| TEST-MVP-18 | Link/tokenu użyto na innym hoście | Odrzucony albo bezpieczny zatwierdzony powrót; nie daje cudzych praw |
| TEST-MVP-19 | Reset hasła | Bez ujawnienia istnienia kont; powrót do właściwego obszaru |
| TEST-MVP-20 | Opłacony okres i trial w TEN-04 | Różne etykiety; trial nie udaje zapłaconej usługi |
| TEST-MVP-21 | Koniec ostatniego opłaconego dnia | Publiczna strona działa do końca daty w Europe/Warsaw, następnie jest wyłączona. Panel, edycja floty i czat pozostają dostępne. |
| TEST-MVP-22 | Trial na przełomie zmiany czasu | Start z pierwszej rejestracji i koniec dokładnie po 336 godzinach; lokalna zmiana czasu nie zmienia długości trialu. |
| TEST-MVP-23 | Refresh, ponowny login lub ponowione zaproszenie | Nie zmienia utrwalonego zdarzenia pierwszej rejestracji i nie uruchamia nowego 14-dniowego trialu. |
| TEST-MVP-24 | Przedłużenie lub skrócenie okresu | Aktualne daty w obu panelach i audyt; bez fikcyjnej płatności. Skrócenie nie blokuje prywatnego panelu; publiczne wznowienie po przerwie według Q-07B. |
| TEST-MVP-25 | Okres płatny kończy się podczas zapisu pojazdu | Zapis pozostaje dozwolony przy poprawnej sesji i regułach domenowych. Równocześnie publiczny odczyt jest zablokowany. |
| TEST-MVP-26 | Rejestracja admina z zerem pojazdów w aktywnym okresie | Automatyczna publikacja publicznej witryny z zapowiedzią. Dodanie/publikacja pojazdu później zmienia treść, nie wymaga aktywowania firmy ponownie. |
| TEST-MVP-27 | Jednodniowy zakres i styk blokad | Zachowane reguły B1 z końcem włącznie |
| TEST-MVP-28 | Dwa równoczesne nakładające się zapisy blokady | Brak dwóch sprzecznych okresów |
| TEST-MVP-29 | Telefoniczny kontakt z oferty | Nie powstaje konto, rezerwacja ani płatność |
| TEST-MVP-30 | Wysłanie i ponowienie wiadomości | Jedna wiadomość przy tej samej operacji; potwierdzony zapis |
| TEST-MVP-31 | Superadmin zmienia rozmowę podczas pisania | Brak wysyłki szkicu do niewłaściwej firmy; szkic zostaje lokalnie przy poprzedniej rozmowie i wraca bez dialogu blokującego |
| TEST-MVP-32 | Zapis zawierający HTML/skrypt w wiadomości/opisie | Treść nie wykonuje kodu |
| TEST-MVP-33 | Rozgrzej cache Alfy, potem otwórz Betę | Brak obcych logo, pojazdów, kontaktów i dat |
| TEST-MVP-34 | Żądanie mutacji z siostrzanej subdomeny | Zabezpieczenia CSRF/Origin działają; samo SameSite nie jest jedyną kontrolą |
| TEST-MVP-35 | Zmiana publicznego logo, danych, treści lub zdjęć | Tylko publiczna strona wybranej firmy zmienia zawartość. Kolory, panele, fonty i ikony pozostają niezmienione. |
| TEST-MVP-36 | 320 px, mobile, desktop, klawiatura | Daty, formularze i czat działają bez zasłaniania treści |
| TEST-MVP-37 | Offline lub utrata sesji | Brak fałszywego zapisu floty/wiadomości; zachowanie PWA według Q-13 |
| TEST-MVP-38 | Archiwizacja firmy | Rekordy firmy, floty i rozmowy są zachowane. Firma znika z domyślnej listy i pojawia się po „Pokaż zarchiwizowane”; dodatkowe skutki Q-10A. |
| TEST-MVP-39 | Przywrócenie danych z kopii | Odtwarzana firma bez nadpisania innych tenantów |
| TEST-MVP-40 | Przegląd menu i prototypów MVP | Bez checkoutu, zespołów, przełącznika firm, edytora publicznej marki u admina oraz dodatków czatu. Pełna obsługa firmy u superadmina pozostaje zagnieżdżona. |
| TEST-MVP-41 | Admin firmy po końcu opłaty dodaje pojazd, zmienia dane, blokadę i pisze na czacie | Wszystkie dotychczasowe dozwolone funkcje działają; banner wyjaśnia tylko wyłączenie strony publicznej. |
| TEST-MVP-42 | Po końcu opłaty otwórz home, listę, szczegóły, kontakt i publiczne API na własnej oraz testowej domenie | Żadna ścieżka nie udostępnia oferty lub danych strony przez boczny adres; brak obejścia publicznej blokady. |
| TEST-MVP-43 | Wygaśnięcie opłaty przy istniejącej sesji i rozgrzanym cache | Brak przymusowego wylogowania i utraty formularza; publiczny cache nie obchodzi granicy opłaconego dnia. |
| TEST-MVP-44 | Rejestracja nieudana, otwarcie linku przez skaner, potem skuteczna rejestracja | Tylko ostatnie zdarzenie jest początkiem trialu i wyzwala pierwszą publikację; koniec następuje dokładnie po 336 godzinach. |
| TEST-MVP-45 | Próba dodania drugiego aktywnego admina do firmy lub przypisania konta do innej firmy | Odrzucona. Drugi klient przechodzi odrębne uruchomienie; nie powstaje przełącznik organizacji. |
| TEST-MVP-46 | Firma bez zakupionej domeny | Działa pod `{slug}.{publicDomainAutervy}`, odrębnym od hosta panelu; po aktywacji własnej domeny routing/TLS są zweryfikowane, a stary adres przekierowuje. |
| TEST-MVP-47 | Admin firmy wywołuje bezpośrednio mutację publicznego logo/danych/treści/zdjęć lub próbuje zmienić kolory | Odmowa serwera, nie tylko brak przycisku. Superadmin edytuje dozwoloną zawartość wyłącznie dla wskazanej firmy; kolorystyka pozostaje stała. |
| TEST-MVP-48 | Nowa wiadomość, czat zamknięty w menu „Więcej” | Nowa wiadomość jest sygnalizowana w panelu, np. kropką i dostępnym opisem. Brak powiadomienia e-mail. |
| TEST-MVP-49 | Przegląd UI oraz endpointów czatu | Brak funkcji załączników i uploadu czatu. Wysyłka tekstu nie uruchamia mailowych alertów; zaproszenia/reset są odrębną funkcją. |
| TEST-MVP-50 | Superadmin wchodzi do floty przez kartę firmy i wykonuje zmianę | Działa pełna obsługa wskazanej firmy, poprawny audyt superadmina i powrót do karty. Nie działa jako konto klienta. |
| TEST-MVP-51 | Jednoczesna edycja przez admina firmy i superadmina | Konflikt wykryty zgodnie z regułami domeny; brak cichego nadpisania lub zapisu w innym tenancie. |
| TEST-MVP-52 | Wygasła opłata versus archiwizacja na liście superadmina | Wygaśnięcie samo nie archiwizuje. Filtr „Pokaż zarchiwizowane” zmienia zakres listy, a nie opłatę, publikację czy dane firmy. |
| TEST-MVP-53 | Logowanie superadmina i admina firmy bez drugiego składnika | Dostęp nie jest przyznany; oba obszary wymagają poprawnego MFA i bezpiecznej obsługi odzyskania. |
| TEST-MVP-54 | Resend aktywnego zaproszenia | Powstaje jeden nowy link ważny 7 dni, poprzedni staje się nieważny, a resend nie tworzy drugiej firmy ani nie uruchamia trialu. |
| TEST-MVP-55 | Zbliża się koniec trialu lub opłaconego okresu | Administrator otrzymuje komunikat w panelu i e-mail 7 dni wcześniej, 1 dzień wcześniej oraz w dniu wygaśnięcia; wiadomości czatu nie uruchamiają tych e-maili. |

**Do istniejącej regresji:** nadal wykonać testy floty i dostępności z B1 §29. Ta lista je rozszerza; nie zastępuje pełnych testów już zaimplementowanych funkcji.

**Zakres potwierdzenia:** jest tu 55 scenariuszy planowanych testów. Nie jest to raport ich wykonania. Wartości zatwierdzone w §5.2B–5.4 są obowiązującym kontraktem; testy backendu, poczty, DNS/TLS, MFA i WebSocketów wymagają rzeczywistego runtime.

<a id="s21"></a>
## 21. Jak edytować istniejący projekt w Penpocie

### 21.1. Przed pierwszą zmianą

1. Otworzyć jednoznacznie wskazany plik Autervy; jeśli nie jest wskazany, zapytać o konkretny plik. Nie wybierać losowego projektu.
2. Odczytać istniejące strony, komponenty i tokeny.
3. Ustalić, które makiety pochodzą z B2, a które rzeczywiście wykonano według B3.
4. Przygotować mapę: ID dokumentacyjne → realne page/board/component ID. Puste pola oznaczają „nie znaleziono”, nie fikcyjny identyfikator.
5. Użyć dostępnego snapshotu/eksportu lub innego sprawdzonego mechanizmu zabezpieczenia wersji. Nie deklarować, że kopia istnieje bez jej utworzenia.

### 21.2. Najmniejsza kolejność edycji po odpowiedziach

**R — kolejność zmian w istniejącym pliku:**
1. Zachować cztery obszary i role hostów; zaznaczyć publiczny adres testowy jako alternatywę własnej domeny, nie jako host panelu.
2. Uprościć MKT-01 i PLT-01/02. Dodać filtr „Pokaż zarchiwizowane”, rozdzielić status opłaty, widoczności i archiwizacji.
3. W shellu firmy zachować wspólny styl, dodać datę opłacenia, wskaźnik nowych wiadomości i banner po końcu opłaty.
4. Usunąć z aktywnego MVP przełączanie firm, zespoły i edytor publicznej marki u firmy. Edycję logo/danych/treści/zdjęć przenieść do PLT-03/04; kolorów nie edytować.
5. Poprawić ACC-04: zakończenie rejestracji jest zdarzeniem startu trialu i automatycznej pierwszej publikacji, nie samo otwarcie linku.
6. Dodać wariant PUB-01/PUB-02 „Nasza oferta pojawi się wkrótce”. To nie jest ekran wyłączonej strony.
7. W TEN-04 i wszystkich panelowych ekranach po końcu opłaty zachować funkcje. Usunąć wcześniejsze pomysły „panel read-only / brak loginu za brak opłaty”.
8. Zastosować TEN-11/PLT-09 w wariancie tekstowym z wewnętrznym wskaźnikiem nowych, bez załączników i e-mailowych alertów.
9. Pod PLT-03 zagnieździć operacyjne widoki ADM-* dla superadmina z nazwą firmy, breadcrumbs i powrotem.
10. Zmienić „Usuń firmę” na „Archiwizuj firmę” i pokazać zachowanie danych, blokadę logowania oraz wyłączenie publicznych adresów zgodnie z Q-10A.
11. Przejrzeć wszystkie PUB/ADM/OVR po zmianach wspólnych komponentów; połączyć przepływy z §19.
12. Zastosować zatwierdzone wartości z §5.2B–5.4 bez dodawania wariantów domyślnych.

Nie mnożyć stron Penpota, gdy można dodać warianty i sekcje istniejących. Wycofane wersje oznaczyć „Poza MVP 3.1”, nie kasować nieodwracalnie. Nie kopiować całej biblioteki dla każdej firmy ani dla zagnieżdżonego widoku superadmina.

### 21.3. Adnotacja każdego zmienianego widoku

```text
ID: TEN-04
Wersja wymagań: MVP 3.1
Obszar: panel firmy
Host: alfa.sites.auterva.example
Podstawa: REQ-MVP-14, REQ-MVP-19, REQ-MVP-20
Stan: koniec opłaconego okresu
Potwierdzone: pełne funkcje panelu; strona publiczna wyłączona;
              komunikat i czynny czat
Viewport: M albo D
Pozostałe Q dla tego wariantu: brak w podstawowej regule wygaśnięcia
Status makiety: do aktualizacji / zweryfikowana po rzeczywistym review
Realne ID Penpota: uzupełnić po odczycie
```

Dla trialu stosować dokładnie 336 godzin od pierwszej skutecznej rejestracji oraz regułę wygaśnięcia z Q-01A. Dla archiwizacji stosować Q-10A i brak automatycznego purge z Q-10B.

Dane demonstracyjne nie są dowodem weryfikacji. Przycisku „Usuń na zawsze” nie projektować jako aktywnej funkcji: archiwizacja jest już potwierdzonym rozwiązaniem, nie wariantem do dowolnego wyboru.

### 21.4. Kontrola jakości

Zachować instancje, tokeny i edytowalne teksty. Nie zastępować istniejącej biblioteki screenshotami. Zmieniać małymi partiami, sprawdzać rezultat i po błędzie odczytać stan przed ponowieniem.

Praca jednego agenta zapisującego w pliku ogranicza konflikty. Recenzja może być niezależna, ale nie udawać jej wykonania bez rzeczywistego przeglądu.

Część z pytaniami nie może otrzymać etykiety „gotowe do implementacji”. Dopuszczalne statusy: „zgodne z potwierdzonym zakresem”, „propozycja układu”, „blokada Q-xx”, „zweryfikowane wizualnie”. Nie utożsamiać ich z działającym systemem.

<a id="s22"></a>
## 22. Kolejność realizacji i warunki odbioru

### 22.1. Kolejność

| Etap | Zakres | Koniec etapu |
|---|---|---|
| A | Mapowanie istniejących makiet i włączenie odpowiedzi; rozstrzygnięcie pozostałych szczegółów Q | Potwierdzone odpowiedzi nie są zadawane ponownie; jasno rozdzielone warianty z blokadą decyzji |
| B | Minimalne poprawki czterech obszarów | Pełny panel po końcu opłaty, publiczny branding, pusta oferta i filtr archiwum; brak wycofanych funkcji |
| C | Routing, sesje, jedno konto na firmę i izolacja | Testy A/B oraz bezpieczne uprawnienia superadmina w kontekście firmy |
| D | Firma, wygląd, okres, zaproszenie i pierwsza rejestracja | Automatyczna publikacja i start trialu zgodnie z zatwierdzonymi szczegółami, bez płatności systemowych |
| E | Oferta i ręczne blokady | Flota działa; publiczny adres własny/testowy podlega kontroli okresu, prywatny panel nie jest blokowany opłatą |
| F | Czat i zagnieżdżona obsługa superadmina | Tekst, wskaźnik nowych wiadomości, brak załączników/mailowych alertów, pełna obsługa danych pod kartą firmy |
| G | Archiwizacja, QA, kopie i pilotaż | Dane zachowane, filtr działa; pozostałe skutki Q-10A zatwierdzone przed uruchomieniem operacji produkcyjnej |

Nie uzależniać pierwszego wydania od checkoutu, faktur, CRM, ticketingu, zespołów i samoobsługowego SaaS. Nie rozpoczynać obsługi wielu realnych firm przed testami izolacji.

### 22.2. Gotowość PRD

Wersja 3.1 zawiera już odpowiedzi właściciela i ich konsekwencje w całym dokumencie. Nie należy ponownie prosić o potwierdzenie jednego konta, publicznej edycji tylko u superadmina, tekstowego czatu czy pełnego panelu po końcu opłaty.

Pozostają do weryfikacji implementacyjnej:
- zgodność runtime z rozstrzygnięciami §5.2B–5.4;
- testy izolacji, czasu, poczty, DNS/TLS, MFA i WebSocketów;
- usunięcie sprzecznych starych założeń z kodu, jeśli występują.

Nie wymaga to ponownego projektowania dotychczasowej floty, galerii i kalendarzy. Część P/B może być rozwijana, a tylko konkretny nieustalony wariant pozostaje zablokowany.

### 22.3. Gotowość produktu

Produkt można odebrać, gdy potwierdzone scenariusze działają, rozdzielenie firm ma dowody testowe, okres i widoczność są egzekwowane według zatwierdzonych zasad, zaproszenia oraz rozmowy mają prawdziwe rezultaty, a oryginalne funkcje floty nie zostały uszkodzone.

Prototyp z zielonymi badge’ami nie jest dowodem dostarczania poczty, konfiguracji DNS, przyjęcia płatności poza systemem czy odtworzenia backupu.

<a id="s23"></a>
## 23. Instrukcja dla agenta i dokumentacji repozytorium

### 23.1. Zmiana źródeł prawdy

Nie nadpisywać wersji historycznych. W istniejącym AGENTS.md i indeksie dokumentacji wskazać aktualne `PRD_MVP_Uproszczony_v3_1.md` oraz pierwszeństwo [U2].

Agent ma wiedzieć, że:
- app jest wyłącznie panelem superadmina, a każda firma ma osobny host panelu;
- jedno konto admina obsługuje tylko jedną firmę, bez zespołów;
- koniec opłaty wyłącza stronę publiczną, nie funkcje panelu;
- branding zmienia tylko superadmin i wyłącznie dla publicznej oferty; fonty/ikony/panel są stałe;
- rejestracja przez zaproszenie uruchamia pierwszą publikację i start przyznanego trialu;
- publiczna pusta oferta jest stanem prawidłowym;
- czat jest tekstowy, bez załączników i mailowych alertów;
- superadmin ma pełne zagnieżdżone zarządzanie firmą pod własną tożsamością;
- firmę archiwizujemy i zachowujemy jej dane;
- jedynie pozostałe Q z §5.3–5.4 wymagają decyzji, a nie cała stara lista pytań.

To instrukcja aktualizacji repozytorium, nie deklaracja, że jego pliki zostały już zmodyfikowane.

### 23.2. Polecenie do użycia przy aktualizacji makiet

```text
Przeczytaj PRD MVP Uproszczony 3.1, PRD bazowe i specyfikację makiet.
Sprawdź istniejące instrukcje projektu oraz faktycznie dostępne skille.
Wymagania użytkownika [U2] mają pierwszeństwo przed sprzecznymi
propozycjami ze starszych PRD i promptów.

Pracuj na wskazanym istniejącym pliku Autervy w Penpocie.
Odczytaj stan, zmapuj ID dokumentacyjne i zabezpiecz dotychczasową pracę.
Nie projektuj od nowa floty, formularzy, kalendarzy i biblioteki.

Zachowaj cztery obszary:
1. auterva.example — publiczny onepage systemu;
2. app.auterva.example — wyłącznie superadmin;
3. [firma].sites.auterva.example — panel admina tej firmy;
4. publiczna domena własna firmy albo testowa domena Autervy —
   oferta i dostępność, bez kont najemców, płatności i rezerwacji online.

Wprowadź potwierdzone decyzje:
- jedno konto admina na firmę; bez zespołów i przełącznika firm;
- po końcu opłaty cała strona publiczna jest wyłączona,
  lecz panel, flota, dane, blokady i czat nadal działają;
- „opłacono do” obejmuje cały ostatni dzień;
- trial startuje przy pierwszej skutecznej rejestracji z zaproszenia,
  nie przy wysyłce, GET lub logowaniu;
- pierwsza publikacja strony jest automatyczna po rejestracji;
  brak aut pokazuje estetyczną zapowiedź „oferta pojawi się wkrótce”;
- tylko superadmin zmienia logo, dane, treści i zdjęcia publicznej strony; kolory pozostają wspólne;
  fonty, ikony i wygląd wszystkich paneli są stałe;
- czat tekstowy, bez załączników i e-mailowych alertów,
  z wewnętrznym wskaźnikiem nowych wiadomości;
- pełne zarządzanie flotą i danymi firmy przez superadmina jest
  zagnieżdżone pod PLT-03; działa on jako superadmin, nie jako klient;
- firmy archiwizujemy, nie usuwamy trwale;
  domyślna lista niezarchiwizowanych + „Pokaż zarchiwizowane”.

Dopasuj PUB/ADM/OVR oraz mapowanie SaaS 2.0 według §13–16.
Usuń z aktywnych wariantów blokadę panelu za brak opłaty,
ręczną pierwszą publikację całej firmy, edytor motywu u admina,
zespoły, checkout, załączniki czatu i trwałe usuwanie firmy.

Stosuj zatwierdzone Q z §5.2B–5.4: publiczna strona działa w trialu,
trial trwa dokładnie 336 godzin, a archiwizacja blokuje logowanie i publiczne
adresy przy zachowaniu danych. Nie pytaj ponownie o decyzje zapisane jako P.

Zachowaj realne ID, stosuj istniejące instancje i wspólne komponenty.
Weryfikuj mobile/desktop, banner bez blokowania formularza,
wskaźnik czatu i stały kontekst firmy w obsłudze superadmina.
Połącz przepływy z §19. Nie twierdź, że statyczna makieta
jest działającym backendem albo potwierdzeniem testu bezpieczeństwa.

Raportuj faktycznie zmienione widoki, wykonane decyzje i kontrole.
Makiet historycznych nie kasuj bez zgody.
```

<a id="s24"></a>
## 24. Źródła, zakres aktualizacji i karta dalszych decyzji

### 24.1. Podstawa aktualizacji

- **[U1]:** opis uproszczonej Autervy podzielonej na cztery obszary.
- **[U2]:** dziewięć odpowiedzi właściciela z najnowszej wiadomości, przypisanych znaczeniowo do Q-01–Q-10 zgodnie z §5.1.
- **Wersja edytowana:** `Auterva_PRD_MVP_Uproszczony_v3_ROBOCZY.md` — 3.0. Zachowano jej układ 24 rozdziałów, katalog bazowych ekranów i znaczenie istniejących identyfikatorów.
- **B1:** bazowy PRD produktu, zwłaszcza zakres, flota, daty, konto, bezpieczeństwo, PWA i testy.
- **B2:** katalog makiet, wspólnych komponentów, stanów oraz przepływów.
- **B3:** poprzednie szersze SaaS 2.0 — wyłącznie jako materiał do mapowania i wycofywania nadmiarowych funkcji.

Ta aktualizacja opiera się na dostarczonych odpowiedziach i treści istniejącego PRD. Nie poszerzano jej o nowe funkcje z badań internetu ani nie wykonywano analizy opłacalności trialu.

### 24.2. Odziedziczone odwołania techniczne

Poniższe odwołania zachowano z wersji 3.0 jako kontekst jej zapisów T. **Nie były ponownie weryfikowane w ramach tej edycji.** Wersja bazowa wskazywała datę sprawdzenia 12 października 2026 r. Nie jest to deklaracja nowego audytu lub aktualnej zgodności implementacji.

- **[W1] OWASP — Multi-Tenant Application Security:** https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- **[W2] OWASP — Session Management:** https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
- **[W3] OWASP — Forgot Password:** https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- **[W4] OWASP — CSRF Prevention:** https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- **[W5] PostgreSQL — Row Security Policies:** https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- **[W6] AWS Certificate Manager — zakres nazw wildcard w certyfikacie:** https://docs.aws.amazon.com/acm/latest/userguide/acm-public-certificates.html

Źródła `current` są zmienne. Implementacja wymaga dokumentacji rzeczywiście użytej wersji. W6 nie oznacza wyboru AWS. Źródła techniczne nie rozstrzygają pytań biznesowych właściciela.

### 24.3. Co zmieniono w wersji 3.1

| Odpowiedź | Zaktualizowane obszary | Przykładowe testy |
|---|---|---|
| Koniec opłaty i pełny panel | §2, §5–6, §8, §10, §12–15, §17–23 | TEST-MVP-21, 25, 41–43 |
| Ostatni dzień włącznie | §2, §5, §8–9, §15–17 | TEST-MVP-21, 24 |
| Start trialu po rejestracji i warunek opłacalności | §5, §7–9, §15, §17–20 | TEST-MVP-15–16, 22–23, 44 |
| Jeden admin, jedna firma | §2, §4–6, §10, §13–18, §23 | TEST-MVP-03–04, 40, 45 |
| Publiczny branding wyłącznie u superadmina | §2, §5–6, §9–10, §13–18 | TEST-MVP-35, 47 |
| Adres testowy, publikacja i zapowiedź | §3, §5, §7–9, §12–15, §19–20 | TEST-MVP-26, 42, 46 |
| Czat tekstowy i kropka nowych | §5–6, §10–11, §13–18, §19–20 | TEST-MVP-30–32, 48–49 |
| Zagnieżdżony pełny dostęp superadmina | §5–6, §9, §13–15, §17–20 | TEST-MVP-50–51 |
| Archiwizacja zamiast usuwania | §2, §4–6, §9, §13–20 | TEST-MVP-38, 52 |

Nie dopisano samych odpowiedzi na końcu: zastąpiono sprzeczne warianty w opisach zachowania, tabelach makiet, instrukcji dla agenta i planie testów. Oryginał pozostaje osobnym plikiem.

### 24.4. Zatwierdzone decyzje końcowe

Q-03A, Q-05A, Q-06A/B, Q-08A, Q-10B, Q-14 oraz Q-15 zostały zatwierdzone w [U4] i zapisane w §5.2B–5.4. Nie zastępować ich innymi wartościami domyślnymi i nie ponawiać tych pytań podczas implementacji.

### 24.5. Zakres wykonanej edycji i dalsze użycie

Zaktualizowano dokument Markdown oraz opisane w nim wymagania, mapowania, przepływy i plan testów. Nie zmieniono faktycznych makiet Penpota, repozytorium, kont, domen ani danych firm. Nie wysyłano e-maili i nie uruchamiano testów aplikacji.

Kontrola pliku obejmuje czytelność Markdown, kompletność rozdziałów, odnośniki wewnętrzne, identyfikatory oraz usunięcie sprzecznych opisów w zmienionych obszarach. Scenariusze TEST-MVP są planem, nie dowodami wykonania.

Przed zmianą konkretnej makiety ustalić jej rzeczywisty identyfikator w `design/traceability.json`. Rozstrzygnięcia [U4] są zatwierdzone; statyczna makieta nie zastępuje jednak testów backendu i infrastruktury.

---

**Koniec wersji 3.1. Odpowiedzi i zatwierdzone rekomendacje właściciela włączono do całego PRD.**
