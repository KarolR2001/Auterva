# Audyt referencji Penpota — issue #7

Stan odczytu live: 23.10.2026. Plik `Nowy plik 2` (`b564c72c-f31f-81ec-8008-af198a313438`). Odczyt był wyłącznie strukturalny; nie zmieniono makiet. ID i wyniki odnoszą się do bieżącej sesji MCP, nie do testu klikania ani aplikacji.

## Siedem nieistniejących boardów

Na każdej z siedmiu stron wykonano `Page.getShapeById` dla każdego historycznego UUID i wyszukiwanie nazw `OVR-14`, `OVR-15`, `OVR-17`. Wszystkie siedem ID nadal zwraca `null`; nie znaleziono nowych boardów o tych nazwach. Stare identyfikatory pozostają w `design/traceability.json` wyłącznie jako `obsoleteBoardId` w `knownGaps`, nie jako aktywne `penpot.boardIds`.

| Overlay | Wariant | Nieistniejący UUID | Potwierdzone źródło istniejące dziś |
|---|---|---|---|
| OVR-14 — sesja wygasła | mobile | `1e066793-8858-8051-8008-cf43e509c246` | `ADM-19 / Access & session` M/D na stronie 03 i `DS-FBK-020 / SessionExpiredDialog` na stronie 01 |
| OVR-14 — sesja wygasła | desktop | `1e066793-8858-8051-8008-cf43e509c247` | To samo źródło; osobny board overlayu nadal nie istnieje |
| OVR-15 — instalacja PWA | mobile | `1e066793-8858-8051-8008-cf43e509c243` | `DS-PWA-001 / InstallPrompt` na stronie 01; `ADM-18` opisuje offline, a nie instalację |
| OVR-15 — instalacja PWA | desktop | `1e066793-8858-8051-8008-cf43e509c245` | To samo źródło; osobny board overlayu nadal nie istnieje |
| OVR-15 — instalacja PWA | variants | `1e066793-8858-8051-8008-cf43e509c244` | To samo źródło; osobny board wariantów nadal nie istnieje |
| OVR-17 — menu użytkownika | mobile | `1e066793-8858-8051-8008-cf43e509c241` | `DS-NAV-011 / UserMenu` na stronie 01 |
| OVR-17 — menu użytkownika | desktop | `1e066793-8858-8051-8008-cf43e509c242` | To samo źródło; osobny board overlayu nadal nie istnieje |

Strona 01: `a4abf4c9-2e1f-80fd-8008-afc9717972ba`; strona 03: `a4abf4c9-2e1f-80fd-8008-afc9717d55df`. `ADM-19` mobile `1e066793-8858-8051-8008-cf3e9586de22`, desktop `a4abf4c9-2e1f-80fd-8008-affed253d8f5`; `ADM-18` mobile `1e066793-8858-8051-8008-cf3e9586ddd9`, desktop `a4abf4c9-2e1f-80fd-8008-affeae329016`. Źródła komponentowe: `DS-FBK-020` board `368ee0a4-28c8-80cb-8008-b81dca1fd7f6`, komponent `368ee0a4-28c8-80cb-8008-b81e20a7f64a`; `DS-PWA-001` board mobile `9425204d-c5c4-807f-8008-b5a89c61c70b`, komponent `9425204d-c5c4-807f-8008-b5a8ff3225e6`; `DS-NAV-011` board mobile `9425204d-c5c4-807f-8008-b595c0d75342`, komponent `9425204d-c5c4-807f-8008-b597a3e742ba`. Historyczny `componentId` OVR-14 wskazywał `AdminPageShell`; źródłem właściwego dialogu jest `SessionExpiredDialog`.

## Wymaganie → ekran, wariant i stan

