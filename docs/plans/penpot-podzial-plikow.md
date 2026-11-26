# Plan: podział projektu Penpota na kilka plików ze wspólnymi tokenami

Cel: Penpot MCP przestaje się zawieszać (timeouty odczytu/eksportu, „tab suspended”), a makiety dalej mają jedno źródło tokenów i działające mapowanie `design/traceability.json`.

Numer issue: do nadania przy zakładaniu zadania (jedna rola wykonawcza: Frontend/design; zmianę w Penpocie wykonuje jeden wyznaczony agent).

## Stan wyjściowy

- Jeden plik `Nowy plik 2` (`b564c72c-f31f-81ec-8008-af198a313438`): 7 stron, 175 komponentów biblioteki, 174 tokeny natywne (`Primitives` 94, `Semantic/Light` 56, `Component` 24). Źródło: `design/README.md`, `design/tokens/README.md`, stan z 22.10.2026.
- Strony: 00 Start, 01 System, 02 Publiczne M+D, 03 Panel firmy M+D, 14/15 Scenariusze Mobile/Desktop, 16 Opisy scenariuszy.
- MCP jest hostowany i przekazuje każde wywołanie do jednej wtyczki w jednej karcie Chrome; globalne wyszukiwanie po pliku przechodzi przez wszystkie strony.
- Podział na pliki zmniejsza koszt każdego odczytu, ale **nie usuwa ograniczenia jednej karty**: blokada `.git/penpot.lock` i jeden zapisujący agent zostają.

## Pomiar z odczytu na żywo (krok 1, wykonany)

Plik `b564c72c-…8438`, jedna strona na wywołanie, bez blokowania innych agentów dłużej niż kilkadziesiąt sekund. Czas to samo przejście po drzewie strony.

| Strona | Kształty | Boardy | Instancje komponentów | Interakcje | Czas przejścia |
|---|---|---|---|---|---|
| 00 Start | 38 | 6 | 0 | 0 | 0,03 s |
| 01 System | 31 734 | 9 921 | 29 840 | 6 | 6,3 s |
| 02 Publiczne | 5 158 | 1 765 | 3 923 | 339 | 1,0 s |
| 03 Panel firmy | 11 379 | 3 929 | 7 888 | 553 | 2,2 s |
| 14 Scenariusze Mobile | 24 104 | 8 065 | 21 286 | 379 | 4,7 s |
| 15 Scenariusze Desktop | 27 228 | 9 946 | 24 223 | 401 | 5,6 s |
| 16 Opisy scenariuszy | 369 | 52 | 0 | 52 | 0,08 s |
| **Razem** | **~100 000** | | | | |

Wnioski: strona System sama ma ~32 tys. kształtów (głównie zagnieżdżone instancje w komponentach), a scenariusze 14+15 razem ~51 tys. Sam wariant A (tylko wycięcie 14–16) zostawiłby w pliku bazowym ~48 tys. kształtów, więc **zalecany jest wariant C**:

| Plik | Strony | Kształty |
|---|---|---|
| Auterva — System | 00, 01 | ~31,8 tys. |
| Auterva — Ekrany | 02, 03 | ~16,5 tys. |
| Auterva — Scenariusze Mobile | 14, 16 | ~24,5 tys. |
| Auterva — Scenariusze Desktop | 15 | ~27,2 tys. |

Obecny plik (`b564c72c-…`) zostaje plikiem System i zachowuje ID stron 00 i 01. Pozostałe strony zmieniają plik, więc ich ID trzeba odczytać na nowo (krok 6).

Uwaga o tokenach: API wtyczki ma `penpot.library.tokensSource` (biblioteka dostarczająca tokeny pliku). Jeśli ta wersja Penpota to wspiera, plik Ekrany/Scenariusze mogą brać tokeny z podłączonej biblioteki System bez importu JSON. Sprawdź to w kroku 5 przed ręcznym importem.

## Założenia do sprawdzenia (nie zakładać)

1. Tokeny Penpota są per plik. Wspólnota tokenów = import tego samego JSON do każdego pliku. Sprawdź w aktualnej wersji, czy biblioteka współdzieli tokeny; jeśli tak, uprość krok 5.
2. Duplikowanie pliku i import `.penpot` mogą nadać nowe UUID stronom/boardom/komponentom. Przyjmij, że **ID się zmienią**, dopóki odczyt nie wykaże inaczej (krok 3).
3. Prototypy (flows) działają tylko w obrębie pliku. Interakcje między boardami z różnych stron, które trafią do różnych plików, przestaną działać.

## Docelowy podział (wariant A, zalecany: najmniejsza zmiana)

