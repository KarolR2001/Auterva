# Auterva — projekt do implementacji

Logikę i zakres określa [PRD MVP 3.1](../docs/product/PRD.md), wygląd [SPEC](../docs/design/SPEC.md) oraz zgodne z nim kanoniczne makiety Penpota. Wymagania i decyzje: [katalog wymagań](../docs/WYMAGANIA_AUTERVA.md). Moduły, routing i pełne ścieżki Penpota: [architektura, załącznik A](../docs/ARCHITEKTURA_AUTERVA.md).

## Pliki robocze

- [traceability.json](traceability.json): 229 pozycji katalogu DS/PUB/ADM/OVR, dodatkowe ekrany i komponenty platformy, powiązania FR/UC oraz rzeczywiste ID. Bez statusów implementacji. Pełne nazwy ścieżek i stanów FLOW-MVP pozostają w załączniku A architektury.
- [REJESTR_MAKIET.md](REJESTR_MAKIET.md): co i gdzie poprawiono w makietach i aplikacji, wzorce wspólne, stałe rozbieżności, kolejka. Czytaj przed każdą zmianą UI lub makiety.
- [screen-occurrences.json](screen-occurrences.json): plansze scenariuszy przypisane do ekranów kanonicznych (gdzie powtarza się ten sam ekran).
- [handoff/components.md](handoff/components.md): anatomia, warianty, zachowanie, dostępność i aliasy komponentów; typy props są kontraktem, nie gotową implementacją.
- [handoff/mfa-recovery.md](handoff/mfa-recovery.md): rozdzielenie kodu odzyskania, utraty wszystkich czynników, niepewnego wyniku oraz ponownego wydania kodów według D-05.
- [handoff/platform-onboarding-navigation.md](handoff/platform-onboarding-navigation.md): cele widocznej nawigacji w PLT-04 M/D oraz ochrona wyjścia z niezapisanym formularzem.
- [handoff/responsive.md](handoff/responsive.md): breakpointy, reflow, karty/tabele, formularze, kalendarze, czat, safe area i klawiatura.
- [tokens](tokens/README.md): manifest tokenów i generowany CSS.
- [assets](assets/README.md): logo i zoptymalizowane obrazy referencyjne z proweniencją; fotografie DEMO nie są danymi realnej floty.

## Odczyt Penpota przed implementacją

1. Uruchom Penpota i połącz wtyczkę MCP. Ostatnia próba połączenia w tej sesji zwróciła `No Penpot instance connected`; lokalny indeks opisuje odczyt z **22.10.2026**, nie bieżący stan po przyszłych zmianach.
2. Projekt jest w czterech plikach (od 23.11.2026; lista w `penpot.files`, strona → plik w `penpot.pages[].fileId`): System `b564c72c-f31f-81ec-8008-af198a313438` (strony 00, 01), Ekrany `7d3e61e0-34c6-81f6-8008-fd63750adb37` (02, 03), Scenariusze Mobile `e7ca6b81-c0d3-8029-8008-fd63c3e8ce4a` (14, 16), Scenariusze Desktop `3db45ae8-1dfd-81ce-8008-fd641392cefa` (15). ID stron, boardów i komponentów nie zmieniły się, zmienił się tylko plik. Otwórz plik wskazany dla strony, potwierdź go i odczytaj aktualne strony. Wtyczka MCP czyta tylko otwarty plik i jedną kartę; stosuj blokadę `.git/penpot.lock` i jedno wywołanie na planszę. Nie identyfikuj obiektu wyłącznie numerem strony lub pozycją w drzewie.
3. Dla FR/UC wybierz pozycję w `traceability.json`, następnie odczytaj wskazany page/board/component ID. Porównaj nazwę, wariant, rolę użytkownika, stan, teksty, media, tokeny i wymiary z załącznikiem A. Przy scenariuszu używaj pełnego stanu FLOW-MVP, nie planszy opisowej.
4. Obejrzyj rzeczywisty board i render w 390 oraz 1440 px; sprawdź odpowiadające mu stany i warianty komponentów. Zmiana nazwy nie zmienia ID; brak ID trzeba zgłosić i poprawić na podstawie nowego odczytu, bez zgadywania.
5. W implementacji stosuj naturalny Flex/Grid i tokeny. Nie kopiuj sztywnych współrzędnych, wysokości fixture, timerów sukcesu, adresów DEMO ani prywatnych danych do publicznego widoku.

Odczyt z 22.10.2026 obejmował 7 stron i 175 komponentów biblioteki w jednym pliku. Po podziale (23.11.2026) komponenty ma tylko System (169; sześć komponentów, których wzorce leżały na stronach ekranów i scenariuszy, jest teraz tylko w kopiach: np. `MfaVerificationForm`, `FeatureCard`). Instancje w plikach Ekrany i Scenariusze są zamrożoną referencją i nie dostają aktualizacji z Systemu; komponenty zmieniaj w Systemie, tokeny importuj do wszystkich plików. Katalog SPEC ma 180 pozycji, w tym aliasy i kompozycje. `16 — Reference / Scenario descriptions` zawiera opisy, nie dodatkowe trasy aplikacji. Biblioteczny fallback `Inter Tight` nie zmienia wymagania użycia Inter Variable w kodzie.

## Porównanie FE i QA

- Sprawdź rolę i host: marketing, publiczna firma, panel firmy lub superadmin. Logo/hero firmy i branding edytuje superadmin; funkcje mobilne pozostają pełne.
- Porównuj ten sam ekran, dane i stan: loading, empty, error, validation, saving, conflict, offline oraz wygasła sesja, jeśli dotyczą przepływu. Sama zgodność obrazu nie potwierdza zapisu ani uprawnień.
- Oprócz 390/1440 sprawdź 320, 430, 768, 1024 i 1920 px, długie treści, małą wysokość, klawiaturę, zoom 200%, fokus i reduced motion według kontraktu responsywności.
- Powiąż zaimplementowane FR/UC z rzeczywistym plikiem kodu i adekwatnym testem. Dodawaj tylko istniejące ścieżki oraz wykonane wyniki; nie twórz pustych rubryk postępu.
- Kryteria funkcjonalne, bezpieczeństwo i testy aplikacji są w [quality gates](../docs/quality-gates.md). Statyczny projekt i graf Penpota ich nie zastępują.

## Znane ograniczenia mapowania

- `knownGaps.missingBoardReferences` zawiera **7 nieodnalezionych ID** dla OVR-14, OVR-15 i OVR-17. Wymagania wygasłej sesji, instalacji PWA i menu pozostają aktualne; źródła DS-FBK-020, DS-PWA-001 i DS-NAV-011 istnieją na stronie Systemu.
- Odczyt struktury wykazał **52 puste cele interakcji** na stronach scenariuszy. Przed użyciem prototypu trzeba sprawdzić aktualny cel; nie uznawać pustej akcji za działający przepływ.
- Prototypy **P-01, P-02 i A-03 są odłożone decyzją właściciela**. Ich wejścia pozostają w indeksie. Pozostałe grafy są referencją projektu, nie wynikiem testów aplikacji.
