# Komponenty, formularze i responsywność

- Ustal wymaganie, rolę/host oraz ekran/stan w `docs/WYMAGANIA_AUTERVA.md`, `design/traceability.json` i aktualnym Penpocie. Przeczytaj odpowiedni fragment `docs/design/SPEC.md` i handoff, nie projektuj kolejnego stylu.
- Inwentarz w `docs/ARCHITEKTURA_AUTERVA.md` ma datę kontroli. Sprawdź bieżący page/board/component ID; brak mapowania oznacza brak referencji, nie usunięcie wymagania.
- W implementacji i QA Penpot jest tylko do odczytu. Nie poprawiaj wzorca, żeby render aplikacji wyglądał na zgodny. Zmiany designu wymagają osobnego zakresu i jednego agenta zapisującego.
- Prymitywy → tokeny semantyczne → komponenty. Źródło: `design/tokens/auterva.tokens.json`; paleta, Inter Variable, Lucide i siatka 4 px są wspólne dla czterech obszarów. Brak dark mode i indywidualnych kolorów firm.
- Sprawdź istniejące komponenty przed dodaniem. Dla shadcn odczytaj `components.json`, Tailwind i bazę Radix; nie zmieniaj presetu ani nie nadpisuj komponentów bez uzgodnionego zakresu. Brak pliku nie jest zgodą na przypadkowy stos.
- Wspólne formularze floty/mediów/kalendarza obsługują admina i superadmina; kontekst firmy jest jawny, uprawnienia rozstrzyga serwer. Nie twórz kopii całego UI per rola lub firma.
- Stosuj typowane warianty i composition, bez iloczynu flag. Boardy opisowe i macierze stanów nie są osobnymi trasami; OVR to overlay na zachowanym ekranie.
- Formularze: RHF + Zod zgodne z wersjami; label, hint, aria-describedby, podsumowanie błędów, focus, loading, dirty state i kontrolowany submit. Zachowuj dane po błędzie i konflikcie wersji.
- Koniec okresu pokazuje nieblokujący banner; nie wyłącza edycji floty/czatu. Unread jest zauważalny także przy czacie w menu „Więcej”. Szkic nie przechodzi do innej rozmowy.
- Kalendarz prezentuje wynik domeny. Zapewnij pola dat i klawiaturę; nie licz konfliktów w JSX. Błąd/ponowne sprawdzanie nie pokazuje starego wyniku „dostępny”.
- Akcja to button, nawigacja to link. Widoczny fokus, etykiety ikon, powrót fokusu po dialogu, alternatywa dla drag-and-drop, status tekstem i dodatkowym sygnałem.
- Mobile zachowuje pełne funkcje, safe area i kompozytor nad klawiaturą. Sticky CTA nie zasłania pól. Referencje 390/1440 px; także 320, 430, 768, 1024 i 1920 px według ryzyka.
- Stany dokumentuj w istniejącym środowisku komponentowym lub uzgodnionym małym przykładzie; brak Storybooka nie wymaga jego instalacji. Timery sukcesu i fixture DEMO nie są logiką API.
- Odbiór: render aplikacji i eksport boardu przy tych samych danych, stanie i szerokości; osobno test zachowania, klawiatury i dostępności. Dowód podaje commit, board ID, viewport, wynik i niezweryfikowane elementy.