| Plik | Strony | Uwagi |
|---|---|---|
| Auterva — System i ekrany (obecny plik, zachowuje ID) | 00, 01, 02, 03 | Źródło komponentów DS i tokenów; ID stron 00–03 się nie zmieniają |
| Auterva — Scenariusze | 14, 15, 16 | Najcięższe: pełne stany FLOW-MVP, 52 puste cele interakcji, prototypy |

Wariant B (tylko jeśli po wariancie A nadal są timeouty): dodatkowo wydzielić stronę 03 (Panel firmy) do osobnego pliku, a w pliku bazowym zostawić 00–02. Decyzja po pomiarze z kroku 1.

## Kroki

### 0. Przygotowanie i kopia

1. `git status --short`; zapisz plan jako issue, `design/` ma jednego zapisującego agenta.
2. W Penpocie: **Export file (.penpot)** pełnego obecnego pliku i zapisz poza repozytorium (kopia odtwarzalna, wymagana przez `design/AGENTS.md`). Nie commituj binarki.
3. Zamknij inne karty Penpota; karta w osobnym widocznym oknie; wyłącz dla `design.penpot.app` oszczędzanie pamięci i energii w Chrome.
4. Weź blokadę: `mkdir .git/penpot.lock` (po pracy `rmdir`; uznaj za nieaktualną po 6 min). Pozostali agenci (CR/QA/FE) nie czytają Penpota w trakcie migracji.

### 1. Pomiar (decyzja A czy B)

Dla każdej strony osobnym `execute_code` (jedna strona = jedno wywołanie, zakres `page.getShapeById`, nie globalnie) policz: liczbę kształtów, liczbę boardów, liczbę interakcji prototypu, liczbę instancji komponentów. Zapisz tabelę w issue. Strona/plik z największą liczbą kształtów jest pierwszym kandydatem do wydzielenia. Jeśli 14+15+16 to większość kształtów, wariant A wystarcza.

### 2. Inwentarz zależności między stronami

Przed przeniesieniem odczytaj (po jednej stronie na wywołanie):

- interakcje prototypu na stronach 14/15 wskazujące na boardy ze stron 02/03/01 (nawigacja między plikami nie zadziała),
- instancje komponentów z biblioteki w pliku (to wewnętrzna biblioteka pliku bazowego; w nowym pliku muszą wskazywać na bibliotekę udostępnioną),
- wpisy `traceability.json`, których `pageIds`/`boardIds` leżą na stronach 14–16 oraz `prototypes` P-01, P-02, A-03 (odłożone decyzją właściciela, ale zostają w indeksie).

Wynik: lista „przerwane po przeniesieniu” w issue. Jeśli lista jest długa, przenieś też boardy docelowe jako kopie scenariuszy albo wybierz wariant, który ich nie rozdziela.

### 3. Utworzenie pliku scenariuszy

1. W obecnym pliku najpierw **udostępnij go jako Shared Library** (File → Libraries → Publish). Ma zawierać komponenty ze strony 01.
2. Zduplikuj plik (Duplicate), nazwij „Auterva — Scenariusze”. W duplikacie usuń strony 00–03 (zostają 14, 15, 16), a w oryginale usuń 14, 15, 16 dopiero **po** weryfikacji kroku 4.
3. W duplikacie podepnij bibliotekę „System” i podmień lokalne komponenty na biblioteczne, żeby nie było dwóch kopii komponentów. Jeśli duplikat zawiera własną kopię komponentów, usuń je dopiero, gdy instancje wskażą bibliotekę (inaczej instancje się odepną).
4. Zmierz po duplikacie, czy ID się zmieniły: porównaj nazwę + ID strony 14 w obu plikach. Zapisz wynik; to rozstrzyga założenie 2.

### 4. Weryfikacja przed usunięciem stron z oryginału

W obu plikach, jedna strona na wywołanie:

- liczba boardów i kształtów na przeniesionych stronach identyczna z pomiarem z kroku 1,
- render 3–4 reprezentatywnych boardów (390 i 1440 px) w nowym pliku; brak renderu = brak przeglądu wizualnego,
- instancje komponentów wskazują bibliotekę (nie „detached”, nie „missing library”),
- prototypy w obrębie scenariuszy działają; przerwane z kroku 2 zapisane w issue.

Dopiero potem usuń strony 14–16 z pliku bazowego i zmierz ponownie czas odczytu/eksportu tej samej planszy (przed/po w issue).

### 5. Wspólne tokeny

