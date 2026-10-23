# Praca nad Autervą przez GitHub Issues

Zakres: MVP 3.1 z superadminem i wieloma firmami. Źródła: [wymagania](../WYMAGANIA_AUTERVA.md), [architektura](../ARCHITEKTURA_AUTERVA.md), [quality gates](../quality-gates.md), `design/traceability.json` i bieżący Penpot. Pracę śledzi prywatny [GitHub Project Auterva — MVP 3.1](https://github.com/users/KarolR2001/projects/1).

## Role i własność

| Rola | Odpowiedzialność | Wynik |
|---|---|---|
| Backend | API/DTO, dane/migracje, auth/izolacja, czas/współbieżność, media, zadania, WebSocket | Serwer, testy integracji, kontrakt FE/QA |
| Frontend | Cztery obszary UI, komponenty/tokeny, formularze/stany, mobile, API, PWA | Interfejs zgodny z Penpotem, testy zachowania, instrukcja odtworzenia |
| QA | Kryteria przed implementacją, regresja/E2E, izolacja/dane, porównanie z Penpotem | Raport dla konkretnego commita i rzeczywiste usterki |

- Każde issue ma jedną rolę wiodącą, jednego właściciela wykonania i zakres plików. Inne role współpracują bez równoległego zapisu do tych samych plików.
- `role:frontend`, `role:backend`, `role:qa` opisują pracę, nie użytkownika GitHub. Agent sesji nie jest automatycznie assignee. Przypisuj wyłącznie istniejące, jawnie wskazane konto; formularze nikogo nie przypisują.
- Przed pracą właściciel zapisuje zakres, zależności i kryteria. Niezależne zmiany mogą używać odrębnych gałęzi/worktrees; wspólny kontrakt ma jednego edytora i przegląd FE/BE.
- QA i implementacja używają Penpota tylko do odczytu. Zmiana designu to osobno autoryzowany zakres i jeden agent zapisujący; nie dopasowuj wzorca do błędnego kodu.

## Issue i zależności

- Formularz implementacji służy też ograniczonemu zadaniu QA; bug opisuje odtwarzalny objaw. Tytuł nazywa rezultat, np. „Backend: zapis blokady odporny na równoległe żądania”.
- Opis zawiera ID C-*/FR-*/REQ-MVP-*, źródło, rolę/host, zakres i granice, zależności/D-xx, kryteria akceptacji i plan dowodów. UI podaje realne file/page/board/component ID, stan i viewport.
- Przekrój funkcji może mieć nadrzędne issue i FE/BE/QA. Nie dziel każdego pola na zadanie. BE publikuje kontrakt przed zależną integracją FE; QA równolegle przygotowuje scenariusze/fixture.
- Używaj relacji **blocked by / blocking** i podzadań. Tekst „Zależy od #…” nie tworzy relacji GitHub. Bez istniejącego numeru wskaż nazwę zależności, nie wymyślaj ID. [GitHub: zależności](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies).
- FE może pracować na jawnych fixture, ale to nie zamyka integracji. QA odbiera konkretny commit/build po spełnieniu zależności, nie obietnicę przyszłego backendu.
- Propozycje „co warto dodać” pozostają poza obowiązkowym backlogiem MVP do zmiany zakresu przez właściciela.

## Statusy i Project

Pola projektu: `Status`, `Priority`, `Role`, `Stage`, `Size`, assignee, etykiety i powiązane PR. Role: Frontend/Backend/QA; bez domyślnej osoby. Priority: P0/P1/P2/P3 ustalane w triage; to nie MUST/SHOULD źródłowego PRD. Stage odpowiada sześciu etapom opisanym niżej, a Size używa XS/S/M/L/XL.

| Status | Warunek |
|---|---|
| Candidates | Nowy pomysł lub zgłoszenie oczekuje na triage, priorytet i decyzję o zakresie |
| To do | Kryteria Ready spełnione; zadanie może zostać podjęte |
| Re-open | Odbiór lub regresja wykazały, że zadanie wymaga ponownej pracy |
| In progress | Jeden właściciel pracuje; aktualny branch/PR wskazany, gdy istnieje |
| Review | Zmiana gotowa do przeglądu, podano rzeczywiste wyniki kontroli |
| Ready to test | Dostępny commit/build, fixture i instrukcja przekazania do QA |
| Test | QA wykonuje odbiór zachowania, integracji i UI |
| Done | Kryteria Done spełnione, dowody zapisane |

Status jest polem single-select Project. Issue pozostaje otwarte do odbioru; PR ma własny stan draft/open/merged/closed. Merge nie potwierdza odbioru całej funkcji. Etykiety nie duplikują statusów. Blokadę oznacz etykietą `blocked`, pozostawiając status etapu, na którym wystąpiła, i wpisując warunek odblokowania. [GitHub: single-select](https://docs.github.com/en/issues/planning-and-tracking-with-projects/understanding-fields/about-single-select-fields).

Widoki projektu: `Workflow` (tablica statusów), `Triage` (Candidates i Re-open), `Development` (To do, In progress i Review), `QA` (Ready to test i Test), `Bugs`, `My work` oraz pełna tabela `All items`.

## Ready

- Wynik, zakres, rola/host, właściciel wykonania i ID wymagań są określone.
- Zależności zamknięte albo kontrakt pozwala na wydzieloną niezależną pracę.
- D-xx wpływające na ten zakres rozstrzygnięte; nie blokuj nimi pozostałych obszarów.
- UI ma odczytaną referencję i stany Penpota; braki mają osobne zadanie, nie fikcyjny ID.
- Kryteria są testowalne, plan weryfikacji/fixture/środowisko dostępne lub ich przygotowanie stanowi jawny zakres zadania.

## Done i QA

- Kryteria zakresu spełnione, zmiana przejrzana, właściwe kontrole uruchomione dla wskazanego commita.
- FE/BE przekazują kroki uruchomienia, role/hosty fixture, zakres i ograniczenia, bez sekretów w issue.
- QA zapisuje wymaganie, scenariusz, commit/build, datę, komendę, wynik `pass/fail/blocked/not-run`, artefakt i otwarte usterki.
- Porównanie Penpot: rzeczywiste file/page/board ID, identyczne dane/stan/viewport, eksport wzorca, screenshot aplikacji i różnice. Referencje 390/1440; dodatkowe 320/430/768/1024/1920 według ryzyka.
- Brak live MCP oznacza niewykonane bieżące porównanie, a historyczny eksport wymaga podania daty i ograniczenia. Nie zmieniaj Penpota podczas QA.
- Klawiatura/fokus/dostępność, zapis/auth/WebSocket wymagają testu zachowania; zgodny obraz ich nie potwierdza.
- Mapowanie wymaganie → ekran/kod/test i dokumentacja kontraktu są aktualne. Brak obowiązkowej weryfikacji pozostawia zadanie otwarte.
- Zamknij tylko odebrany ograniczony zakres; nadrzędna funkcja i zależne QA pozostają otwarte do pełnej integracji. `Closes #…` w PR tylko gdy odbiór tego issue zakończy się przed merge.

## Etapy do rozwinięcia w dokładny backlog

1. **Fundament:** ADR-0002, manifest/lockfile, scaffold, fixture, CI aplikacji, macierz uprawnień i brakujące referencje designu.
2. **Hosty i dostęp:** cztery obszary, A/B, sesje/MFA, jedno konto firmy, pierwszy superadmin, testy odmów.
3. **Uruchomienie firmy:** prerejestracja, zaproszenia, rejestracja, domeny, okres/trial, pusta oferta i dwa KPI.
4. **Flota/dostępność:** media, publikacja, blokady/współbieżność, katalog publiczny i zagnieżdżona obsługa superadmina.
5. **Obsługa usługi:** WebSocket/typing/read, zadania/przypomnienia, ustawienia, archiwizacja/przywrócenie i audyt.
6. **Odbiór/pilotaż:** PWA, regresja TEST-MVP/UC, porównania Penpot, dostępność, obciążenie, backup/restore i środowiska.

QA uczestniczy w każdym etapie. Numer etapu nie tworzy sztywnej zależności niezależnych zadań. To podział planu, nie gotowy backlog ani utworzone issue.

## Szablony i kontrole

- `.github/ISSUE_TEMPLATE/implementation.yml` dodaje `type:task`, a `bug.yml` dodaje `type:bug`; oba formularze dodają issue do projektu i nie przypisują osoby. W triage ustaw Status, Priority, Role, Stage, Size i właściwy `area:*`. [GitHub: issue forms](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms).
- `.github/labels.json` odwzorowuje własne etykiety skonfigurowane w repozytorium. Typy: task/feature/bug/spike/docs/decision; role: frontend/backend/QA; priorytety: P0–P3; obszary odpowiadają architekturze. `needs:decision`, `needs:penpot` i `blocked` opisują wyjątki wymagające działania.
- GitHub nie udostępnia przez publiczne API konfiguracji wbudowanego workflow „Item added to project”. Nowo dodane issue bez Status przypisz w triage do `Candidates`; nie traktuj pustego statusu jako `To do`.
- CI i testy aplikacji powstają w zadaniu scaffoldingu. Uprawnienia workflow ogranicz do niezbędnych operacji, domyślnie `contents: read`. [GitHub: permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions).
- Required checks i ochrona gałęzi wymagają osobnej konfiguracji repozytorium po uruchomieniu właściwych testów.
