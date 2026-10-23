# Dostęp do GitHuba i Penpota

Sprawdzenie: 2026-10-23. Konto: `KarolR2001`. Repozytorium: [KarolR2001/Auterva](https://github.com/KarolR2001/Auterva), prywatne, z włączonymi issues.

## Wyniki sprawdzenia połączeń

| Obszar | Dowód i wynik |
|---|---|
| GitHub MCP | `get_me` zwróciło konto `KarolR2001`; wyszukiwanie repozytoriów działa |
| GitHub CLI | `GET /user`: HTTP 200; to samo konto |
| Zakresy CLI | `repo`, `workflow`, `project`, `read:org`, `gist`; wartości tokenów nie są zapisane w repozytorium |
| Repozytorium | REST potwierdził `private: true` i prawa `admin`, `maintain`, `push`, `triage`, `pull` |
| Issues | GitHub MCP `list_issues`: odczyt poprawny, lista pusta |
| Projects | Zapytanie GraphQL `viewer.projectsV2` po autoryzacji zakończone poprawnie; lista projektów pusta w chwili sprawdzenia |
| Penpot MCP | Ostatnia próba odczytu: brak połączonej instancji Penpota. Zachowany wcześniejszy inwentarz nie potwierdza bieżącego połączenia |

Pierwsza próba CLI w sandboxie była blokowana przez sieć. Po wykonaniu zapytań poza sandboxem logowanie działało. Brak zakresu `project` został następnie usunięty przez autoryzację użytkownika w przeglądarce.

## Operacje i sposób ich wykonywania

| Operacja | Narzędzie | Stan możliwości |
|---|---|---|
| Odczyt issues | GitHub MCP `list_issues`, `issue_read` | Odczyt Auterva potwierdzony; brak issues w chwili sprawdzenia |
| Tworzenie/edycja issue | GitHub MCP `issue_write` | Prawo admin/push/triage i zakres `repo` potwierdzone; mutacji issue jeszcze nie wykonywano |
| Komentarze | GitHub MCP `add_issue_comment`, `update_issue_comment` | Prawo zapisu potwierdzone; mutacji komentarza jeszcze nie wykonywano |
| Repozytorium | GitHub MCP `create_repository` | Utworzono przez MCP; prywatność i uprawnienia potwierdzone odczytem REST |
| Commity i branche | Lokalny Git / GitHub MCP `push_files`, `create_branch` | Wykonano pierwszy commit `4fba484` i push do `main`; lokalny branch śledzi `origin/main` |
| Pull request | GitHub MCP `create_pull_request`, `update_pull_request` | Prawo zapisu potwierdzone; utworzenie PR wymaga rzeczywistej różnicy branchy, nie wykonywano tej mutacji |
| Review kodu | Lokalny przegląd diff + GitHub MCP `pull_request_review_write` i komentarze do linii | Prawo zapisu i narzędzia dostępne; review API jeszcze nie wykonano. Własnego PR nie przedstawiaj jako niezależnego zatwierdzenia |
| Tworzenie/edycja Projects | GitHub CLI `gh project` / GraphQL | Odczyt potwierdzony; zakres `project` nadany. Wtyczka MCP GitHub w tej sesji nie udostępnia operacji Projects |

Dostępne narzędzie i zakres tokenu nie są dowodem wykonania każdej mutacji. Nie utworzono sztucznych issue, PR ani komentarzy wyłącznie do testowania uprawnień. Pierwsze rzeczywiste operacje trzeba potwierdzić odpowiedzią API i odczytem wyniku. Etykiety ról nie przypisują automatycznie kont agentów GitHub.

## Warunek pracy QA z Penpotem

Otwórz plik `Nowy plik 2`, ID `b564c72c-f31f-81ec-8008-af198a313438`, i połącz jego wtyczkę MCP z bieżącym klientem. Agent najpierw odczytuje plik, strony oraz wymagane boardy; porównuje je z [traceability](../../design/traceability.json) i [architekturą](../ARCHITEKTURA_AUTERVA.md). Przy braku połączenia zgłasza niewykonane porównanie wizualne, zachowując możliwość wykonywania testów aplikacji.

## Utrzymanie dostępu

W razie utraty dostępu Projects użyj `gh auth refresh -h github.com -s project` i zatwierdź uprawnienie w przeglądarce. Nie zapisuj tokenów w issue, plikach projektu ani konfiguracji udostępnianej agentom. Zakresy opisują [dokumentacja Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) oraz [GitHub CLI](https://cli.github.com/manual/gh_project).
