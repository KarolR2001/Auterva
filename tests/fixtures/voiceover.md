# Odbiór komponentów #11 czytnikiem VoiceOver

Wykonawca #97 przygotowuje fixture i przeglądarkę; niezależny QA zapisuje rzeczywisty odczyt na aktualnym commicie #11 po CR. Ta procedura nie zastępuje testu czytnikiem.

1. Na testowanym commicie [#11](https://github.com/KarolR2001/Auterva/pull/92) wykonaj `pnpm install --frozen-lockfile`. Utwórz tymczasową trasę `src/app/ui-check/page.tsx` o treści poniżej, a potem uruchom `pnpm dev --port 3339` na wolnym porcie. Fixture `tests/fixtures/ui-check.tsx` pochodzi z #11; trasa nie należy do PR.

   ```tsx
   import { UiCheckFixture } from "../../../tests/fixtures/ui-check";

   export default function Page() {
     return <UiCheckFixture />;
   }
   ```

2. W drugim terminalu, z brancha #97, uruchom `node tests/fixtures/open-voiceover-browser.mjs http://127.0.0.1:3339/ui-check`. Skrypt otwiera widoczne Chromium z nowym, izolowanym profilem i usuwa profil po zamknięciu. Nie otwieraj w tym oknie prywatnych stron ani sesji.
3. Włącz VoiceOver przez Command-F5. Jeżeli pojawi się ekran powitalny, Return przechodzi do czytnika, a Escape anuluje. Nie wybieraj opcji trwałego ukrycia powitania. Skrót VO oznacza Control-Option albo Caps Lock. Włącz panel napisów przez VO-Fn-Command-F10 lub VoiceOver Utility → Visuals → Panels and Menus. Panel pokazuje wypowiedzi **VoiceOver**, więc pozwala ręcznie zapisać dowód bez AppleScript.
4. Przejdź klawiaturą i kursorem VO przez poniższe scenariusze. Zapisz wypowiedź z panelu napisów albo dokładnie usłyszany tekst, działanie, wynik i testowany commit. Jeśli panel nie działa, odnotuj blokadę; drzewo AX, atrybut HTML i `speechSynthesis` nie są dowodem mowy czytnika.

| Scenariusz      | Działanie i oczekiwany sens komunikatu                                                                                                                                                                      |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SkipLink        | Pierwszy Tab prowadzi do „Przejdź do treści”, rozpoznawanego jako link. Enter przenosi do głównej treści.                                                                                                   |
| Etykiety i błąd | Odczytaj oba pola „Nazwa pojazdu”: etykieta, wymaganie/hint i błąd muszą być zrozumiałe przy odpowiednim polu. Zapisz faktyczną kolejność wypowiedzi.                                                       |
| Hasło           | Wpisz wyłącznie wartość testową, przełącz widoczność i sprawdź nazwę akcji oraz zachowanie wartości i fokusu.                                                                                               |
| Loading         | Uruchom „Zapisz” z długim `loadingLabel`; odczyt identyfikuje trwający zapis, bez pozornego sukcesu. Sprawdź wariant z ikoną i bez.                                                                         |
| Dialog          | Otwórz dialog destrukcyjny bez podanej akcji drugorzędnej. Odczytaj tytuł, opis i „Anuluj”; spróbuj przejść kursorem VO poza dialog. Tło nie może być dostępne, Escape zamyka, a fokus wraca do wyzwalacza. |

Po teście wyłącz VoiceOver przez Command-F5, przywróć poprzedni stan panelu napisów, zamknij izolowaną przeglądarkę i usuń tymczasową trasę. Nie zapisuj wypowiedzi z innych aplikacji, zawartości schowka ani danych użytkownika. Jeśli macOS wymaga ręcznej zgody na sterowanie VoiceOver przez AppleScript, można ją rozważyć w VoiceOver Utility → General, ale **nie jest potrzebna** do odbioru przez panel napisów i nie należy włączać jej automatycznie.

Źródła Apple: [włączanie i okno powitalne](https://support.apple.com/en-ie/guide/voiceover/vo2682/mac), [panel napisów](https://support.apple.com/en-ie/guide/voiceover/unac078/mac), [ustawienie AppleScript](https://support.apple.com/en-ie/guide/voiceover/cpvougen/mac).
