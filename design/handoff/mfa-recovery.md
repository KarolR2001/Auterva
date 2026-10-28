# MFA — odzyskanie i niepewny wynik

Zakres: C-F040, C-F044, FR-ADM-004/005/007 oraz D-05. Ten kontrakt uzupełnia `DS-AUT-005` i ekran ACC-07. Dotyczy obu ról, panelu firmy i platformy; nie zmienia serwerowych zasad MFA. Wersja mobilna ma 390 px, desktop 1440 px. W obu przypadkach zachowuje się Inter Variable, czytelne etykiety pól i komunikaty, których znaczenie nie zależy wyłącznie od koloru.

## Rozdzielenie ścieżek

| Stan wejścia | Dalszy przebieg | Granica bezpieczeństwa |
|---|---|---|
| Użytkownik ma działającą aplikację TOTP | Potwierdzenie jednorazowego kodu → pełna sesja | Błąd i limit pozostają w weryfikacji; nie tworzą pełnej sesji. |
| Użytkownik ma zapisany kod odzyskania | Zużycie kodu → ograniczony ponowny enrollment: hasło → nowy TOTP → nowa jednorazowa lista kodów → panel | Kod nie prowadzi wprost do panelu ani nie odtwarza starej listy. |
| Użytkownik nie ma ani aplikacji, ani kodów | Istniejący FLOW-MVP-02/07C: ręczna procedura właściciela | Nie ma samodzielnego obejścia przez formularz. |
| Odpowiedź na operację MFA zaginęła | Informacja o niepewnym wyniku → odczyt stanu sesji → dalszy krok według potwierdzonego stanu | Brak automatycznego powtórzenia potencjalnie zużytego kodu. Błąd odczytu nadal oznacza niepewność. |
| Pełna sesja potwierdzona po zwykłym challenge | Panel właściwej roli | Dotyczy zwykłego logowania, bez zamiaru odzyskania listy. |
| Pełna sesja potwierdzona przy zamiarze odzyskania utraconej listy | Świeży czynnik → hasło → ponowne wydanie kodów | Sama pełna sesja nie ujawnia poprzednich kodów i nie wystarcza do rotacji. |
| Sesja ograniczona po kodzie odzyskania | Serwerowa strona MFA prowadzi do ponownego enrollmentu: hasło → nowy TOTP → nowe kody | Odczyt pełnej sesji może zwrócić 401 także dla sesji ograniczonej; sam kod odpowiedzi nie oznacza wylogowania. |
| Sesja nie istnieje lub została cofnięta | Powrót do logowania z zachowanym zamiarem odzyskania kodów | Zachować wyłącznie flagę zamiaru; sekretów, kodów i dowodów nie zapisywać w URL ani storage. |
| Odczyt stanu nie powiódł się | Pozostać przy niepewnym wyniku i umożliwić ponowny odczyt po odzyskaniu połączenia | Błąd sieci nie jest dowodem wylogowania ani sukcesu. |
| Odpowiedź z nową listą zaginęła | Nowy świeży czynnik → hasło → nowa lista kodów | Nie obiecujemy odzyskania poprzedniej jednorazowej listy. Po kolejnej utracie odpowiedzi wracamy do weryfikacji. |

## Stany widoczne

- **Kod odzyskania:** jedno pole tekstowe z wyjaśnieniem jednorazowości, akcją potwierdzenia i powrotem do TOTP. Niepoprawny lub użyty kod dostaje neutralny komunikat przy polu; próba w toku blokuje ponowne wysłanie; limit pokazuje rzeczywisty czas ponowienia bez obcinania go do minuty.
- **Wydana lista:** fikcyjne kody służą wyłącznie do przedstawienia układu. Tekst wyjaśnia, że każdy działa raz, nowa lista unieważnia starą, a po opuszczeniu tego widoku kodów nie można ponownie odczytać. Jednoznaczne potwierdzenie zapisania zamyka ten krok.
- **Niepewny wynik:** tekst „Nie wiadomo, czy operacja została zakończona” jest wspólny dla challenge, enrollmentu i rotacji. Jedyna akcja sprawdza stan; błąd odczytu pozostawia użytkownika na tym samym ekranie z możliwością ponownego sprawdzenia po odzyskaniu połączenia.
- **Ponowne wydanie:** najpierw świeży czynnik, potem hasło. Odmowa lub wygaśnięcie potwierdzenia wraca do świeżej weryfikacji; nie ponawia starego dowodu. Utrata odpowiedzi na rotację wraca do stanu niepewnego, bez pozornego sukcesu.

Makiety są statycznym kontraktem układu i nawigacji. Testy API, rzeczywiste zużycie kodu, sesja, limit, utrata odpowiedzi oraz brak sekretów w logach należą do implementacji i odbioru #15. VoiceOver pozostaje odroczony do #97; pozostałe kontrole dostępności obowiązują teraz.

## Referencje ekranów