| Zakres | Potwierdzone boardy | Ograniczenie |
|---|---|---|
| Sesja wygasła / brak uprawnień, `FR-ADM-003` | `ADM-19` M/D `state=session-expired`; warianty `state=access-denied` M/D; `DS-FBK-020` jako komponent | OVR-14 nadal bez osobnych M/D boardów. 401, timeout i odmowa uprawnień pozostają odrębnymi stanami w aplikacji. |
| Instalacja i offline PWA, `FR-PWA-001–005` | `DS-PWA-001` jako komponent instalacji; `ADM-18` M/D `state=offline` | OVR-15 bez osobnych boardów. Offline nie dowodzi instalacji, a statyczny prompt nie dowodzi service workera. |
| Menu użytkownika / Więcej | `DS-NAV-011` jako komponent M/D | OVR-17 bez osobnych boardów. Wymaga weryfikacji zachowania klawiatury/fokusu w aplikacji. |
| MFA firmy i superadmina, `C-F040`, `D-05` | `ACC-07` weryfikacja M/D; `FLOW-MVP-02` M/D 07 enrollment i 07C odzyskanie; `FLOW-MVP-03` M/D 05 wspólne MFA | Boardy scenariuszy są stanami, nie nowymi trasami. 07C zawiera komunikat kontaktu z pomocą, ale nadal pokazuje DEMO klucz i pole kodu; akcja potwierdzenia ma pusty cel. Kody odzyskania i ręczna procedura właściciela wymagają osobnego przeglądu designu/implementacji. |

Boardy MFA na stronie 14 (`fb4e1683-f05f-8095-8008-c755dff0027c`): enrollment `4e2ad814-13be-80ec-8008-cc98e7641a9a`, odzyskanie `4e2ad814-13be-80ec-8008-cc98f6937664`, wspólne MFA `4e2ad814-13be-80ec-8008-cc9fbbe9363e`. Na stronie 15 (`fb4e1683-f05f-8095-8008-c755dff4dae6`): enrollment `4e2ad814-13be-80ec-8008-cc95e2b4b5f4`, odzyskanie `4e2ad814-13be-80ec-8008-cc96bbba80bb`, wspólne MFA `4e2ad814-13be-80ec-8008-cc9f9f862e0d`. `ACC-07` na stronie 03: mobile `1e066793-8858-8051-8008-cf3e790c33a6`, desktop `269b07ba-69e5-8066-8008-c7a8b4386e15`.

