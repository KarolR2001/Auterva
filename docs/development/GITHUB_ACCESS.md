# Dostęp do GitHuba i Penpota

Stan: 23.10.2026. Konto: `KarolR2001`. Prywatne [repozytorium Auterva](https://github.com/KarolR2001/Auterva) i prywatny [Project nr 1](https://github.com/users/KarolR2001/projects/1) są połączone.

## Potwierdzone możliwości

| Obszar | Sposób pracy i dowód |
|---|---|
| Issues | GitHub MCP: utworzone rzeczywiste zadania #1–79; odczyt i zapis działają |
| Project | GitHub CLI/GraphQL: osiem statusów, pola, widoki, elementy i zależności; MCP GitHub nie udostępnia operacji Projects |
| Repozytorium | Konto ma uprawnienia admin/push/triage; Git lokalny śledzi origin/main |
| Agenty | Główny orkiestrator oraz Frontend, Backend i QA to osobne sesje Codex na jednym komputerze i koncie KarolR2001. Review/needs:cr wskazuje CR orkiestratora; Ready to test/Test kolejkę QA. Osobne konta i assignees nie są potrzebne |
| Penpot | Odczyt live MCP: plik Nowy plik 2, 7 stron i 175 komponentów; rzeczywiste boardy użyte w zadaniach frontendowych |

Uprawnienie nie dowodzi wykonania każdej możliwej operacji. Nie wykonano wdrożenia aplikacji ani niezależnego review własnych zmian. Szczegóły [backlogu](BACKLOG.md) i [workflow](WORKFLOW.md) opisują dalszą realizację.

## Penpot podczas implementacji i odbioru

Otwórz plik `Nowy plik 2`, ID `b564c72c-f31f-81ec-8008-af198a313438`, i połącz jego wtyczkę MCP z bieżącym klientem. Odczytaj właściwą stronę/board i porównaj z linkiem w issue oraz [traceability](../../design/traceability.json). Bieżący odczyt nie rozstrzyga automatycznie wszystkich historycznych braków mapowania — obejmuje je [#7](https://github.com/KarolR2001/Auterva/issues/7).

Linki w issue otwierają stronę Penpota; dokładna nazwa i board ID wskazują ekran. Przy braku połączenia zgłoś niewykonane bieżące porównanie, zachowując możliwość testowania aplikacji.

## Utrzymanie dostępu

CLI ma zakresy repo/workflow/project. W razie utraty dostępu Projects użyj `gh auth refresh -h github.com -s project` i zatwierdź w przeglądarce. Nie zapisuj tokenów w repo, issue ani udostępnianych konfiguracjach.

## Ochrona `main` i polityka bootstrapu

Sprawdzono 23.10.2026: odczyt ochrony gałęzi oraz rulesets dla prywatnego repozytorium zwraca z GitHub `403` z informacją o wymaganym GitHub Pro lub repozytorium publicznym. Do czasu zmiany planu lub widoczności repo nie można technicznie wymusić reguł ochrony `main`.

Nie tworzyć pozornych required checks przed zadaniem [#10](https://github.com/KarolR2001/Auterva/issues/10), ponieważ aplikacja i CI jeszcze nie istnieją. Dla zadań bootstrapu #1–#10 obowiązuje rzeczywisty CR orkiestratora, QA adekwatne do rodzaju rezultatu, lokalne kontrole, jawne ograniczenia oraz zakaz uznawania niewykonanego builda lub testu za zaliczony. Po integracji #10 należy ponownie ocenić ochronę gałęzi i włączyć dostępne wymagane checks.

[Dokumentacja Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) · [GitHub CLI](https://cli.github.com/manual/gh_project)