1. Źródłem pozostaje `design/tokens/auterva.tokens.json`; nie edytuj tokenów ręcznie w Penpocie.
2. Dodaj skrypt `scripts/export_penpot_tokens.mjs`, który z manifestu generuje JSON w formacie importu tokenów Penpota (zestawy `Primitives`, `Semantic/Light`, `Component`). Zachowaj znane wyjątki z `design/tokens/README.md`: fallback `Inter Tight` w Penpocie (w aplikacji Inter Variable), motion jako liczby, mapowanie nazwy `action.destructive.pressed.content`.
3. Zaimportuj ten sam JSON do pliku scenariuszy (Tokens → Import). Plik bazowy już ma tokeny; porównaj jego eksport z manifestem.
4. Odczytaj tokeny w obu plikach po imporcie i porównaj z manifestem (liczba: 174 natywne; różnica 1 do 175 jest udokumentowana). Sprawdź bindingi na kilku boardach; sama nazwa warstwy nie dowodzi bindingu.

### 6. Aktualizacja mapowania i dokumentacji

- `design/traceability.json`: schemaVersion 3 → 4. `penpot.fileId` zostaje dla pliku bazowego; dodaj `penpot.files[]` (`name`, `fileId`, `role`, `pages[]`) oraz w pozycjach, których strony przeniesiono, pole `penpot.fileId`. `conventions.fileId` („wszystkie odwołania dziedziczą penpot.fileId”) zmień na regułę „domyślnie plik bazowy, chyba że pozycja ma własny fileId”. Nowe ID tylko z odczytu, bez zgadywania. Odłożone prototypy P-01, P-02, A-03 zachowują status.
- Pliki wskazujące stary plik: `design/README.md`, `design/AGENTS.md` (jeśli trzeba), `design/handoff/components.md`, `design/handoff/mfa-recovery.md`, `design/handoff/platform-account.md`, `design/handoff/platform-onboarding-navigation.md`, `docs/ARCHITEKTURA_AUTERVA.md` (załącznik A), `docs/adr/0001-penpot.md`, `docs/design/PENPOT_AUDIT_ISSUE_7.md`, `docs/development/GITHUB_ACCESS.md`. Zmień tylko miejsca, gdzie liczy się, w którym pliku leży strona; dopisz datę odczytu.
- `design/README.md`, sekcja „Odczyt Penpota”: krok „potwierdź plik” dla każdego z plików; wpis o jednym zapisującym agencie i blokadzie.
- Sprawdź, czy któryś test lub skrypt czyta `traceability.json` i zakłada jeden `fileId` (`grep -rn "penpot.fileId\|fileId" scripts tests src`); popraw je i uruchom.

### 7. Zasady pracy po podziale (QA/FE)

- Agent czyta tylko plik i stronę wskazane w pozycji `traceability.json`; jedno wywołanie = jeden board; eksport tylko małych poddrzew.
- Zmiana tokenu: manifest → `node scripts/generate_design_tokens.mjs` → eksport JSON → import do **obu** plików → odczyt kontrolny.
- Zmiana komponentu: tylko w pliku bazowym, publikacja biblioteki, potem „Update” w pliku scenariuszy.
- Nie zmieniaj makiet, aby ukryć rozbieżność aplikacji (reguła `design/AGENTS.md`).

### 8. Odbiór

Dowody w PR/issue (bez dziennika w repozytorium):

- tabela przed/po: liczba kształtów na plik, czas odczytu i eksportu tego samego boardu,
- porównanie tokenów manifest ↔ oba pliki,
- lista przerwanych prototypów i decyzja właściciela,
- sprawdzenie, że wszystkie ID w `traceability.json` istnieją we wskazanym pliku (odczyt wyrywkowy każdej grupy + 7 znanych braków bez zmian),
- brak regresji: `git diff` obejmuje tylko `design/`, `docs/`, `scripts/`.

## Ryzyka i wycofanie

- Duplikacja/import może zmienić ID i odpiąć instancje komponentów. Wycofanie: kopia `.penpot` z kroku 0, a oryginalny plik zachowuje strony 14–16 aż do końca kroku 4.
- Tokeny mogą rozjechać się między plikami. Ograniczenie: jeden JSON z manifestu i kontrola porównawcza w kroku 8.
- Podział nie rozwiązuje kolizji wielu agentów w jednej karcie. Ograniczenie: blokada i seryjne odczyty.
- Jeśli po wariancie A nadal są timeouty, wykonaj wariant B (strona 03 osobno) według tych samych kroków 3–8.

## Otwarte decyzje właściciela

1. Wariant A czy B po pomiarze.
2. Czy usunąć strony 14–16 z pliku bazowego, czy zostawić je tymczasowo jako zapas.
3. Czy właściciel akceptuje zmianę schematu `traceability.json` (3 → 4).
