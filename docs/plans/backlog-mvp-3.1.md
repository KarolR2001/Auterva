# Backlog realizacji Autervy MVP 3.1

## Cel

Przygotować i opublikować w GitHub Issues pełny, uporządkowany backlog od scaffoldingu do produkcji. Właściciel implementacji: Frontend albo Backend; tester odbiera te same issue według opisanych scenariuszy i wyników, bez osobnych zadań QA.

## Plan

- Przeczytać PRD 3.1, niesprzeczny kontrakt bazowy, wymagania, architekturę, instrukcje i kontrakty designu; sprawdzić istniejące issue.
- Odczytać aktualne strony i boardy Penpota; zadania frontendowe linkują właściwe referencje bez przepisywania wyglądu.
- Rozdzielić podstawowy zakres do `To do`, opcjonalne usprawnienia do `Candidates`; zapisać zależności i zadania rozstrzygające D-01–D-15.
- Każde issue: rezultat, zakres, źródła, zależności, kryteria, założenia QA, scenariusze → wyniki oraz zasady przekazania/poprawki.
- Opublikować zadania, uzupełnić pola projektu i role, dodać relacje zależności oraz widoki programistów.
- Sprawdzić pełne pokrycie wymagań i scenariuszy TEST-MVP/UC, brak osobnych zadań testera, poprawność powiązań i faktyczną obecność issue na tablicy.

## Warunki

Produkt obejmuje superadmina i wiele firm. Otwarte decyzje są zakresem zadań przygotowawczych, bez domyślnego zatwierdzania wariantów. Wdrożenie jest elementem planu; bieżące zadanie nie wdraża aplikacji. Główny orkiestrator koordynuje osobne sesje Frontend, Backend i QA na jednym komputerze i koncie GitHub. Role/statusy rozdzielają kolejki; wykonawca odpowiada za poprawki po `Re-open`.

## Wynik i weryfikacja

- Opublikowano [backlog](../development/BACKLOG.md): 64 obowiązkowe issue w To do i 15 Candidates, 35 Frontend oraz 44 Backend. Tester odbiera te same zadania.
- Odczyt GitHub API potwierdził 79 opisów/etykiet, 188 relacji zależności, prywatność repo/projektu, pola, osiem statusów, dziesięć widoków i kolejność 001–079. Brak cykli; każdy obowiązkowy zakres prowadzi do produkcyjnego #64.
- Sprawdzono przypisanie 330 identyfikatorów wymagań/decyzji, 55 TEST-MVP i 10 UC. Referencje frontendowe pochodzą z bieżącego odczytu Penpota; brakujące historyczne mapowanie ma zadanie #7.
- Szablony przeszły parsowanie YAML, lokalne linki Markdown istnieją, git diff --check nie wykazał błędów. Nie uruchamiano nieistniejącej aplikacji ani jej testów; nie wykonywano wdrożenia.

## Dostosowanie do trzech agentów

- Ujednolicono instrukcje, szablony i 79 opisów issue: role Frontend/Backend oraz odbiór QA, bez osobnych kont i assignees.
- Opisano osobne worktree, przejęcie sesji i przegląd na wspólnym koncie; widok osobisty zastąpiono Active, a QA uzupełniono o Review.
- Ponowny odczyt potwierdził opisy, filtry oraz zachowanie kolejności/statusów/ról. YAML i diff poprawne. Pierwsze nieblokowane zadania to #1–4 oraz #6–7; kodowanie zależne od decyzji pozostaje w backlogu.

## Główny orkiestrator i code review

- Dodano orkiestratora nadzorującego trzy role wykonawcze: CR każdego PR, integracja i przegląd całego kodu po etapach oraz przed wydaniem.
- Ujednolicono instrukcje, quality gates, szablony i 79 issue: implementacja → CR → QA → integracja → Done; poprawki wracają do wykonawcy. #62/#64 wymagają raportu SYSTEM REVIEW.
- Utworzono [widok CR](https://github.com/users/KarolR2001/projects/1/views/11) i needs:cr; QA obejmuje Ready to test/Test. Odczyt API potwierdził 11 widoków, 79 opisów, zachowane role/statusy/kolejność oraz 188 zależności.
- YAML, JSON, lokalne linki i git diff --check poprawne. To konfiguracja pracy; nie wykonano przyszłego CR ani testów nieistniejącej aplikacji. Statusy/etykiety nie uruchamiają sesji automatycznie.
