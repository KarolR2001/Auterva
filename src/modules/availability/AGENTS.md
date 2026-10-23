# Dostępność — krytyczna domena

Czytaj wymagania floty/dostępności i UC-03–06/10 w `docs/WYMAGANIA_AUTERVA.md`, projekt współbieżności w `docs/ARCHITEKTURA_AUTERVA.md` i odpowiednie źródło PRD wskazane w tych dokumentach.

- Daty są całodniowe: walidowany LocalDate i SQL DATE. `start == end` jest poprawne, oba końce wliczone. Dzisiaj wynika z zegara Europe/Warsaw.
- Konflikt: `existing.startDate <= requested.endDate && existing.endDate >= requested.startDate`. Nie przesuwaj dnia przez niekontrolowaną konwersję `YYYY-MM-DD` do UTC Date.
- Dostępność = cały zakres w aktywności pojazdu i brak przecięcia blokady. Publiczny wynik wymaga także PUBLISHED i aktualnej widoczności firmy na danym publicznym hoście.
- Brak końca aktywności nie tworzy nieskończonej blokady. Nie zapisuj wolnych dni. Koniec usługi Autervy nie dodaje blokad kalendarza.
- Pojazd i okres należą do firmy; odczyt/zapis weryfikuje tenant i zgodność relacji. Superadmin zachowuje własnego aktora i wybrany kontekst firmy.
- Koniec opłaty/trialu nie blokuje prywatnej edycji. Archiwizacja blokuje operacje admina firmy; uprawniony superadmin korzysta z jawnego kontekstu archiwum.
- Check-then-insert przy domyślnej izolacji nie chroni przed wyścigiem. Użyj udokumentowanego constraintu zakresowego PostgreSQL lub spójnej serializacji per pojazd; sprawdź dwa rzeczywiście równoległe zapisy.
- Zmiana aktywności i zapis blokady muszą korzystać z tego samego zabezpieczenia. SQL tylko parametryzowany; `btree_gist`/constraints w przeglądanej migracji ze sprawdzonym wsparciem hostingu.
- Edycja wyklucza samokonflikt, ale kontroluje inne okresy i wersję rekordu. Równoczesna zmiana admina/superadmina daje jawny konflikt bez nadpisania.
- Typ serwisu: `MAINTENANCE`, etykieta „Serwis”; nie dodawaj `SERVICE` z rozbieżnego przykładu makiety. Źródło MVP: MANUAL.
- Publiczne DTO nie zawierają powodu, typu, notatki, reference ani operatora. Błąd/stan nieznany nigdy nie oznacza dostępności.
- Po commit osobny publiczny kontekst widzi aktualny wynik; odświeżenie samego kalendarza admina jest niewystarczające.

Minimalne testy: jeden dzień, wspólny dzień końca/początku, następny dzień, zawieranie, częściowe przecięcie, zakres odwrotny, otwarta aktywność i jej granice, rok przestępny, DST/północ Warszawa, ukryty pojazd, wygasła/archiwalna firma, A/B, równoległe inserty/edycje/zmiana aktywności, wersja, aktualność po zapisie i brak wycieku. Zegar i historyczne fixture są zamrożone.
