# Praca nad Autervą przez GitHub Issues

Zakres: MVP 3.1 z superadminem i wieloma firmami. [Projekt](https://github.com/users/KarolR2001/projects/1), [backlog i kolejność](BACKLOG.md), [wymagania](../WYMAGANIA_AUTERVA.md), [architektura](../ARCHITEKTURA_AUTERVA.md), [quality gates](../quality-gates.md).

## Trzy osoby, jeden właściciel zadania

| Rola | Odpowiedzialność |
|---|---|
| Backend | Dane, API/DTO, auth/MFA, izolacja, czas, media, jobs/WS, infrastruktura i wydanie |
| Frontend | Cztery obszary UI, integracja API, Penpot, formularze, mobile, dostępność i PWA |
| Tester | Niezależny odbiór tego samego issue, scenariusze, dowody i regresja poprawki |

- Właścicielem issue jest **Frontend albo Backend**. Nie tworzymy osobnych zadań testera. Założenia, kroki i oczekiwane wyniki testów znajdują się w zadaniu programisty.
- Role i role:frontend/role:backend określają kolejkę, nie konto GitHub. Nie wskazano kont trzech członków zespołu; assignees pozostają puste.
- Podejmując pracę, programista przypisuje siebie. Zachowuje przypisanie podczas Review, Ready to test, Test i Re-open. Tester zapisuje swój login w komentarzu rozpoczęcia odbioru.
- Po Re-open poprawia **ten sam programista**. Zmiana właściciela wymaga jawnego przekazania, nie automatycznego przypisania testera.
- Jeden edytor kontraktu/pliku; niezależne prace mogą korzystać z branchy/worktrees. QA i implementacja czytają Penpota; zmiana designu ma osobny uzgodniony zakres.

## Skąd brać zadania

1. Otwórz widok Frontend albo Backend. Najpierw obsłuż własne Re-open.
2. Następnie weź **pierwsze od góry nieblokowane To do** swojej roli. Order i numer w tytule określają kolejność; ręczny porządek tablicy jest taki sam.
3. Sprawdź blocked by, decyzje i kontrakty. Po spełnieniu zależności usuń etykietę blocked; GitHub nie usuwa jej automatycznie.
4. Ustaw assignee i In progress. Zalecany limit: jedno aktywne zadanie na programistę; podczas blokady można podjąć następne gotowe swojej roli.
5. Tester otwiera QA, bierze pierwsze Ready to test, zapisuje rozpoczęcie odbioru i przesuwa do Test.

**To do zawiera cały obowiązkowy plan**, także przyszłe zadania oczekujące na zależności. Sam status nie oznacza gotowości rozpoczęcia. Widok Ready pokazuje To do/Re-open bez blocked. FE może uzgodnić kontrakt lub pracować na fixture wcześniej, lecz nie zamyka integracji na mockach.

Candidates zawiera odziedziczone SHOULD i propozycje rozwoju. Triage ustala zakres, priorytet, kolejność i makiety przed przeniesieniem do To do. Numer Candidates nie zobowiązuje do realizacji przed produkcją.

## Przepływ

| Status | Kto przenosi i kiedy |
|---|---|
| Candidates | Właściciel produktu/triage: opcjonalny zakres lub nowa propozycja |
| To do | Zaplanowany zakres programisty; rozpoczęcie po spełnieniu zależności |
| Re-open | Tester/reviewer: nieudany odbiór, kroki i oczekiwany wynik; dotychczasowy assignee zostaje |
| In progress | Programista rozpoczyna implementację lub poprawkę |
| Review | Programista przekazuje PR i rzeczywiste wyniki kontroli; przegląda inna osoba |
| Ready to test | Po review istnieją dostępny build, fixture, instrukcja i spełnione zależności |
| Test | Tester wykonuje scenariusze z opisu i regresję |
| Done | Tester potwierdził kryteria i dowody; issue zostaje zamknięte |

Poprawka wraca Re-open → In progress → Review → Ready to test → Test. Blokada środowiska to wynik blocked z przyczyną, nie automatycznie błąd implementacji. Statusy zmieniamy ręcznie; etykiety nie duplikują kolumn.

Merge nie zastępuje testów. PR używa Refs #numer do czasu odbioru; Closes #numer wyłącznie gdy odbiór nastąpił przed merge. Nie zamykaj zadania z pominięciem testera.

## Pola i widoki

- **Order:** kolejność zależności od przygotowania do produkcji. Nowe zadanie umieść przed zależnymi; zsynchronizuj Order, prefiks i ręczny porządek.
- **Role:** Frontend/Backend dla implementacji. Historyczna opcja QA nie jest używana do odrębnych zadań.
- **Priority:** P0 krytyczne, P1 wysokie, P2 normalne, P3 niskie. Pole i priority:p* muszą być zgodne; priorytet nie zastępuje zależności.
- **Stage:** 0 fundament, 1 dostęp/hosty, 2 uruchomienie firmy, 3 flota/dostępność, 4 obsługa usługi, 5 odbiór i wydanie produkcyjne. Nie blokuje niezależnej pracy.
- **Size:** względna złożoność XS/S/M/L/XL, bez deklaracji czasu.
- **Labels:** type:task/feature/bug/spike/docs/decision, area:*, role:*, priority:*, blocked, needs:decision, needs:penpot. Definicje w .github/labels.json.
- **Workflow:** pełna tablica. **Frontend/Backend:** kolejki roli. **Ready:** nieblokowane To do/Re-open. **QA:** Ready to test/Test. **Triage:** Candidates. **Bugs:** aktywne usterki. **My work:** assignee:@me. **Development/All items:** przekrój pracy.

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