Sprawdzono także odnośniki w zależnych issue [#11](https://github.com/KarolR2001/Auterva/issues/11), [#15](https://github.com/KarolR2001/Auterva/issues/15), [#73](https://github.com/KarolR2001/Auterva/issues/73), [#75](https://github.com/KarolR2001/Auterva/issues/75) i [#78](https://github.com/KarolR2001/Auterva/issues/78). Wskazane tam boardy istnieją na podanych stronach, mają zgodne nazwy i warianty M/D. W #15 enrollment i odzyskanie MFA prowadzą do właściwych plansz scenariuszy; nie wymagały podmiany linków.

## Puste cele interakcji na stronach scenariuszy

Live: strona 14 ma 256 interakcji i 28 akcji z `destination.id = null`; strona 15 ma 250 interakcji i 24 takie akcje. Razem 52 z 506 interakcji tych dwóch stron. Historyczne 1284 dotyczyło pełnego pliku i nie jest nowym wynikiem pełnego skanu. Żadna z poniższych akcji nie potwierdza działania prototypu lub aplikacji.

| Strona | Board kontekstowy | Element/shape ID | Akcja z pustym celem |
|---|---|---|---|
| 14 / mobile | FLOW-MVP-02 / M / 03B / Błąd wysyłki — firma zachowana (`4e2ad814-13be-80ec-8008-cc908e33d374`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cc908e33d3ee`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-12 / M / 01 — Publiczny adres Autervy przygotowany (`f625007f-d8bc-808b-8008-ccd5b4aa09ca`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd5b5438781`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 01 / Dodaj firmę (`4e2ad814-13be-80ec-8008-cc908c621e2e`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cc908c6251a3`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-12 / M / 07 — Domena aktywna i przekierowanie (`f625007f-d8bc-808b-8008-ccd6a443e865`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd6a443e882`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-07 / M / 02 — Zapisany nowy okres (`4e2ad814-13be-80ec-8008-cca09dd0f3f8`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cca09dd0f472`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 07C — Odzyskanie dostępu do MFA (`4e2ad814-13be-80ec-8008-cc98f6937664`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc98f693766c`) | `navigate-to` |
| 14 / mobile | FLOW-MVP-11 / M / 10 — Powrót do tej samej firmy (`4e2ad814-13be-80ec-8008-ccaacecd969f`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-ccaacecd9719`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 03 / Zaproszenie wysłane (`4e2ad814-13be-80ec-8008-cc908d70912e`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cc908d7091a8`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-08 / M / 07 — Superadmin przedłuża okres (`4e2ad814-13be-80ec-8008-cca471716f56`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cca471716fd0`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 07 — Pierwsza konfiguracja MFA (`4e2ad814-13be-80ec-8008-cc98e7641a9a`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc98e77a58aa`) | `navigate-to` |
| 14 / mobile | FLOW-MVP-12 / M / 04B — Domena zajęta — dane zachowane (`f625007f-d8bc-808b-8008-ccd6a5614886`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd6a56148a3`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-03 / M / 05 — Wspólne MFA (`4e2ad814-13be-80ec-8008-cc9fbbe9363e`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc9fbbe93646`) | `navigate-to` |
| 14 / mobile | FLOW-MVP-02 / M / 01D — Błąd zapisu, dane zachowane (`fb4e1683-f05f-8095-8008-c77a9a5d904a`) | Button / Anuluj (`96538b9c-ee73-800d-8008-cf0f4f986cc7`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 01B — Walidacja firmy (`fb4e1683-f05f-8095-8008-c7627a3913fc`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cc8dd795b32a`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 07B — Nieprawidłowy kod MFA (`4e2ad814-13be-80ec-8008-cc98f67cd79b`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc98f67cd7a3`) | `navigate-to` |
| 14 / mobile | FLOW-MVP-02 / M / 01C — Zapisywanie firmy (`96538b9c-ee73-800d-8008-cf0f911b927d`) | Button / Anuluj (`96538b9c-ee73-800d-8008-cf0f911b92c0`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-11 / M / 02 — Karta Alfa Campers (`4e2ad814-13be-80ec-8008-ccaa3d74b94c`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-ccaa3d74f5f7`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-12 / M / 06 — Domena gotowa do aktywacji (`f625007f-d8bc-808b-8008-ccd6a3353569`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd6a3353586`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-07 / M / 01B — Błąd zapisu, dane zachowane (`4e2ad814-13be-80ec-8008-cca09e02aab9`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cca09e02ab33`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-12 / M / 05C — TLS niegotowy — ponowienie (`f625007f-d8bc-808b-8008-ccd6a7add1f5`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd6a7add212`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-07 / M / 01 — Nowy okres, zmiany niezapisane (`4e2ad814-13be-80ec-8008-cca09d98fd59`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cca09d98fdd3`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-03 / M / 01 — Trial oczekuje na rejestrację (`4e2ad814-13be-80ec-8008-cc9e63d68356`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cc9e63d683d0`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 02 / Firma zapisana — zaproszenie niewysłane (`4e2ad814-13be-80ec-8008-cc908c892b4b`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cc908c895fa7`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-12 / M / 05 — DNS i TLS w trakcie sprawdzania (`f625007f-d8bc-808b-8008-ccd6a22ed864`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd6a22ed881`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-12 / M / 04 — Domena klienta wpisana (`f625007f-d8bc-808b-8008-ccd6a11d79ad`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd6a11d79ca`) | `open-overlay` |
| 14 / mobile | PLT-03 / Company details / Mobile / state=active (`fb4e1683-f05f-8095-8008-c761449ab7eb`) | Button / Anuluj (`4e2ad814-13be-80ec-8008-cc9070ad2340`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-12 / M / 05B — Niezgodny DNS — ponowienie (`f625007f-d8bc-808b-8008-ccd6a68a54c9`) | Button / Anuluj (`f625007f-d8bc-808b-8008-ccd6a68a54e6`) | `open-overlay` |
| 14 / mobile | FLOW-MVP-02 / M / 02A — Wysyłanie zaproszenia (`efe3ac9b-6991-807f-8008-cf1d8eeaad24`) | Button / Anuluj (`efe3ac9b-6991-807f-8008-cf1d8eeaad9e`) | `open-overlay` |
| 15 / desktop | FLOW-MVP-02 / D / 04B — Link nieaktywny (`4e2ad814-13be-80ec-8008-cc95546474e8`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc95546474ed`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 04 — Aktywacja konta (`4e2ad814-13be-80ec-8008-cc9546a01790`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc9546be634f`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 05B — Konto aktywne, routing w toku (`4e2ad814-13be-80ec-8008-cc95548024d7`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc95548024dc`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 05B — Konto aktywne, routing w toku (`4e2ad814-13be-80ec-8008-cc95548024d7`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc95548024db`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-03 / D / 02 — Rejestracja uruchamia trial (`4e2ad814-13be-80ec-8008-cc9f04d63807`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc9f04d6380b`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 05 — Konto aktywne, strona dostępna (`4e2ad814-13be-80ec-8008-cc95544b6ca9`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc95544b6cae`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 07B — Nieprawidłowy kod MFA (`4e2ad814-13be-80ec-8008-cc95e2db8769`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc95e2db8775`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 04D — Walidacja hasła (`4e2ad814-13be-80ec-8008-cc955492ea7b`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc955492ea7f`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 04 — Aktywacja konta (`4e2ad814-13be-80ec-8008-cc9546a01790`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc9546be634d`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-03 / D / 03 — Trial rozpoczęty (`4e2ad814-13be-80ec-8008-cc9f04e32062`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc9f04e32067`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 07 — Pierwsza konfiguracja MFA (`4e2ad814-13be-80ec-8008-cc95e2b4b5f4`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc95e2d313cb`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 04D — Walidacja hasła (`4e2ad814-13be-80ec-8008-cc955492ea7b`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc955492ea80`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 04C — Błąd sieci, retry (`4e2ad814-13be-80ec-8008-cc9554747c6c`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc9554747c71`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-12 / D / 02 — Rejestracja administratora (`f625007f-d8bc-808b-8008-ccd67aa37865`) | Action / Submit (`f625007f-d8bc-808b-8008-ccd67aa3786a`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 04C — Błąd sieci, retry (`4e2ad814-13be-80ec-8008-cc9554747c6c`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc9554747c70`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-12 / D / 02A — Konto aktywne i strona uruchomiona (`f625007f-d8bc-808b-8008-ccd69a25f9f5`) | Action / Submit (`f625007f-d8bc-808b-8008-ccd69a25f9fa`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-03 / D / 02 — Rejestracja uruchamia trial (`4e2ad814-13be-80ec-8008-cc9f04d63807`) | Action / Submit (`4e2ad814-13be-80ec-8008-cc9f04d6380c`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 07C — Odzyskanie dostępu do MFA (`4e2ad814-13be-80ec-8008-cc96bbba80bb`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc96bbba80c3`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 05 — Konto aktywne, strona dostępna (`4e2ad814-13be-80ec-8008-cc95544b6ca9`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc95544b6cad`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-02 / D / 04B — Link nieaktywny (`4e2ad814-13be-80ec-8008-cc95546474e8`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc95546474ec`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-03 / D / 05 — Wspólne MFA (`4e2ad814-13be-80ec-8008-cc9f9f862e0d`) | Instance / Button / Potwierdź kod / mobile (`4e2ad814-13be-80ec-8008-cc9f9f862e15`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-03 / D / 03 — Trial rozpoczęty (`4e2ad814-13be-80ec-8008-cc9f04e32062`) | Action / Back to login (`4e2ad814-13be-80ec-8008-cc9f04e32066`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-12 / D / 02 — Rejestracja administratora (`f625007f-d8bc-808b-8008-ccd67aa37865`) | Action / Back to login (`f625007f-d8bc-808b-8008-ccd67aa37869`) | `navigate-to` |
| 15 / desktop | FLOW-MVP-12 / D / 02A — Konto aktywne i strona uruchomiona (`f625007f-d8bc-808b-8008-ccd69a25f9f5`) | Action / Back to login (`f625007f-d8bc-808b-8008-ccd69a25f9f9`) | `navigate-to` |

## Warunek odbioru braków

- Wyznaczony projektant w osobnym zadaniu rozstrzyga, czy OVR-14/15/17 mają mieć własne boardy M/D, czy obowiązujące komponenty i ekran wystarczą; zapisuje decyzję i rzeczywiste ID. Ta decyzja nie powstaje przez samą zmianę mapy.
- Właściciel designu przypisuje lub usuwa 52 puste cele zgodnie z intencją przepływów. Szczególnie przejrzeć MFA i akcje formularzy. Po zmianie ponowić odczyt ID, typu akcji i celu oraz test klikania, bez kopiowania starych wyników.
- Implementacja zachowuje obowiązkowe MFA, kody odzyskania i ręczne odzyskanie według PRD/D-05. Brak kompletnej makiety nie znosi wymagania. W `design/traceability.json` nie wpisuje się ścieżki kodu ani testu, dopóki nie powstaną.
- QA porównuje aktualny plik, stronę, board, stan i viewport; osobno sprawdza klawiaturę, fokus, API i uprawnienia w działającej aplikacji. Ten audyt nie jest dowodem runtime.
