# ADR-0001: Penpot jako źródło designu

Status: **PRZYJĘTE**. Aktualizacja dokumentacji: 22.10.2026.

Auterva korzysta z Penpota. Zakres określa [PRD 3.1](../product/PRD.md), a wygląd [SPEC](../design/SPEC.md) i zgodne z nim aktualne makiety. Historyczne określenia Figma w bazowych materiałach nie oznaczają zmiany narzędzia ani konieczności importu.

- Kanoniczny plik Penpota: `Nowy plik 2`, ID `b564c72c-f31f-81ec-8008-af198a313438`. Odczyt 22.10.2026 obejmował 7 stron i 175 komponentów.
- Rzeczywiste page/board/component ID i nazwy: [architektura — załącznik A](../ARCHITEKTURA_AUTERVA.md#załącznik-a-dokładne-ścieżki-w-penpocie). [Traceability](../../design/traceability.json) wiąże wymagania z designem i przyszłą implementacją.
- Zachować tokeny, ID DS/PUB/ADM/OVR/PLT/TEN/ACC/MKT, stany i semantykę. Nie odtwarzać dawnych propozycji struktury stron z historycznych dokumentów.
- Boardy, teksty, Flex/Grid oraz komponenty i instancje pozostają natywne i edytowalne. Zrzut ekranu nie zastępuje biblioteki.
- Przed pracą w Penpocie odczytać aktualny stan i sygnatury API; nie zakładać zgodności narzędzia na podstawie starego eksportu.
- Implementacyjny font to Inter Variable. Inter Tight w zapisanych stylach biblioteki jest znanym fallbackiem Penpota, nie zmianą fontu aplikacji.
- Lokalny manifest tokenów, CSS oraz [kontrakt komponentów](../../design/handoff/components.md) i [responsywności](../../design/handoff/responsive.md) pozostają materiałem implementacyjnym.
- Siedem nieaktualnych referencji boardów i 52 puste cele interakcji opisano w załączniku A. Prototypy są odłożone; statyczna makieta nie potwierdza działania UI, autoryzacji lub backendu.
- Repozytorium jest bazą dokumentacji i kontraktów. Dawne eksporty QA i demonstrator usunięto przy porządkowaniu; nie stanowią testów przyszłej aplikacji.

Zmiana narzędzia nie zmienia reguł produktu, palety, dat ani priorytetów. Nowe rozbieżności zapisywać jawnie w rejestrze decyzji dokumentu wymagań.
