# Backlog MVP 3.1

[Tablica projektu](https://github.com/users/KarolR2001/projects/1) · [Zasady pracy](WORKFLOW.md)

Stan przygotowania: 23.10.2026. **64 obowiązkowe zadania w To do, 15 pozycji Candidates.** To plan realizacji, nie raport działającej aplikacji. Role zastępują przypisanie osób do czasu podania kont GitHub. Tester odbiera każde issue programisty; nie ma osobnych zadań QA.

## Kolejność

Bierz pierwsze nieblokowane To do swojej roli według Order, z pierwszeństwem własnych Re-open. Każda zależność ma wcześniejszy numer i relację blocked by. Wszystkie obowiązkowe zadania prowadzą przez zależności do [#64](https://github.com/KarolR2001/Auterva/issues/64). Pełny zakres wyjaśnia opis issue; tabela służy nawigacji i kontroli pokrycia.

Pierwsze zadania backendu: decyzje [#1](https://github.com/KarolR2001/Auterva/issues/1)–[#4](https://github.com/KarolR2001/Auterva/issues/4), potem walidacja/scaffold [#5](https://github.com/KarolR2001/Auterva/issues/5). Frontend może równolegle rozpocząć treści [#6](https://github.com/KarolR2001/Auterva/issues/6) i mapowanie Penpota [#7](https://github.com/KarolR2001/Auterva/issues/7), a następnie bazowe komponenty [#11](https://github.com/KarolR2001/Auterva/issues/11) po spełnieniu zależności.

## Zadania obowiązkowe

| Order / issue | Rola | Rezultat | Wymagania |
|---|---|---|---|
| [#1](https://github.com/KarolR2001/Auterva/issues/1) | Backend | Uzgodnić macierz ustawień firmy i warunki publikacji pojazdu | D-01 D-02 C-F081 C-F085 FR-ADM-032 |
| [#2](https://github.com/KarolR2001/Auterva/issues/2) | Backend | Uzgodnić nakładanie okresów, KPI i harmonogram przypomnień | D-06 D-07 D-11 D-14 C-F055 C-F072 |
| [#3](https://github.com/KarolR2001/Auterva/issues/3) | Backend | Ustalić środowiska, domeny, dostawców i parametry eksploatacji | D-09 D-10 C-N020 C-N041 C-N046 C-N058 C-N059 |
| [#4](https://github.com/KarolR2001/Auterva/issues/4) | Backend | Ustalić limity techniczne i bezpieczne uruchamianie kont MFA | D-04 D-05 C-F040 C-N015 C-N018 C-N038 |
| [#5](https://github.com/KarolR2001/Auterva/issues/5) | Backend | Zweryfikować stos i uruchomić odtwarzalny scaffold aplikacji | D-12 C-R001 C-N060 |
| [#6](https://github.com/KarolR2001/Auterva/issues/6) | Frontend | Zebrać finalne treści, dane oferty i dokumenty do publikacji | D-03 C-F019–021 C-F106 C-F112 C-F138–142 DS-N23 |
| [#7](https://github.com/KarolR2001/Auterva/issues/7) | Frontend | Uzupełnić prawdziwe referencje Penpota i mapę wymaganie–ekran | D-13 C-N063–065 |
| [#8](https://github.com/KarolR2001/Auterva/issues/8) | Backend | Wdrożyć schemat danych i migracje z izolacją firm | C-F009–012 C-N021–027 C-R021 |
| [#9](https://github.com/KarolR2001/Auterva/issues/9) | Backend | Przygotować lokalne usługi i powtarzalne fixture dwóch firm | C-N061 C-N062 |
| [#10](https://github.com/KarolR2001/Auterva/issues/10) | Backend | Uruchomić CI aplikacji i odseparowane środowiska preview/staging | C-N020 C-N041 C-N060 |
| [#11](https://github.com/KarolR2001/Auterva/issues/11) | Frontend | Podłączyć tokeny i wspólne komponenty z design systemu | C-N047–050 C-N064 DS-N01–06 DS-N12–15 DS-N18 DS-N20 DS-N21 |
| [#12](https://github.com/KarolR2001/Auterva/issues/12) | Backend | Wdrożyć logowanie, sesje, obowiązkowe MFA i bootstrap superadmina | C-F008–014 C-F040 C-F044 C-N009–011 C-N018–020 FR-ADM-001–005 FR-ADM-007 FR-ADM-082 |
| [#13](https://github.com/KarolR2001/Auterva/issues/13) | Backend | Egzekwować cztery hosty i autoryzację wszystkich operacji | C-F002–005 C-F013–018 C-N001–014 C-R002–010 |
| [#14](https://github.com/KarolR2001/Auterva/issues/14) | Frontend | Wdrożyć nawigację paneli i wspólne stany dostępu/błędów | C-F018 C-F147–150 C-N052–057 DS-N07 DS-N08 DS-N10 DS-N14 DS-N21 |
| [#15](https://github.com/KarolR2001/Auterva/issues/15) | Frontend | Podłączyć logowanie i pełny przepływ MFA obu ról | C-F040 C-F044 FR-ADM-001 FR-ADM-004 FR-ADM-005 FR-ADM-007 |
| [#16](https://github.com/KarolR2001/Auterva/issues/16) | Backend | Zapisywać nieedytowalny audyt z rzeczywistym aktorem | C-F017 C-F151 C-N019 C-N037 C-N039 C-N040 FR-ADM-070 FR-ADM-071 |
| [#17](https://github.com/KarolR2001/Auterva/issues/17) | Backend | Uruchomić trwałe zadania i pocztę transakcyjną | C-F025 C-F035 C-N004 C-N016 C-N017 |
| [#18](https://github.com/KarolR2001/Auterva/issues/18) | Backend | Wdrożyć reset hasła i bezpieczne operacje konta | C-F041 C-F042 C-F044 C-N015–017 FR-ADM-006 FR-ADM-080 FR-ADM-082 |
| [#19](https://github.com/KarolR2001/Auterva/issues/19) | Frontend | Podłączyć reset, profil, zmianę hasła i wylogowanie | C-F041 C-F042 C-F044 FR-ADM-006 FR-ADM-080 FR-ADM-082 |
| [#20](https://github.com/KarolR2001/Auterva/issues/20) | Backend | Tworzyć firmę i zarządzać jednorazowymi zaproszeniami | C-F015 C-F019–028 C-F030 C-F034–036 C-N014–018 C-N024 C-R008–012 |
| [#21](https://github.com/KarolR2001/Auterva/issues/21) | Backend | Wdrożyć okres usługi i centralną bramkę publicznej widoczności | C-F024 C-F045–064 C-F071 C-N027 C-N031–033 C-R013 C-R017 C-R022 |
| [#22](https://github.com/KarolR2001/Auterva/issues/22) | Backend | Aktywować konto i rozpocząć trial dokładnie raz | C-F029 C-F031–039 C-F050–054 C-N014 C-N026 |
| [#23](https://github.com/KarolR2001/Auterva/issues/23) | Backend | Obsłużyć domenę zastępczą, DNS/TLS i domenę własną firmy | C-F004 C-F086–089 C-N008 C-N024 C-N058 |
| [#24](https://github.com/KarolR2001/Auterva/issues/24) | Backend | Udostępnić listę firm, kartę i dwa KPI superadmina | C-F068–072 C-F076 C-F079 C-R007 |
| [#25](https://github.com/KarolR2001/Auterva/issues/25) | Frontend | Zrealizować formularz prerejestracji i obsługę zaproszeń | C-F020–028 C-F034–038 C-R008–012 |
| [#26](https://github.com/KarolR2001/Auterva/issues/26) | Frontend | Zintegrować ekran aktywacji konta i stany zaproszenia | C-F026–033 C-F037–039 C-F052 C-F108 D-11 |
| [#27](https://github.com/KarolR2001/Auterva/issues/27) | Frontend | Podłączyć listę firm, kartę i edycję okresu superadmina | C-F015–018 C-F045–049 C-F068–072 C-F084 C-F086–089 C-R007 C-R013 |
| [#28](https://github.com/KarolR2001/Auterva/issues/28) | Backend | Wdrożyć CRUD, publikację i kolejność floty firmy | C-F007 C-F095–097 C-F104 C-N023 C-N027 FR-ADM-020–022 FR-ADM-030–035 |
| [#29](https://github.com/KarolR2001/Auterva/issues/29) | Backend | Zaimplementować bezpieczny upload i przetwarzanie obrazów | C-F098 C-N034 C-N035 FR-ADM-040–042 NFR-PERF-004 |
| [#30](https://github.com/KarolR2001/Auterva/issues/30) | Backend | Udostępnić ustawienia i publiczne materiały firmy z kontrolą pól | C-F023 C-F081–085 C-N025 C-N034 C-N048 FR-ADM-060–063 |
| [#31](https://github.com/KarolR2001/Auterva/issues/31) | Frontend | Zintegrować ustawienia firmy, kontakt, SEO i treści prawne | C-F083–085 C-F112 FR-ADM-060–063 |
| [#32](https://github.com/KarolR2001/Auterva/issues/32) | Backend | Zapewnić transakcyjne zdjęcie główne i chronione dostarczanie mediów | C-F098 C-F061 C-N006 C-N033 C-N035 FR-ADM-043–046 |
| [#33](https://github.com/KarolR2001/Auterva/issues/33) | Backend | Zaimplementować reguły i odczyty dostępności na LocalDate | C-F094 C-F102 C-F105 C-N028–030 FR-PUB-023–026 FR-ADM-010 |
| [#34](https://github.com/KarolR2001/Auterva/issues/34) | Frontend | Podłączyć listę floty i dashboard firmy | C-F095 C-F097 FR-ADM-010 FR-ADM-020–022 |
| [#35](https://github.com/KarolR2001/Auterva/issues/35) | Frontend | Wdrożyć formularz pojazdu i cykl publikacji | C-F095–097 C-F104 FR-ADM-030–035 DS-N12 DS-N13 DS-N15 |
| [#36](https://github.com/KarolR2001/Auterva/issues/36) | Frontend | Zintegrować upload i zarządzanie zdjęciami pojazdu | C-F098 FR-ADM-040–046 DS-N17 DS-N19 |
| [#37](https://github.com/KarolR2001/Auterva/issues/37) | Frontend | Podłączyć edycję logo i materiałów publicznych przez superadmina | C-F023 C-F081 C-F082 C-N048 DS-N22 |
| [#38](https://github.com/KarolR2001/Auterva/issues/38) | Backend | Zapisywać blokady bez kolizji i natychmiast odświeżać dostępność | C-F007 C-F100 C-F102–105 C-N027 C-N031 FR-ADM-050–056 FR-ADM-058 D-15 |
| [#39](https://github.com/KarolR2001/Auterva/issues/39) | Frontend | Podłączyć kalendarz pojazdu i szybkie blokowanie terminów | C-F100 C-F102–105 FR-ADM-050–056 DS-N16 |
| [#40](https://github.com/KarolR2001/Auterva/issues/40) | Backend | Udostępnić publiczną ofertę, filtrowanie i metadane SEO firmy | C-F005 C-F090–094 C-F106–114 C-N028–033 C-N057 FR-PUB-001 FR-PUB-003 FR-PUB-010–015 FR-PUB-021–026 FR-PUB-030–042 |
| [#41](https://github.com/KarolR2001/Auterva/issues/41) | Frontend | Wdrożyć publiczny home i katalog z filtrami | C-F090–092 C-F108–111 C-F113 C-F114 FR-PUB-001 FR-PUB-003 FR-PUB-010–015 |
| [#42](https://github.com/KarolR2001/Auterva/issues/42) | Frontend | Wdrożyć szczegóły pojazdu i dostępną galerię | C-F093 FR-PUB-020–022 DS-N17 DS-N18 NFR-PERF-004 |
| [#43](https://github.com/KarolR2001/Auterva/issues/43) | Frontend | Zintegrować publiczny kalendarz i sprawdzanie dostępności | C-F094 C-F102 C-F105 FR-PUB-023–026 DS-N11 DS-N16 |
| [#44](https://github.com/KarolR2001/Auterva/issues/44) | Frontend | Podłączyć kontakt, kontekst zapytania i dokumenty firmy | C-F006 C-F106 C-F107 C-F112 FR-PUB-030–042 |
| [#45](https://github.com/KarolR2001/Auterva/issues/45) | Frontend | Wdrożyć marketingowy onepage Autervy | C-F001 C-F019–021 C-F138–142 C-R018 DS-N22 DS-N23 |
| [#46](https://github.com/KarolR2001/Auterva/issues/46) | Backend | Udostępnić chroniony preview i operacje w kontekście firmy superadmina | C-F016–018 C-F058 C-F099 C-N030 FR-ADM-034 |
| [#47](https://github.com/KarolR2001/Auterva/issues/47) | Frontend | Zintegrować chroniony podgląd i pełne zarządzanie firmą przez superadmina | C-F016–018 C-F058 C-F099 C-F104 DS-N22 |
| [#48](https://github.com/KarolR2001/Auterva/issues/48) | Backend | Archiwizować i przywracać firmę bez utraty danych | C-F073–080 C-F075-T C-F126 C-N011 C-N046 |
| [#49](https://github.com/KarolR2001/Auterva/issues/49) | Frontend | Dodać archiwizację, restore i odblokowanie firmy w karcie | C-F069 C-F073–080 C-F147 C-R015 |
| [#50](https://github.com/KarolR2001/Auterva/issues/50) | Backend | Zapisywać prywatne rozmowy i wiadomości bez duplikatów | C-F115–117 C-F125 C-F126 C-F129–131 C-F134 C-F135 C-N036–038 C-R016 |
| [#51](https://github.com/KarolR2001/Auterva/issues/51) | Backend | Uruchomić WebSocket z read/typing i odzyskiwaniem zdarzeń | C-F118–121 C-F127 C-F130–132 C-N004 C-N059 D-08 |
| [#52](https://github.com/KarolR2001/Auterva/issues/52) | Frontend | Podłączyć czat firmy, wskaźniki nowych wiadomości i draft | C-F115–133 C-N051 C-N054 DS-N09 |
| [#53](https://github.com/KarolR2001/Auterva/issues/53) | Frontend | Zrealizować skrzynkę superadmina i bezpieczne przełączanie rozmów | C-F122–124 C-F134–137 DS-N09 |
| [#54](https://github.com/KarolR2001/Auterva/issues/54) | Backend | Wysyłać przypomnienia 7/1/0 i udostępnić je w panelu | C-F067 C-N004 |
| [#55](https://github.com/KarolR2001/Auterva/issues/55) | Frontend | Pokazać status usługi i nieblokujące przypomnienia w panelu firmy | C-F058–067 C-F084 C-F125 C-N054 |
| [#56](https://github.com/KarolR2001/Auterva/issues/56) | Frontend | Dostarczyć bezpieczną instalowalną PWA panelu firmy | C-F143–146 FR-PWA-001–005 C-N031 |
| [#57](https://github.com/KarolR2001/Auterva/issues/57) | Backend | Domknąć zabezpieczenia serwera i regresję izolacji przed wydaniem | C-N001–020 C-N028–038 C-N044 C-N057 C-N059 C-N061 C-N062 |
| [#58](https://github.com/KarolR2001/Auterva/issues/58) | Backend | Uruchomić monitoring, alerty i instrukcje obsługi awarii | C-N020 C-N037 C-N059 C-N060 |
| [#59](https://github.com/KarolR2001/Auterva/issues/59) | Backend | Zoptymalizować zapytania i sprawdzić obciążenie docelowe | NFR-PERF-002 C-N060 C-N062 |
| [#60](https://github.com/KarolR2001/Auterva/issues/60) | Backend | Skonfigurować backup i przećwiczyć restore całego systemu oraz jednej firmy | C-N041–046 |
| [#61](https://github.com/KarolR2001/Auterva/issues/61) | Frontend | Domknąć dostępność, responsywność i wydajność interfejsu | C-N047–056 C-N060 C-N063–065 DS-N01–23 NFR-PERF-001 NFR-PERF-003 NFR-PERF-004 |
| [#62](https://github.com/KarolR2001/Auterva/issues/62) | Frontend | Spiąć przepływy MVP i przygotować wersję kandydującą do wydania | C-N061–065 |
| [#63](https://github.com/KarolR2001/Auterva/issues/63) | Backend | Przećwiczyć migrację i wdrożenie release candidate na staging | C-N041–045 C-N060 C-N062 |
| [#64](https://github.com/KarolR2001/Auterva/issues/64) | Backend | Wdrożyć MVP na produkcję i przeprowadzić kontrolowany start firm | C-N041–046 C-N058–062 |

## Candidates

Pozycje SHOULD i propozycje poza obowiązkowym MVP. Zadania rozpoznawcze kończą się zatwierdzonym kontraktem oraz osobnymi zadaniami wdrożenia po decyzji; nie są obietnicą gotowej nowej funkcji.

| Order / issue | Rola | Zakres |
|---|---|---|
| [#65](https://github.com/KarolR2001/Auterva/issues/65) | Backend | Udostępnić zbiorczy kalendarz floty jednej firmy |
| [#66](https://github.com/KarolR2001/Auterva/issues/66) | Frontend | Podłączyć zbiorczy kalendarz floty firmy |
| [#67](https://github.com/KarolR2001/Auterva/issues/67) | Backend | Dodać wyróżnianie pojazdów na home firmy |
| [#68](https://github.com/KarolR2001/Auterva/issues/68) | Frontend | Podłączyć zarządzanie wyróżnionymi i ich sekcję na home |
| [#69](https://github.com/KarolR2001/Auterva/issues/69) | Backend | Przekierowywać stare slugi opublikowanych pojazdów |
| [#70](https://github.com/KarolR2001/Auterva/issues/70) | Backend | Przygotować kontrakt najbliższego wolnego terminu i zbiorczych blokad |
| [#71](https://github.com/KarolR2001/Auterva/issues/71) | Frontend | Uzgodnić dodatkowy język publicznej oferty |
| [#72](https://github.com/KarolR2001/Auterva/issues/72) | Backend | Udostępnić listę i świadome kończenie sesji konta |
| [#73](https://github.com/KarolR2001/Auterva/issues/73) | Frontend | Dodać przegląd i zakończenie aktywnych sesji |
| [#74](https://github.com/KarolR2001/Auterva/issues/74) | Backend | Udostępnić filtrowany odczyt audytu do paneli |
| [#75](https://github.com/KarolR2001/Auterva/issues/75) | Frontend | Podłączyć ekran audytu firmy i jej kontekst superadmina |
| [#76](https://github.com/KarolR2001/Auterva/issues/76) | Frontend | Pokazać listę braków obniżających jakość oferty |
| [#77](https://github.com/KarolR2001/Auterva/issues/77) | Backend | Rozszerzyć diagnostykę uruchomienia firmy dla operatora |
| [#78](https://github.com/KarolR2001/Auterva/issues/78) | Frontend | Pokazać diagnostykę domeny i poczty na karcie firmy |
| [#79](https://github.com/KarolR2001/Auterva/issues/79) | Backend | Uzgodnić bezpieczny eksport kalendarza i danych firmy |

## Pokrycie scenariuszy odbioru

Każdy scenariusz ma konkretne zadanie implementacyjne i oczekiwany wynik w jego sekcji dla testera. [#62](https://github.com/KarolR2001/Auterva/issues/62) spina regresję całego wydania; nie zastępuje odbiorów poszczególnych zadań. Pokrycie oznacza zaplanowany odbiór, nie wykonany test.

| Scenariusz PRD | Zadania z konkretnym przypadkiem |
|---|---|
| TEST-MVP-01 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-02 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-03 | [#12](https://github.com/KarolR2001/Auterva/issues/12), [#13](https://github.com/KarolR2001/Auterva/issues/13), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-04 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-05 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#28](https://github.com/KarolR2001/Auterva/issues/28), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-06 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#29](https://github.com/KarolR2001/Auterva/issues/29), [#38](https://github.com/KarolR2001/Auterva/issues/38), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-07 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#50](https://github.com/KarolR2001/Auterva/issues/50), [#51](https://github.com/KarolR2001/Auterva/issues/51), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-08 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#33](https://github.com/KarolR2001/Auterva/issues/33), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-09 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-10 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#23](https://github.com/KarolR2001/Auterva/issues/23), [#41](https://github.com/KarolR2001/Auterva/issues/41), [#57](https://github.com/KarolR2001/Auterva/issues/57) |
| TEST-MVP-11 | [#8](https://github.com/KarolR2001/Auterva/issues/8), [#28](https://github.com/KarolR2001/Auterva/issues/28) |
| TEST-MVP-12 | [#8](https://github.com/KarolR2001/Auterva/issues/8), [#20](https://github.com/KarolR2001/Auterva/issues/20), [#23](https://github.com/KarolR2001/Auterva/issues/23) |
| TEST-MVP-13 | [#20](https://github.com/KarolR2001/Auterva/issues/20), [#25](https://github.com/KarolR2001/Auterva/issues/25) |
| TEST-MVP-14 | [#20](https://github.com/KarolR2001/Auterva/issues/20), [#25](https://github.com/KarolR2001/Auterva/issues/25) |
| TEST-MVP-15 | [#20](https://github.com/KarolR2001/Auterva/issues/20), [#26](https://github.com/KarolR2001/Auterva/issues/26) |
| TEST-MVP-16 | [#22](https://github.com/KarolR2001/Auterva/issues/22), [#26](https://github.com/KarolR2001/Auterva/issues/26) |
| TEST-MVP-17 | [#20](https://github.com/KarolR2001/Auterva/issues/20), [#26](https://github.com/KarolR2001/Auterva/issues/26) |
| TEST-MVP-18 | [#22](https://github.com/KarolR2001/Auterva/issues/22), [#26](https://github.com/KarolR2001/Auterva/issues/26) |
| TEST-MVP-19 | [#18](https://github.com/KarolR2001/Auterva/issues/18) |
| TEST-MVP-20 | [#21](https://github.com/KarolR2001/Auterva/issues/21), [#55](https://github.com/KarolR2001/Auterva/issues/55) |
| TEST-MVP-21 | [#21](https://github.com/KarolR2001/Auterva/issues/21) |
| TEST-MVP-22 | [#21](https://github.com/KarolR2001/Auterva/issues/21), [#22](https://github.com/KarolR2001/Auterva/issues/22) |
| TEST-MVP-23 | [#22](https://github.com/KarolR2001/Auterva/issues/22) |
| TEST-MVP-24 | [#21](https://github.com/KarolR2001/Auterva/issues/21), [#27](https://github.com/KarolR2001/Auterva/issues/27) |
| TEST-MVP-25 | [#21](https://github.com/KarolR2001/Auterva/issues/21), [#35](https://github.com/KarolR2001/Auterva/issues/35), [#55](https://github.com/KarolR2001/Auterva/issues/55) |
| TEST-MVP-26 | [#22](https://github.com/KarolR2001/Auterva/issues/22), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#41](https://github.com/KarolR2001/Auterva/issues/41) |
| TEST-MVP-27 | [#33](https://github.com/KarolR2001/Auterva/issues/33), [#39](https://github.com/KarolR2001/Auterva/issues/39) |
| TEST-MVP-28 | [#38](https://github.com/KarolR2001/Auterva/issues/38), [#39](https://github.com/KarolR2001/Auterva/issues/39) |
| TEST-MVP-29 | [#44](https://github.com/KarolR2001/Auterva/issues/44) |
| TEST-MVP-30 | [#50](https://github.com/KarolR2001/Auterva/issues/50), [#52](https://github.com/KarolR2001/Auterva/issues/52) |
| TEST-MVP-31 | [#53](https://github.com/KarolR2001/Auterva/issues/53) |
| TEST-MVP-32 | [#50](https://github.com/KarolR2001/Auterva/issues/50) |
| TEST-MVP-33 | [#40](https://github.com/KarolR2001/Auterva/issues/40) |
| TEST-MVP-34 | [#13](https://github.com/KarolR2001/Auterva/issues/13) |
| TEST-MVP-35 | [#30](https://github.com/KarolR2001/Auterva/issues/30), [#37](https://github.com/KarolR2001/Auterva/issues/37) |
| TEST-MVP-36 | [#14](https://github.com/KarolR2001/Auterva/issues/14), [#34](https://github.com/KarolR2001/Auterva/issues/34), [#61](https://github.com/KarolR2001/Auterva/issues/61) |
| TEST-MVP-37 | [#14](https://github.com/KarolR2001/Auterva/issues/14), [#56](https://github.com/KarolR2001/Auterva/issues/56) |
| TEST-MVP-38 | [#48](https://github.com/KarolR2001/Auterva/issues/48), [#49](https://github.com/KarolR2001/Auterva/issues/49) |
| TEST-MVP-39 | [#60](https://github.com/KarolR2001/Auterva/issues/60) |
| TEST-MVP-40 | [#14](https://github.com/KarolR2001/Auterva/issues/14), [#47](https://github.com/KarolR2001/Auterva/issues/47) |
| TEST-MVP-41 | [#21](https://github.com/KarolR2001/Auterva/issues/21), [#46](https://github.com/KarolR2001/Auterva/issues/46), [#55](https://github.com/KarolR2001/Auterva/issues/55) |
| TEST-MVP-42 | [#21](https://github.com/KarolR2001/Auterva/issues/21), [#32](https://github.com/KarolR2001/Auterva/issues/32), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#41](https://github.com/KarolR2001/Auterva/issues/41) |
| TEST-MVP-43 | [#14](https://github.com/KarolR2001/Auterva/issues/14), [#21](https://github.com/KarolR2001/Auterva/issues/21), [#32](https://github.com/KarolR2001/Auterva/issues/32), [#55](https://github.com/KarolR2001/Auterva/issues/55) |
| TEST-MVP-44 | [#22](https://github.com/KarolR2001/Auterva/issues/22) |
| TEST-MVP-45 | [#8](https://github.com/KarolR2001/Auterva/issues/8), [#12](https://github.com/KarolR2001/Auterva/issues/12) |
| TEST-MVP-46 | [#23](https://github.com/KarolR2001/Auterva/issues/23), [#27](https://github.com/KarolR2001/Auterva/issues/27) |
| TEST-MVP-47 | [#30](https://github.com/KarolR2001/Auterva/issues/30), [#31](https://github.com/KarolR2001/Auterva/issues/31), [#37](https://github.com/KarolR2001/Auterva/issues/37) |
| TEST-MVP-48 | [#51](https://github.com/KarolR2001/Auterva/issues/51), [#52](https://github.com/KarolR2001/Auterva/issues/52) |
| TEST-MVP-49 | [#50](https://github.com/KarolR2001/Auterva/issues/50), [#52](https://github.com/KarolR2001/Auterva/issues/52) |
| TEST-MVP-50 | [#13](https://github.com/KarolR2001/Auterva/issues/13), [#27](https://github.com/KarolR2001/Auterva/issues/27), [#28](https://github.com/KarolR2001/Auterva/issues/28), [#34](https://github.com/KarolR2001/Auterva/issues/34), [#46](https://github.com/KarolR2001/Auterva/issues/46), [#47](https://github.com/KarolR2001/Auterva/issues/47) |
| TEST-MVP-51 | [#28](https://github.com/KarolR2001/Auterva/issues/28), [#35](https://github.com/KarolR2001/Auterva/issues/35), [#38](https://github.com/KarolR2001/Auterva/issues/38), [#46](https://github.com/KarolR2001/Auterva/issues/46), [#47](https://github.com/KarolR2001/Auterva/issues/47) |
| TEST-MVP-52 | [#24](https://github.com/KarolR2001/Auterva/issues/24), [#27](https://github.com/KarolR2001/Auterva/issues/27), [#48](https://github.com/KarolR2001/Auterva/issues/48), [#49](https://github.com/KarolR2001/Auterva/issues/49) |
| TEST-MVP-53 | [#12](https://github.com/KarolR2001/Auterva/issues/12), [#15](https://github.com/KarolR2001/Auterva/issues/15) |
| TEST-MVP-54 | [#20](https://github.com/KarolR2001/Auterva/issues/20) |
| TEST-MVP-55 | [#54](https://github.com/KarolR2001/Auterva/issues/54), [#55](https://github.com/KarolR2001/Auterva/issues/55) |
| UC-01 | [#28](https://github.com/KarolR2001/Auterva/issues/28), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#41](https://github.com/KarolR2001/Auterva/issues/41) |
| UC-02 | [#28](https://github.com/KarolR2001/Auterva/issues/28), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#41](https://github.com/KarolR2001/Auterva/issues/41) |
| UC-03 | [#33](https://github.com/KarolR2001/Auterva/issues/33), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#43](https://github.com/KarolR2001/Auterva/issues/43) |
| UC-04 | [#33](https://github.com/KarolR2001/Auterva/issues/33), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#43](https://github.com/KarolR2001/Auterva/issues/43) |
| UC-05 | [#33](https://github.com/KarolR2001/Auterva/issues/33), [#43](https://github.com/KarolR2001/Auterva/issues/43) |
| UC-06 | [#38](https://github.com/KarolR2001/Auterva/issues/38), [#39](https://github.com/KarolR2001/Auterva/issues/39) |
| UC-07 | [#28](https://github.com/KarolR2001/Auterva/issues/28), [#35](https://github.com/KarolR2001/Auterva/issues/35) |
| UC-08 | [#56](https://github.com/KarolR2001/Auterva/issues/56) |
| UC-09 | [#13](https://github.com/KarolR2001/Auterva/issues/13) |
| UC-10 | [#38](https://github.com/KarolR2001/Auterva/issues/38), [#40](https://github.com/KarolR2001/Auterva/issues/40), [#43](https://github.com/KarolR2001/Auterva/issues/43) |

## Decyzje i granice

- D-01/02: [#1](https://github.com/KarolR2001/Auterva/issues/1). D-06/07/11/14: [#2](https://github.com/KarolR2001/Auterva/issues/2). D-09/10: [#3](https://github.com/KarolR2001/Auterva/issues/3). D-04/05: [#4](https://github.com/KarolR2001/Auterva/issues/4). D-12/ADR-0002: [#5](https://github.com/KarolR2001/Auterva/issues/5). D-03: [#6](https://github.com/KarolR2001/Auterva/issues/6). D-13: [#7](https://github.com/KarolR2001/Auterva/issues/7). D-08: [#51](https://github.com/KarolR2001/Auterva/issues/51). D-15 jest już rozstrzygnięte: MAINTENANCE/„Serwis”, wdrożenie [#38](https://github.com/KarolR2001/Auterva/issues/38).
- Aktualny zakres C-F/C-N, odziedziczone FR-ADM/FR-PUB/FR-PWA, DS-N i NFR-PERF mają przypisanie w tabelach/issue. Podstawowa walidacja publikacji nie blokuje zapisu szkicu; opcjonalne featured, kalendarz floty i UI sesji/audytu pozostają Candidates.
- PRD 3.1 U3/U4 ma pierwszeństwo przed bazą i historycznym SaaS 2.0. C-X001–020 i sekcja rozliczenia SaaS w wymaganiach opisują wyłączenia, nie brakujące zadania: bez billingów, rezerwacji, płatności, zespołów, publicznej rejestracji, globalnej floty i impersonacji.
- Reset hasła i chroniony preview obejmuje To do: aktualne scenariusze 3.1 wymagają ich działania także po końcu okresu. MFA i PWA są obowiązkowe mimo historycznych niższych priorytetów.
- Infrastruktura nie kończy się na kodzie: CI/środowiska [#10](https://github.com/KarolR2001/Auterva/issues/10), zabezpieczenia [#57](https://github.com/KarolR2001/Auterva/issues/57), monitoring [#58](https://github.com/KarolR2001/Auterva/issues/58), obciążenie [#59](https://github.com/KarolR2001/Auterva/issues/59), restore [#60](https://github.com/KarolR2001/Auterva/issues/60), odbiór UI [#61](https://github.com/KarolR2001/Auterva/issues/61), regresja [#62](https://github.com/KarolR2001/Auterva/issues/62), próba rollout/rollback [#63](https://github.com/KarolR2001/Auterva/issues/63), rzeczywista produkcja [#64](https://github.com/KarolR2001/Auterva/issues/64).
- Linki frontendowe wskazują istniejące strony i boardy Penpota odczytane 23.10.2026. Braki historycznego mapowania pozostają w [#7](https://github.com/KarolR2001/Auterva/issues/7); nowe rozszerzenia UI wymagają zatwierdzonych stanów designu.
