# Planowanie zmian Autervy

Zadania implementacyjne prowadź w GitHub Issues według [workflow](docs/development/WORKFLOW.md). Nie dopisuj tutaj dzienników narzędzi ani historii tworzenia makiet.

## Plan pojedynczego zadania

- Cel i kryteria akceptacji oraz ID wymagań z PRD 3.1 i WYMAGANIA_AUTERVA.
- Zakres plików i jedna rola odpowiedzialna: frontend, backend albo QA.
- Zależności, kontrakt API/danych, rzeczywiste file/page/board ID Penpota przy zmianie UI.
- Kroki realizacji i sprawdzenia z `docs/quality-gates.md`.
- Otwarte decyzje i warunki odbioru. Brak makiety lub komendy oznacz jawnie.

Krótki plan zapisz w issue. Dłuższy plan przechowuj w `docs/plans/<numer-issue>-<temat>.md` i podlinkuj z issue. Po wykonaniu podaj wyniki, PR i pozostałe ryzyka; usuń nieaktualne założenia.

## Następny etap: backlog MVP 3.1

Przy podziale pracy użyj etapów z workflow, aktualnych wymagań, architektury i mapy Penpota. Każde issue ma jedną rolę wiodącą: frontend, backend albo QA, konkretne kryteria i zależności. Otwarte D-xx rozstrzygaj przed zależnymi zadaniami.

Testy i CI aplikacji powstają wraz ze scaffoldem. Repozytorium nie zawiera pomocniczego walidatora dokumentacji ani jego testów. Bieżący odczyt Penpota wymaga połączenia instancji MCP; lokalna mapa ma datę 22.10.2026.