Plik Penpota: `b564c72c-f31f-81ec-8008-af198a313438`. Strony scenariuszy: Mobile `fb4e1683-f05f-8095-8008-c755dff0027c`, Desktop `fb4e1683-f05f-8095-8008-c755dff4dae6`. Pary rzeczywistych ID są w `design/traceability.json` → `ACC-07.scenarioStateBoards`:

- `recoveryCode`: 07D (wpisanie), 07D1 (niepoprawny lub użyty), 07D2 (sprawdzanie), 07D3 (limit);
- `recoveryPassword`: 07E, po przyjęciu kodu i przed nowym TOTP;
- `issuedCodes`: 07G, jednorazowa lista przykładowych kodów;
- `totpChallenge`: 07A, zwykłe potwierdzenie kodu TOTP bez komunikatu błędu;
- `uncertainResult`: 07H, niepewny wynik i akcja odczytu sesji;
- `sessionReadPrototype`: 07H0, wyraźnie oznaczona symulacja wyników wyłącznie dla prototypu, oraz 07H1 (błąd odczytu) i 07H2 (brak sesji z zachowanym zamiarem nowej listy);
- `rotateFreshFactor`: 07I, świeży czynnik po utracie listy;
- `rotatePassword`: 07J, hasło przed ponownym wydaniem;
- `expiredProof`: 07J1, odmowa lub wygaśnięcie potwierdzenia.

Istniejący 07C pozostaje wyłącznie ręczną procedurą po utracie obu czynników. Istniejący 07 jest ekranem nowego TOTP po ograniczonym dostępie; wymagane przejście po jego zatwierdzeniu to 07G, a dopiero potwierdzenie zapisania kodów prowadzi do panelu. Prototyp Penpota nie rozpoznaje odpowiedzi serwera, więc warunki odczytu sesji i utrata odpowiedzi są rozstrzygane przez aplikację zgodnie z tabelą wyżej. Samo istnienie ID nie potwierdza połączenia wszystkich akcji; wynik odczytu live i eksportu jest w #132.

## Nawigacja prototypu i granice

- Biblioteczny ACC-07 default to wzorzec wyglądu weryfikacji: Mobile `1e066793-8858-8051-8008-cf3e790c33a6`, Desktop `269b07ba-69e5-8066-8008-c7a8b4386e15` na stronie `a4abf4c9-2e1f-80fd-8008-afc9717d55df`. Penpot zwraca pusty cel przy `navigate-to` między tą stroną a stronami scenariuszy. Testowy link usunięto; nie zaliczać bibliotecznego przycisku jako działającego prototypu odzyskiwania.
- Działające wejście na tej samej stronie scenariuszy: widoczna akcja „Nie mam dostępu do aplikacji” z 07B Mobile (`4e2ad814-13be-80ec-8008-cc98f67cd79b`, hit `4e2ad814-13be-80ec-8008-cc98f67cd7a2`) prowadzi do M/07D. Desktop (`4e2ad814-13be-80ec-8008-cc95e2db8769`, hit `4e2ad814-13be-80ec-8008-cc95e2db876f`) prowadzi do D/07D. Oba cele odczytano po zapisie.
- 07D i jego stany błędu/limitu mają odrębne akcje: potwierdzenie posiadanego kodu, powrót do 07A (zwykły TOTP) oraz „Nie mam aplikacji ani kodów” prowadzące do istniejącego 07C tej samej strony. 07D1 pokazuje ponowną próbę przez 07D2; wynik API wybiera dalszy stan. 07D2 wyłącza oba przyciski podczas żądania, a 07D3 wyłącza ponowienie do końca rzeczywistego `Retry-After`; dlatego te szare kontrolki nie mają prototypowego kliknięcia.
- Ścieżka poprawnego kodu: 07D → 07E (hasło) → istniejący 07 (nowy TOTP) → 07G (nowe kody) → panel. Ścieżka utraconej odpowiedzi na listę: 07I (świeży czynnik) → 07J (hasło) → 07G; po odmowie/wygaśnięciu 07J1 wraca do 07I. 07H „Sprawdź stan” prowadzi do 07H0. Ten ekran jest wyłącznie nawigatorem prototypu, jawnie oznaczonym jako symulacja odpowiedzi serwera; nie należy go implementować w UI ani pozwalać użytkownikowi wybierać stanu sesji. Klikalne warianty 07H0 prowadzą: pełna sesja bez zamiaru odzyskania → panel, pełna sesja z zamiarem nowej listy → 07I, sesja ograniczona po kodzie odzyskania → 07E, brak sesji bez zamiaru → logowanie, brak sesji z zamiarem → 07H2 → logowanie, błąd odczytu → 07H1 → ponowny odczyt przez 07H0. Aplikacja #15 rozstrzyga wariant po serwerowym odczycie stanu; błędu nie interpretuje jako sukcesu ani wylogowania i nie ponawia potencjalnie zużytego kodu.
- FLOW-MVP-03/05 M/D jest historyczną kompozycją enrollmentu z QR i dawnym CTA obiecującym wejście prosto do panelu. Nie jest wzorcem implementacji #15 ani punktem wejścia do posiadanego kodu. Kanoniczny enrollment to FLOW-MVP-02/07 M/D z rzeczywistym przejściem do 07G. W `traceability.json` historyczny board jest jawnie niekanoniczny.

