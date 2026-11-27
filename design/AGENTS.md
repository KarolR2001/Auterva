# Auterva — Penpot, implementacja i QA

## Źródła

- Aktualny zakres i reguły: `docs/product/PRD.md` — MVP 3.1 z superadminem. `docs/WYMAGANIA_AUTERVA.md` zbiera wymagania i otwarte decyzje.
- Wygląd: `docs/design/SPEC.md` oraz kanoniczne makiety zgodne z PRD. Ścieżki Penpota: załącznik A `docs/ARCHITEKTURA_AUTERVA.md`; identyfikatory i FR/UC: `design/traceability.json`.
- Kontrakty: `design/handoff/components.md`, `design/handoff/responsive.md`, `design/tokens/README.md`. Zasoby: `design/assets/README.md`.
- Czytaj potrzebną sekcję i rzeczywisty obiekt; nie odtwarzaj dawnej historii QA. Nazwa lub numer strony nie zastępuje ID. Brak mapowania zapisz jawnie, bez fikcyjnych UUID i pustych statusów implementacji.

## Praca z Penpotem

- Przed odczytem/zapisem uruchom połączenie i sprawdź dostępne narzędzia oraz aktualną sygnaturę API. Użyj zainstalowanego skilla `maestro-dogn-mcp`; projektowy PRD/SPEC ma pierwszeństwo przed domyślną estetyką skilla.
- Potwierdź file/page/board/component ID. Snapshot z 22.10.2026 jest indeksem; przed porównaniem FE/QA odczytaj aktualny plik. Znane braki i odłożone prototypy są w `traceability.json`.
- Jeden agent zapisuje do Penpota. Rozdziel przełączenie strony i kontrolny odczyt od zapisu. Przed usunięciem lub zmianą fundamentów sprawdź zakres upoważnienia i zapewnij odtwarzalną kopię.
- Przed każdą zmianą makiety lub UI przeczytaj `design/REJESTR_MAKIET.md`. Nie powtarzaj pozycji oznaczonych jako zrobione. Ten sam ekran występuje w kilku plikach: plansza kanoniczna jest w Ekranach (ADM/PUB/OVR/ACC/TEN/MKT) albo w planszach `PLT-…` Scenariuszy, a `FLOW-MVP-*` to jej kopie w stanach scenariusza (lista w `design/screen-occurrences.json`). Najpierw zmień wzorzec i planszę kanoniczną, potem wszystkie wystąpienia we wszystkich plikach, potem aplikację. Kopii nie poprawiaj w oderwaniu od wzorca. W tej samej zmianie zaktualizuj rejestr, a dla nowych plansz także JSON.
- Sprawdź istnienie przed tworzeniem. Po timeout odczytaj stan przed ponowieniem. Pracuj małymi partiami; zachowuj realne instancje, edytowalne teksty oraz Flex/Grid.
- Po zmianie odczytaj strukturę i obejrzyj render. Brak renderu oznacza niewykonany przegląd wizualny. Nie deklaruj focus trap, czytnika ani zapisu serwera na podstawie statycznej makiety.

## Niezmienniki projektu

- Cztery obszary: marketing Autervy, publiczna firma, panel firmy i superadmin. Jeden aktywny administrator firmy; obowiązkowe MFA obu ról. Priorytety PRD mają pierwszeństwo nad starymi oznaczeniami P1.
- Paleta #151515, #424242, #737373, #a5a5a5, #f2f2f2 i dozwolone alfa; tokeny semantyczne, Inter Variable, Lucide, spacing 4 px, brak dark mode. Fallback Inter Tight w bibliotece nie jest fontem aplikacji. Status ma tekst/ikonę, a #737373 na #f2f2f2 nie służy do zwykłego tekstu.
- Dostępność: LocalDate, koniec włącznie, jeden dzień poprawny, Europe/Warsaw. Publicznie brak typu/przyczyny blokady i prywatnej notatki. Kontakt nie tworzy rezerwacji ani klienta.
- Koniec trialu/opłaty wyłącza publiczną stronę, ale pozostawia panel i czat. Archiwizacja blokuje dostęp; przywrócenie nie publikuje automatycznie. Branding/hero/logo firmy edytuje superadmin; spornych uprawnień kontakt/SEO/legal nie rozszerzaj domysłem.
- PWA dotyczy panelu firmy; brak prywatnego cache, kolejkowania zapisów offline i fikcyjnego sukcesu. Aktualizacja nie może zgubić formularza. Czat zachowuje osobny lokalny szkic rozmowy.
- Główne makiety 390×844 i 1440×1024; kontrola także 320, 430, 768, 1024 i 1920 px. Mobile ma pełne funkcje. Dłuższe treści, safe area, klawiatura, zoom i reduced motion wymagają rzeczywistego reflow.

## Implementacja i odbiór

- Zachowaj powiązanie wymaganie → ekran/stan → Penpot ID → istniejący kod/test. Alias DS i plansza opisowa nie oznaczają nowego komponentu lub trasy.
- Porównaj rzeczywistą aplikację z odczytanym boardem i kontraktem; testuj zachowanie według `docs/quality-gates.md`. Status projektu nie jest statusem wdrożenia.
- Raportuj zmienione pliki/ID, wykonane sprawdzenia i otwarte braki. Nie zmieniaj siedmiu brakujących referencji ani odłożonych prototypów na pozornie potwierdzone.
