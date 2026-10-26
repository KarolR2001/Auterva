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
| Odpowiedź z nową listą zaginęła | Nowy świeży czynnik → hasło → nowa lista kodów | Nie obiecujemy odzyskania poprzedniej jednorazowej listy. Po kolejnej utracie odpowiedzi wracamy do weryfikacji. |

## Stany widoczne

- **Kod odzyskania:** jedno pole tekstowe z wyjaśnieniem jednorazowości, akcją potwierdzenia i powrotem do TOTP. Niepoprawny lub użyty kod dostaje neutralny komunikat przy polu; próba w toku blokuje ponowne wysłanie; limit pokazuje rzeczywisty czas ponowienia bez obcinania go do minuty.
- **Wydana lista:** fikcyjne kody służą wyłącznie do przedstawienia układu. Tekst wyjaśnia, że każdy działa raz, nowa lista unieważnia starą, a po opuszczeniu tego widoku kodów nie można ponownie odczytać. Jednoznaczne potwierdzenie zapisania zamyka ten krok.
- **Niepewny wynik:** tekst „Nie wiadomo, czy operacja została zakończona” jest wspólny dla challenge, enrollmentu i rotacji. Jedyna akcja sprawdza stan; błąd odczytu pozostawia użytkownika na tym samym ekranie z możliwością ponownego sprawdzenia po odzyskaniu połączenia.
- **Ponowne wydanie:** najpierw świeży czynnik, potem hasło. Odmowa lub wygaśnięcie potwierdzenia wraca do świeżej weryfikacji; nie ponawia starego dowodu. Utrata odpowiedzi na rotację wraca do stanu niepewnego, bez pozornego sukcesu.

Makiety są statycznym kontraktem układu i nawigacji. Testy API, rzeczywiste zużycie kodu, sesja, limit, utrata odpowiedzi oraz brak sekretów w logach należą do implementacji i odbioru #15. VoiceOver pozostaje odroczony do #97; pozostałe kontrole dostępności obowiązują teraz.
