# Praca nad Autervą przez GitHub Issues

Zakres: MVP 3.1 z superadminem i wieloma firmami. [Projekt](https://github.com/users/KarolR2001/projects/1), [backlog i kolejność](BACKLOG.md), [wymagania](../WYMAGANIA_AUTERVA.md), [architektura](../ARCHITEKTURA_AUTERVA.md), [quality gates](../quality-gates.md).

## Główny orkiestrator i trzy role wykonawcze

| Rola | Odpowiedzialność |
|---|---|
| Orkiestrator | Koordynacja zależności i kontraktów, CR każdego PR, spójność całego kodu, integracja i zamknięcie zadania po QA |
| Backend | Dane, API/DTO, auth/MFA, izolacja, czas, media, jobs/WS, infrastruktura i wydanie |
| Frontend | Cztery obszary UI, integracja API, Penpot, formularze, mobile, dostępność i PWA |
| QA | Niezależne testy tego samego issue po CR, porównanie z Penpotem, dowody i regresja poprawki |
| Właściciel produktu — użytkownik | Decyzje wymagające akceptacji, zmiany zakresu i zgoda na wdrożenie produkcyjne |

- Główny orkiestrator i agenty **Frontend, Backend, QA** pracują w osobnych sesjach Codex na jednym komputerze i koncie GitHub użytkownika. Nie wymagamy osobnych kont ani assignees; przypisania pozostają puste.
- Pole Role i etykieta role:frontend/role:backend wskazują właściciela implementacji. Orkiestrator i QA odbierają to samo issue według statusu, bez zmiany Role i bez osobnych zadań odbioru.
- Przy podjęciu issue agent zapisuje w komentarzu rolę, branch i krótki plan, następnie ustawia In progress. Ścieżkę worktree i identyfikator sesji zachowuje w lokalnym checkpoincie. Jeden aktywny wykonawca issue; ponownie odczytaj status przed rozpoczęciem.
- Po Re-open poprawia ten sam agent wykonawczy. Jeśli sesja zakończyła się, nowa sesja tej samej roli jawnie przejmuje istniejący branch i kontekst; nie rozpoczyna drugiej implementacji.
- Każdy agent implementujący pracuje w osobnym worktree i branchu, np. codex/backend/issue-8 lub codex/frontend/issue-11. Nie przełączaj branchy ani nie zmieniaj cudzych plików we współdzielonym katalogu. Wspólne manifesty, migracje i kontrakty mają jednego edytora; uzgodnione zmiany integruj przez PR.
- Orkiestrator i QA używają własnych worktree i sprawdzają dokładny commit/build przekazany w issue. Lokalne serwery mają różne porty i testowe bazy/schematy; bez resetowania usług innego agenta. QA czyta Penpota; nie zmienia wzorca, aby ukryć błąd.
- Orkiestrator rozstrzyga podwójne przejęcie zadania, ustala edytora wspólnych plików oraz kontrakt API/danych przed równoległą implementacją. Zmiana kontraktu obejmuje konsumentów i dokumentację.

## Skąd brać zadania

1. Otwórz widok Frontend albo Backend. Najpierw obsłuż własne Re-open.
2. Następnie weź **pierwsze od góry nieblokowane To do** swojej roli. Order i numer w tytule określają kolejność; ręczny porządek tablicy jest taki sam.
3. Sprawdź blocked by, decyzje i kontrakty. Orkiestrator po zweryfikowaniu spełnienia zależności usuwa blocked; GitHub nie usuwa jej automatycznie.
4. Zapisz przejęcie przez agenta i ustaw In progress. Jedno aktywne zadanie implementacyjne na rolę; podczas blokady można podjąć następne gotowe, odnotowując przerwę i jej powód.
5. Orkiestrator otwiera [CR — Orchestrator](https://github.com/users/KarolR2001/projects/1/views/11), bierze pierwsze Review według Order i zapisuje rozpoczęcie CR z odnośnikiem do checkpointu aktualnego commita. Sprawdza też [otwarte PR z needs:cr](https://github.com/KarolR2001/Auterva/pulls?q=is%3Apr+is%3Aopen+label%3Aneeds%3Acr), aby wykryć brak statusu lub powiązania z issue.
6. Agent QA otwiera **QA**, bierze pierwsze Ready to test z aktualnym CR: PASS, zapisuje rozpoczęcie i przesuwa do Test. Nie przejmuje Review. Przy pustej kolejce może przygotować scenariusze przyszłego zakresu, bez deklarowania odbioru.
7. Orkiestrator sprawdza również Test z raportem QA: PASS, integruje zaakceptowane zmiany i odblokowuje następne zadania.

**To do zawiera cały obowiązkowy plan**, także przyszłe zadania oczekujące na zależności. Sam status nie oznacza gotowości rozpoczęcia. Widok Ready pokazuje To do/Re-open bez blocked. FE może uzgodnić kontrakt lub pracować na fixture wcześniej, lecz nie zamyka integracji na mockach.

Candidates zawiera odziedziczone SHOULD i propozycje rozwoju. Triage ustala zakres, priorytet, kolejność i makiety przed przeniesieniem do To do. Numer Candidates nie zobowiązuje do realizacji przed produkcją.

## Czytelny zapis i synchronizacja

- Commit opisuje zmianę, a opis issue/PR, CR, QA i komentarz zaczyna się od wyniku lub problemu. Podaj istotne kontrole, uwagi i ograniczenia; nie powielaj metadanych w każdym akapicie ani wierszu tabeli.
- W GitHubie używaj ścieżek względem repozytorium lub linków. Nie publikuj bezwzględnych ścieżek lokalnych, nazw komputerów, zbędnych dat ani identyfikatorów sesji. Merytoryczne daty, np. granice okresu lub wynik testu czasu, zostają, gdy wyjaśniają zmianę.
- W jednym checkpoincie przekazania lub raporcie CR/QA zapisz zwięzłe dane synchronizacji: dokładny head SHA, sprawdzony base SHA i build/środowisko, jeśli mają znaczenie. Rola lub identyfikator sesji trafia tam tylko, gdy wyjaśnia niezależność odbioru na wspólnym koncie. Dalsze komentarze linkują ten zapis; po nowym commicie powstaje nowy punkt synchronizacji. Lokalizacja worktree pozostaje w lokalnym checkpoincie.

## Przepływ

| Status | Kto przenosi i kiedy |
|---|---|
| Candidates | Właściciel produktu/triage: opcjonalny zakres lub nowa propozycja |
| To do | Orkiestrator: zaplanowany zakres wykonawcy; rozpoczęcie po spełnieniu zależności |
| Re-open | Orkiestrator po CR lub QA po testach: uwagi, dowód i oczekiwany wynik; wykonawca zostaje |
| In progress | Frontend/Backend rozpoczyna implementację lub poprawkę |
| Review | Wykonawca: PR gotowy do CR, issue, checkpoint aktualnego commita i wyniki kontroli; needs:cr na issue i PR |
| Ready to test | Wyłącznie orkiestrator: CR: PASS dla aktualnego commita, dostępny build, fixture i instrukcja; usuwa needs:cr |
| Test | QA wykonuje scenariusze i regresję, zapisuje wynik dla konkretnego builda/commita |
| Done | Orkiestrator: aktualne CR i QA: PASS, spełnione kryteria, merge oraz kontrole integracji; zamyka issue |

Poprawka wraca Re-open → In progress → Review → Ready to test → Test. Odrzucający CR/QA usuwa needs:cr, jeśli jest obecne; wykonawca dodaje je ponownie, gdy poprawka jest gotowa do CR. Blokada środowiska to wynik blocked z przyczyną, nie automatycznie błąd implementacji. Statusy i etykiety aktualizują agenci; sama tablica nie uruchamia sesji ani review.

QA: PASS pozostaje w Test do integracji przez orkiestratora. Przed merge orkiestrator sprawdza aktualne SHA, wymagane checks, zgodność z main i raporty CR/QA. Po integracji potwierdza wynik wymaganych kontroli na main; dopiero wtedy ustawia Done i zamyka issue. Nie scala PR z niewykonanym lub nieudanym obowiązkowym sprawdzeniem. PR używa **Refs #numer**; zamknięcie issue jest jawną czynnością po odbiorze i integracji.

Zmiana head SHA po CR unieważnia poprzednie CR i QA. Wykonawca po zakończeniu zmian przywraca Review i needs:cr na issue/PR; orkiestrator przegląda zmianę, QA ponawia testy dotkniętych zachowań i regresję. Zmiana main od sprawdzonego base SHA wymaga ponownej oceny integracji i adekwatnych kontroli przed merge. Nie przenoś automatycznie starego PASS na nowy kod.

Dla decyzji lub zadania bez zmian kodu CR obejmuje dokument/kontrakt, a QA sprawdzalne kryteria tego rezultatu. Merge jest wtedy wymagany tylko, jeśli powstał PR; nie wymyślaj builda ani testów runtime. Wdrożenie produkcyjne nadal wymaga jawnej zgody użytkownika.

## CR głównego orkiestratora

- Przeczytaj issue, wymagania, aktualny PRD 3.1, architekturę, właściwe AGENTS.md i decyzje. Dla UI sprawdź kontrakt Penpota i mapowanie wymaganie → ekran → kod → test.
- Przejrzyj diff **oraz istniejący kod, z którym zmiana współpracuje**: wywołujących, konsumentów API, wspólne komponenty, modele, migracje, cache, jobs/WS i testy. Sam diff nie wystarcza do oceny spójności.
- Sprawdź poprawność zachowania i przypadków błędnych, kontrakty FE/BE, izolację firm, uprawnienia, daty/współbieżność, prywatność, styl kodu, nazewnictwo, podział modułów, duplikację, zależności i adekwatność testów. Zakres dobierz do zmiany; nie oznaczaj nieprzeczytanych obszarów jako sprawdzone.
- Uwagi zawierają plik/wiersz, wpływ, oczekiwaną poprawkę i ważność: blokująca albo sugestia. Nierozwiązana uwaga blokująca → CR: CHANGES_REQUESTED i Re-open. Sugestia poza zakresem trafia do triage, bez cichego rozszerzania zadania.
- Orkiestrator kieruje poprawki do wykonawcy. Nie implementuje poprawki, którą następnie sam odbiera. Jeśli jest autorem części zmiany, tę część przegląda inna sesja z odpowiednią kompetencją, wskazana w raporcie; nie deklaruj niezależności własnej oceny.
- CR: PASS wymaga braku otwartych uwag blokujących i dowodów adekwatnych quality gates. Nie zastępuje niezależnego odbioru QA.

Raport CR w PR, z linkiem w issue; dane synchronizacji podaj raz:

```text
CR: PASS | CHANGES_REQUESTED | BLOCKED
Problem / wynik: …
Przejrzany zakres i powiązany kod: …
Uwagi blokujące / sugestie: plik:wiersz — wpływ — oczekiwanie
Kontrole i dowody: komenda/scenariusz — wynik — link
Ograniczenia / niesprawdzone obszary: …
Przekazanie: Ready to test | Re-open | Review + blocked
Synchronizacja: issue #…; PR #…; head SHA …; sprawdzony base SHA …; rola/recenzent …; build … (jeśli dotyczy)
```

Wspólne konto nie pozwala zatwierdzić własnego PR przyciskiem Approve ([GitHub](https://docs.github.com/en/pull-requests/how-tos/review-pull-requests/approving-a-pull-request-with-required-reviews)). Orkiestrator zapisuje raport jako komentarz lub review typu COMMENT z jednym punktem synchronizacji; QA osobno zapisuje odbiór. Nie przedstawiaj ich jako formalnej akceptacji innego konta. W [#10](https://github.com/KarolR2001/Auterva/issues/10) skonfiguruj rzeczywiste wymagane checks; nie wymagaj fikcyjnego drugiego użytkownika i nie obchodź zabezpieczeń. needs:cr jest sygnałem do pracy, nie dowodem zaliczonego CR ani techniczną blokadą merge.

## Przegląd całego kodu i spójności

Orkiestrator przegląda cały aktualny kod aplikacji i konfigurację **po zakończeniu każdego Stage oraz przed release candidate (#62) i wydaniem produkcyjnym (#64)**. Przegląd PR obejmuje powiązany kod na bieżąco; przegląd etapu sprawdza integrację wszystkich dotychczasowych modułów, także niezmienianych w ostatnim PR.

- Sprawdź strukturę modułów i kierunki zależności, modele/DTO, auth i izolację we wszystkich wejściach, migracje, obsługę błędów, aktualność cache, spójność UI/tokenów, konfigurację środowisk i pokrycie wymagań testami.
- Raport `SYSTEM REVIEW` zapisz w issue zamykającym etap, a przegląd wydania w #62/#64. Podaj commit main, sprawdzone katalogi, kontrole, luki i linki do poprawek. Brak kodu oznacza brak implementacji.
- Błąd bieżącego zadania wraca do Re-open; niezależna usterka otrzymuje bug z rolą i zależnością. Blokery wstrzymują zależne zadania lub wydanie. Po poprawkach ponownie sprawdź wskazane obszary.
- Nie zmieniaj PRD, zatwierdzonej architektury ani makiet, aby dopasować je do błędu kodu. Rozbieżność opisz; zmianę kontraktu rozstrzygnij przed zależną implementacją.

## Pola i widoki

- **Order:** kolejność zależności od przygotowania do produkcji. Nowe zadanie umieść przed zależnymi; zsynchronizuj Order, prefiks i ręczny porządek.
- **Role:** Frontend/Backend to właściciel implementacji. Orkiestrator korzysta z Review, QA z Ready to test/Test; nie zmieniaj Role na QA ani Orchestrator.
- **Priority:** P0 krytyczne, P1 wysokie, P2 normalne, P3 niskie. Pole i priority:p* muszą być zgodne; priorytet nie zastępuje zależności.
- **Stage:** 0 fundament, 1 dostęp/hosty, 2 uruchomienie firmy, 3 flota/dostępność, 4 obsługa usługi, 5 odbiór i wydanie produkcyjne. Nie blokuje niezależnej pracy.
- **Size:** względna złożoność XS/S/M/L/XL, bez deklaracji czasu.
- **Labels:** type:task/feature/bug/spike/docs/decision, area:*, role:*, priority:*, blocked, needs:decision, needs:penpot oraz **needs:cr — PR/issue czeka na CR orkiestratora**. Definicje w [.github/labels.json](../../.github/labels.json).
- **Workflow:** pełna tablica. **Frontend/Backend:** kolejki wykonawcze. **Ready:** nieblokowane To do/Re-open. **CR — Orchestrator:** Review, także gdy wykonawca zapomniał etykiety. **QA:** Ready to test/Test. **Triage:** Candidates. **Bugs:** aktywne usterki. **Active:** In progress/Review/Ready to test/Test. **Development/All items:** przekrój pracy.

Projekt zawiera issue; powiązany PR otrzymuje needs:cr i link Refs #numer. Nie dodawaj drugiego elementu projektu dla tego samego zakresu. Orkiestrator uzgadnia status issue z PR i raportami przy każdym przekazaniu.

## Start agentów

W osobnych sesjach nadaj role: „Jesteś głównym orkiestratorem Autervy”, „Jesteś agentem Frontend”, „Jesteś agentem Backend” albo „Jesteś agentem QA”. Każdy zaczyna od AGENTS.md, tego workflow, swojego widoku i opisu issue. Rola jest zakresem sesji, nie nowym kontem ani uprawnieniem. GitHub przechowuje stan pracy; orkiestrator koordynuje uruchomione sesje i przekazuje konkretne issue. Etykieta nie uruchamia automatycznie agenta.

Backend może rozpocząć decyzje #1–4; scaffold #5 czeka na #3 i #4. Frontend może pracować nad #6 (treści) i #7 (mapowanie Penpota), po jednym zadaniu naraz. Orkiestrator zaczyna od zależności i kontraktów, następnie odbiera Review. QA zaczyna odbiór po Ready to test. Decyzji wymagających akceptacji użytkownika agent nie zatwierdza sam. Gotowy backlog nie oznacza rozstrzygniętych D-xx, działającej aplikacji, CI ani infrastruktury.

## Issue i odbiór

- Jeden rezultat, źródła C-*/FR-*/TEST-MVP/UC, zakres, rola, prawdziwe relacje blocked by, testowalne kryteria i otwarte decyzje.
- Frontend: link do aktualnej strony Penpota, dokładna nazwa/ID boardu i stan. Design system jest źródłem wyglądu; nie kopiujemy specyfikacji komponentów.
- Dla testera: commit/build, URL, hosty/role, fixture A/B i zależności; każdy scenariusz ma **akcję → oczekiwany rezultat**.
- Wykonawca przekazuje PR, checkpoint aktualnego SHA, wyniki quality gates i ograniczenia. QA zapisuje `QA: PASS/FAIL/BLOCKED`, scenariusze z pass/fail/blocked/not-run, dowody, usterki i ograniczenia oraz jedną sekcję synchronizacji z testowanym SHA/buildem i środowiskiem. Identyfikator sesji lub data pojawia się tylko, gdy jest potrzebna do ustalenia niezależności albo znaczenia wyniku. Obowiązkowy blocked/not-run wyklucza QA: PASS.
- UI porównujemy z aktualnym Penpotem na identycznych danych/stanie/viewport; referencje 390/1440 i dodatkowe szerokości według ryzyka. Klawiatura, czytnik, API i WS wymagają testów zachowania.
- Brak live Penpota, dostępnego builda lub obowiązkowego testu pozostaje jawnym brakiem. Makieta nie dowodzi działania aplikacji.
- Aktualizujemy wymaganie → ekran → kod → test w design/traceability.json. Artefakty w PR/CI, bez wielkiego dziennika w repo.
- Decyzja kończy się zatwierdzonym kontraktem, a zadanie produkcji rzeczywistym wdrożeniem po jawnej zgodzie właściciela. Ukończony plan nie oznacza gotowej aplikacji.
- Przed zakończeniem sesji zapisz stan, branch/SHA, następny krok, blokery i przekazanie. Lokalny checkpoint może zawierać ścieżkę worktree; publiczny komentarz linkuje aktualny punkt synchronizacji. Nie zmieniaj In progress na gotowe tylko dlatego, że sesja się kończy.

## Bugi i nowe zgłoszenia

Nieudany CR lub odbiór bieżącego zadania opisz w tym issue i skieruj do Re-open. Osobny bug dotyczy niezależnej usterki lub regresji zamkniętego zakresu; linkuje pierwotne issue oraz podaje rolę, wpływ, reprodukcję i oczekiwanie.

Szablony implementation.yml i bug.yml dodają projekt, ale nie przypisują osoby. Nowe zgłoszenie bez Status ustaw w triage na Candidates; uzupełnij pola i etykiety. Publiczne API Projects nie udostępnia konfiguracji automatycznego statusu po dodaniu. Obecny workflow wymaga jawnych zmian statusu.

Kontrole aplikacji, ochrona gałęzi i środowisk powstają w zadaniach backlogu. Tablica nie oznacza działającego CI lub runtime.
