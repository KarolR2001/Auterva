# PLT-04 — nawigacja podczas dodawania firmy

Zakres #112 dotyczy wyłącznie widocznych kopii nawigacji w ośmiu stanach `FLOW-MVP-02 / 01–03B` na każdej stronie scenariusza. Plik Penpota: `b564c72c-f31f-81ec-8008-af198a313438`; Mobile page `fb4e1683-f05f-8095-8008-c755dff0027c` (boardy 390 px), Desktop page `fb4e1683-f05f-8095-8008-c755dff4dae6` (boardy 1440 px). Kolejność stanów, board ID i widocznych instancji nawigacji jest w `design/traceability.json` → `platform.screens[id=PLT-04].navigation`; ID pochodzą z bieżącego odczytu live.

| Widoczna pozycja | Mobile                                                | Desktop                                              |
| ---------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Firmy            | `fb4e1683-f05f-8095-8008-c7595a575f33` (`PLT-01/02`)  | `fb4e1683-f05f-8095-8008-c759e3b05202` (`PLT-01/02`) |
| Wiadomości       | `fb4e1683-f05f-8095-8008-c76fcc42bde3` (`PLT-09`)     | `fb4e1683-f05f-8095-8008-c772c96f234e` (`PLT-09`)    |
| Menu             | Więcej otwiera `89433e5c-4f5c-80ad-8008-d910ad0b18fd` | Konto otwiera `89433e5c-4f5c-80ad-8008-d90d3f63bcb7` |

W każdym z 16 boardów widoczne trzy pozycje mają aktywne prototypowe cele. Mobile nie wyświetla historycznego Pulpitu; Desktop nie wyświetla historycznych Pulpitu ani Ustawień. Odczyt menu M/D potwierdził Konto → PLT-10 właściwego viewportu z #103 i Wyloguj → PLT-08; sam prototyp nie unieważnia sesji. W ośmiu mobilnych kopiach tekst historycznej pozycji „Więcej” miał inną wysokość niż pozostałe pozycje. Instancja i jej aktywny hitbox pozostały na miejscu; stary tekst jest ukryty, a widoczna etykieta o stylu kanonicznym i z takim samym celem menu leży na wspólnej linii. Jej osiem ID zapisano w traceability. Ukryte kopie odtworzeniowe samych instancji nawigacji mają nazwę `Restore / #112 / ... / <stan>` wewnątrz każdego boardu. Nie są aktywnym UI ani dodatkowym wariantem produktu.

## Ochrona wyjścia i granica prototypu

Kliknięcie w Penpocie pokazuje stały cel, bez oceny danych formularza, serwera lub trwającego zapisu. #25 przed każdą nawigacją z `01`, `01B` i `01D` sprawdza stan formularza; przy niezapisanych zmianach otwiera istniejący `OVR-13`, zachowuje wybrany cel i przechodzi dopiero po świadomej decyzji użytkownika. „Pozostań” wraca do formularza z wartościami, a „Odrzuć” opuszcza go do wybranego celu. W `01C` oraz podczas innych trwających mutacji nawigacja nie może pozorować zakończenia zapisu ani utracić danych. Po potwierdzonym zapisie firmy i odpowiednim wyniku wysyłki zaproszenia można przejść bez ostrzeżenia; nie wolno mylić zapisu firmy ze skutecznym wysłaniem e-maila.

Runtime #25 testuje klawiaturę, fokus w menu i `OVR-13`, powrót fokusu do triggera, obsługę Escape, semantykę, mobile oraz rzeczywiste API. Ten PR nie dostarcza kodu aplikacji ani dowodu działania tych zachowań. VoiceOver pozostaje `DEFERRED` do #97.

## Kontrola makiety

Strukturalny odczyt live potwierdził cele 8/8 Mobile i 8/8 Desktop, a także osiem widocznych mobilnych etykiet „Więcej” na poziomie 30 px od góry nawigacji. Wąski PNG desktopowego sidebaru `01B` pokazuje czytelne Firmy, Wiadomości i Konto. Pełny live PNG mobilnego boardu `01B` po korekcie pokazuje trzy etykiety na jednej linii i czytelny formularz. Pozostałe siedem mobilnych stanów ma ten sam układ potwierdzony strukturalnie; pełnego PNG każdego z nich nie eksportowano. Eksporty nie dowodzą działania klawiatury, API ani warunku dirty.
