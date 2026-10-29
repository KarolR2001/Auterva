# Planowanie zmian Autervy

Zadania implementacyjne prowadź w GitHub Issues według [workflow](docs/development/WORKFLOW.md). Nie dopisuj tutaj dzienników narzędzi ani historii tworzenia makiet.

## Plan pojedynczego zadania

- Cel i kryteria akceptacji oraz ID wymagań z PRD 3.1 i WYMAGANIA_AUTERVA.
- Zakres plików i jedna rola wykonawcza: frontend albo backend; orkiestrator wykonuje CR, QA odbiera to samo issue.
- Zależności, kontrakt API/danych, rzeczywiste file/page/board ID Penpota przy zmianie UI.
- Kroki realizacji i sprawdzenia z `docs/quality-gates.md`.
- Otwarte decyzje, warunki CR/QA i integracji przed Done. Raporty zawierają dowody i jeden punkt synchronizacji aktualnego SHA; sesję podają tylko, gdy wyjaśnia niezależność. Brak makiety lub komendy oznacz jawnie.

Krótki plan zapisz w issue. Dłuższy plan przechowuj w `docs/plans/<numer-issue>-<temat>.md` i podlinkuj z issue. Po wykonaniu podaj wyniki, PR i pozostałe ryzyka; usuń nieaktualne założenia.

## Backlog MVP 3.1

Kolejność i zakres opisuje [backlog](docs/development/BACKLOG.md). Frontend i Backend najpierw poprawiają własne Re-open, potem biorą pierwsze nieblokowane To do swojej roli według Order. Po przekazaniu PR do Review kontynuują kolejkę bez czekania na CR/QA; każdy wykonawca ma najwyżej jedno issue w implementacji/poprawce, a w roli może pracować wielu wykonawców (D-31). Główny orkiestrator koordynuje zależności, odbiera Review/needs:cr i przekazuje Ready to test do QA. Po odbiorze integruje i zamyka issue; po każdym Stage i przed wydaniem przegląda cały kod. Każde issue ma osobny branch/worktree; role/statusy zastępują osobiste przypisanie GitHub. Issue zawiera kryteria, zależności i scenariusze testera z oczekiwanym wynikiem. Otwarte D-xx rozstrzygaj przed zależnymi zadaniami.

Testy i CI aplikacji powstają wraz ze scaffoldem. Repozytorium nie zawiera pomocniczego walidatora dokumentacji ani jego testów. Bieżący odczyt Penpota wymaga połączenia instancji MCP; lokalna mapa ma datę 22.10.2026.