Punkty odtworzenia przed zmianą istniejących boardów: mobilny 07 `89433e5c-4f5c-80ad-8008-d97b37d40aed`, desktopowy 07 `89433e5c-4f5c-80ad-8008-d9828ebb77b1`, mobilny 07B `89433e5c-4f5c-80ad-8008-d9850d4478d6`, desktopowy 07B `89433e5c-4f5c-80ad-8008-d9852ee48871`. Są ukrytymi kopiami właściwych boardów w tym samym pliku; ich odtworzenie nie wymaga cofnięcia całego pliku. Dodane stany M/D używają wyłącznie pięciu zatwierdzonych kolorów oraz Inter; finalne rendery 390/1440 px sprawdzono w Chromium z załadowanym fontem.

## Odczyt live i korekty (Frontend, #132)

- Odczyt interakcji M i D potwierdził pełny graf: 07D/07D1/07D3 → 07E (07D1 → 07D2), 07E → 07 → 07G → panel; 07I → 07J → 07G, 07J1 → 07I; 07D2 bez akcji (disabled). Zgodne z listą M i D.
- Korekta: przycisk „Potwierdź kod” w 07B (M i D) miał pusty cel `navigate-to`; ustawiono panel FLOW-MVP-02 08 (M `4e2ad814-13be-80ec-8008-cc9917133544`, D `4e2ad814-13be-80ec-8008-cc9750a70b0f`). Duplikat akcji M/07B usunięto; ponowny odczyt potwierdził jedną akcję do panelu.
- Wynik dynamicznej weryfikacji TOTP nadal rozstrzyga serwer; prototyp pokazuje tylko ścieżkę sukcesu.
- Niepewny zapis `align: center` po timeout nie utrwalił się. Etykiety akcji w 10 nowych boardach Mobile i 10 Desktop wyśrodkowano małymi partiami; odczyt po zapisie i ponownym otwarciu strony potwierdził wszystkie 20 boardów. Etykiety pól pozostają wyrównane do lewej.
- Eksport PNG wszystkich 10 nowych boardów Desktop zakończył się poprawnie. Render 07D, 07G, 07H i 07J1 sprawdzono wizualnie po korekcie; na Mobile ponownie sprawdzono 07G. Etykiety nie nakładają się na inne treści. Eksporty służą kontroli makiet, nie są dowodem działania MFA w aplikacji ani zachowania klawiatury lub czytnika.

## Poprawki po CR #132

- Dotychczasowe powroty 07D, 07D1 i 07D3 (M/D) wskazywały historyczny FLOW-MVP-03/05 z enrollmentem QR. Na stronach scenariuszy dodano zwykły challenge 07A bez błędu (Mobile `2f81c084-f559-80fe-8008-dbb8f7ae8efa`, Desktop `2f81c084-f559-80fe-8008-dbb95a36748f`), z istniejącym wejściem do odzyskania i powrotem do logowania. Odczyt każdej z sześciu akcji potwierdził dokładnie jeden cel 07A. Oba warianty 07A sprawdzono w eksporcie PNG.
- Aktywne „Sprawdź stan” w 07H (M/D) ma teraz pojedynczy cel 07H0. 07H0 jest jawnie oznaczoną symulacją prototypu, **nie ekranem do implementacji**: sześć klikalnych gałęzi pokazuje pełną sesję zwykłą, pełną sesję z zamiarem nowej listy, sesję ograniczoną po kodzie odzyskania, brak sesji z zachowanym zamiarem, brak sesji bez zamiaru oraz błąd odczytu. Wynik wybiera serwer według D-05, nie użytkownik. Wariant z zamiarem idzie przez 07H2 do logowania i po logowaniu wymaga świeżego czynnika; bez zamiaru idzie wprost do logowania.
- Błąd 07H1 pozostawia wynik niepotwierdzony. Jedyna akcja „Ponów odczyt sesji” wraca do symulacji odczytu 07H0; nie wysyła ponownie TOTP ani kodu odzyskania. Odczyt struktury M/D potwierdził cele, a Mobile 07H0, 07H1 i 07H2 sprawdzono w PNG bez obcięcia tekstu. Desktop 07H0 ma potwierdzoną strukturę, tekst, obramowania i sześć pojedynczych interakcji oraz poprawny eksport SVG; eksport PNG dwukrotnie przekroczył limit MCP 120 s, także po odświeżeniu karty. To ograniczenie kontroli rastrowej Desktop 07H0, nie potwierdzenie renderu PNG. Desktop 07A wyeksportowano i sprawdzono.
- Runtime MFA i odczyt sesji pozostają w #15. Klawiatura, fokus, semantyka, zoom i reduced motion wymagają odbioru implementacji; statyczny Penpot ich nie potwierdza. VoiceOver: `DEFERRED` do #97.
