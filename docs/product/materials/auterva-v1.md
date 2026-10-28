# Auterva — materiały MKT-01, wersja 1.0

**Status:** zatwierdzone decyzją D-17 do implementacji i oznaczonego preview staging. **Podmiot:** Auterva jako marka produktu; tożsamość operatora, dane kontaktowe i dokument prawny wymagają uzupełnienia przed publiczną produkcją. **Źródło:** MKT-01 Mobile `1e066793-8858-8051-8008-cf36d8d5909f`, Desktop `269b07ba-69e5-8066-8008-c84b6a04500c` w [pliku Penpota](https://design.penpot.app/#/workspace?file-id=b564c72c-f31f-81ec-8008-af198a313438&page-id=269b07ba-69e5-8066-8008-c84a9b898bc0). Copy poniżej pochodzi z makiety, chyba że oznaczono „wg PRD”.

## Treść strony

| Sekcja | Treść do użycia |
|---|---|
| Hero | **Flota online. Terminy pod kontrolą.** Pokaż flotę z najlepszej strony. Aktualizuj auta i wolne terminy w jednym panelu — także z telefonu. CTA: „Zadzwoń do Autervy”. Dopisek: „Rozmowa, prezentacja i indywidualne uruchomienie”. |
| Korzyści | **Więcej czasu dla klientów.** Klient poznaje ofertę na stronie. Ty aktualizujesz ją w jednym miejscu. Karty: „Oferta, która przekonuje” (zdjęcia, wyposażenie, wolne terminy); „Mniej ręcznej pracy” (aktualizacja opisów i zdjęć w panelu); „Aktualne terminy” (wpisanie uzgodnionego wynajmu lub serwisu); „Panel zawsze pod ręką” (obsługa z telefonu). |
| Podgląd | **Oferta dla klientów. Panel dla Ciebie.** Klient poznaje auta i wolne terminy. Ty zarządzasz ofertą w swoim panelu. Podpisy „Przykładowy widok strony firmy” i „Przykładowy widok panelu” muszą pozostać widoczne; zrzuty nie przedstawiają rzeczywistego klienta. |
| Jak to działa — wg PRD §12.1 | **Od prezentacji do gotowej strony.** 1. „Porozmawiajmy” — ustalamy telefonicznie potrzeby. 2. „Zobacz rozwiązanie” — pokazujemy makietę strony i panel. 3. „Uzgodnij materiały” — firma akceptuje wygląd poza aplikacją, Auterva przygotowuje konfigurację. 4. „Otrzymaj dostęp” — po zaproszeniu administrator prowadzi ofertę w panelu. Cztery kroki doprecyzowują trzy kroki z makiety zgodnie z PRD; nie tworzą publicznej rejestracji. |
| FAQ | **Jak klient ustala termin?** Sprawdza informacyjną dostępność i kontaktuje się z firmą; administrator zapisuje uzgodniony zakres. **Czy mogę pracować z telefonu?** Tak, funkcje panelu floty i dostępności są dostępne na telefonie. **Co przygotować na start?** Logo, dane firmy i zdjęcia; Auterva pokazuje sposób obsługi panelu. |
| Kontakt | **Porozmawiajmy o Twojej wypożyczalni.** Pokażemy Ci system do prezentacji floty i zarządzania dostępnością. Kanały: telefon (pierwszy kontakt), WhatsApp i e-mail. W preview pokazuj oznaczenie „Dane DEMO — kontakt nieaktywny”; nie podłączaj numeru `+48 000 000 000` ani `kontakt@example.invalid` jako działającego CTA. Produkcja wymaga prawdziwych, sprawdzonych kanałów. |
| Stopka | „Auterva — system prezentacji floty i dostępności dla wypożyczalni pojazdów.” Odnośnik do osobnej polityki prywatności operatora pojawia się dopiero po jej zatwierdzeniu. |

Teksty opisują możliwości produktu bez niepopartych wyników biznesowych. Onepage nie jest wspólną flotą firm, cennikiem, formularzem publicznej rejestracji, rezerwacją ani płatnością online.

## Meta, obrazy i alt — wg PRD

- `meta title`: „Auterva — strona i panel dla wypożyczalni pojazdów”.
- `meta description`: „Pokaż flotę i dostępne terminy na stronie swojej wypożyczalni. Zarządzaj ofertą z panelu i porozmawiaj z Autervą o uruchomieniu.”
- Logo tekstowe „AUTERVA” ma alt „Auterva”; obraz dekoracyjny obok już czytelnego nagłówka ma pusty alt. Zrzuty funkcji oznacz „Przykładowy widok panelu Autervy” i „Przykładowa publiczna strona wypożyczalni”.
- Istniejący zasób `public-fleet-depot` z `design/assets/manifest.json` może ilustrować redakcję wyłącznie jako DEMO; alt z manifestu identyfikuje trzy **demonstracyjne** pojazdy. Nie sugeruj, że to auta klientów Autervy. Użycie logo SVG z `design/assets/brand/` wymaga przed produkcją potwierdzenia autorstwa i prawa użycia; w preview wystarczy tekstowy wordmark z makiety.
- Na Mobile hero i telefoniczne CTA poprzedzają duży obraz. Desktop może pokazać dwukolumnowy hero i oznaczony podgląd produktu. Nie zmieniaj wspólnej palety, fontu ani ikon.

## Polityka prywatności Autervy — robocza struktura

**Status dokumentu:** szkic 1.0, tylko do opracowania i preview oznaczonego DEMO. Nie publikować jako rzeczywistej polityki. Makieta MKT-01 zawiera odnośnik w stopce, lecz nie dostarcza danych operatora ani kompletnego dokumentu. Poniższe pola odzwierciedlają zakres informacji z [art. 13 RODO](https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX%3A32016R0679) oraz zalecenie jasnego języka [UODO](https://uodo.gov.pl/pl/492/2439).

1. **Administrator i kontakt:** `[rzeczywista nazwa i dane podmiotu prowadzącego Autervę]`, `[adres]`, `[publiczny e-mail do spraw prywatności]`; dane IOD, jeśli został wyznaczony.
2. **Cele, dane i podstawy:** rozdzielić zapytania telefoniczne/WhatsApp/e-mail o usługę, zaproszenie i obsługę administratora firmy oraz techniczne działanie strony. Dla każdego procesu wskazać faktyczne kategorie danych, podstawę z art. 6 RODO i ewentualny uzasadniony interes. Samo kliknięcie CTA nie tworzy konta ani rezerwacji.
3. **Odbiorcy i transfer:** wpisać rzeczywistych dostawców hostingu, poczty, komunikacji i logów; zweryfikować, czy dane trafiają poza EOG i jakie zabezpieczenie wtedy obowiązuje.
4. **Retencja:** przypisać faktyczne okresy lub kryteria do każdego celu; rozróżnić dokumentację zapytania, konto administracyjne, audit log i log techniczny. Nie przenosić automatycznie 365 dni audytu na wszystkie dane kontaktowe.
5. **Prawa i skarga:** opisać dostęp, sprostowanie, usunięcie, ograniczenie, sprzeciw, przenoszenie tam, gdzie ma zastosowanie, oraz skargę do organu nadzorczego. Podać sposób kontaktu i wymagane informacje o obowiązkowości podania danych oraz automatycznych decyzjach, jeżeli występują.

Finalna wersja musi mieć datę, tożsamość rzeczywistego operatora, zgodność z faktycznymi procesami/dostawcami i udokumentowaną akceptację. Dokument firmy jest osobny; [pakiet Alfa Campers DEMO](alfa-campers-demo-v1.md) nie zastępuje polityki Autervy.
