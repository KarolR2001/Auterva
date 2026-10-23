# Praca nad Autervą przez GitHub Issues

Zakres: MVP 3.1 z superadminem i wieloma firmami. [Projekt](https://github.com/users/KarolR2001/projects/1), [backlog i kolejność](BACKLOG.md), [wymagania](../WYMAGANIA_AUTERVA.md), [architektura](../ARCHITEKTURA_AUTERVA.md), [quality gates](../quality-gates.md).

## Trzy agenty Codex, jedno konto GitHub

| Rola | Odpowiedzialność |
|---|---|
| Backend | Dane, API/DTO, auth/MFA, izolacja, czas, media, jobs/WS, infrastruktura i wydanie |
| Frontend | Cztery obszary UI, integracja API, Penpot, formularze, mobile, dostępność i PWA |
| QA | Niezależny przegląd i odbiór tego samego issue, scenariusze, dowody i regresja poprawki |

- Pracują trzy osobne agenty/sesje Codex: **Frontend, Backend i QA**, na jednym komputerze i koncie GitHub użytkownika. Nie wymagamy osobnych kont ani assignees; przypisania pozostają puste.
- Pole Role i etykieta role:frontend/role:backend wskazują właściciela implementacji i nie zmieniają się podczas odbioru QA. Agent QA bierze zadania według statusu, niezależnie od ich Role. Nie tworzymy osobnych issue testera.
- Przy podjęciu issue agent zapisuje w komentarzu rolę, nazwę sesji/wątku, branch i ścieżkę worktree, następnie ustawia In progress. Jeden aktywny wykonawca issue; ponownie odczytaj status przed rozpoczęciem.
- Po Re-open poprawia ten sam agent wykonawczy. Jeśli sesja zakończyła się, nowa sesja tej samej roli jawnie przejmuje istniejący branch i kontekst; nie rozpoczyna drugiej implementacji.
- Każdy agent implementujący pracuje w osobnym worktree i branchu, np. codex/backend/issue-8 lub codex/frontend/issue-11. Nie przełączaj branchy ani nie zmieniaj cudzych plików we współdzielonym katalogu. Wspólne manifesty, migracje i kontrakty mają jednego edytora; uzgodnione zmiany integruj przez PR.
- QA używa osobnego worktree i sprawdza dokładny commit/build przekazany w issue. Lokalne serwery mają różne porty i testowe bazy/schematy; bez resetowania usług innego agenta. QA czyta Penpota; nie zmienia wzorca, aby ukryć błąd.

## Skąd brać zadania

1. Otwórz widok Frontend albo Backend. Najpierw obsłuż własne Re-open.
2. Następnie weź **pierwsze od góry nieblokowane To do** swojej roli. Order i numer w tytule określają kolejność; ręczny porządek tablicy jest taki sam.
3. Sprawdź blocked by, decyzje i kontrakty. Po spełnieniu zależności usuń etykietę blocked; GitHub nie usuwa jej automatycznie.
4. Zapisz przejęcie przez agenta i ustaw In progress. Jedno aktywne zadanie implementacyjne na rolę; podczas blokady można podjąć następne gotowe, odnotowując przerwę i jej powód.
5. Agent QA otwiera QA, bierze pierwsze Ready to test, zapisuje rozpoczęcie i przesuwa do Test. Jeżeli nie ma takich zadań, może przejrzeć pierwsze Review; po poprawnym przeglądzie i udostępnieniu builda ustawia Ready to test. Z pustej kolejki nie tworzy dodatkowych zadań QA.

**To do zawiera cały obowiązkowy plan**, także przyszłe zadania oczekujące na zależności. Sam status nie oznacza gotowości rozpoczęcia. Widok Ready pokazuje To do/Re-open bez blocked. FE może uzgodnić kontrakt lub pracować na fixture wcześniej, lecz nie zamyka integracji na mockach.

Candidates zawiera odziedziczone SHOULD i propozycje rozwoju. Triage ustala zakres, priorytet, kolejność i makiety przed przeniesieniem do To do. Numer Candidates nie zobowiązuje do realizacji przed produkcją.

## Przepływ

| Status | Kto przenosi i kiedy |
|---|---|
| Candidates | Właściciel produktu/triage: opcjonalny zakres lub nowa propozycja |
| To do | Zaplanowany zakres programisty; rozpoczęcie po spełnieniu zależności |
| Re-open | Agent QA/reviewer: nieudany odbiór, kroki i oczekiwany wynik; właściciel implementacji zostaje |
| In progress | Programista rozpoczyna implementację lub poprawkę |
| Review | Agent implementujący przekazuje PR i rzeczywiste wyniki kontroli; przegląda inny agent |
| Ready to test | Po review istnieją dostępny build, fixture, instrukcja i spełnione zależności |
| Test | Tester wykonuje scenariusze z opisu i regresję |
| Done | Tester potwierdził kryteria i dowody; issue zostaje zamknięte |

Poprawka wraca Re-open → In progress → Review → Ready to test → Test. Blokada środowiska to wynik blocked z przyczyną, nie automatycznie błąd implementacji. Statusy zmieniamy ręcznie; etykiety nie duplikują kolumn.

Merge nie zastępuje testów. PR używa Refs #numer do czasu odbioru; Closes #numer wyłącznie gdy odbiór nastąpił przed merge. Nie zamykaj zadania z pominięciem testera.

Wspólne konto nie pozwala zatwierdzić własnego PR przyciskiem Approve ([GitHub](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)). Oddzielny agent QA zapisuje przegląd i wynik w komentarzu z rolą/sesją oraz commitem. Nie przedstawiaj tego jako zatwierdzenia przez inne konto. W zadaniu CI skonfiguruj rzeczywiste wymagane checks; nie wymagaj fikcyjnego drugiego użytkownika i nie obchodź istniejących zabezpieczeń. Zmiana commita po odbiorze wymaga ponownego sprawdzenia.

## Pola i widoki

- **Order:** kolejność zależności od przygotowania do produkcji. Nowe zadanie umieść przed zależnymi; zsynchronizuj Order, prefiks i ręczny porządek.
- **Role:** Frontend/Backend to właściciel implementacji. Agent QA korzysta ze statusów Review/Ready to test/Test; nie przestawiaj Role na QA i nie dodawaj osobnych zadań QA.
- **Priority:** P0 krytyczne, P1 wysokie, P2 normalne, P3 niskie. Pole i priority:p* muszą być zgodne; priorytet nie zastępuje zależności.
- **Stage:** 0 fundament, 1 dostęp/hosty, 2 uruchomienie firmy, 3 flota/dostępność, 4 obsługa usługi, 5 odbiór i wydanie produkcyjne. Nie blokuje niezależnej pracy.
- **Size:** względna złożoność XS/S/M/L/XL, bez deklaracji czasu.
- **Labels:** type:task/feature/bug/spike/docs/decision, area:*, role:*, priority:*, blocked, needs:decision, needs:penpot. Definicje w .github/labels.json.
- **Workflow:** pełna tablica. **Frontend/Backend:** kolejki agentów. **Ready:** nieblokowane To do/Re-open. **QA:** Review/Ready to test/Test. **Triage:** Candidates. **Bugs:** aktywne usterki. **Active:** In progress/Review/Ready to test/Test, bez filtrowania po koncie. **Development/All items:** przekrój pracy.

## Start agentów

W osobnych sesjach nadaj role: „Jesteś agentem Frontend”, „Jesteś agentem Backend” albo „Jesteś agentem QA”. Każdy zaczyna od AGENTS.md, tego workflow, swojego widoku i opisu issue. Rola jest zakresem sesji, nie nowym kontem ani uprawnieniem.

Backend może rozpocząć decyzje #1–4; scaffold #5 czeka na #3 i #4. Frontend może równolegle pracować nad #6 (treści) i #7 (mapowanie Penpota), po jednym zadaniu naraz. QA zaczyna odbiór po pojawieniu się Review/Ready to test. Decyzji produktowych wymagających akceptacji użytkownika agent nie zatwierdza sam. Gotowy backlog nie oznacza rozstrzygniętych D-xx, działającej aplikacji, CI ani infrastruktury.

## Issue i odbiór

- Jeden rezultat, źródła C-*/FR-*/TEST-MVP/UC, zakres, rola, prawdziwe relacje blocked by, testowalne kryteria i otwarte decyzje.
- Frontend: link do aktualnej strony Penpota, dokładna nazwa/ID boardu i stan. Design system jest źródłem wyglądu; nie kopiujemy specyfikacji komponentów.
- Dla testera: commit/build, URL, hosty/role, fixture A/B i zależności; każdy scenariusz ma **akcję → oczekiwany rezultat**.
- Programista przekazuje PR, wyniki adekwatnych quality gates i ograniczenia. Tester zapisuje pass/fail/blocked/not-run, środowisko, datę, dowód i usterki.
- UI porównujemy z aktualnym Penpotem na identycznych danych/stanie/viewport; referencje 390/1440 i dodatkowe szerokości według ryzyka. Klawiatura, czytnik, API i WS wymagają testów zachowania.
- Brak live Penpota, dostępnego builda lub obowiązkowego testu pozostaje jawnym brakiem. Makieta nie dowodzi działania aplikacji.
- Aktualizujemy wymaganie → ekran → kod → test w design/traceability.json. Artefakty w PR/CI, bez wielkiego dziennika w repo.
- Decyzja kończy się zatwierdzonym kontraktem, a zadanie produkcji rzeczywistym wdrożeniem po jawnej zgodzie właściciela. Ukończony plan nie oznacza gotowej aplikacji.

## Bugi i nowe zgłoszenia

Nieudany odbiór bieżącego zadania opisz w tym issue i skieruj do Re-open. Osobny bug dotyczy niezależnej usterki lub regresji zamkniętego zakresu; linkuje pierwotne issue oraz podaje rolę, wpływ, reprodukcję i oczekiwanie.

Szablony implementation.yml i bug.yml dodają projekt, ale nie przypisują osoby. Nowe zgłoszenie bez Status ustaw w triage na Candidates; uzupełnij pola i etykiety. Publiczne API Projects nie udostępnia konfiguracji automatycznego statusu po dodaniu. Obecny workflow wymaga jawnych zmian statusu.

Kontrole aplikacji, ochrona gałęzi i środowisk powstają w zadaniach backlogu. Tablica nie oznacza działającego CI lub runtime.
