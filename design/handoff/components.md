# Auterva — kontrakty komponentów

Kontrakty anatomii, wariantów, zachowania i dostępności do implementacji. ID katalogu i komponentów: [traceability](../traceability.json); dokładne ścieżki bibliotek: [architektura, załącznik A](../../docs/ARCHITEKTURA_AUTERVA.md). Ten dokument nie potwierdza działania aplikacji ani testów runtime.

Obowiązuje [PRD MVP 3.1](../../docs/product/PRD.md): dwa obszary administracyjne, jeden aktywny administrator na firmę, obowiązkowe MFA obu ról. Logo, hero i branding firmy edytuje superadmin. Dostępność pozostaje informacyjna; nie ma rezerwacji, płatności ani kont klientów. Priorytety i uprawnienia PRD mają pierwszeństwo przed starszym katalogiem komponentów. Szczegółowy podział pól kontaktu/SEO/treści wymaga rozstrzygnięcia D-01 w [wymaganiach](../../docs/WYMAGANIA_AUTERVA.md).

Szerokości, scroll i reflow: [responsywność](responsive.md). Poniższe typy props opisują kontrakt UI, nie gotowy kod ani obowiązkową strukturę API. Dane firmowe i stan zapisu pochodzą z autoryzowanego serwera; timery i adresy demonstracyjne z makiet nie są logiką aplikacji.

## Zasady wspólne

Wszystkie poniższe komponenty katalogowe są na stronie `01 — System projektu` (`a4abf4c9-2e1f-80fd-8008-afc9717972ba`), w sekcjach Shared, Public lub Admin. Kompozycja VehicleForm wskazuje osobno stronę scenariusza.

- Źródło projektu: Penpot, plik `b564c72c-f31f-81ec-8008-af198a313438`.
- Nazewnictwo: `Obszar / Rodzina / Komponent` oraz jawne osie wariantów.
- Kolory pochodzą wyłącznie z tokenów Autervy i zatwierdzonej palety.
- Bazą odstępów jest 4 px.
- Tekst implementacyjny używa `Inter Variable`; Penpot używa oznaczonego fallbacku `Inter Tight`, ponieważ właściwa rodzina nie jest dostępna w bieżącej instancji.
- Status nie może być przekazywany wyłącznie kolorem.
- Etykieta formularza pozostaje nad kontrolką; placeholder nie zastępuje etykiety.
- Minimalny główny cel dotykowy przycisku i pola to 48 px wysokości.
- `focus-visible` musi być widoczny niezależnie od hover.

## VehicleForm — kompozycja formularza

Kompozycja referencyjna. Jeden master `f625007f-d8bc-808b-8008-ccdf448b7f95`, nazwa `Admin / Vehicles / VehicleForm`; main instance `f625007f-d8bc-808b-8008-ccdf43c813e1` na stronie `15 — Scenarios / MVP / Desktop` (`fb4e1683-f05f-8095-8008-c755dff4dae6`). To uzupełnienie brakującej pełnej kompozycji, nie nowy zestaw wariantów każdego stanu. Formularz składa istniejące FormField, Textarea, Select, Checkbox, FileDropzone i Button. Szkic/walidacja zmieniają dane i komunikaty.

| Sekcja | Pola i opcje |
|---|---|
| Dane podstawowe | nazwa, marka, model, wariant, kategoria, rok |
| Parametry | miejsca, drzwi, skrzynia, napęd, kolor, pojemność bagażowa |
| Opis i wyposażenie | krótki opis, pełny opis, wyposażenie |
| Cena | cena od, jednostka, ukrycie ceny |
| Zdjęcia | FileDropzone + ImageAdminTile: postęp, błąd, retry, gotowa galeria; pozostałe akcje galerii nadal WIP |
| Dostępność bazowa | początek i opcjonalny koniec zakresu |
| Publikacja i SEO | slug, tytuł SEO, opis SEO, kolejność, wyróżnienie |

To 23 pola danych i dwa checkboxy; zdjęcia są osobnym obszarem mediów. M: 358 px treści w boardzie 390 px, jedna przewijana kolumna. D: 640 px pól w boardzie 1440 px, pary powiązanych danych oraz boczna nawigacja/status. Kontrolki i akcje mają 48 px wysokości; Textarea minimum 120 px. Błędy mają tekst, nie tylko odcień. Stan szkicu i wymagania publikacji należy rozdzielić zgodnie z FR-ADM-032/033. Cena oraz SEO nie blokują zapisu szkicu. Daty są LocalDate, koniec zakresu wliczony; upload i limity według konfiguracji.

Pola Textarea M mają Flex, padding 12 px i szerokość fill; treść zawija się. Penpot nie wyegzekwował minimum 120 px przy auto-height, dlatego wysokość fixture jest jawnie obliczona jako max(120, wysokość tekstu + 24). Przy 320 px pełny opis ma 144 px. Implementacja ma zapewnić rzeczywiste minimum i powiększanie pola, nie kopiować sztywnej wysokości dla dowolnej treści. Pola jednoliniowe pozostają jednoliniowe; pełna wartość ma być dostępna podczas edycji przez przewijanie kontrolki, nie zawijanie na ukrytą linię.

### Zdjęcia w formularzu

Pięć nowych par stanów 06/07/08/09/07a korzysta z istniejących wariantów ImageAdminTile (główne, zwykłe, uploading, failed), ResponsiveImage, ProgressBar, InlineMessage oraz Button/IconButton. Nie dodano masterów. DS-FRM-023/DS-MED-006 pozostały referencją zachowania; ich katalogowych boardów nie skopiowano jako kolejnego sztywnego formularza.

Galeria ma 358 px i jedną kolumnę na M, 640 px i dwie kolumny po 308 px na D. Jest to lokalna kompozycja pełnego formularza z akcjami i opisem każdego zdjęcia, nie globalna zmiana siatki DS-MED-005 ze SPEC §6.7 (tam 2 kolumny M i 3–5 D). Odstępstwo jest jawnie robocze; źródłowego SPEC nie zmieniono. Zdjęcie główne 2:1 jest wyśrodkowane w polu mediów bez rozciągania, wnętrze ma proporcje 3:2. Są to istniejące generowane zasoby DEMO, nie dokumentacja konkretnego pojazdu. Przyciski mają 48 px wysokości; kolejność ma również jawne przyciski, nie sam uchwyt drag-and-drop.

Błąd i anulowanie dotyczą tylko drugiego pliku; pierwsze, główne zdjęcie pozostaje. Gotowość publikacji nie wymaga dwóch zdjęć. Przejścia uploadu są demonstracją; timer 1,8 s nie jest kontraktem czasu odpowiedzi serwera. Zmiana głównego, opis, usunięcie zapisanego zdjęcia i przestawianie kolejności mają widoczne kontrolki, ale ich lokalne przejścia pozostają do podłączenia. Nie traktować tego fragmentu jako kompletnego wzorca zachowania galerii.

## DS-ACT-001 — Button

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf2791de2347`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afcd55d189a8`.

### Anatomy

1. kontener akcji z Auto Layout;
2. edytowalny `Label`;
3. opcjonalne miejsce ikony — nieobecne w aktualnej macierzy `icon=none`.

### Osie i pokrycie

| Oś | Wartości w katalogu |
|---|---|
| `style` | `primary`, `secondary`, `tertiary`, `destructive` |
| `state` | `default`, `hover`, `pressed`, `focus`, `disabled`, `loading` |
| `size` | `sm`, `md`, `lg` |
| `icon` | `none` |
| `width` | `hug` |

Macierz ma 28 rzeczywistych wariantów. `md` obejmuje wszystkie kombinacje style/state; `sm` i `lg` mają reprezentatywne warianty primary/secondary w stanie default używane przez ButtonGroup. Ikony, `width=fill` i zbędne powtórzenia stanów dla każdego rozmiaru pozostają kontraktem runtime zamiast osobnymi rysunkami.

### Tokeny i wymiary

- wysokość: `button.height.md` = 48 px;
- padding poziomy: `button.padding.x.md`;
- radius: `radius.md`;
- tło primary: `action.primary.*`;
- treść primary: `action.primary.content`;
- obramowanie secondary: `action.secondary.border`;
- focus: `focus.ring` + `border.width.active`.

### Kontrakt implementacyjny

```ts
type ButtonProps = {
  style?: "primary" | "secondary" | "tertiary" | "destructive";
  size?: "sm" | "md" | "lg";
  width?: "hug" | "fill";
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  iconPosition?: "leading" | "trailing";
  children: React.ReactNode;
};
```

- `loading` utrzymuje rozmiar komponentu i nie powoduje zmiany szerokości.
- `disabled` jest stanem rzeczywiście nieaktywnym, nie tylko stylem.
- Akcja destrukcyjna ma jednoznaczną etykietę obiektu/skutku; monochromatyczna paleta nie może być jedynym sygnałem.
- Implementacja nie może zagnieżdżać elementu interaktywnego w `<button>`.

### Dostępność i motion

- Typ elementu: natywny `<button>` lub semantycznie równoważny link tylko dla prawdziwej nawigacji.
- `aria-busy=true` w stanie loading; tekst stanu dostępny dla czytnika.
- Focus ring nie znika przy `prefers-reduced-motion`.
- Hover/pressed: `motion.fast` 120 ms; standard easing.
- Loading spinner może animować obrót, ale przy reduced motion pozostaje statyczną ikoną z komunikatem.

## DS-ACT-002 — IconButton

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d05b4a62f`.
- Library component head: `dc32726c-e29a-8032-8008-b6ed312f805d`.

### Anatomy i pokrycie

1. natywny kontener przycisku;
2. jedna wymienna ikona Lucide;
3. focus ring poza obrysem;
4. dostępna nazwa przekazywana przez `aria-label`.

| Oś | Wartości w katalogu |
|---|---|
| `appearance` | `default`, `subtle`, `destructive` |
| `state` | `default`, `hover`, `pressed`, `focus`, `disabled`, `loading` |
| `size` | `40`, `44`, `48` |

Variant Set zawiera 10 celowych kombinacji zamiast pełnego iloczynu 54. Wszystkie stany są pokazane dla bazowego `default/44`; subtle i destructive mają wariant bazowy, a 40 i 48 px potwierdzają skalowanie tej samej anatomii. Hover/pressed/focus/disabled/loading nie są dublowane dla każdej pary appearance/size, ponieważ implementacja używa tego samego kontraktu stanów.

### Tokeny i zachowanie

- fill: `surface.default`, `surface.subtle`, `surface.disabled`, `action.secondary.hover`, `action.secondary.pressed` i `status.error.surface`;
- stroke: `border.default`, `border.subtle`, `border.strong`, `border.critical`, `focus.ring`;
- radius: `radius.sm`;
- ikona: Lucide 18 px dla rozmiaru 40 oraz 20 px dla 44/48;
- loading używa `LoaderCircle`, `aria-busy=true` i blokuje ponowne kliknięcie;
- destructive wymaga nazwy skutku, np. „Usuń zdjęcie”, nie ogólnego „Usuń”.

```ts
type IconButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  label: string;
  icon: React.ReactNode;
  appearance?: "default" | "subtle" | "destructive";
  size?: 40 | 44 | 48;
  loading?: boolean;
  tooltip?: string;
};
```

- `label` zawsze zasila `aria-label`; tooltip jest obowiązkowy, gdy znaczenie ikony nie jest oczywiste z sąsiedniej treści.
- Fokus pozostaje widoczny przy reduced motion. Hover/pressed używa `motion.fast` 120 ms bez skalowania, jeśli użytkownik ogranicza ruch.

## DS-ACT-003 — TextLink

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aab5d1f`.
- Library component head: `dc32726c-e29a-8032-8008-b789a087db8e`.

### Anatomy i pokrycie

1. semantyczny tekst linku, zawsze edytowalny;
2. underline obecny niezależnie od koloru;
3. opcjonalna ikona Lucide dla linku zewnętrznego albo dodatkowego sygnału
   stanu odwiedzonego;
4. focus ring wokół rzeczywistego obszaru interakcji.

| Oś | Wartości w katalogu |
|---|---|
| `variant` | `inline`, `standalone`, `inverse`, `external` |
| `state` | `default`, `hover`, `visited`, `focus` |
| `size` | `body`, `body-sm` |

Variant Set ma 8 celowych kombinacji: wszystkie stany dla `inline/body`, bazowe warianty `standalone`, `inverse` i `external` oraz kontrolny rozmiar `inline/body-sm`. Pozostałe stany współdzielą ten sam kontrakt runtime; nie powstał sztuczny iloczyn 4×4×2.

### Tokeny i zachowanie

- tekst: `text.link`, `text.secondary` dla visited i `text.inverse` na `surface.inverse`;
- focus: `focus.ring`, `border.width.active`, `radius.xs`;
- typografia: `body` 16 px oraz `body-sm` 14 px;
- przejście hover/focus: `motion.fast` 120 ms, bez skalowania;
- tło przy wariancie inverse należy do powierzchni nadrzędnej, a nie do linku; ciemny prostokąt w katalogu jest wyłącznie próbką prezentacyjną.

```ts
type TextLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: "inline" | "standalone" | "inverse" | "external";
  size?: "body-sm" | "body";
  children: React.ReactNode;
};
```

- komponent renderuje natywny `<a>` z prawdziwym `href`; akcje bez nawigacji używają `Button`, nie linku;
- link zewnętrzny zachowuje widoczną ikonę, a dostępna nazwa pozostaje treścią linku; dodatkowy komunikat o nowej karcie jest wymagany tylko wtedy, gdy użyto `target="_blank"`;
- visited nie polega wyłącznie na zmianie koloru; reprezentatywny wariant ma także ikonę check oznaczoną jako dekoracyjna;
- focus-visible pozostaje czytelny przy `prefers-reduced-motion`.

## DS-ACT-004 — ButtonGroup

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aab5d3b`.
- Library component head: `dc32726c-e29a-8032-8008-b78c5b4fa30d`.

### Anatomy i pokrycie

1. natywny kontener Flex z odstępem 12 px i paddingiem 16 px;
2. dokładnie dwie rzeczywiste instancje `DS-ACT-001 Button` w przykładach;
3. secondary/cancel przed primary/confirm w układzie poziomym;
4. osobny responsywny kontrakt zmieniający row/hug na column/fill.

| Oś | Wartości w katalogu |
|---|---|
| `layout` | `horizontal`, `vertical`, `split-responsive` |
| `childState` | `default`, `disabled-child`, `loading-child` |
| `size` | `sm`, `md`, `lg` |

Variant Set zawiera 7 celowych kombinacji. Pełny stan i rozmiar są własnością dziecka `Button`; grupa nie kopiuje jego anatomii i nie tworzy iloczynu 3×3×3. Wszystkie 14 bezpośrednich dzieci pozostaje powiązanymi instancjami biblioteki.

### Responsywność i zachowanie

- `horizontal`: akcja drugorzędna po lewej, główna po prawej; `gap=12`;
- `vertical`: kolejność logiczna i wizualna jest jawna; oba cele zachowują rozmiar dziecka;
- `split-responsive`: mobile używa `column/fill`, desktop `row/hug`;
- grupa może zawierać pojedyncze dziecko disabled albo loading bez blokowania niezależnej akcji anulowania;
- loading nie zmienia szerokości grupy i przekazuje `aria-busy` do właściwego przycisku, nie do całego formularza.

```ts
type ButtonGroupProps = {
  layout?: "horizontal" | "vertical" | "split-responsive";
  size?: "sm" | "md" | "lg";
  children: React.ReactNode;
};
```

- komponent nie zmienia semantyki dzieci; opcjonalne `role="group"` wymaga dostępnej nazwy tylko wtedy, gdy wspólne znaczenie nie wynika z formularza;
- przy 320 px `split-responsive` przechodzi w pełną szerokość i nie zmniejsza celów dotykowych;
- przejście układu nie animuje rozmiaru przy `prefers-reduced-motion`.

## DS-ACT-005 — FloatingActionButton

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aab5d62`.
- Library component head: `dc32726c-e29a-8032-8008-b78d8103d0f9`.
- Zakres: warunkowy akcelerator wyłącznie dla mobilnego panelu admina.

### Anatomy i pokrycie

1. kołowy cel dotykowy 56×56 px;
2. jedna wymienna ikona Lucide 24 px;
3. widoczny focus ring poza obrysem;
4. kontekstowa nazwa dostępna i tooltip.

| Oś | Wartości w katalogu |
|---|---|
| `kind` | `add`, `quick-block` |
| `state` | `default`, `pressed`, `focus` |
| `size` | `56` |

Macierz ma kompletne 6 kombinacji. `add` używa `Plus` i etykiety „Dodaj pojazd”; `quick-block` używa `CalendarX` i etykiety „Dodaj niedostępność”. Ikony są dekoracyjne wobec nazwy przycisku.

```ts
type FloatingActionButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  kind: "add" | "quick-block";
  label: string;
};
```

- komponent renderuje natywny `<button>` i zawsze przekazuje `label` jako `aria-label`; tooltip nie zastępuje nazwy dostępnej;
- użycie jest warunkowe: nie zastępuje podpisanej głównej akcji formularza lub dialogu i nie ma wariantu desktopowego;
- pressed używa `motion.fast` 120 ms bez zmniejszania celu dotykowego;
- focus pozostaje widoczny przy reduced motion.

## DS-ACT-006 — CopyButton

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aab5d90`.
- Library component head: `dc32726c-e29a-8032-8008-b78f1ae3eb23`.

### Anatomy i pokrycie

1. natywny przycisk z ikoną Lucide `Copy`, `Check` albo `CircleAlert`;
2. opcjonalna, edytowalna etykieta tekstowa;
3. komunikat zwrotny dostępny dla technologii asystujących;
4. obszar interakcji niezależny od długości kopiowanej wartości.

| Oś | Wartości w katalogu |
|---|---|
| `type` | `icon-only`, `icon+label` |
| `state` | `default`, `copied`, `error` |
| `size` | `sm`, `md` |

Macierz zawiera 8 celowych kombinacji. Oba typy pokazują pełny cykl default/copied/error w bazowym rozmiarze oraz wariant kontrolny w drugim rozmiarze. Nie utworzono pełnego iloczynu 2×3×2, ponieważ anatomia i stan nie zmieniają się wraz z rozmiarem.

### Wymiary i zachowanie

- `icon-only`: `sm=40`, `md=44`; zawsze wymaga kontekstowego `aria-label` i tooltipu;
- `icon+label`: `sm=40`, `md=48`; label pozostaje widoczny;
- copied: ikona `Check`, tekst/nazwa „Skopiowano” i komunikat „Skopiowano do schowka” w `aria-live="polite"`;
- error: ikona `CircleAlert`, tekst „Błąd kopiowania” albo dostępny komunikat „Nie udało się skopiować. Spróbuj ponownie.”;
- feedback jest czasowy, ale ponowne kliknięcie w error ponawia kopiowanie.

```ts
type CopyButtonProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  value: string;
  type?: "icon-only" | "icon+label";
  size?: "sm" | "md";
  label?: string;
};
```

- Clipboard API jest wywoływane dopiero po aktywacji użytkownika; brak wsparcia lub odmowa uprawnień przechodzi do stanu error;
- copied/error nie są przekazywane wyłącznie kolorem;
- `focus-visible` pozostaje niezależny od feedbacku, a reduced motion usuwa przejście ikony bez usuwania komunikatu.

## DS-ACT-007 — MenuTrigger

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aab5dc0`.
- Library component ID: `dc32726c-e29a-8032-8008-b790f880e794`.
- Main instance ID: `dc32726c-e29a-8032-8008-b79026337453`.

### Anatomy i pokrycie

1. natywny `<button>` o celu interakcji 40 albo 44 px;
2. ikona Lucide `EllipsisVertical`, `ChevronDown`/`ChevronUp` albo inicjały
   awatara;
3. widoczny focus ring niezależny od koloru i stanu otwarcia;
4. opcjonalny znacznik rozwinięcia w wariancie avatar.

| Oś | Wartości w katalogu |
|---|---|
| `variant` | `kebab`, `chevron`, `avatar` |
| `state` | `default`, `open`, `focus` |
| `size` | `40`, `44` |

Macierz zawiera 10 celowych kombinacji. Każda anatomia pokazuje pełny cykl default/open/focus, a drugi rozmiar występuje jako wariant kontrolny. Nie utworzono pełnego iloczynu 3×3×2, ponieważ rozmiar nie zmienia semantyki ani zachowania menu.

```ts
type MenuTriggerProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  variant?: "kebab" | "chevron" | "avatar";
  size?: 40 | 44;
  label: string;
  expanded: boolean;
  controls: string;
  avatarLabel?: string;
};
```

- przycisk zawsze przekazuje `aria-haspopup="menu"`, `aria-expanded`, `aria-controls` oraz kontekstowy `aria-label`;
- inicjały avatara są treścią wizualną, ale dostępna nazwa pochodzi z `label`;
- stan open zmienia chevron na skierowany w górę; animacja używa `motion.fast` 120 ms, a reduced motion przełącza ikonę natychmiast;
- zamknięcie przez Escape, focus trap w otwartym menu i powrót fokusu do triggera należą do kontraktu overlay/runtime, nie do osobnego wariantu;
- `kebab` służy do akcji rekordu, `chevron` do sekcji/menu, a `avatar` do menu użytkownika. Nie należy tworzyć kolejnych triggerów dla pojedynczych tras.

## DS-ACT-008 — InlineAction

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aab5df2`.
- Library component ID: `dc32726c-e29a-8032-8008-b792b94515e4`.
- Main instance ID: `dc32726c-e29a-8032-8008-b792890b2518`.

### Anatomy i pokrycie

1. natywny `<button>` o wysokości 40 px;
2. dekoracyjna ikona Lucide `Pencil`, `Trash2` albo `RotateCcw`;
3. edytowalna, zawsze widoczna etykieta `body-sm`;
4. powierzchnia hover albo niezależny focus ring.

| Oś | Wartości w katalogu |
|---|---|
| `variant` | `edit`, `remove`, `retry` |
| `state` | `default`, `hover`, `focus`, `disabled` |

Macierz zawiera 6 celowych kombinacji: edit prezentuje wszystkie cztery stany, a remove i retry mają wariant bazowy. Nie utworzono pełnego iloczynu 3×4, ponieważ stany interakcji nie zmieniają anatomii zależnie od rodzaju akcji.

```ts
type InlineActionProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  variant: "edit" | "remove" | "retry";
  label?: string;
};
```

- domyślne etykiety to odpowiednio „Edytuj”, „Usuń” i „Ponów”; można je doprecyzować kontekstowo, ale nie wolno usuwać widocznego tekstu;
- remove korzysta z semantyki akcji destrukcyjnej, lecz nadal jest rozpoznawalny przez ikonę i tekst, a nie sam kolor;
- disabled używa natywnego atrybutu `disabled`; nie jest focusowalny ani aktywowalny i nie wymaga osobnego `aria-disabled` przy natywnym buttonie;
- hover oraz focus korzystają z tokenów `action.tertiary.hover` i `focus.ring`; focus nie może znikać przy reduced motion;
- komponent służy do krótkich działań wewnątrz treści, alertu lub wiersza listy. Główne akcje strony pozostają komponentem Button.

## DS-AUT-001 — LoginForm

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf308979da32`.
- Library component ID: `dc32726c-e29a-8032-8008-b796ce2f7d38`.
- Main instance ID: `dc32726c-e29a-8032-8008-b79530e662c8`.

### Anatomy i pokrycie

1. nagłówek i neutralna informacja o chronionym panelu;
2. instancja `FormField` dla e-maila z `autocomplete="username"`;
3. instancja `FormField` dla hasła z
   `autocomplete="current-password"`;
4. instancja Button „Pokaż”/„Ukryj” sterująca widocznością hasła;
5. instancja głównego Buttona submit;
6. warunkowa instancja TextLink do resetu hasła;
7. instancja Alert dla invalid, rate-limited i session-expired.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `state` | `default`, `loading`, `invalid`, `rate-limited`, `session-expired` |

Macierz zawiera 6 celowych kombinacji: mobile/default potwierdza kompozycję full-width, a desktop pokazuje komplet stanów w karcie 480 px. Nie utworzono pełnego iloczynu 2×5, ponieważ zachowanie stanów nie zmienia się wraz z viewportem.

```ts
type LoginFormState =
  | "default"
  | "loading"
  | "invalid"
  | "rate-limited"
  | "session-expired";

type LoginFormProps = {
  state?: LoginFormState;
  resetEnabled?: boolean;
  rateLimitRemainingSeconds?: number;
  returnTo?: string;
  onSubmit: (credentials: { email: string; password: string }) => void;
};
```

- formularz nie zawiera rejestracji ani informacji potwierdzającej istnienie podanego konta;
- invalid używa neutralnego komunikatu „Adres e-mail lub hasło są nieprawidłowe” oraz wiąże błędy z oboma polami;
- loading ustawia `aria-busy="true"`, blokuje ponowny submit i zachowuje tekst „Logowanie…”;
- rate-limited wyłącza pola i submit do końca rzeczywistego odliczania; sam komponent nie oblicza limitu i nie zapisuje danych logowania;
- session-expired prosi o ponowne logowanie i po sukcesie może użyć `returnTo` wyłącznie dla wcześniej zweryfikowanej, bezpiecznej trasy;
- kontrolka widoczności hasła jest przyciskiem z `aria-pressed` i `aria-controls`, nie zmianą typu pola bez dostępnej nazwy;
- link resetu jest renderowany tylko wtedy, gdy przepływ SHOULD/P1 jest aktywny. Brak aktywnego resetu nie pozostawia martwego CTA;
- wariant Penpota opisuje interfejs. Nie jest dowodem działającej sesji, rate-limitingu, autoryzacji serwerowej ani ochrony przed brute force.

## DS-AUT-002 — ResetPasswordRequest

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf308979dac7`.
- Library component ID: `dc32726c-e29a-8032-8008-b79aa674cb60`.
- Main instance ID: `dc32726c-e29a-8032-8008-b7993092c22b`.

### Anatomy i pokrycie

1. nagłówek wyjaśniający odzyskiwanie dostępu;
2. jedna instancja `FormField` dla e-maila z `autocomplete="username"`;
3. instancja głównego Buttona submit;
4. instancja TextLink powrotu do `/admin/login`;
5. instancja Alert dla sent-neutral, rate-limited i error.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `state` | `default`, `loading`, `sent-neutral`, `rate-limited`, `error` |

Macierz zawiera 6 celowych kombinacji: mobile/default potwierdza kompozycję full-width, a desktop pokazuje komplet stanów w karcie 480 px. Nie utworzono pełnego iloczynu 2×5, ponieważ zachowanie stanów nie zależy od viewportu.

```ts
type ResetPasswordRequestState =
  | "default"
  | "loading"
  | "sent-neutral"
  | "rate-limited"
  | "error";

type ResetPasswordRequestProps = {
  state?: ResetPasswordRequestState;
  rateLimitRemainingSeconds?: number;
  onSubmit: (email: string) => void;
  onBackToLogin: () => void;
};
```

- po wysłaniu zawsze pokazuj tę samą neutralną informację: „Jeśli konto z tym adresem istnieje, wyślemy instrukcję resetu hasła”;
- loading ustawia `aria-busy="true"`, blokuje pole i ponowny submit oraz zachowuje tekst „Wysyłanie…”;
- rate-limited wyłącza pole i submit do końca rzeczywistego odliczania; sam komponent nie oblicza limitu;
- error opisuje błąd sieci lub serwera i pozwala ponowić próbę bez ujawniania stanu konta;
- komponent i trasa są warunkowym SHOULD/P1. Gdy reset nie jest aktywny, `LoginForm` nie renderuje prowadzącego do niego linku;
- wariant Penpota nie dowodzi wysłania e-maila, działania tokenu ani ochrony endpointu przed nadużyciem — te zachowania wymagają testów runtime.

## DS-AUT-003 — SetNewPasswordForm

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf30d90e4c55`.
- Library component ID: `dc32726c-e29a-8032-8008-b79fea09e9fd`.
- Main instance ID: `dc32726c-e29a-8032-8008-b79ec68cd663`.

### Anatomy i pokrycie

1. nagłówek i informacja o ustawieniu hasła administratora;
2. instancja `FormField` nowego hasła z `autocomplete="new-password"`;
3. instancja `DS-AUT-004 PasswordStrength`;
4. instancja `FormField` potwierdzenia hasła;
5. instancja głównego Buttona;
6. TextLink powrotu do logowania albo Alert dla wygasłego tokenu i sukcesu.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `state` | `valid`, `mismatch`, `loading`, `expired`, `success` |

Macierz zawiera 6 celowych kombinacji: mobile/valid potwierdza pełną kompozycję 342 px, a desktop pokazuje komplet stanów w karcie 480 px. Poziomy siły nie tworzą dodatkowej osi, ponieważ należą do zagnieżdżonego `PasswordStrength`.

```ts
type SetNewPasswordFormState =
  | "valid"
  | "mismatch"
  | "loading"
  | "expired"
  | "success";

type SetNewPasswordFormProps = {
  state?: SetNewPasswordFormState;
  strength: PasswordStrengthProps;
  onSubmit: (value: { password: string; confirmation: string }) => void;
  onRequestNewLink: () => void;
  onGoToLogin: () => void;
};
```

- oba pola są typu password, mają `autocomplete="new-password"` i pozostają powiązane z własnymi komunikatami pomocy lub błędu;
- mismatch oznacza pole potwierdzenia przez tekst „Hasła muszą być identyczne” oraz blokuje submit;
- loading ustawia `aria-busy="true"`, blokuje oba pola i ponowny submit;
- expired nie pokazuje aktywnych pól hasła. Jedno główne CTA prowadzi do ponownego żądania linku, a drugie do logowania;
- success pokazuje status i jedno główne CTA do `/admin/login`; token należy po użyciu unieważnić po stronie serwera;
- statyczny wariant nie dowodzi ważności tokenu, zapisu hasła, przekierowania ani działania menedżera haseł — wymagają one testów runtime.

## DS-AUT-004 — PasswordStrength

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf308979db2c`.
- Library component ID: `dc32726c-e29a-8032-8008-b79d8e789c63`.
- Main instance ID: `dc32726c-e29a-8032-8008-b79cccdc1877`.

### Anatomy i pokrycie

1. jawna etykieta „Siła hasła: Słabe/Średnie/Mocne”;
2. pasek postępu o wartości 25%, 75% albo 100%;
3. cztery tekstowe kryteria ze stanem spełnione/oczekujące;
4. kontener statusu z `aria-live="polite"`.

| Oś | Wartości w katalogu |
|---|---|
| `strength` | `weak`, `medium`, `strong` |

Komponent ma jedną responsywną anatomię skalowaną w zakresie 342–400 px. Nie dodano osi viewport, ponieważ mobile i desktop używają tej samej listy i tego samego zachowania.

```ts
type PasswordStrengthLevel = "weak" | "medium" | "strong";

type PasswordStrengthProps = {
  level: PasswordStrengthLevel;
  criteria: {
    minLength: boolean;
    letterCase: boolean;
    number: boolean;
    specialCharacter: boolean;
  };
};
```

- stan wynika równocześnie z etykiety, tekstowej checklisty i długości paska; kolor nie jest jedynym nośnikiem informacji;
- komponent prezentuje wynik walidacji przekazany przez formularz i sam nie ustala polityki ani nie ocenia hasła;
- zmianę poziomu należy ogłaszać bez przerywania wpisywania; `aria-live` nie może odczytywać całej listy po każdym znaku;
- rzeczywistą walidację, kolejność komunikatów i działanie czytnika należy potwierdzić w demonstratorze.

## DS-AUT-005 — TwoFactorForm

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf30d90e4d02`.
- Library component head: `dc32726c-e29a-8032-8008-b7a4bdbeed42`.
- MFA obu ról jest obowiązkowe w MVP 3.1. Rozdzielenie posiadanego kodu odzyskania, ręcznej procedury po utracie wszystkich czynników i niepewnego wyniku opisuje [kontrakt odzyskiwania](mfa-recovery.md). Historyczne oznaczenie P1 w katalogu wariantów nie określa priorytetu produktu.

### Anatomy i pokrycie

1. nagłówek jawnie oznaczający obowiązkową weryfikację MFA;
2. mobile TOTP: rzeczywista instancja `FormField` z `inputMode="numeric"` i
   `autocomplete="one-time-code"`;
3. desktop TOTP: jedna logiczna kontrolka przedstawiona jako sześć segmentów;
4. recovery: rzeczywista instancja `FormField` na jednorazowy kod;
5. rzeczywiste instancje Buttona i TextLink do zatwierdzenia oraz zmiany trybu;
6. tekstowe stany błędu i limitu prób z `aria-live="polite"`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `mode` | `totp`, `recovery` |
| `state` | `default`, `error`, `retry` |

Macierz zawiera 6 celowych kombinacji: mobile/TOTP/default potwierdza natywną klawiaturę numeryczną, desktop pokazuje TOTP default/error/retry oraz recovery default/error. Nie utworzono pełnego iloczynu 2×2×3, ponieważ te same stany korzystają ze wspólnej responsywnej anatomii.

```ts
type TwoFactorMode = "totp" | "recovery";
type TwoFactorState = "default" | "error" | "retry";

type TwoFactorFormProps = {
  mode: TwoFactorMode;
  state?: TwoFactorState;
  retryRemainingSeconds?: number;
  onSubmit: (code: string) => void;
  onSwitchMode: (mode: TwoFactorMode) => void;
  onRetry: () => void;
};
```

- sześć segmentów desktopowych jest prezentacją jednej wartości: implementacja musi obsłużyć wklejenie całego kodu, Backspace, strzałki i czytelną nazwę grupy, bez sześciokrotnego ogłaszania pola;
- TOTP odnawia się w aplikacji uwierzytelniającej. Nie dodajemy kanału SMS ani e-mail tylko po to, aby zrealizować „resend”; retry oznacza ponowienie próby po rzeczywistym limicie serwera;
- kod odzyskiwania jest jednorazowy, nie powinien trafiać do logów ani analityki, a błąd nie ujawnia dodatkowych danych konta;
- komponent nie tworzy osobnej trasy ani ekranowej klawiatury. Starsze umiejscowienie w `ADM-15` nie odracza obowiązkowego MFA obu ról;
- statyczny wariant Penpota nie dowodzi konfiguracji TOTP, rate-limitingu, ważności kodu ani bezpiecznego zużycia recovery code — wymagają testów runtime i serwerowych.

## DS-AUT-006 — AccountSummary

- Library component: `dc32726c-e29a-8032-8008-b7a759fd1949`.
- Main board: `dc32726c-e29a-8032-8008-b7a724aeea33`.
- Kontrolny podgląd mobile 342 px: `7cf0d39f-ce5c-80f6-8008-cf30d90e4dee`.

### Anatomy i pokrycie

1. avatar z inicjałami jako opcjonalny skrót wizualny;
2. nazwa administratora i neutralny opis profilu;
3. e-mail z jawną etykietą „Tylko do odczytu”;
4. rola z jawną etykietą „Tylko do odczytu”;
5. informacja, że dane konta są zarządzane po stronie serwera.

To jedna responsywna anatomia działająca jako karta 342 px na mobile i panel 440 px na desktopie. `profile`, `email` i `role` są współwystępującą treścią, nie trzema trybami, dlatego nie utworzono sztucznej osi wariantów.

```ts
type AccountSummaryProps = {
  name: string;
  email: string;
  roleLabel: string;
  avatarInitials?: string;
};
```

- e-mail i rola są tekstem tylko do odczytu, nie polami formularza i nie sugerują możliwości edycji;
- komponent nie zawiera sesji, zmiany hasła, 2FA ani wylogowania — te funkcje mają odrębne odpowiedzialności w `ADM-15`/`ADM-16`;
- inicjały muszą wynikać z nazwy, a przy jej braku można użyć neutralnej ikony użytkownika; nie pobieramy zewnętrznego avatara bez decyzji produktowej;
- nie przekazuj do klienta dodatkowych danych konta ani uprawnień poza nazwą roli potrzebną w interfejsie. Autoryzacja nadal jest wykonywana na serwerze.

## DS-AUT-007 — ChangePasswordForm

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf30d90e4e0c`.
- Library component head: `dc32726c-e29a-8032-8008-b7aa33bffa97`.

### Anatomy i pokrycie

1. `FormField` aktualnego hasła z `autocomplete=current-password`;
2. `FormField` nowego hasła z `autocomplete=new-password`;
3. współdzielony `PasswordStrength`;
4. `FormField` potwierdzenia z `autocomplete=new-password`;
5. główny `Button` zapisu;
6. komunikat formularza, informacja o sesjach i warunkowy `TextLink`.

| Oś | Wartości w katalogu |
|---|---|
| `state` | `default`, `reauth-error`, `validation-error`, `loading`, `success`, `server-error` |

Komponent ma jedną responsywną anatomię dla szerokości 342–560 px, z limitem 640 px w ekranie. Nie powstała osobna oś `viewport`: pola current/new/confirm są anatomią formularza, a nie wariantami ani dodatkowymi ekranami.

```ts
type ChangePasswordState =
  | "default"
  | "reauth-error"
  | "validation-error"
  | "loading"
  | "success"
  | "server-error";

type ChangePasswordFormProps = {
  state: ChangePasswordState;
  strength: "weak" | "medium" | "strong";
  onSubmit: (values: {
    currentPassword: string;
    newPassword: string;
    confirmation: string;
  }) => void;
  onOpenSessions: () => void;
};
```

- serwer ponownie potwierdza tożsamość aktualnym hasłem; sam stan interfejsu nie jest autoryzacją;
- słabe lub różne hasła mają jawny tekst błędu i blokują zapis. Stan nie może zależeć wyłącznie od koloru;
- `loading` ustawia `aria-busy`, blokuje pola i ponowne wysłanie; błąd serwera zachowuje wpisane wartości i umożliwia ponowienie;
- po sukcesie formularz znika, a użytkownik otrzymuje komunikat oraz link do aktywnych sesji. Hasła nie trafiają do analityki, logów ani audytu;
- zagnieżdżone instancje Penpota nie przeliczyły wewnętrznych constraints przy drugim poziomie komponentów. Implementacja musi nadać polom `width: 100%`; statyczna makieta nie dowodzi bezpiecznej zmiany hasła po stronie serwera.

## DS-AUT-008 — ActiveSessionList

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf30d90ea1d8`.
- Library component head: `dc32726c-e29a-8032-8008-b7af17296484`.

### Anatomy i pokrycie

1. karta bieżącej sesji z ikoną i tekstem „Bieżąca sesja”, bez akcji kończącej;
2. responsywne karty pozostałych sesji z urządzeniem, lokalizacją, ostatnią
   aktywnością i skróconą informacją techniczną;
3. destructive `Button` otwierający potwierdzenie `OVR-19` dla jednej sesji;
4. destructive `Button` kończący wszystkie pozostałe sesje po potwierdzeniu;
5. komunikat błędu zachowujący listę i umożliwiający ponowienie.

| Oś | Wartości w katalogu |
|---|---|
| `state` | `default`, `terminating-one`, `terminating-all`, `server-error` |

Jedna lista kart działa od 342 do 560 px. Desktop może używać kart zgodnie ze SPEC, więc nie ma osobnej osi `viewport`. `current/other` oznacza role rekordów w tej samej liście, a nie warianty komponentu. Brak pozostałych sesji jest przypadkiem danych — renderowana jest tylko karta bieżącej sesji.

```ts
type AdminSession = {
  id: string;
  current: boolean;
  deviceLabel: string;
  locationLabel?: string;
  lastActiveAt: string;
  technicalSummary: string;
};

type ActiveSessionListProps = {
  sessions: AdminSession[];
  state: "default" | "terminating-one" | "terminating-all" | "server-error";
  pendingSessionId?: string;
  onRequestTerminate: (sessionId: string) => void;
  onRequestTerminateOthers: () => void;
};
```

- bieżąca sesja nigdy nie otrzymuje akcji zakończenia i nie jest objęta akcją „wszystkie pozostałe”; uprawnienie i ponowne uwierzytelnienie sprawdza serwer;
- każda destrukcyjna akcja najpierw otwiera `OVR-19`. Stan `loading` blokuje pozostałe przyciski i zapobiega podwójnemu wysłaniu;
- błąd serwera nie usuwa rekordów z listy. Sukces usuwa wyłącznie sesje potwierdzone przez aktualną odpowiedź serwera;
- czas prezentujemy lokalnie z danych UTC. Informacja techniczna jest skrócona i nie może zawierać tokenu sesji, pełnego sekretu ani zbędnych danych;
- testowe adresy należą do zakresów dokumentacyjnych. Statyczny Penpot nie dowodzi unieważnienia sesji, autoryzacji ani ochrony przed wyścigiem zapisu.

## DS-AUT-009 — ReauthenticationDialog

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf30d90ea2a5`.
- Library component head: `dc32726c-e29a-8032-8008-b7b2a1a12ea9`.

### Anatomy i pokrycie

1. responsywny shell dialogu z tytułem, opisem i jawnym statusem operacji
   chronionej;
2. dla hasła: realny `FormField` z `autocomplete=current-password`;
3. realne `Button` potwierdzenia i anulowania;
4. dla konta z 2FA: realna instancja `DS-AUT-005 TwoFactorForm`, bez nowego
   pola kodu i bez osobnej trasy.

| Oś | Wartości w katalogu |
|---|---|
| `method` | `password`, `totp` |
| `state` | `default`, `error`, `loading` |

Macierz jest celowo rzadka: password/default, password/error, password/loading i totp/default. Błędy oraz limit prób TOTP pozostają odpowiedzialnością `DS-AUT-005`, więc nie są dublowane w tym komponencie. Jedna anatomia dialogu działa przy 342 i 560 px; mobile używa pełnego dialogu, a desktop modalu. Runtime wybiera właściwy wariant viewportu `TwoFactorForm`.

```ts
type ReauthenticationDialogProps = {
  open: boolean;
  method: "password" | "totp";
  state: "default" | "error" | "loading";
  protectedActionLabel: string;
  onConfirmPassword: (currentPassword: string) => void;
  onConfirmTotp: (code: string) => void;
  onCancel: () => void;
};
```

- element ma `role="dialog"`, `aria-modal="true"`, nazwę z tytułu i opis powiązany przez `aria-describedby`; po otwarciu fokus trafia do pola;
- Tab pozostaje w dialogu, Escape działa jak „Anuluj”, a po zamknięciu fokus wraca do kontrolki, która rozpoczęła operację;
- `loading` ustawia `aria-busy`, blokuje pole, anulowanie i ponowne wysłanie; błąd hasła jest jawny przy polu, ale nie ujawnia dodatkowych danych konta;
- pozytywna odpowiedź interfejsu nie jest dowodem autoryzacji. Serwer ponownie sprawdza sesję i wydaje krótko ważny dowód dla konkretnej operacji;
- hasło, kod TOTP i dowód re-auth nie trafiają do logów, analityki, URL ani publicznego cache. Statyczny Penpot nie dowodzi focus trapu ani walidacji serwerowej — wymagają testów runtime;
- wspólny `Dialog` nie ma slotu na złożony formularz, dlatego wymagany komponent domenowy posiada minimalny shell, ale ponownie używa istniejących pól, przycisków i `TwoFactorForm` zamiast tworzyć ich kopie.

## DS-AUT-010 — PermissionState

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf30d90ea37e`.
- Library component head: `dc32726c-e29a-8032-8008-b7b664828721`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7b636f4ba2d` oraz `dc32726c-e29a-8032-8008-b7b66497dad6`.

### Anatomy i pokrycie

1. wspólna ikona tarczy, jawna etykieta stanu, tytuł i krótki opis;
2. jedna bezpieczna akcja zależna od typu stanu;
3. informacja, że prywatna treść albo szczegóły chronionego zasobu nie są
   ujawniane.

| Oś | Wartości w katalogu |
|---|---|
| `type` | `unauthenticated`, `forbidden` |

Nie ma osi `viewport`: ten sam Auto Layout działa w masterze 560 px i w rzeczywistych instancjach 342 px. Nie ma też wariantu `session-expired`, bo wygaśnięcie sesji obsługuje `OVR-14 SessionExpiredDialog`, a pełnostronicowy fallback korzysta z `unauthenticated`.

```ts
type PermissionStateProps = {
  type: "unauthenticated" | "forbidden";
  onLogin?: () => void;
  onBackToDashboard?: () => void;
};
```

- `unauthenticated` nie renderuje prywatnych danych w tle i pokazuje wyłącznie główną akcję „Przejdź do logowania”; powrót do poprzedniej trasy następuje dopiero po nowym, poprawnym uwierzytelnieniu i ponownej autoryzacji;
- `forbidden` może być złożony w zachowanym shellu aktywnej sesji, ale nie ujawnia nazwy ani danych chronionego zasobu. Jedyna akcja prowadzi do dashboardu;
- obie akcje są rzeczywistymi instancjami `DS-ACT-001 Button`, mają wysokość 48 px i nie tworzą osobnych komponentów nawigacyjnych;
- implementacja używa nagłówka strony i `role="status"` albo semantycznej sekcji nazwanej przez tytuł. Zmiana trasy przenosi fokus na nowy nagłówek;
- statyczny Penpot potwierdza hierarchię, reflow i bezpieczne copy, lecz nie dowodzi autoryzacji serwerowej ani bezpiecznego przywrócenia trasy.

## DS-FRM-002 — TextInput

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf2791de2383`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afce9870bf30`.

### Anatomy

1. kontener kontrolki z Auto Layout;
2. edytowalny `Value` albo `Placeholder`;
3. obramowanie i powierzchnia powiązane z tokenami.

### Osie i pokrycie

| Oś | Wartości w katalogu |
|---|---|
| `type` | `text` |
| `state` | `empty`, `filled`, `hover`, `focus`, `error`, `disabled`, `readonly` |

Typy `email`, `tel` i `url` korzystają z tej samej anatomii, ale nie mają jeszcze oddzielnych wariantów Penpot. Nie należy oznaczać ich jako wykonanych.

### Tokeny i wymiary

- wysokość: `input.height` = 48 px;
- padding: `input.padding.x`;
- radius: `radius.sm`;
- powierzchnia: `surface.default`, `surface.disabled`, `surface.subtle`;
- border: `border.default`, `border.strong`, `border.critical`;
- focus: `focus.ring` + `border.width.active`.

### Kontrakt implementacyjny

```ts
type TextInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "size"
> & {
  invalid?: boolean;
};
```

- Typ natywny wynika z danych: `text`, `email`, `tel` albo `url`.
- `readonly` i `disabled` są rozłączne semantycznie.
- Wartości i komunikaty nie mogą być ukryte wyłącznie w placeholderze.

## DS-FRM-003 — SearchInput

- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d6712924b`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d6712924e`.
- Library component head: `368ee0a4-28c8-80cb-8008-b824f8b104af`.

| Oś | Wartości utworzone |
|---|---|
| `affordance` | `clear`, `shortcut` |
| `state` | `default`, `searching`, `no-match` |

Macierz ma tylko cztery sensowne kombinacje: `clear/default`, `clear/searching`, `clear/no-match` i `shortcut/default`. Nie istnieją sztuczne warianty `shortcut/searching` ani `shortcut/no-match`. Viewport nie jest osią: mobile korzysta z pełnej szerokości, a desktop z zakresu 280–400 px.

### Anatomy

1. dekoracyjna ikona Lucide `Search`;
2. natywne pole `search` z edytowalną wartością albo placeholderem;
3. przycisk „Wyczyść” 44×44 px, spinner albo desktopowy skrót `/`;
4. tekstowy status braku wyników tylko w stanie `no-match`.

```ts
type SearchInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "role"
> & {
  label: string;
  state?: "default" | "searching" | "no-match";
  showShortcut?: boolean;
  onClear: () => void;
};
```

- Wrapper wyszukiwarki ma `role="search"`; pole używa `type="search"` i dostępnej etykiety. Placeholder nie zastępuje nazwy kontrolki.
- `Escape` albo przycisk czyszczenia opróżnia wartość i pozostawia fokus w polu. Ikona Search jest dekoracyjna.
- `searching` i `no-match` są ogłaszane przez `aria-live="polite"` bez przenoszenia fokusu. Spinner ma tekstową nazwę stanu poza wizualnym polem.
- Skrót `/` służy tylko jako desktopowa podpowiedź i nie jest dodatkowym interaktywnym celem.
- Zmiana stanu używa `motion.fast` 120 ms. Przy reduced motion spinner może zostać zastąpiony statyczną ikoną i tekstem „Wyszukiwanie…”.
- Kontrolne instancje 320 px, 390 px i desktop 360 px nie mają overflow; widoczny tekst ma 14 lub 16 px, a przycisk czyszczenia zachowuje 44×44 px.
- Cztery człony używają prawdziwych instancji `TextInput`; stany clear składają prawdziwy `IconButton`, a searching prawdziwy `Spinner`.

## DS-FRM-004 — PasswordInput

- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d6712929f`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d671292a2`.
- Library component head: `368ee0a4-28c8-80cb-8008-b82812fd95c2`.

| Oś | Wartości utworzone |
|---|---|
| `visibility` | `hidden`, `shown` |
| `state` | `default`, `strength`, `error`, `caps-lock` |

Macierz ma pięć sensownych kombinacji: `hidden/default`, `shown/default`, `hidden/strength`, `hidden/error` i `hidden/caps-lock`. Nie powstały sztuczne warianty widocznego hasła dla każdego komunikatu. `autocomplete` oraz viewport są właściwościami implementacyjnymi, a nie osiami wyglądu.

### Anatomy

1. natywne pole `password` albo `text` po świadomym ujawnieniu wartości;
2. przycisk `Pokaż hasło` / `Ukryj hasło` o celu 44×44 px;
3. rzeczywisty `DS-FBK-007 ProgressBar` z tekstowym wynikiem siły;
4. rzeczywisty `DS-FBK-002 InlineMessage` dla błędu albo Caps Lock.

```ts
type PasswordInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "autoComplete"
> & {
  label: string;
  visibility?: "hidden" | "shown";
  state?: "default" | "strength" | "error" | "caps-lock";
  autoComplete: "current-password" | "new-password";
  strength?: { value: number; label: string };
  error?: string;
  onVisibilityChange: (visibility: "hidden" | "shown") => void;
};
```

- Logowanie i pole aktualnego hasła używają `autocomplete="current-password"`; nowe hasło oraz jego potwierdzenie używają `autocomplete="new-password"`.
- Implementacja nie blokuje wklejania ani działania menedżera haseł.
- Przycisk ujawnienia ma zmienny `aria-label`, `aria-pressed` oraz pozostawia fokus na sobie. Zmiana widoczności nie czyści wartości.
- Błąd jest powiązany przez `aria-describedby` i `aria-invalid=true`; komunikat pozostaje po utracie fokusu do chwili poprawienia wartości.
- Siła hasła ma tekstową etykietę, więc nie jest przekazywana wyłącznie kolorem lub długością paska. Polityka z PRD wymaga co najmniej 12 znaków albo równoważnej polityki opartej na sile.
- Informacja Caps Lock jest pomocnicza i nie zastępuje walidacji. Nie jest zapisywana ani wysyłana.
- Hasło, tokeny i sekrety nie mogą trafić do logów, analityki, HTML serwera ani propsów możliwych do serializacji.
- Kontrolne instancje 320, 390 i 400 px nie mają overflow. `InlineMessage` i `ProgressBar` zmieniają szerokość razem z komponentem, a pokaż/ukryj zachowuje 44×44 px.
- Wszystkie zależności pozostają prawdziwymi instancjami bibliotecznymi.

## DS-FRM-005 — Textarea

- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d6712931d`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d67129320`.
- Library component head: `368ee0a4-28c8-80cb-8008-b82a461e6ede`.

| Oś | Wartości utworzone |
|---|---|
| `mode` | `short`, `long`, `autosize`, `markdown` |
| `state` | `default`, `counter`, `error`, `disabled` |

Macierz zawiera siedem celowych kombinacji: komplet czterech stanów dla `short` oraz `long/default`, `autosize/counter` i `markdown/counter`. Nie powstał sztuczny iloczyn 4×4 ani oś viewport.

### Anatomy i odpowiedzialność

1. natywny, edytowalny `<textarea>` o wysokości zależnej od trybu;
2. rzeczywisty `DS-FRM-029 CharacterCounter` w stanach z licznikiem;
3. rzeczywisty `DS-FBK-002 InlineMessage` w stanie błędu;
4. label, optional/required i ogólny hint należą do `FormField`, nie są
   kopiowane do Textarea;
5. `markdown` pokazuje surową składnię; toolbar i podgląd pozostają
   odpowiedzialnością `DS-FRM-024 MarkdownEditor`.

```ts
type TextareaProps = Omit<
  React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "rows"
> & {
  label: string;
  mode?: "short" | "long" | "autosize" | "markdown";
  state?: "default" | "counter" | "error" | "disabled";
  currentLength?: number;
  maxLength?: number;
  error?: string;
};
```

- `short` ma `min-height: 120px`, `long` 240 px; `autosize` rośnie od 120 do 320 px, a następnie przewija zawartość.
- Ręczne resize może być dostępne na desktopie, ale nie pozwala zejść poniżej 120 px. Mobile nie zależy od uchwytu resize.
- Błąd pozostaje widoczny do poprawy, ustawia `aria-invalid=true` i jest połączony przez `aria-describedby`. Licznik przekazuje `current/max`, ale nie zastępuje walidacji.
- Disabled używa natywnego `disabled`; readonly, jeśli potrzebny, pozostaje osobnym stanem semantycznym i nie może być udawany przez disabled.
- Powierzchnia i obramowanie są powiązane z tokenami semantycznymi. Dla części starszych źródeł API Penpota nie utrwaliło wiązania radius/text-color; jawny fallback to `radius.sm` = 8 px oraz zatwierdzone wartości palety.
- Instancje 320, 390 i 400 px wypełniają kontener. Pierwszy audyt wykrył szerokość tekstu 336 px w instancji 320 px; ustawiono dziecko Flex na `fill`, a ponowny audyt zwrócił zero overflow.
- Markdown pozostaje jawnie surowym tekstem, bez dublowania `MarkdownEditor`.

## DS-FRM-006 — NumberInput

- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d67129368`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d6712936b`.
- Library component head: `368ee0a4-28c8-80cb-8008-b82c35580fb8`.

| Oś | Wartości utworzone |
|---|---|
| `kind` | `integer`, `currency`, `year`, `order` |
| `state` | `default`, `min-max`, `step`, `error` |

Macierz zawiera siedem celowych kombinacji: komplet stanów dla `integer` oraz po jednym stanie `default` dla `currency`, `year` i `order`. Nie powstał pełny iloczyn 4×4 ani oś viewport.

### Anatomy i odpowiedzialność

1. jawny label, edytowalna wartość i rzeczywista instancja `TextInput`
   o wysokości 48 px;
2. rzeczywisty `DS-FBK-002 InlineMessage`: informacyjny dla ograniczeń i kroku,
   walidacyjny dla błędu;
3. metadane `type=number`, `inputmode`, `min`, `max`, `step` i
   `aria-invalid` jako kontrakt implementacyjny;
4. `currency` odpowiada tylko za semantykę liczby dziesiętnej; prefiksy,
   sufiksy PLN i „od” należą wyłącznie do `DS-FRM-019 CurrencyField`;
5. komponent nie oblicza ani nie zapisuje wartości biznesowej.

```ts
type NumberInputKind = "integer" | "currency" | "year" | "order";
type NumberInputState = "default" | "min-max" | "step" | "error";

type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "inputMode"
> & {
  label: string;
  kind?: NumberInputKind;
  state?: NumberInputState;
  min?: number;
  max?: number;
  step?: number;
  error?: string;
};
```

- Implementacja używa `type="number"`; `currency` ustawia `inputmode="decimal"`, pozostałe tryby `inputmode="numeric"`.
- Mobile używa systemowej klawiatury numerycznej i pełnej szerokości kontenera. Desktop zachowuje kompaktową szerokość wynikającą z formularza. Viewport nie zmienia logiki ani nie tworzy wariantu.
- `min`, `max` i `step` ograniczają kontrolkę w przeglądarce, ale te same reguły muszą być sprawdzane po stronie serwera. Błąd ustawia `aria-invalid=true` i łączy pole z komunikatem przez `aria-describedby`.
- Rok jest czterocyfrową liczbą całkowitą, a kolejność nieujemną liczbą całkowitą. Szczegółowe granice pochodzą z reguł domenowych, nie z komponentu.
- Instancje mają 288 px w ramie 320 px, 358 px w ramie 390 px i kompaktowe 240 px na desktopie. Wszystkie kontrolki zachowują 48 px wysokości.

## DS-FRM-001 — FormField

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf2791de2395`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afceec4d1362`.
- Zagnieżdżona kontrolka jest rzeczywistą instancją `TextInput`.

### Anatomy

1. `Label`;
2. `Control / TextInput`;
3. `Support / Hint` albo `Support / Error`.

### Osie i pokrycie

| Oś | Wartości w katalogu |
|---|---|
| `state` | `default`, `focus`, `error`, `disabled` |
| `support` | `hint`, `error` |
| `required` | `true`, `false` |

Wariant counter oraz jawna etykieta optional pozostają do dodania.

### Kontrakt implementacyjny

```ts
type FormFieldProps = {
  id: string;
  label: string;
  required?: boolean;
  optionalLabel?: string;
  hint?: string;
  error?: string;
  counter?: { current: number; max: number };
  children: React.ReactElement;
};
```

- `label` jest powiązany z kontrolką przez `htmlFor`/`id`.
- `hint` i `error` otrzymują stabilne ID, a kontrolka używa `aria-describedby`.
- Błąd ma `aria-invalid=true`; dynamiczne zgłoszenie używa odpowiedniego regionu live, bez wielokrotnego odczytywania przy każdym znaku.
- Rezerwacja miejsca na pomoc/błąd może ograniczać skoki layoutu, ale nie może tworzyć pustej, ogłaszanej treści.

## DS-FBK-001 — Alert

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf29549c6b1b`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afcf49e41ed5`.

### Anatomy

1. ikona znaczeniowa;
2. `Title`;
3. `Description`;
4. opcjonalny `Action`;
5. opcjonalny `Dismiss`.

### Osie i pokrycie

| Oś | Wartości w katalogu |
|---|---|
| `tone` | `info`, `success`, `warning`, `error` |
| `action` | `none`, `link`, `retry` |
| `dismissible` | `false`, `true` |

Każdy wariant używa ikony, tekstu i obramowania; kolor nie jest jedynym nośnikiem statusu.

### Kontrakt implementacyjny

```ts
type AlertProps = {
  tone: "info" | "success" | "warning" | "error";
  title: string;
  children?: React.ReactNode;
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
};
```

- `role=alert` tylko dla błędów wymagających natychmiastowej uwagi.
- Informacje i potwierdzenia domyślnie używają `role=status` albo neutralnego regionu, zależnie od kontekstu.
- Dismiss ma dostępną nazwę odnoszącą się do konkretnego komunikatu.
- Krytyczny błąd nie znika automatycznie.
- Wejście/wyjście: opacity + najwyżej niewielkie przesunięcie w `motion.base`; reduced motion używa wyłącznie opacity albo zmiany bez animacji.

## DS-FBK-002 — InlineMessage

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aabbf87`.
- Library component head: `dc32726c-e29a-8032-8008-b7b8e723bae2`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7b8d219ebb2`, `dc32726c-e29a-8032-8008-b7b8e75472f8` oraz `dc32726c-e29a-8032-8008-b7b93048ad7e`.

### Anatomy i pokrycie

1. jedna semantyczna ikona 20/24 px;
2. edytowalny komunikat 14 px, który może zawinąć się pod kontrolką;
3. wspólny Auto Layout o minimalnej wysokości przykładu 48 px i odstępie 8 px.

| Oś | Wartości w katalogu |
|---|---|
| `tone` | `hint`, `validation`, `success` |

Viewport nie jest osią wariantu. Ta sama anatomia działa pod polem 360 px i w rzeczywistych instancjach 280 px. Znaczenie przekazują jednocześnie ikona i tekst; odcień nie jest jedynym nośnikiem informacji.

```ts
type InlineMessageProps = {
  id: string;
  tone: "hint" | "validation" | "success";
  children: React.ReactNode;
};
```

- `hint` otrzymuje stabilne `id`, a kontrolka wskazuje je przez `aria-describedby`; neutralna pomoc nie używa regionu live;
- `validation` jest powiązane z `aria-invalid=true`. `role="alert"` albo `aria-live="assertive"` stosuje się dopiero po pojawieniu się błędu, bez ponawiania ogłoszenia przy każdym znaku;
- `success` może używać `role="status"` i `aria-live="polite"`, jeśli potwierdzenie następuje asynchronicznie. Nie zastępuje globalnego Toast;
- tekst ma szerokość fill i może zwiększyć wysokość w implementacji; nie wolno ucinać długiego polskiego komunikatu ani opierać go wyłącznie na tooltipie;
- pojawienie może użyć opacity w `motion.fast` 120 ms. Reduced motion stosuje zmianę bez przesunięcia.

## DS-FBK-006 — Spinner

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d2aabbfc9`.
- Library component head: `dc32726c-e29a-8032-8008-b7bb42c2f1e2`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7bb2dd24146`, `dc32726c-e29a-8032-8008-b7bb42e5877f` oraz `dc32726c-e29a-8032-8008-b7bbe76e987e`.

### Anatomy i pokrycie

| Oś | Wartości w katalogu | Rozmiar wskaźnika |
|---|---|---|
| `context` | `inline` | 16 px |
| `context` | `button` | 24 px |
| `context` | `page` | 32 px |

Rozmiar wynika z kontekstu, więc komponent nie ma osobnej osi `size` ani nadmiarowego iloczynu 3×3. `inline` i `page` mają widoczny tekst, a `button` pozostaje ikoną wewnątrz kontrolki, która nadaje mu dostępną nazwę.

```ts
type SpinnerProps = {
  context: "inline" | "button" | "page";
  label?: string;
};
```

- `inline` domyślnie pokazuje `Ładowanie…`; tekst może być częścią `role="status"`, gdy operacja asynchroniczna wymaga ogłoszenia;
- `button` nie tworzy własnego celu kliknięcia. Przycisk zachowuje swój label dostępności i dodatkowo ustawia `aria-busy="true"`;
- `page` pokazuje `Ładowanie danych…`, lecz nie usuwa stabilnego shella strony ani nie zastępuje skeletonów dla treści o znanym układzie;
- obrót używa `motion.loading` wyłącznie dla łuku. Przy `prefers-reduced-motion` wskaźnik pozostaje statyczny, a stan nadal opisuje tekst lub dostępna nazwa kontrolki.

## DS-FBK-007 — ProgressBar

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d946284`.
- Library component head: `dc32726c-e29a-8032-8008-b7bd5897f337`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7bd48e17f51` oraz `dc32726c-e29a-8032-8008-b7bd58c2fd2f`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `determinate`, `indeterminate` |

Upload i zapis są kontekstami użycia, a nie kolejną osią wariantów. Oba tryby mają etykietę zadania, status tekstowy i tor wysokości 8 px. Wariant określony pokazuje przykładowe `60%`; wartość pochodzi z propsów, nie z osobnego wariantu.

```ts
type ProgressBarProps = {
  mode: "determinate" | "indeterminate";
  label: string;
  value?: number;
};
```

- root ma `role="progressbar"` oraz dostępną nazwę z `label`;
- `determinate` ustawia `aria-valuemin="0"`, `aria-valuemax="100"` i `aria-valuenow`; widoczny procent odzwierciedla tę samą wartość;
- `indeterminate` nie ustawia `aria-valuenow`, ale pokazuje i ogłasza stan `W toku` bez zapętlonych komunikatów live;
- reduced motion zatrzymuje przesuwanie segmentu; tekst nadal przekazuje stan.

## DS-FBK-008 — Skeleton

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d9462a0`.
- Library component head: `dc32726c-e29a-8032-8008-b7be915ff3d9`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7be88f4a544`, `dc32726c-e29a-8032-8008-b7be91831c51`, `dc32726c-e29a-8032-8008-b7bead61e6da`, `dc32726c-e29a-8032-8008-b7bead652d77` oraz `dc32726c-e29a-8032-8008-b7bead687586`.

| Oś | Wartości w katalogu |
|---|---|
| `type` | `text`, `card`, `image`, `table`, `calendar` |

Każdy wariant odzwierciedla geometrię docelowej treści. `calendar` zachowuje siedem kolumn i cele 48×44 px; liczba wierszy, viewport oraz animacja nie są osiami wariantu.

```ts
type SkeletonProps = {
  type: "text" | "card" | "image" | "table" | "calendar";
  label?: string;
};
```

- kontener ładowania może mieć `aria-busy="true"`; same dekoracyjne bloki są ukryte przed technologiami asystującymi;
- krótki, stabilny tekst statusu jest przekazywany przez rodzica, nie przez każdy prostokąt Skeletonu;
- shimmer używa wyłącznie zmiany pozycji jasnego pasa i nie blokuje treści;
- przy `prefers-reduced-motion` shimmer jest wyłączony, a placeholder pozostaje statyczny. Statyczna makieta dokumentuje fallback, nie wykonanie animacji.

## DS-FBK-009 — EmptyState

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b77c`.
- Library component head: `dc32726c-e29a-8032-8008-b7c09ca149fe`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7c0617559fa`, `dc32726c-e29a-8032-8008-b7c09cc3fdcb` oraz `dc32726c-e29a-8032-8008-b7c0eda1aebe`.

| Oś | Wartości w katalogu | Domyślna akcja |
|---|---|---|
| `type` | `first-use` | `Dodaj pojazd` |
| `type` | `filtered` | `Wyczyść filtry` |
| `type` | `no-data` | `Odśwież` |

Wspólna anatomia składa ikonę 24 px w powierzchni 56 px, tytuł 22 px, opis 16 px i rzeczywistą instancję `Button` 216×48 px. Viewport nie jest osią: blok 360 px działa jako pełna szerokość mobile oraz wyśrodkowany lub inline region desktopowy.

```ts
type EmptyStateProps = {
  type: "first-use" | "filtered" | "no-data";
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
};
```

- `first-use` prowadzi do podstawowej akcji utworzenia właściwego zasobu;
- `filtered` zachowuje kontekst strony i resetuje tylko aktywne filtry;
- `no-data` używa retry wyłącznie wtedy, gdy ponowne pobranie może zmienić wynik; przy trwałym braku danych akcję można pominąć;
- region może otrzymać nagłówek zgodny z hierarchią strony, ale nie powinien automatycznie używać `role="alert"` ani agresywnego regionu live.

## DS-FBK-010 — ErrorState

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b809`.
- Library component head: `dc32726c-e29a-8032-8008-b7c250c63956`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7c20834c762`, `dc32726c-e29a-8032-8008-b7c250e6bec8`, `dc32726c-e29a-8032-8008-b7c26db5f515` oraz `dc32726c-e29a-8032-8008-b7c26db9b903`.

| `type` | Akcje | Request ID |
|---|---|---|
| `local` | retry | ukryty |
| `page` | retry + back | opcjonalny, pokazany w przykładzie |
| `network` | retry | ukryty |
| `permission` | back do bezpiecznej części | ukryty |

Wspólna anatomia składa ikonę 24 px w powierzchni 56 px, tytuł 22 px, opis 16 px, opcjonalny identyfikator 12 px i rzeczywiste instancje `Button` 216×48 px. Master ma 540 px; przy 342 px akcje `page` zawijają się pionowo.

```ts
type ErrorStateProps = {
  type: "local" | "page" | "network" | "permission";
  title?: string;
  description?: string;
  requestId?: string;
  onRetry?: () => void;
  onBack?: () => void;
};
```

- retry zachowuje dane formularza i nie pokazuje fikcyjnego sukcesu;
- `network` rozróżnia błąd od świadomego trybu offline i nie obiecuje zapisu;
- `permission` nie ujawnia nazwy ani danych chronionego zasobu;
- `requestId` jest opcjonalnym, bezpiecznym identyfikatorem wsparcia, a nie stosem błędu ani tokenem;
- błąd strony może użyć `role="alert"` przy pierwszym pojawieniu; ponowne próby nie powinny zapętlać komunikatu live. Runtime weryfikuje fokus i działania.

## DS-FBK-011 — Tooltip

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b913`.
- Library component head: `dc32726c-e29a-8032-8008-b7c3e0de544e`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7c3d1581dad` oraz `dc32726c-e29a-8032-8008-b7c3e100906c`.

| Oś | Wartości w katalogu |
|---|---|
| `type` | `text`, `shortcut` |

Komponent ma wysokość 36 px i szerokość wynikającą z treści. `shortcut` składa dodatkowy keycap 52×24 px. Położenie, strona strzałki, trigger i viewport nie są osiami wariantów — odpowiada za nie warstwa pozycjonująca.

```ts
type TooltipProps = {
  type?: "text" | "shortcut";
  content: string;
  shortcut?: string;
  children: React.ReactElement;
};
```

- desktop otwiera Tooltip po hover i focusie, zachowując go przy przejściu wskaźnika nad treść zgodnie z WCAG 2.2;
- mobile nie może polegać wyłącznie na hover: używa fokusu albo kontrolowanego tapnięcia z jednoznacznym zamknięciem;
- `Escape` zamyka warstwę bez przenoszenia fokusu, a utrata triggera kończy widoczność zgodnie z biblioteką warstw;
- Tooltip nie zawiera krytycznych instrukcji, błędów walidacji ani interakcji. Takie treści muszą pozostać stale widoczne w interfejsie;
- statyczna makieta potwierdza treść i geometrię, nie timing hover ani obsługę klawiatury i dotyku.

## DS-FBK-012 — Popover

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b957`.
- Library component head: `368ee0a4-28c8-80cb-8008-b82d97f6e0c1`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7c7bd554220`, `dc32726c-e29a-8032-8008-b7c7bda46dd4` oraz `dc32726c-e29a-8032-8008-b7c7bdfa1726`.
- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b954`.

| Oś | Wartości utworzone |
|---|---|
| `type` | `menu`, `calendar`, `details` |

`menu` składa rzeczywistą instancję `DS-FBK-013 DropdownMenu` 280×156 px, `calendar` rzeczywistą instancję publicznego miesięcznego `DS-FRM-016 CalendarGrid` w powierzchni 368×414 px, a `details` jest prostą powierzchnią informacyjną 320×184 px. Nie powstała oś viewport ani drugi zestaw zawartości tylko dla mobile.

```ts
type PopoverProps = {
  type: "menu" | "calendar" | "details";
  open: boolean;
  triggerId: string;
  labelledBy?: string;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};
```

- trigger ma `aria-haspopup`, `aria-expanded` i `aria-controls`; wartość `aria-haspopup` odpowiada semantyce treści, a nie zawsze `dialog`;
- desktop kotwiczy warstwę przy triggerze, z collision avoidance i zachowaniem co najmniej 8 px od krawędzi viewportu;
- mobile przekazuje tę samą treść do istniejącego BottomSheet/Sheet zamiast przełączać wariant komponentu;
- po otwarciu fokus trafia do pierwszej sensownej kontrolki albo jawnie fokusowalnego kontenera; `Escape` zamyka warstwę i zwraca fokus do triggera;
- menu używa własnego kontraktu roving focus, a kalendarz własnego kontraktu siatki klawiaturowej; Popover nie duplikuje tych reguł;
- klik poza warstwą może zamknąć wyłącznie niekrytyczną treść. Mobile modalny sheet wymaga własnej blokady scrolla i focus trap;
- statyczna struktura nie dowodzi pozycjonowania, obsługi kolizji ani zwrotu fokusu.
- audyt wykazał 3/3 unikalne wartości osi, brak `variantError`, bezpośredniego overflow, nazw automatycznych, tekstów poniżej 12 px i kolorów spoza palety.

## DS-FBK-013 — DropdownMenu

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b92f`.
- Library component head: `dc32726c-e29a-8032-8008-b7c542e17790`.
- Źródła wariantów: `dc32726c-e29a-8032-8008-b7c4fbed7c37` oraz `dc32726c-e29a-8032-8008-b7c542fc6d72`.

| Oś | Wartości w katalogu |
|---|---|
| `type` | `record-actions`, `user` |

Oba warianty mają szerokość 280 px, trzy wiersze po 44 px i edytowalne etykiety 14 px. `record-actions` zawiera „Edytuj pojazd”, „Podgląd publiczny” i „Archiwizuj pojazd”; `user` zawiera „Konto i hasło”, „Aktywne sesje” oraz „Wyloguj”. Ten sam komponent treści jest używany w zakotwiczonej warstwie desktop i wewnątrz istniejącego BottomSheet/Sheet na mobile — viewport nie jest dodatkową osią wariantów.

```ts
type DropdownMenuProps = {
  type: "record-actions" | "user";
  items: Array<{
    id: string;
    label: string;
    onSelect: () => void;
    disabled?: boolean;
  }>;
  onClose: () => void;
};
```

- kontener używa `role="menu"`, a elementy `role="menuitem"`; trigger ma `aria-haspopup="menu"`, `aria-expanded` i `aria-controls`;
- `ArrowDown`/`ArrowUp` przechodzą między aktywnymi pozycjami, `Home`/`End` wybierają skrajne, `Enter` lub `Space` uruchamiają akcję, a `Escape` zamyka menu i zwraca fokus do triggera;
- typeahead jest opcjonalny, jeśli zapewnia go wybrana biblioteka warstw;
- mobile składa tę samą treść w BottomSheet/Sheet i nie tworzy osobnego wariantu komponentu ani ekranu;
- jawne etykiety „Archiwizuj pojazd” i „Wyloguj” opisują akcję; wymagane potwierdzenie destrukcyjne należy do właściwego dialogu lub przepływu, nie do samego menu;
- statyczny Penpot potwierdza anatomię i geometrię, ale nie działanie klawiatury, pozycjonowanie ani zwrot fokusu — te zachowania wymagają testów runtime.

## DS-FBK-014 — Dialog

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf29549c6b37`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afd2c65eb4bc`.
- Kompozycja korzysta z rzeczywistych instancji `Button`, a wariant formularza także z instancji `FormField`.

### Osie i pokrycie

| Oś | Wartości w katalogu |
|---|---|
| `type` | `confirm`, `info`, `destructive`, `form` |
| `size` | `md` |
| `actions` | `two`, `one` |

### Kontrakt implementacyjny

```ts
type DialogProps = {
  type?: "confirm" | "info" | "destructive" | "form";
  title: string;
  description?: string;
  children?: React.ReactNode;
  primaryAction: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  onOpenChange: (open: boolean) => void;
};
```

- Desktop używa wyśrodkowanej warstwy modalnej; mobilny formularz może przejść do pełnego ekranu albo `BottomSheet`, zależnie od długości treści.
- Po otwarciu fokus przechodzi do logicznego początku, `Escape` zamyka warstwę, a po zamknięciu fokus wraca do elementu wywołującego.
- Akcja destrukcyjna nazywa skutek i obiekt; nie polega wyłącznie na kolorze.
- Przejście używa `motion.base`; przy reduced motion nie skaluje zawartości.

## DS-FBK-015 — BottomSheet

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf29549c6b60`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afd3a807f84a`.
- Warianty akcji i formularza używają rzeczywistych instancji komponentów bazowych.

### Osie i pokrycie

| Oś | Wartości w katalogu |
|---|---|
| `type` | `filters`, `contact`, `actions`, `select` |
| `state` | `default` |
| `viewport` | `mobile` |

### Kontrakt implementacyjny

```ts
type BottomSheetProps = {
  type: "filters" | "contact" | "actions" | "select";
  title: string;
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  showDragHandle?: boolean;
};
```

- Komponent uwzględnia dolny safe area i nigdy nie zasłania ostatniej akcji.
- Maksymalna wysokość pozostawia widoczny kontekst poprzedniego widoku; długa treść przewija się wewnątrz panelu.
- Gest zamknięcia nie może być jedyną metodą wyjścia. Dostępny przycisk zamknij i obsługa `Escape` są wymagane.
- Animacja to pionowe wejście/wyjście w `motion.base`; reduced motion usuwa przesunięcie.

## DS-FBK-016 — SideDrawer

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d813a5b04`.
- Library component head: `92bfc32e-2dd6-801a-8008-be235ceedba4`.
- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d813a5b01`.

| Oś | Wartości utworzone |
|---|---|
| `type` | `menu`, `detail`, `quick-edit` |

Viewport nie jest osią wariantów. Ten sam komponent ma elastyczny Flex layout: na mobile zajmuje pełną szerokość, a na desktopie jest prawym panelem o szerokości `clamp(480px, 40vw, 640px)`. Wszystkie trzy zachowują pełną funkcję i nie tworzą osobnych ekranów.

```ts
type SideDrawerProps = {
  type: "menu" | "detail" | "quick-edit";
  open: boolean;
  title: string;
  description?: string;
  dirty?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onOpenChange: (open: boolean) => void;
  onRequestClose: () => void;
};
```

- `menu` składa istniejący `DS-FBK-013 DropdownMenu`; `detail` używa edytowalnych par label/value i istniejącego Buttonu; `quick-edit` składa dwa `DS-FRM-013 DateInput`, istniejący Alert oraz Buttony secondary/primary.
- Dirty nie jest dodatkową osią. Quick edit pokazuje jawny komunikat „Masz niezapisane zmiany”; próba zamknięcia z `dirty=true` otwiera istniejący `OVR-13`/`DS-FBK-018`, zamiast po cichu odrzucać dane.
- Header i stopka pozostają dostępne, a długa treść przewija się wyłącznie w części body. Mobile uwzględnia top/bottom safe area i nie chowa akcji za dolną nawigacją ani klawiaturą ekranową.
- Warstwa wymaga `role="dialog"`, `aria-modal="true"`, powiązanych title/description, pułapki fokusu, inertnego tła, blokady scrollu i zwrotu fokusu do triggera. Escape zamyka tylko czysty drawer; stan dirty przechodzi przez ochronę niezapisanych zmian.
- Wejście/wyjście używa `motion.slow` 240 ms i przesunięcia od prawej. Przy `prefers-reduced-motion` pozostaje krótka zmiana opacity bez ruchu.
- Wszystkie główne akcje mają wysokość 48 px.

## DS-NAV-012 — Tabs

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf29549c6b94`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afd4d18eb799`.

### Osie i pokrycie

| Oś | Wartości w katalogu |
|---|---|
| `style` | `underline`, `contained`, `scrollable` |
| `state` | `default`, `active`, `disabled` |
| `badge` | `none`, `count` |

Zestaw zawiera 12 reprezentatywnych wariantów: trzy style z osobnymi stanami default, active i disabled oraz wariantem badge. Nie jest to iloczyn wszystkich osi; licznik nie zastępuje stanu aktywnego.

### Kontrakt implementacyjny

```ts
type TabItem = {
  id: string;
  label: string;
  disabled?: boolean;
  badge?: number;
};

type TabsProps = {
  style?: "underline" | "contained" | "scrollable";
  items: TabItem[];
  value: string;
  onValueChange: (id: string) => void;
};
```

- Semantyka: `tablist`, `tab`, `tabpanel`, `aria-selected` i powiązanie przez stabilne ID.
- Klawisze strzałek przenoszą fokus; disabled jest pomijany. Wariant scrollable utrzymuje aktywną zakładkę w widocznym obszarze bez ukrywania focus ringu.
- Aktywny stan ma tekst i wskaźnik/powierzchnię, więc nie jest sygnalizowany samym odcieniem.
- Zmiana wskaźnika używa `motion.fast`; reduced motion przełącza stan bez ruchu.

## DS-NAV-003 — PublicHeader

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf251bc85925`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afd75219f2d0`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `desktop`, `mobile` |
| `variant` | `default`, `transparent`, `sticky` |
| `state` | `top`, `scrolled`, `menuOpen` |

Zestaw zawiera sześć reprezentatywnych kombinacji. Mobilny nagłówek ma logo, kontakt i menu; desktop ma linki oraz CTA.

```ts
type PublicHeaderProps = {
  variant?: "default" | "transparent" | "sticky";
  activePath?: string;
  menuOpen?: boolean;
  onMenuOpenChange?: (open: boolean) => void;
};
```

- Logo prowadzi do `/`, a aktywna pozycja ma tekstowy/geometryczny wskaźnik.
- Menu mobilne ma jawne „Zamknij”, focus trap i zwrot fokusu.
- Sticky nie zasłania celu skip linku ani zakotwiczonych nagłówków.

## DS-DAT-002 — VehicleCardPublic

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf251bc8595b`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afd875334236`.
- Osadzone media WebP: `demo-v01-front-3q`, `demo-v02-front-3q`, `demo-v03-front-3q`.

| Oś | Wartości w katalogu |
|---|---|
| `layout` | `grid`, `list`, `featured` |
| `state` | `default`, `available`, `unavailable`, `loading` |
| `price` | `shown`, `hidden` |
| `image` | `photo`, `placeholder`, `fallback` |

Osiem reprezentatywnych wariantów obejmuje loading, brak zdjęcia, brak ceny i wynik dostępności. Teksty mają poprawny wrap; eksport po korekcie nie ma przycięć.

```ts
type VehicleCardPublicProps = {
  layout?: "grid" | "list" | "featured";
  vehicle: PublicVehicleSummary;
  availability?: "available" | "unavailable";
  loading?: boolean;
};
```

- Zdjęcie ma opis alternatywny odnoszący się do konkretnego pojazdu.
- Brak ceny nie rezerwuje pustej przestrzeni.
- Publiczny status nie zawiera rodzaju, notatki ani technicznych danych blokady.
- Karta nie może być klikalnym kontenerem z zagnieżdżonym przyciskiem.

## DS-DAT-003 — VehicleCardFeatured

Kontrakt: alias zastosowania istniejącego `DS-DAT-002`, a nie druga karta pojazdu. Dzięki temu katalog SPEC jest rozliczony bez dublowania anatomii, stanów, fotografii i kontraktu dostępności.

- Źródłowy katalog/Variant Set `DS-DAT-002`: `efe3ac9b-6991-807f-8008-cf251bc8595b`; głowa biblioteczna: `a4abf4c9-2e1f-80fd-8008-afd875334236`.

| Prezentacja DS-DAT-003 | Wariant DS-DAT-002 | Component ID | Main instance ID |
|---|---|---|---|
| `large` | `featured/default/shown/photo` | `a4abf4c9-2e1f-80fd-8008-afd8aded2f78` | `a4abf4c9-2e1f-80fd-8008-afd8adc7c5aa` |
| `compact` | `grid/default/shown/photo` | `a4abf4c9-2e1f-80fd-8008-afd8485e90bb` | `a4abf4c9-2e1f-80fd-8008-afd84839a007` |
| fallback obrazu | `grid/default/shown/fallback` | `a4abf4c9-2e1f-80fd-8008-afd8d393b8e4` | `a4abf4c9-2e1f-80fd-8008-afd8d36650d6` |

```ts
type VehicleCardFeaturedProps = Omit<
  VehicleCardPublicProps,
  "layout"
> & {
  presentation: "large" | "compact";
};
```

- `presentation=large` wybiera `layout=featured`, a `compact` wybiera `layout=grid`. Brak `vehicle.image` wybiera istniejący wariant `fallback`; nie jest osobnym stanem kontrolowanym przez konsumenta.
- Swipe/stack na mobile oraz grid 3–6 kart na desktopie należą do rodzica kolekcji. Karta nie posiada osi viewport ani własnej logiki karuzeli/gridu.
- Semantyka i dostępność pozostają kontraktem `VehicleCardPublic`: jedna powierzchnia nawigacyjna bez zagnieżdżania aktywnego przycisku.

## DS-DAT-004 — VehicleRowAdmin

Kontrakt: mapowanie `layout=row` wspólnego komponentu `VehicleAdminItem`. `DS-DAT-004` i `DS-DAT-005` współdzielą dane, statusy i akcje; nie istnieją jako dwie rozchodzące się anatomie.

- Katalog: `1e066793-8858-8051-8008-cf320ddccb90`.
- Variant Set: `1e066793-8858-8051-8008-cf320ddccb93`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be9a8abf261e`.

Wiersz ma warianty `default`, `selected`, `menu-open` i `updating`. Każdy zawiera kolejność, miniaturę, nazwę/kategorię, osobny status publikacji i dostępności, datę zmiany oraz akcje „Edycja”, „Terminy” i „Więcej”. Selected ma jawny znak i obramowanie; menu pokazuje „Podgląd”, „Ukryj” i „Archiwizuj”; updating składa rzeczywistą instancję `Spinner`.

Na `ADM-05` trzy widoczne akcje każdego wiersza/karty mają osobne cele: Edytuj → `ADM-07`, Terminy/Kalendarz → `/admin/pojazdy/[id]/kalendarz` (`ADM-09`), Więcej → overlay menu. Referencyjny Mercedes Klasa V przechodzi do istniejącego boardu `ADM-09` z tym samym pojazdem; pozostałe demonstracyjne wiersze mają własne trasy pojazdów, a nie sześć kopii statycznego kalendarza. Overlay MVP `89433e5c-4f5c-80ad-8008-d67038a557ec` pokazuje Ukryj i Archiwizuj. Źródłowy wariant biblioteczny zachowuje Podgląd dla odłożonego `ADM-08` (SHOULD), lecz ta opcja nie jest wejściem MVP.

Otwarcie menu jest interakcją prototypu; same Ukryj/Archiwizuj są tu statycznym kontraktem `onHide(vehicleId)`/`onArchive(vehicleId)` z właściwymi `OVR-10`/`OVR-11`, nie potwierdzonym wykonaniem mutacji ani przejściem wszystkich danych. [#107](https://github.com/KarolR2001/Auterva/issues/107) domyka kontekst wybranego pojazdu, stany i referencyjne potwierdzenia przed implementacją listy i cyklu publikacji (#34/#35). Nie kierujemy żadnej z tych akcji do `/admin/pojazdy/[id]/akcje`.

Na mobile nie ściskamy wiersza tabeli. Rodzic przełącza ten sam model danych na `layout=card`, czyli kontrakt `DS-DAT-005`. W implementacji desktopowy wariant renderuje semantyczny `<tr>` z komórkami, `aria-selected` przy zaznaczeniu i prawdziwymi przyciskami akcji. Zmiana kolejności wymaga alternatywy klawiaturowej obok drag and drop.

## DS-DAT-005 — VehicleCardAdmin

Kontrakt: mapowanie `layout=card` tego samego `VehicleAdminItem`. Jest podstawowym przedstawieniem listy pojazdów na mobile i opcjonalnym przedstawieniem na tablecie/desktopie.

| Oś wspólnego komponentu | Wartości w katalogu |
|---|---|
| `layout` | `row`, `card` |
| `detail` | `compact`, `detailed` |
| `state` | `default`, `selected`, `menu-open`, `updating`, `warning` |

Variant Set ma siedem celowych kombinacji zamiast pełnego iloczynu 2×2×5: cztery wiersze oraz trzy karty (`compact/default`, `detailed/default`, `compact/warning`). Karta ostrzegawcza składa realny `Alert`; każdy wariant składa dwie realne instancje `StatusBadge` oraz fotografię DEMO.

```ts
type VehicleAdminItemProps = {
  layout: "row" | "card";
  detail?: "compact" | "detailed";
  state?: "default" | "selected" | "menu-open" | "updating" | "warning";
  vehicle: AdminVehicleSummary;
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  onEdit: () => void;
  onOpenCalendar: () => void;
  onOpenActions: () => void;
  onMove?: (direction: "up" | "down") => void;
};
```

- Mobile zachowuje wszystkie szybkie akcje i oba statusy. Nie ujawnia danych publicznych w innym zakresie niż desktop, ale może pokazać administracyjne ostrzeżenie jakości danych.
- `onOpenCalendar` zawsze dotyczy `vehicle.id` z tego wiersza/karty i prowadzi do `/admin/pojazdy/[id]/kalendarz`. Lista `/admin/pojazdy` jest wejściem do kalendarzy MVP; nie kierujemy akcji do `/admin/kalendarz` ani do osobnych „Terminów” bez pojazdu.
- Karta jest `<li>`/`<article>` wewnątrz listy, a akcje są osobnymi przyciskami. Nie czynimy całej karty klikalną, gdy zawiera te kontrolki.
- Otwarty menu ma zarządzany fokus, Escape i zwrot fokusu do „Więcej”. Stan updating blokuje podwójną mutację i używa `aria-busy=true`.
- Statyczny Penpot potwierdza strukturę i geometrię. Sortowanie klawiaturą, fokus menu i blokadę double-submit trzeba potwierdzić w demonstratorze.

## DS-DAT-006 — StatCard

Jest to pojedynczy, prosty komponent prezentacyjny dla metryk dashboardu z `FR-ADM-010` i opcjonalnego ostrzeżenia `FR-ADM-011`. Nie oblicza statystyk, nie dodaje wykresów ani osobnego ekranu.

- Katalog: `1e066793-8858-8051-8008-cf325738b89d`.
- Variant Set: `1e066793-8858-8051-8008-cf325738b8a5`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be9c627f5da7`.

| Oś | Celowe wartości |
|---|---|
| `type` | `number`, `number+trend`, `warning` |
| `state` | `default`, `loading`, `empty`, `warning` |

Zamiast pełnego iloczynu 3×4 istnieje pięć sensownych kombinacji: `number/default`, `number+trend/default`, `warning/warning`, `number/loading` i `number/empty`. Loading składa rzeczywistą instancję wspólnego `Spinner`. Warning komunikuje stan ikoną, tekstem i mocniejszym obramowaniem, więc nie polega wyłącznie na kolorze. Empty pokazuje `—` i „Brak danych”, nie fikcyjne zero.

```ts
type StatCardProps = {
  type: "number" | "number+trend" | "warning";
  state?: "default" | "loading" | "empty" | "warning";
  label: string;
  value?: number | string;
  helper?: string;
  trend?: { direction: "up" | "down"; label: string };
};
```

- Rodzic dashboardu układa komponent w 2 kolumnach na mobile/tablecie i 4 na desktopie; `StatCard` nie ma osi viewport.
- Wartość, label, trend i ostrzeżenie są danymi serwerowymi. Komponent nie wylicza dostępności ani KPI i nie zapisuje stanu.
- Loading używa `aria-busy=true`; ostrzeżenie wymaga tekstu dostępnego dla czytnika. Trend nie może być komunikowany wyłącznie strzałką.

## DS-DAT-007 — SpecList

Jeden komponent prezentuje publiczne parametry pojazdu z `FR-PUB-011` w dwóch trybach. Nie dodaje osobnych komponentów dla mobile i desktopu ani stanu „brak pola”.

- Katalog: `1e066793-8858-8051-8008-cf325738b989`.
- Variant Set: `1e066793-8858-8051-8008-cf325738b991`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be9ef1f00a32`.

Jedyna oś `mode` ma wartości `icon-list` i `definition-list`. Wariant ikonowy pokazuje cztery najważniejsze parametry, a definicyjny trzy wartości i celowo pomija nieobecne opcjonalne pole bagażu. `null`/`undefined` nie tworzą pustego wiersza, placeholdera ani trzeciej wartości osi.

```ts
type VehicleSpec = {
  key: string;
  label: string;
  value: string | number | null | undefined;
  icon?: ReactNode;
  optional?: boolean;
};

type SpecListProps = {
  mode: "icon-list" | "definition-list";
  items: VehicleSpec[];
};
```

- Przed renderem `items` są filtrowane do wartości niepustych. Wartość `0` pozostaje poprawną wartością, jeśli dana semantyka ją dopuszcza.
- Lista używa semantyki `<ul>` w trybie ikonowym albo `<dl>` z parami `<dt>/<dd>` w trybie definicyjnym.
- Rodzic stosuje 2 kolumny na mobile, 3 na tablecie i 3–4 na desktopie. Komponent nie posiada osi viewport.

## DS-DAT-008 — FeatureChip

Jeden atom cechy obsługuje publiczną prezentację wyposażenia z `FR-PUB-021` oraz kontrolowane usuwanie elementu w formularzu `FR-ADM-030`. Nie zastępuje pełnego `TagInput` ani semantycznego `StatusBadge`.

- Katalog: `1e066793-8858-8051-8008-cf325738ba58`.
- Variant Set: `1e066793-8858-8051-8008-cf325738ba60`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-bea078298a56`.

| Oś | Celowe wartości |
|---|---|
| `kind` | `text`, `icon`, `admin` |
| `state` | `default`, `selected`, `removable` |

Istnieją cztery kombinacje: `text/default`, `icon/default`, `text/selected` i `admin/removable`. Selected ma znak oraz obrys 2 px, więc nie polega tylko na kolorze. Admin/removable ma osobny cel usuwania 44×44 px; warianty publiczne nie zawierają zagnieżdżonej akcji.

```ts
type FeatureChipProps = {
  kind?: "text" | "icon" | "admin";
  state?: "default" | "selected" | "removable";
  label: string;
  icon?: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
};
```

- Chip prezentacyjny jest `<span>`/`<li>`. Selected jest kontrolką tylko w kontekście wyboru i wtedy używa `aria-pressed` albo semantyki checkboxa.
- Admin/removable ma dostępny przycisk z etykietą „Usuń cechę: {label}”; znak `×` jest dekoracyjny.
- Wrap i odstępy należą do rodzica listy. Komponent nie ma osi viewport ani własnego poziomego scrolla.

## DS-DAT-009 — PriceBlock

Komponent realizuje informacyjną cenę z `FR-PUB-022` bez obliczeń, płatności ani rezerwacji.

- Katalog: `1e066793-8858-8051-8008-cf325738c8b4`.
- Variant Set: `1e066793-8858-8051-8008-cf325738c8bc`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-bea1b581d993`.

Jedyna oś `mode` ma dwa renderowane warianty: `price-from` i `individual`. Wartości `hidden`, `null` oraz kwota `0` są warunkami braku renderu, a nie pustymi masterami bibliotecznymi.

```ts
type PriceBlockProps =
  | { mode: "price-from"; amount: number; currency: "PLN"; unit: string }
  | { mode: "individual"; contactHref?: string }
  | { mode: "hidden" };
```

- `amount <= 0`, brak kwoty lub `mode=hidden` zwraca `null`; interfejs nie pokazuje „0 zł” ani pustego obramowania.
- Wariant `price-from` formatuje wartość jako dane prezentacyjne, np. „250 zł / doba”. Nie wykonuje kalkulacji dla zakresu dat.
- `individual` komunikuje „Wycena indywidualna” i może kierować do istniejącego przepływu kontaktu; nie tworzy osobnej rezerwacji.
- Mobile układa dwa przykłady pionowo i na pełną szerokość. Od tabletu rodzic może użyć inline/aside. Komponent nie ma osi viewport.

## DS-DAT-010 — DefinitionList

To ogólny prymityw par etykieta–wartość; nie zastępuje domenowego `DS-DAT-007 SpecList`.

- Katalog: `1e066793-8858-8051-8008-cf328d4ce9e8`.
- Variant Set: `1e066793-8858-8051-8008-cf328d4ce9ef`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-bea46a4b44f9`.

Jedyna oś `layout` ma wartości `vertical` i `two-column`. `vertical` układa termin nad wartością, a `two-column` zestawia termin i wartość w jednym wierszu. Brak wartości jest filtrowany przed renderem; nie powstaje pusty wiersz, placeholder ani wariant `missing`.

```ts
type DefinitionItem = {
  id: string;
  term: string;
  description: React.ReactNode | null | undefined;
};

type DefinitionListProps = {
  layout: "vertical" | "two-column";
  heading?: string;
  items: readonly DefinitionItem[];
};
```

- Implementacja używa semantyki `<dl>` z odpowiadającymi parami `<dt>/<dd>`.
- Mobile 320–430 px używa `vertical`; od 768 px rodzic wybiera `two-column`. Breakpoint nie jest osią komponentu.
- Siedem rzeczywistych instancji w dokładnych viewportach przeszło świeży audyt: zero `variantError`, overflow, nazw automatycznych, tekstu poniżej 12 px i kolorów treści spoza palety.

## DS-DAT-011 — DataTable

Jeden semantyczny wrapper tabeli obsługuje pojazdy, logi i sesje na desktopie. Nie jest używany jako szeroka tabela na telefonie i nie duplikuje `VehicleAdminItem`, `RecordCard`, `AuditLogRow` ani `SessionCard`.

- Katalog: `1e066793-8858-8051-8008-cf328d4cea86`.
- Variant Set: `1e066793-8858-8051-8008-cf328d4cea8d`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-bea9b6c5165a`.

Osie to `dataset=vehicles|logs|sessions` oraz `content=populated|loading|empty`, ale istnieje tylko pięć celowych kombinacji. Sortowanie, filtr i zaznaczenie są zachowaniami, które mogą współistnieć w tabeli z danymi; nie tworzą wzajemnie wykluczających się wariantów ani pełnego iloczynu.

```ts
type DataTableDataset = "vehicles" | "logs" | "sessions";
type DataTableContent = "populated" | "loading" | "empty";

type DataTableProps<Row> = {
  dataset: DataTableDataset;
  content: DataTableContent;
  rows: readonly Row[];
  sort?: { key: string; direction: "asc" | "desc" };
  filters?: readonly { key: string; value: string }[];
  selectedIds?: ReadonlySet<string>;
  onSort?: (key: string) => void;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
};
```

- Używać natywnej semantyki `<table>`, `<thead>`, `<tbody>`, `<th>` i `<td>`; sortowalny nagłówek jest przyciskiem z `aria-sort`.
- `vehicles/populated` składa dwa realne `VehicleAdminItem`: selected i default. `vehicles/loading` składa `Skeleton/type=table`, a empty składa `EmptyState/type=filtered`.
- Logi pokazują tylko bezpieczne podsumowania, bez sekretów, haseł i tokenów. Destrukcyjna akcja sesji wymaga potwierdzenia `OVR-19`.
- 320–768 px nie renderuje `DataTable`; ten sam zbiór przechodzi do `DS-DAT-012 RecordCard` bez utraty funkcji. Od 1024 px tabela mieści się bez poziomego scrolla jako podstawowego wzorca.
- Audyt objął 5/5 wariantów, sześć realnych instancji desktopowych i siedem viewportów.

## DS-DAT-012 — RecordCard

Jeden generyczny wrapper jest mobilnym odpowiednikiem rekordu tabeli dla logu, sesji i blokady. Nie dubluje `AuditLogRow`, `SessionCard`, `DataTable` ani całych ekranów.

- Katalog: `1e066793-8858-8051-8008-cf328d4d28b5`.
- Variant Set: `1e066793-8858-8051-8008-cf328d4d28bc`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-beafe7b64a5b`.

Osie to `record=log|session|block` i `detail=compact|expanded`, ale biblioteka zawiera tylko pięć celowych kombinacji: log compact/expanded, session compact oraz block compact/expanded. Brak `session/expanded` jest świadomy: zarządzanie sesją korzysta z dedykowanego flow potwierdzenia, a nie z kolejnego wariantu karty. Breakpoint nie jest osią komponentu.

```ts
type RecordCardRecord = "log" | "session" | "block";
type RecordCardDetail = "compact" | "expanded";

type RecordCardProps = {
  record: RecordCardRecord;
  detail: RecordCardDetail;
  title: string;
  subtitle: string;
  status: { label: string; icon: string };
  metadata: readonly { label: string; value: string }[];
  primaryAction: { label: string; onInvoke: () => void };
  secondaryActions: readonly { label: string; onInvoke: () => void }[];
};
```

- Anatomia zawsze zachowuje identyfikację rekordu, status z tekstem i znakiem, kluczowe metadane, jedną główną akcję oraz menu pozostałych akcji.
- Każdy wariant składa realne instancje wspólnych `Button` i `MenuTrigger`; sesja oraz blokada składają również istniejący `StatusBadge`.
- Log pokazuje wyłącznie bezpieczne podsumowanie i redakcję danych wrażliwych. Notatka blokady jest jawnie oznaczona jako prywatna dla admina.
- Karta ma szerokość 304 px, więc mieści się w widoku 320 px bez poziomego przewijania. Mobile używa jej jako podstawowej reprezentacji; desktop może użyć jej opcjonalnie obok podstawowego `DataTable`.
- Audyt objął 5/5 wariantów, 16 realnych instancji i siedem dokładnych viewportów.

## DS-DAT-013 — KeyValueRow

To pojedyncza para etykieta–wartość używana wewnątrz paneli danych. Komponent nie zastępuje całego `DefinitionList` i nie tworzy osobnych ekranów ani kart domenowych.

- Katalog: `1e066793-8858-8051-8008-cf328d4d2a9f`.
- Variant Set: `1e066793-8858-8051-8008-cf328d4d2aa6`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-beb228df8775`.

Komponent ma osie `kind=plain|copyable|status` i `layout=vertical|row`, czyli sześć potrzebnych kombinacji. `layout` opisuje realną zmianę anatomii, ale breakpoint i viewport pozostają odpowiedzialnością rodzica. Długi tekst jest danymi i zawijaniem treści, nie trzecią osią.

```ts
type KeyValueRowKind = "plain" | "copyable" | "status";
type KeyValueRowLayout = "vertical" | "row";

type KeyValueRowProps = {
  kind: KeyValueRowKind;
  layout: KeyValueRowLayout;
  label: string;
  value: string;
  status?: { category: string; value: string };
  onCopy?: () => void;
};
```

- Copyable składa realny wspólny `Button` z jawną etykietą „Kopiuj”. Nie używa bieżącego `IconButton`, którego ikona chevron komunikowałaby inną akcję.
- Status składa istniejący `StatusBadge`; status zachowuje tekst i znak, więc nie polega wyłącznie na kolorze.
- Vertical ma 304×128 px i zawija długą wartość bez poziomego scrolla. Row ma 600×72 px i układa etykietę, wartość oraz opcjonalną akcję w jednym rzędzie.
- Audyt objął 6/6 wariantów, 18 realnych instancji i siedem dokładnych viewportów.

## DS-DAT-014 — AuditLogRow

Kontrakt: alias zastosowania istniejących `RecordCard` i `DataTable`, a nie trzecia anatomia rekordu audytu.

- Katalog aliasu: `1e066793-8858-8051-8008-cf32e1096be8`.
- Mobile korzysta z głowy `DS-DAT-012 RecordCard` `92bfc32e-2dd6-801a-8008-beafe7b64a5b`.
- Desktop korzysta z wariantu `DS-DAT-011 DataTable` `dataset=logs/content=populated` (`92bfc32e-2dd6-801a-8008-bea9ca365cbc`).

| Prezentacja DS-DAT-014 | Istniejący wariant |
|---|---|
| `compact` mobile | `RecordCard record=log/detail=compact` |
| `expanded` mobile | `RecordCard record=log/detail=expanded` |
| table row desktop | `DataTable dataset=logs/content=populated` |

```ts
type AuditLogRowProps = {
  presentation: "compact" | "expanded" | "table-row";
  occurredAt: string;
  actorLabel: string;
  actionLabel: string;
  objectLabel: string;
  safeSummary: string;
  onShowDetails: () => void;
};
```

- Mobile zachowuje identyfikację, bezpieczne metadane, główną akcję i menu. Expanded pokazuje jawny komunikat „Dane wrażliwe zredagowane”.
- Desktop pozostaje semantycznym wierszem tabeli. Akcja „Pokaż” prowadzi do `OVR-18`, zamiast rozwijać drugą kopię danych w tabeli.
- Katalog aliasu składa trzy realne instancje źródłowe.
- Statyczny alias nie dowodzi autoryzacji, focus management ani pobrania danych dla `OVR-18`; te elementy pozostają bramkami prototypu i runtime.

## DS-DAT-015 — SessionCard

Kontrakt: alias ról rekordów istniejącego `DS-AUT-008 ActiveSessionList` oraz desktopowego `DataTable/sessions`. Nie powstała druga karta sesji.

- Katalog aliasu: `1e066793-8858-8051-8008-cf32e1096c33`.
- Źródłowy `ActiveSessionList`: głowa `dc32726c-e29a-8032-8008-b7af17296484`, wariant `state=default`.
- Desktopowy wariant `DataTable`: `dataset=sessions/content=populated` (`92bfc32e-2dd6-801a-8008-bea9d0db3099`).

| Rola DS-DAT-015 | Istniejąca prezentacja |
|---|---|
| `current` | rekord bieżącej sesji w `ActiveSessionList`; badge, bez terminate |
| `other` | rekord innej sesji w `ActiveSessionList`; terminate przez `OVR-19` |
| `expired` | no-render w liście aktywnych sesji MVP |
| desktop table/card | `DataTable/sessions` albo ten sam `ActiveSessionList` |

```ts
type SessionRecord = {
  id: string;
  role: "current" | "other";
  deviceLabel: string;
  lastActiveAt: string;
  locationLabel?: string;
  technicalSummary: string;
};
```

- PRD `FR-ADM-081` definiuje listę aktywnych sesji. SPEC wymienia również `expired`; w liście aktywnych sesji wygasły rekord jest filtrowany i nie tworzy karty. Historia sesji wymagałaby ponownej decyzji.
- Bieżąca sesja nie ma akcji zakończenia. Pozostałe sesje i akcja zbiorcza zawsze przechodzą przez `OVR-19`; serwer ponownie sprawdza uprawnienie.
- Katalog aliasu składa dwie realne instancje źródłowe.
- Makieta nie dowodzi unieważnienia sesji, ochrony przed wyścigiem ani focus management dialogu potwierdzenia.

## DS-DAT-016 — WarningList

Kontrakt: wzorzec kompozycyjny. Nie powstał dodatkowy komponent biblioteczny, ponieważ lista grupuje istniejące warianty `Alert`.

- Katalog: `1e066793-8858-8051-8008-cf334fe56b43`.
- Obszar czterech kompozycji: `1e066793-8858-8051-8008-cf334fe56b46`.

| Rodzaj | Zachowanie elementów |
|---|---|
| `data-quality` | brak zdjęcia/opisu; akcja prowadzi do właściwej sekcji pojazdu |
| `setup` | brak kanału lub błąd publikacji; akcja prowadzi do ustawień/statusu |
| `dismissed` | element znika z listy; nie renderuje pustej karty |
| `resolved` | opcjonalne krótkie potwierdzenie sukcesu, następnie usunięcie |

```ts
type WarningListItem = {
  id: string;
  title: string;
  description: string;
  state: "action" | "resolved";
  action?: { label: string; href: string };
};

type WarningListProps = {
  kind: "data-quality" | "setup";
  items: WarningListItem[];
  onDismiss?: (id: string) => void;
};
```

- Mobile układa alerty w stos. Desktop zachowuje jeden panel i używa dwóch kolumn tylko przy wystarczającej szerokości; nie istnieje oś viewport.
- Licznik pokazuje wyłącznie renderowane elementy. Lista nie oblicza jakości danych ani nie utrwala dismissal — otrzymuje bezpieczny model z serwera.
- Nawigacja do encji, autoryzacja, utrwalenie dismissal i ogłoszenia live wymagają testów runtime.

## DS-DAT-017 — ResultCount

Jeden mały komponent prezentuje liczbę wyników po filtrach albo wyszukiwaniu; pozycjonowanie sticky i osadzenie w toolbarze należą do rodzica.

- Katalog: `1e066793-8858-8051-8008-cf32e1096c6b`.
- Variant Set: `1e066793-8858-8051-8008-cf32e1099776`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-beb4f392eaf4`.

Jedyna oś to `context=filters|search`. Aktualizacja wyniku jest zachowaniem live regionu, a nie wizualnym stanem. Oba mastery mają metadane `aria-live=polite` i `aria-atomic=true`.

```ts
type ResultCountProps = {
  context: "filters" | "search";
  count: number;
  detail?: string;
};
```

- Mobile umieszcza komponent przy toolbarze/triggerze filtrów i może przykleić jego rodzica. Desktop osadza ten sam komponent w toolbarze.
- Zmiana liczby aktualizuje ten sam atomic live region i nie przenosi fokusu.
- Audyt objął 2/2 warianty, 11 realnych instancji i siedem dokładnych viewportów.
- Metadane Penpota są kontraktem, nie dowodem działania DOM lub czytnika ekranu; wymagany jest test runtime.

## DS-DAT-018 — SortControl

Jeden komponent obsługuje dwie prezentacje tego samego sortowania; aktualnie wybrane kryterium jest treścią, nie osobnym wariantem.

- Katalog: `1e066793-8858-8051-8008-cf32e10997b6`.
- Variant Set: `1e066793-8858-8051-8008-cf32e10997bd`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-beb6a34cedbb`.

Jedyna oś to `presentation=select|menu`. `select` jest pełnym polem do sheetu i małego viewportu, a `menu` kompaktowym triggerem toolbaru desktopowego.

```ts
type SortControlProps = {
  presentation: "select" | "menu";
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
};
```

- `select` dokumentuje `role=combobox` i `aria-expanded=false`; `menu` dokumentuje `role=button`, `aria-haspopup=listbox` i `aria-expanded=false`.
- Rodzic dostarcza opcje, synchronizuje query i decyduje o osadzeniu w sheecie albo toolbarze. Komponent nie tworzy własnego ekranu ani filtra.
- Audyt objął 2/2 warianty, 11 realnych instancji i siedem dokładnych viewportów.
- Otwieranie popupu, klawiatura, focus i synchronizacja URL wymagają testów runtime.

## DS-DAT-019 — FilterChip

Kontrakt: alias użycia `DS-DAT-008 FeatureChip`; nie powstał drugi komponent biblioteczny o tej samej anatomii.

- Katalog aliasu: `1e066793-8858-8051-8008-cf32e109980d`.
- Źródłowy Variant Set: `1e066793-8858-8051-8008-cf325738ba60`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-bea078298a56`.

| Rola DS-DAT-019 | Istniejący wariant DS-DAT-008 |
|---|---|
| `applied` | `kind=text`, `state=selected` |
| `removable` | `kind=admin`, `state=removable` |

```ts
type FilterChipProps = {
  state: "applied" | "removable";
  label: string;
  onRemove?: () => void;
  removeLabel?: string;
};
```

- Lista/`FilterBar` odpowiada za poziomy scroll na mobile oraz wrap od tabletu; chip nie ma osi viewport ani własnego magazynu filtrów.
- `focus-visible` pozostaje stanem CSS. Removable zachowuje źródłowy, osobny cel usuwania 44×44 px i dostępną etykietę.
- Usuwanie, klawiatura, focus i aktualizacja query wymagają testów runtime.

## DS-DAT-020 — FilterBar

Kontrakt: wzorzec kompozycyjny. Nie powstał dodatkowy komponent biblioteczny, ponieważ FilterBar wyłącznie orkiestruje istniejące kontrolki.

- Katalog: `1e066793-8858-8051-8008-cf334fe506b7`.
- Obszar siedmiu kompozycji: `1e066793-8858-8051-8008-cf334fe506ba`.

| Kontekst | Prezentacja | Stan |
|---|---|---|
| public | compact | default, applied |
| admin | compact | dirty |
| public | full | default, applied |
| admin | full | applied, loading |

To siedem celowych kombinacji zamiast pełnego iloczynu 16. `compact` składa istniejący `Button`, `ResultCount` i opcjonalny rail `FilterChip`. `full` dodaje istniejące `SearchInput` oraz `SortControl`; loading zachowuje geometrię przez istniejący `Skeleton`.

```ts
type FilterBarProps = {
  context: "public" | "admin";
  presentation: "compact" | "full";
  state: "default" | "dirty" | "applied" | "loading";
  query: string;
  appliedFilters: Array<{ id: string; label: string }>;
  resultCount?: number;
  onOpenFilters: () => void;
  onRemoveFilter: (id: string) => void;
};
```

- Strona nadrzędna owns wartości, przejścia dirty/applied, query URL, wrap i poziomy scroll; wzorzec nie tworzy drugiego magazynu stanu.
- Mobile używa triggera i chipów. Od 1024 px dostępne są pełne kontrolki; 768 px zachowuje kompaktowy fallback bez utraty funkcji.
- Sheet, klawiatura, focus, URL i faktyczne ładowanie wymagają testów runtime.

## DS-DAT-021 — FilterSheet

Kontrakt: wzorzec kompozycyjny. Nie powstał dodatkowy komponent biblioteczny, ponieważ FilterSheet składa istniejące shelle i kontrolki.

- Katalog: `1e066793-8858-8051-8008-cf334fe569ba`.
- Obszar czterech kompozycji: `1e066793-8858-8051-8008-cf334fe569bd`.

| Domena | Mobile | Desktop | Pokryte stany |
|---|---|---|---|
| `vehicles` | istniejący `BottomSheet` | istniejący prawy `SideDrawer` | apply, clear, count |
| `logs` | istniejący `BottomSheet` | istniejący prawy `SideDrawer` | apply, clear, count |

W obu domenach zawartość składa rzeczywiste `Checkbox`, `ResultCount` i dwa `Button`: „Wyczyść” oraz „Pokaż N…”. Clear jest disabled bez aktywnych filtrów. Licznik nie jest osobnym ekranem ani osią wariantów; aktualizuje się po zmianie kryteriów i jest ogłaszany jako polite live region.

```ts
type FilterSheetProps = {
  domain: "vehicles" | "logs";
  presentation: "mobile" | "desktop";
  selectedIds: string[];
  resultCount: number;
  open: boolean;
  onToggle: (id: string) => void;
  onApply: () => void;
  onClear: () => void;
  onOpenChange: (open: boolean) => void;
};
```

- Mobile zachowuje wszystkie filtry w bottom sheecie z 16 px gutterem; desktop może użyć prawego drawera 520 px z insetem 24 px.
- Rodzic przechowuje wartości, synchronizuje query/URL i pobiera dane. Wzorzec nie tworzy drugiego magazynu filtrów ani nowej trasy.
- Focus trap, Escape, blokada scrolla tła, zwrot fokusu, klawiatura, synchronizacja URL i rzeczywiste ogłoszenie `aria-live` wymagają testów runtime.

## DS-DAT-022 — LegalContent

Powstał jeden współdzielony komponent treści prawnej, zamiast osobnych komponentów lub osi wariantów dla polityki prywatności i regulaminu.

- Katalog: `efe3ac9b-6991-807f-8008-cf25a15b7b4b`.
- Master Flex: `92bfc32e-2dd6-801a-8008-bec4f17637a6`.
- Komponent biblioteczny: `92bfc32e-2dd6-801a-8008-bec5214ffc0f`.

Jedna kolumna Flex zawiera typ dokumentu, `h1`, datę aktualizacji, nawigację kotwicową, lead, semantyczne `h2`, akapity, listę, link kontaktowy i notę o zatwierdzeniu. Warstwa konsumenta podstawia treść `privacy` albo `terms` oraz ogranicza czytelną szerokość kolumny; breakpoint nie zmienia anatomii.

```ts
type LegalContentProps = {
  documentType: "privacy" | "terms";
  title: string;
  updatedAt: string;
  sections: Array<{
    id: string;
    heading: string;
    paragraphs?: string[];
    items?: string[];
  }>;
  contactHref?: string;
  approvalState: "draft" | "approved";
};
```

- Wariant linku zewnętrznego i brak skonfigurowanej treści są stanami strony/routera, nie nowymi wariantami komponentu. Konfigurację content-versus-link obsługuje istniejący `DS-SET-007 LegalContentEditor`.
- Audyt i rendery katalogu oraz 320, 1024 i 1920 px wykazały zero obcych kolorów/fontów, mikrotekstu, automatycznych nazw i niezamierzonego overflow.
- Finalna treść prawna, akceptacja oraz zachowanie anchorów i linków wymagają zatwierdzenia właściciela treści i testów runtime.

## DS-DAT-023 — ContactDataList

Kontrakt: wzorzec kompozycyjny. Nie powstał kolejny komponent biblioteczny: lista składa istniejące `DS-CNT-003 ContactChannelButton` i `DS-CNT-006 ContactHours`.

- Katalog: `efe3ac9b-6991-807f-8008-cf25aa0bce2a`.
- Obszar kompozycji: `efe3ac9b-6991-807f-8008-cf25aa0bce2d`.

```ts
type ContactDataListProps = {
  phone?: string;
  email?: string;
  whatsapp?: string;
  address?: string;
  hours?: ContactHoursProps;
};
```

- Phone, email i WhatsApp mapują się na istniejące warianty kanałów. Address reużywa wariant `copy/available` z podmienioną etykietą i wartością; hours używa istniejącego wariantu open-text na mobile i structured na desktopie.
- Brak kanału oznacza no-render. Katalog pokazuje pełny zestaw oraz wariant bez email/WhatsApp, bez disabled lub pustej karty.
- Mobile układa elementy pionowo; od tabletu dozwolony jest prosty grid dwóch kolumn. Preview ma siedem dokładnych viewportów 320–1920 px.
- Aktywacja `tel:`, `mailto:`, WhatsApp, kopiowanie adresu i aktualny status godzin wymagają testów runtime.

## DS-DAT-024 — MapEmbed

Jeden komponent biblioteczny obsługuje statyczny podgląd, opcjonalny embed oraz stan wymagający zgody bez tworzenia trzech osobnych komponentów lub osi viewport.

- Katalog: `efe3ac9b-6991-807f-8008-cf25aa0c027b`.
- Master: `92bfc32e-2dd6-801a-8008-bec8d42187d9`.
- Komponent biblioteczny: `92bfc32e-2dd6-801a-8008-bec8f5bd5fc6`.

```ts
type MapEmbedProps = {
  presentation: "static" | "embed";
  state: "ready" | "consent-required";
  address: string;
  externalUrl: string;
  providerUrl?: string;
  onConsent?: () => void;
};
```

- Mobile preferuje `static/ready`; embed jest opcjonalnym ulepszeniem od szerszych widoków. Brak mapy nie ukrywa danych ani akcji kontaktowych.
- `embed/consent-required` pokazuje pustą powierzchnię, wyjaśnienie oraz akcję „Załaduj mapę”; nie ładuje dostawcy przed zgodą. `embed/ready` zachowuje link do pełnej mapy jako dostępny fallback.
- Mapa jest natywną, edytowalną kompozycją kształtów; akcja korzysta z istniejącego `Button secondary/default/md`.
- Provider, consent storage, CSP, budżet wydajności, nawigacja zewnętrzna i dostępny fallback tekstowy wymagają testów runtime.

## DS-AVL-001 — AvailabilityChecker

Natywna struktura, warianty, realne instancje i pięć szerokości walidacyjnych przeszły audyt API oraz świeży odbiór wizualny.

- Katalog: `efe3ac9b-6991-807f-8008-cf25561c8858`.
- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25561c885b`.
- Library component head: `92bfc32e-2dd6-801a-8008-be354f4b86c7`.

| Oś | Wartości utworzone |
|---|---|
| `context` | `homepage`, `list`, `vehicle-detail` |
| `viewport` | `mobile`, `desktop` |
| `state` | `empty`, `partial`, `invalid`, `checking`, `available`, `unavailable`, `network-error`, `stale` |

Zestaw zawiera dziesięć celowych kombinacji zamiast pełnego iloczynu 48. Każdy kontekst, oba sposoby prezentacji i wszystkie osiem wymaganych stanów są reprezentowane, ale nie powielają identycznego zachowania w każdym kontekście.

### Anatomy i odpowiedzialność

1. rzeczywisty `DS-FRM-014 DateRangeField`;
2. rzeczywisty `DS-ACT-001 Button` z disabled albo loading zależnie od stanu;
3. `DS-FBK-003 StatusBadge` i tekst liczby wyników wyłącznie na liście;
4. rzeczywisty `DS-AVL-006 AvailabilityResult` wyłącznie dla pojedynczego
   pojazdu w stanie available, unavailable lub stale;
5. rzeczywisty `DS-FBK-001 Alert` dla błędu sieci/API;
6. brak logiki zapisu, rezerwacji, blokowania dat i tworzenia klienta.

```ts
type AvailabilityCheckerContext = "homepage" | "list" | "vehicle-detail";
type AvailabilityCheckerState =
  | "empty"
  | "partial"
  | "invalid"
  | "checking"
  | "available"
  | "unavailable"
  | "network-error"
  | "stale";

type AvailabilityCheckerProps = {
  context: AvailabilityCheckerContext;
  state: AvailabilityCheckerState;
  startDate: string | null;
  endDate: string | null;
  vehicleId?: string;
  resultCount?: number;
  onCheck: () => void;
  onRetry?: () => void;
  onChangeDates: () => void;
};
```

- Daty są `LocalDate`, koniec zakresu jest wliczony, a zakres jednodniowy jest poprawny. Format widoczny to `dd.MM.yyyy`, strefa `Europe/Warsaw`.
- Homepage kieruje do listy dla wybranego zakresu. Lista filtruje całą flotę i pokazuje liczbę wyników; nie udaje wyniku pojedynczego pojazdu.
- Vehicle detail może pokazać tylko `DOSTĘPNY` albo `NIEDOSTĘPNY`. Nie przekazuje typu blokady, prywatnej notatki ani referencji.
- Pozytywny wynik zawiera dokładne zastrzeżenie: „Dostępność ma charakter informacyjny i wymaga potwierdzenia przez właściciela.” Kontakt nie rezerwuje terminu.
- `checking` ustawia `aria-busy=true`, blokuje ponowne sprawdzenie i zachowuje stabilny układ. Wynik oraz błąd są ogłaszane przez odpowiedni region `aria-live`, bez przenoszenia fokusu wbrew użytkownikowi.
- Mobile jest pionowy i pełnej szerokości. Desktop homepage/list używa układu poziomego; wynik szczegółu pozostaje czytelną kartą. Maksymalna szerokość szczegółowego checkera to 816 px.
- Instancje 320, 430, 768, 1024 i 1920 px po korekcie potomków `fill` nie mają overflow. Na szerokim widoku komponent nie rozciąga się ponad max-width.
- Dwa pozytywne wyniki — agregat listy i szczegół pojazdu — zawierają dokładne zastrzeżenie PRD. Publiczna kompozycja nie pokazuje typu blokady, notatki ani referencji.

## DS-AVL-002 — AvailabilityDateSummary

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25561c881f`.
- Library component ID: `92bfc32e-2dd6-801a-8008-be2cfc4e0057`.
- Main instance ID: `92bfc32e-2dd6-801a-8008-be2c77a18337`.

| Oś | Wartości |
|---|---|
| `density` | `compact`, `detailed` |
| `range` | `start-end`, `one-day` |

Nie istnieje oś viewport. `compact` jest używany nad CTA i w węższym kontekście, a `detailed` w panelu szczegółów. Zmiana szerokości nie zmienia znaczenia danych.

### Anatomy i kontrakt

1. etykieta „Wybrany termin”;
2. sformatowana data albo daty;
3. liczba dni;
4. jawna informacja, że koniec zakresu jest wliczony, gdy zakres ma więcej
   niż jeden dzień.

```ts
type LocalDate = string; // YYYY-MM-DD

type AvailabilityDateSummaryProps = {
  density?: "compact" | "detailed";
  start: LocalDate;
  end: LocalDate; // inclusive
  locale?: "pl-PL";
  timeZone?: "Europe/Warsaw";
};
```

- `start === end` jest poprawnym zakresem jednodniowym i nie wyświetla sztucznego przedziału.
- Liczba dni jest obliczana jako różnica kalendarzowa `+ 1`; komponent nie operuje na godzinach ani timestampach.
- Zakres wielodniowy pokazuje „dzień końcowy wliczony”. Czytelnik ekranu otrzymuje pełne daty i liczbę dni w jednym, zrozumiałym opisie.
- Komponent wyłącznie podsumowuje wybór. Nie sprawdza dostępności, nie rezerwuje terminu i nie tworzy klienta.
- `compact` może wypełnić 320 px. `detailed` ma maksymalną szerokość 720 px i przechodzi z dwóch pól dat do czytelnego stosu w implementacji, jeśli zabraknie miejsca.
- Źródła compact mają 320×80 px, detailed 720×128 lub 720×112 px.

## DS-AVL-003 — PublicAvailabilityCalendar

- Katalog: `efe3ac9b-6991-807f-8008-cf25561ce4ed`.
- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25561ce4f0`.
- Library component head: `92bfc32e-2dd6-801a-8008-be3e06ff8b9e`.

| Oś | Wartości |
|---|---|
| `layout` | `one-month`, `two-month` |
| `state` | `default`, `loading`, `selected`, `unavailable`, `past` |

Zestaw zawiera sześć sensownych kombinacji: wszystkie wymagane stany dla `one-month` oraz `two-month/default`. Nie powielono stanów, których anatomia i zachowanie są już identyczne dzięki wspólnym instancjom `PublicDayCell`.

### Anatomy i kontrakt

1. nawigacja poprzedni/następny miesiąc z celami 44×44 px;
2. zlokalizowany tytuł miesiąca;
3. nagłówki dni od poniedziałku do niedzieli;
4. siatka 6×7 z rzeczywistych instancji `DS-AVL-004 PublicDayCell`;
5. rzeczywista instancja publicznego `DS-AVL-005 CalendarLegend`;
6. komunikat statusowy podczas ładowania.

```ts
type LocalDate = string; // YYYY-MM-DD

type PublicCalendarLayout = "one-month" | "two-month";
type PublicCalendarState =
  | "default"
  | "loading"
  | "selected"
  | "unavailable"
  | "past";

type PublicAvailabilityCalendarProps = {
  layout: PublicCalendarLayout;
  state: PublicCalendarState;
  visibleMonth: LocalDate; // pierwszy dzień miesiąca
  selectedRange?: { start: LocalDate; end: LocalDate }; // inclusive
  availabilityByDate: Record<LocalDate, "available" | "unavailable">;
  minDate: LocalDate;
  onVisibleMonthChange: (month: LocalDate) => void;
  onRangeChange: (range: { start: LocalDate; end: LocalDate }) => void;
};
```

- Wartość publiczna ma wyłącznie `available` albo `unavailable`; API komponentu nie przyjmuje typu, prywatnej notatki ani referencji blokady.
- Zakres używa `LocalDate`, koniec jest wliczony, a jeden dzień jest poprawnym zakresem. Przykład selected obejmuje 12–16.10.2026.
- Dni przeszłe i niedostępne mają `aria-disabled=true`; zakres ma `aria-selected=true`. Siatka stosuje roving `tabindex`, strzałki, Home/End oraz Page Up/Page Down. Przyciski miesięcy mają pełne etykiety, np. „Pokaż listopad 2026”.
- Loading ustawia `aria-busy=true` na regionie kalendarza i zachowuje jawny tekst „Ładowanie dostępności…”. Zmiana miesiąca używa `motion.base` 180 ms; przy reduced motion pozostaje natychmiastowa zmiana treści bez przesunięcia.
- Na 320 px siatka jest kontrolowanym wyjątkiem pełnej szerokości: `7 × 44 + 6 × 2 = 320`. Przy 390 i 430 px jest wyśrodkowana. 768 px zachowuje jeden miesiąc; od 1024 px wariant desktopowy pokazuje dwa miesiące w jednym komponencie.
- Komponent nie rezerwuje pojazdu, nie blokuje terminu i nie tworzy klienta.

## DS-AVL-004 — PublicDayCell

- Katalog: `efe3ac9b-6991-807f-8008-cf25561c8750`.
- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25561c8753`.
- Library component ID: `92bfc32e-2dd6-801a-8008-be2481ac95b4`.
- Main instance ID: `92bfc32e-2dd6-801a-8008-be2427227925`.

| Oś | Wartości |
|---|---|
| `state` | `available`, `unavailable`, `past`, `today`, `selected`, `range-start`, `range-middle`, `range-end` |

Komponent nie ma osi viewport. Źródło ma 44×44 px, a ta sama instancja może mieć 40×40 px w desktopowym kalendarzu.

```ts
type PublicDayCellState =
  | "available"
  | "unavailable"
  | "past"
  | "today"
  | "selected"
  | "range-start"
  | "range-middle"
  | "range-end";

type PublicDayCellProps = {
  date: string; // LocalDate, YYYY-MM-DD
  state: PublicDayCellState;
  tabIndex: 0 | -1;
  onSelect?: (date: string) => void;
  ariaLabel: string;
};
```

- `unavailable` używa przerywanego obramowania i znaku ukośnego, `past` przekreślenia, `today` pierścienia oraz markera, a zakres zmienia geometrię początku, środka i końca. Znaczenie nie zależy wyłącznie od odcienia.
- `past` i `unavailable` są niedostępne do wyboru oraz otrzymują `aria-disabled=true`; publiczny opis nie zawiera przyczyny blokady.
- `selected` i zakres używają `aria-selected=true`. Pełna nazwa dostępna ma zawierać dzień tygodnia, pełną datę i stan, np. „poniedziałek, 12 października 2026, dostępny, początek zakresu”.
- Focus visible jest ortogonalnym pierścieniem 2 px i nie tworzy osobnej osi wariantów. Roving `tabindex`, strzałki, Home/End oraz Page Up/Down należą do kontraktu nadrzędnego kalendarza.
- Na mobile cel pozostaje 44×44 px. Przy szerokości 320 px siedem kolumn 44 px i sześć przerw 2 px zajmuje dokładnie 320 px; dozwolony jest pełnoszeroki wyjątek kalendarza zamiast zmniejszenia celów dotykowych.
- Desktop używa 40×40 px i przerw 4 px. Audyt obu wierszy zwrócił zero overflow, 8/8 unikalnych wariantów i brak `variantError`.
- Bezpośredni eksport Variant Setu i pojedynczego rootu dwukrotnie zakończył się timeoutem usługi Penpota; ponowny odczyt przez MCP potwierdził jednak utrwalenie osi, ID, metadanych i instancji. Klawiatura, roving tabindex i focus-visible pozostają bramkami testów implementacji/runtime.

## DS-AVL-005 — CalendarLegend

- Katalog: `efe3ac9b-6991-807f-8008-cf25561c87a0`.
- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25561c87a3`.
- Library component ID: `92bfc32e-2dd6-801a-8008-be2627f89a38`.
- Main instance ID: `92bfc32e-2dd6-801a-8008-be25dddb5699`.

| Oś | Wartości |
|---|---|
| `context` | `public`, `admin` |

```ts
type CalendarLegendProps = {
  context: "public" | "admin";
};
```

- Publiczny wariant zawiera wyłącznie: „Dostępny”, „Niedostępny”, „Dzisiaj” i „Wybrany zakres”. Nie pokazuje typu ani powodu blokady.
- Wariant administratora może nazwać prywatne typy: „Wolny”, „Rezerwacja”, „Serwis”, „Blokada” i „Inne”. Nie wolno używać go na publicznej trasie.
- Każda pozycja składa znacznik z tekstową etykietą. Znaczniki są dekoracyjne (`aria-hidden=true`), a całość jest semantyczną listą z dostępnymi nazwami.
- Szerokość elementu to 152 px. Przy 320 px dwa elementy i przerwa 16 px mieszczą się dokładnie w jednym wierszu; publiczna legenda ma dwa wiersze, administracyjna trzy. Desktop pozostaje inline.
- Rzeczywiste instancje public/admin przy 320 px oraz oba układy desktopowe przeszły kontrolę bez overflow, błędów wariantów, automatycznych nazw, tekstów poniżej 12 px i kolorów spoza palety. Oś `context` ma dokładnie dwie unikalne wartości.
- Rzeczywiste ogłaszanie listy przez czytnik ekranu pozostaje osobną bramką implementacji/runtime.

## DS-AVL-006 — AvailabilityResult

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf251bc859ad`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afd9de880ef5`.

| Oś | Wartości w katalogu |
|---|---|
| `state` | `available`, `unavailable`, `invalid`, `stale` |
| `viewport` | `desktop`, `mobile` |
| `actions` | `primary`, `alternative`, `repair`, `retry` |

Każdy z czterech stanów istnieje w mobile i desktop. Status zawsze łączy znak, tekst i obramowanie. Wszystkie warianty zawierają disclaimer, że wynik nie jest rezerwacją.

```ts
type AvailabilityResultProps = {
  state: "available" | "unavailable" | "invalid" | "stale";
  vehicleName?: string;
  rangeLabel?: string;
  onContact?: () => void;
  onChangeRange?: () => void;
  onShowAlternatives?: () => void;
  onRetry?: () => void;
};
```

- Stan available nie oznacza utworzenia klienta ani rezerwacji.
- Unavailable nie ujawnia publicznie przyczyny blokady.
- Stale nie zachowuje starego pozytywnego wyniku bez ostrzeżenia i akcji retry.
- Dynamiczny wynik używa odpowiednio `role=status`; błąd walidacji nie jest wielokrotnie ogłaszany przy każdym znaku.

## DS-AVL-007 — AvailabilityDisclaimer

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25429e283e`.
- Library component head: `368ee0a4-28c8-80cb-8008-b8182723ff99`.
- Catalog i rzeczywiste instancje wariantów: `efe3ac9b-6991-807f-8008-cf25429e2839`.

| Oś | Wartości |
|---|---|
| `density` | `compact`, `full` |

### Anatomy i kontrakt

1. ikona `Info` z Lucide;
2. edytowalna treść zastrzeżenia;
3. w wariancie `full` dodatkowy tytuł „Informacja o dostępności”.

```ts
type AvailabilityDisclaimerProps = {
  density?: "compact" | "full";
  message?: string;
};
```

Domyślna treść `compact` brzmi dokładnie:

> Dostępność ma charakter informacyjny i wymaga potwierdzenia przez
> właściciela.

- Komponent jest wymagany przy pozytywnym wyniku dostępności. `full` może dopowiedzieć: „Kontakt nie tworzy rezerwacji terminu.”
- Nie wolno zastępować tekstu samą ikoną ani samym kolorem. Ikona jest dekoracyjna, jeśli pełny tekst pozostaje dostępny; grupa może być opisana przez `role="note"` albo zwykły element tekstowy zależnie od kontekstu.
- Treść publiczna nie ujawnia typu blokady, notatki wewnętrznej ani referencji. Komponent nie dodaje procesu rezerwacji.
- `compact` ma 320 px, a `full` 720 px.

## DS-AVL-008 — AdminVehicleCalendar

- Catalog board: `7cf0d39f-ce5c-80f6-8008-cf31083bd77b`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf31083bd77e`.
- Library component head: `92bfc32e-2dd6-801a-8008-be48610da66f`.

| Oś | Wartości |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `layout` | `month`, `month+list` |
| `state` | `default`, `loading`, `empty`, `conflict`, `editing` |

Variant Set ma siedem celowych kombinacji zamiast pełnego iloczynu 20. Mobile udostępnia sam miesiąc albo miesiąc z listą pod spodem; desktop łączy miesiąc z panelem bocznym. Każdy wariant używa 42 rzeczywistych instancji `DS-AVL-009 AdminDayCell`. Lista i stany szczegółowe reużywają istniejące `BlockEvent`, `CalendarLegend`, `BlockConflictCard` i `Button`.

```ts
type AdminVehicleCalendarProps = {
  viewport: "mobile" | "desktop";
  layout?: "month" | "month+list";
  state?: "default" | "loading" | "empty" | "conflict" | "editing";
  vehicle: { id: string; name: string; registration?: string };
  month: LocalDate;
  blocks: AvailabilityBlock[];
  selectedBlockId?: string;
  onMonthChange?: (month: LocalDate) => void;
  onSelectRange?: (start: LocalDate, end: LocalDate) => void;
  onOpenBlock?: (blockId: string) => void;
  onAddBlock?: () => void;
};
```

- Tydzień zaczyna się w poniedziałek, a zakresy dat są domknięte.
- Mobile mieści pełną siatkę 7 × 44 px w 320 px i zachowuje główną akcję „Dodaj niedostępność”. Desktop dodaje skróty „Dzisiaj” i „Następny”.
- `empty` nie ukrywa akcji dodania blokady; `loading` ma jawny komunikat; `conflict` używa istniejącej karty konfliktu; `editing` pokazuje typ, daty, prywatną notatkę i źródło wyłącznie administratorowi.
- Typy `reserved`, `maintenance`, `blocked` i `other` mają marker tekstowy lub geometryczny oprócz koloru. Cele dni pozostają 44 px.
- Trzy warianty desktopowe mają 1120×610 px: miesiąc ma 472 px, siatka 472×404 px, a 42 pola dnia po 64×64 px. `ADM-09 desktop` używa jednej instancji źródła zamiast luźnych pól wewnątrz pustej karty.
- Podgląd zawiera rzeczywiste instancje dla 320, 390, 768, 1024, 1440 i 1920 px. Audyt: 7/7 kombinacji, zero `variantError`, overflow, automatycznych nazw, kolorów spoza palety i treści użytkowej poniżej 12 px. Dekoracyjny `Type mark` w `AdminDayCell` ma 9 px; metadane `BlockEvent` podniesiono z 10 do 12 px we wszystkich 16 wariantach.
- Komponent nie tworzy rezerwacji online, płatności ani kont klienta.

## DS-NAV-007 — AdminSidebar

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a4e05e`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afe7cf308b7f`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `expanded`, `collapsed` |
| `state` | `active`, `hover`, `badge`, `disabled` |

```ts
type AdminSidebarProps = {
  mode?: "expanded" | "collapsed";
  activeItem: "dashboard" | "vehicles" | "chat" | "settings" | "account";
  unreadChatCount?: number;
};
```

- Szerokości wynoszą odpowiednio 240 i 72 px.
- Cele MVP: Dashboard → `/admin`, Pojazdy → `/admin/pojazdy`, Czat z Autervą → `/admin/czat`, Ustawienia → `/admin/ustawienia`, Konto → `/admin/konto`. Nie ma osobnego celu „Dostępność” bez pojazdu; jego kalendarz otwiera widoczna akcja w `VehicleAdminItem`.
- Active używa powierzchni, wagi tekstu i ikony, nie wyłącznie koloru.
- Badge przy Czat z Autervą w expanded pokazuje liczbę nowych wiadomości; collapsed używa notification dot z dostępną nazwą. Gdy liczba nie jest znana, pokazujemy sam opisany stan nowych wiadomości.
- Po zwinięciu każda ikona wymaga tooltipu i czytelnej nazwy dla AT.

## DS-NAV-008 — AdminTopbar

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a4e123`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afe869ab1f84`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `desktop`, `mobile` |
| `status` | `online`, `offline`, `update` |

```ts
type AdminTopbarProps = {
  viewport: "desktop" | "mobile";
  title: string;
  breadcrumbs?: BreadcrumbItem[];
  connectionStatus?: "online" | "offline" | "update";
  onSearch?: (query: string) => void;
};
```

- Desktop pokazuje breadcrumbs, wyszukiwanie i menu użytkownika; mobile tytuł oraz status/menu.
- Offline i update zawsze mają symbol oraz tekst.
- Search ma widoczną etykietę dostępną mimo wizualnego placeholdera.

## DS-NAV-009 — AdminBottomNavigation

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a4e15a`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-afe8bf3c4467`.

| Oś | Wartości w katalogu |
|---|---|
| `active` | `dashboard`, `vehicles`, `chat`, `more` |
| `notification` | `none`, `dot` |

```ts
type AdminBottomNavigationProps = {
  active: "dashboard" | "vehicles" | "chat" | "more";
  hasUnreadChat?: boolean;
};
```

- Cztery cele mają stałe etykiety: Start (`/admin`), Pojazdy (`/admin/pojazdy`), Czat (`/admin/czat`) i Więcej (otwarcie menu, nie link). Kalendarz konkretnego pojazdu jest dostępny przez akcję na liście; ADM-10 pozostaje SHOULD poza nawigacją MVP.
- W ośmiu wariantach Penpota są dokładnie cztery widoczne itemy; etykiety są wyśrodkowane pod ikonami także po rozszerzeniu komórki do 97,5 px w `ADM-04` mobile.
- Active jest oznaczony wagą tekstu i ikoną; dot na Czat nie jest jedynym nośnikiem informacji o nowych wiadomościach i ma nazwę dostępną.
- Komponent respektuje dolny safe area i nie zasłania ostatniego elementu formularza.

## DS-AVL-009 — AdminDayCell

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a4e2dc`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-aff2244d9b8d`.

| Oś | Wartości w katalogu |
|---|---|
| `status` | `free`, `reserved`, `maintenance`, `blocked`, `other` |
| `state` | `default`, `today`, `selected` |

Komórka ma 44 px i nie komunikuje stanu wyłącznie kolorem: typ niedostępności ma znak tekstowy, a today/selected korzystają także z obramowania i symbolu.

## DS-AVL-010 — BlockEvent

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a4e2f2`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-aff284d9b0a4`.

| Oś | Wartości w katalogu |
|---|---|
| `type` | `reserved`, `maintenance`, `blocked`, `other` |
| `state` | `default`, `hover`, `selected`, `truncated` |

Warianty zawierają typ, zakres i numer referencyjny przeznaczone wyłącznie dla administratora. Publiczna warstwa nie może używać tego komponentu ani ujawniać jego prywatnych metadanych.

## DS-AVL-011 — BlockTypeBadge

`BlockTypeBadge` jest domenowym użyciem istniejącego, zweryfikowanego `DS-FBK-003 StatusBadge`, a nie osobnym komponentem biblioteki. Zapobiega to utrzymywaniu dwóch identycznych badge’y.

- Library component head: `a4abf4c9-2e1f-80fd-8008-b000917add0e`.
- Catalog board: `7cf0d39f-ce5c-80f6-8008-cf29549c6bbd`.
- Używana kategoria wariantu: `category=block`.

| Typ domenowy | `value` | Etykieta i znak |
|---|---|---|
| `RESERVED` | `reserved` | `◆ Rezerwacja` |
| `MAINTENANCE` | `maintenance` | `↻ Serwis` |
| `BLOCKED` | `blocked` | `■ Blokada` |
| `OTHER` | `other` | `• Inne` |

```ts
type BlockType = "RESERVED" | "MAINTENANCE" | "BLOCKED" | "OTHER";

type BlockTypeBadgeProps = {
  type: BlockType;
};
```

- Wszystkie warianty mają 196 × 40 px, tekst 12 px, obramowanie oraz odrębny znak; kolor nie jest jedynym nośnikiem znaczenia.
- Fill, tekst, obramowanie, jego szerokość i promień są związane z istniejącymi tokenami semantycznymi.
- Badge jest prywatny i może być renderowany tylko w interfejsie administratora. Publiczne API i UI nadal pokazują wyłącznie „dostępny” lub „niedostępny”.
- Odczyt Penpota potwierdził cztery warianty i brak `variantError`; katalog `DS-FBK-003` ma wcześniej zweryfikowany eksport.

## DS-SET-001 — SettingsNavigation

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a50fac`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-aff67181b446`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `desktop`, `mobile` |
| `active` | `company`, `contact`, `presentation`, `legal` |

Desktop używa sticky side navigation, mobile poziomych tabs. Licznik błędów sekcji kontaktowej pozostaje widoczny w obu trybach; aktywność ma powierzchnię i wagę tekstu, nie tylko kolor.

## DS-FBK-003 — StatusBadge

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf29549c6bbd`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b000917add0e`.

| Oś | Wartości w katalogu |
|---|---|
| `category` | `availability`, `publication`, `block`, `session` |
| `value` | `available`, `unavailable`, `draft`, `published`, `hidden`, `archived`, `reserved`, `maintenance`, `blocked`, `other`, `current`, `active`, `expired` |

```ts
type StatusBadgeProps =
  | { category: "availability"; value: "available" | "unavailable" }
  | {
      category: "publication";
      value: "draft" | "published" | "hidden" | "archived";
    }
  | {
      category: "block";
      value: "reserved" | "maintenance" | "blocked" | "other";
    }
  | { category: "session"; value: "current" | "active" | "expired" };
```

- Trzynaście wariantów korzysta z Auto Layout i tokenów semantycznych.
- Każdy status ma znak oraz tekst i obramowanie; żaden nie polega wyłącznie na kolorze.
- Typy blokad są prywatnym słownikiem administratora i nie mogą trafić do publicznego API, HTML ani propsów RSC.

## DS-FBK-004 — Toast

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b9a0`.
- Library component head: `368ee0a4-28c8-80cb-8008-b81b0d88dab1`.
- Catalog: `7cf0d39f-ce5c-80f6-8008-cf2d4d94b99d`.

| Oś | Wartości utworzone |
|---|---|
| `type` | `success`, `error`, `info`, `undo` |

Wspólna anatomia 358×88 px zawiera nazwany znacznik statusu, edytowalny tytuł i opis oraz jedną akcję 98×44 px. Status jest przekazywany ikoną/znakiem i tekstem, nie samym kolorem. Mobile składa instancję przy dolnej krawędzi nad nawigacją, a desktop w prawym górnym rogu; viewport nie jest osobną osią wariantów.

```ts
type ToastProps = {
  type: "success" | "error" | "info" | "undo";
  title: string;
  description?: string;
  action?: { label: string; onSelect: () => void };
  onDismiss?: () => void;
};
```

- `success` i `info` mogą zamykać się automatycznie tylko wtedy, gdy komunikat nie jest krytyczny i pozostaje dostępny przez region `aria-live="polite"`.
- `error` nie znika automatycznie; akcja „Ponów” zachowuje kontekst operacji.
- `undo` utrzymuje widoczną akcję „Cofnij” przez cały czas życia komunikatu.
- Pauza timera przy hover/focus, kolejka komunikatów, przeniesienie fokusu i ogłoszenia czytnika ekranu są kontraktem runtime, nie cechą statycznej makiety.
- Wejście/wyjście używa `motion.base` 180 ms; przy reduced motion pozostaje wyłącznie krótka zmiana opacity bez przesunięcia.

## DS-FBK-005 — GlobalBanner

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d67129187`.
- Library component head: `368ee0a4-28c8-80cb-8008-b81c8ed2e1a6`.
- Catalog: `7cf0d39f-ce5c-80f6-8008-cf2d67129184`.

| Oś | Wartości utworzone |
|---|---|
| `type` | `offline`, `update`, `maintenance` |

Komponent jest cienką warstwą kompozycji, a nie trzecią kopią istniejącego UI:

- `offline` składa rzeczywistą instancję `DS-PWA-002 OfflineBanner` w wariancie `presentation=compact`, `state=offline`;
- `update` składa instancję `Shared / Feedback / Alert` w wariancie `warning/link` i ma nazwany cel akcji 220×44 px;
- `maintenance` składa instancję Alert `info`, bez akcji i bez dismiss.

Wrapper używa Flex `fill/stretch`, dlatego te same warianty obsługują 390 i 1000 px bez osi viewport. Sticky positioning należy do shella strony; sam komponent pozostaje w normalnym przepływie dokumentu.

```ts
type GlobalBannerProps =
  | { type: "offline" }
  | { type: "update"; onOpenUpdate: () => void }
  | { type: "maintenance"; message?: string };
```

- Offline nie może obiecywać zapisu ani kolejki offline.
- Update prowadzi do istniejącego `UpdatePrompt`; przy dirty form odświeżenie nadal musi przejść przez `OVR-13`.
- Offline i maintenance są niedismissowalne. Update może zostać odłożony tylko w kontrolowanym flow PWA, nie przez przypadkowe ukrycie bannera.
- Region używa `role="alert"` wyłącznie dla blokującego offline; update i maintenance powinny korzystać z `role="status"`/`aria-live="polite"`.
- Pojawienie używa `motion.base` 180 ms; reduced motion usuwa przesunięcie.

## DS-FBK-017 — ConfirmDialog

- Penpot catalog: `7cf0d39f-ce5c-80f6-8008-cf2d67129208`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d6712920b`.
- Library component head: `368ee0a4-28c8-80cb-8008-b82355ea3cd0`.

| Oś | Wartości w katalogu |
|---|---|
| `intent` | `publish`, `unpublish`, `archive`, `delete` |

To wyspecjalizowana kompozycja istniejącego `Shared / Feedback / Dialog`, a nie jego kopia. Każdy wariant zawiera prawdziwą instancję Dialogu oraz zagnieżdżone instancje Buttonów: neutralne „Anuluj” i pełną etykietę operacji. Treść zawsze nazywa obiekt, opisuje skutek i mówi, czy zmianę można odwrócić. `publish` używa akcji primary; `unpublish`, `archive` i `delete` używają wariantu destructive.

```ts
type ConfirmDialogProps = {
  intent: "publish" | "unpublish" | "archive" | "delete";
  objectName: string;
  effect: string;
  reversible: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};
```

- Desktop używa dialogu 640 px. Mobile pokazuje dozwolony pełnoszeroki dialog 342 px w viewportcie 390 px z akcjami 294×48 px ułożonymi pionowo. Viewport nie jest osobną osią wariantów.
- Implementacja wymaga `role="alertdialog"`, `aria-labelledby`, `aria-describedby`, pułapki fokusu, zamknięcia przez Escape oraz zwrotu fokusu do wyzwalacza. Statyczna makieta nie potwierdza tych zachowań.
- Potwierdzenie wykonuje autoryzowaną operację serwerową; stan sukcesu pojawia się dopiero po odpowiedzi. Podwójne kliknięcie blokuje się przez stan pending, a błąd zachowuje kontekst i pozwala ponowić.
- Wejście używa `motion.base` 180 ms; reduced motion pozostawia zmianę opacity.
- Fioletowy stroke kontenera wariantów jest interfejsem edytora Penpota.

## DS-FBK-018 — UnsavedChangesDialog

- Penpot catalog: `7cf0d39f-ce5c-80f6-8008-cf2d671291df`.
- Penpot source component: `368ee0a4-28c8-80cb-8008-b8211d5ca393`.
- Library component: `368ee0a4-28c8-80cb-8008-b82192b16b35`.

`stay`, `discard` i `save` są trzema decyzjami widocznymi jednocześnie, a nie osią wariantów. Komponent pozostaje pojedynczą kompozycją istniejącego Dialogu i Buttonów:

- „Zostań” — secondary, bezpieczne zamknięcie dialogu bez utraty formularza;
- „Odrzuć zmiany” — destructive, opuszczenie bez zapisu;
- „Zapisz i wyjdź” — primary, zapis potwierdzony przez serwer przed przejściem.

```ts
type UnsavedChangesDialogProps = {
  open: boolean;
  contextLabel?: string;
  onStay: () => void;
  onDiscard: () => void | Promise<void>;
  onSaveAndLeave: () => void | Promise<void>;
};
```

- Desktop używa 640×388 px, mobile pełnego dialogu 342×396 px. Mobile układa trzy akcje pionowo; każda ma 294×48 px i pozostaje widoczna bez przewijania.
- Warstwa nie zamyka się przez kliknięcie scrimu. Escape odpowiada bezpiecznej decyzji „Zostań”, o ile produkt nie wymaga jawnego wyboru przy krytycznej operacji.
- Implementacja wymaga `role="alertdialog"`, nazwanych title/description, pułapki fokusu i zwrotu fokusu. Podczas zapisu akcje przechodzą w stan pending i nie wolno nawigować przed potwierdzeniem serwera.
- Istniejący `OVR-13` zachowuje zgodną anatomię, ale po rollbacku wymaga osobnej podmiany na odbudowaną instancję i świeżego renderu; nie należy przedstawiać historycznej kompozycji prototypowej jako aktualnego spięcia.

## DS-FBK-020 — SessionExpiredDialog

- Penpot catalog: `7cf0d39f-ce5c-80f6-8008-cf2d671291b9`.
- Penpot source component: `368ee0a4-28c8-80cb-8008-b81dca1fd7f6`.
- Library component: `368ee0a4-28c8-80cb-8008-b81e20a7f64a`.

Komponent jest pojedynczym krytycznym dialogiem, bez sztucznej osi wariantów. Ponowne logowanie i odrzucenie danych lokalnych są dwiema równoczesnymi decyzjami:

- „Odrzuć dane lokalne” — destructive; czyści wyłącznie niezapisany lokalny stan formularza i nie wykonuje operacji biznesowej;
- „Zaloguj się ponownie” — primary; rozpoczyna bezpieczną reautoryzację.

```ts
type SessionExpiredDialogProps = {
  open: boolean;
  onDiscardLocalData: () => void | Promise<void>;
  onRelogin: () => void | Promise<void>;
};
```

- Desktop używa dialogu 640×332 px z dwiema akcjami 216×48 px. Mobile używa 342×380 px i dwóch akcji 294×48 px ułożonych pionowo bez overflow.
- Po rollbacku nie potwierdzono ponownego spięcia historycznych instancji `session-expired` w `DS-LYT-006 AdminPageShell`. Odbudowany komponent jest gotowy do tego użycia, ale integrację `OVR-14` należy zweryfikować osobno; nie należy tworzyć ręcznej kopii overlayu ani dodatkowego ekranu.
- Docelowe tło stanu wygasłej sesji zawiera wyłącznie neutralny shell nawigacji i pusty slot. Dane pojazdu, klienta, blokady i kontaktu nie mogą pozostawać widoczne; po rollbacku integracja shella wymaga ponownego spięcia.
- Implementacja wymaga `role="alertdialog"`, nazwanych title/description, pułapki fokusu oraz braku click-outside. Polityka Escape nie może omijać jawnej decyzji o lokalnych danych.
- Runtime musi atomowo wyczyścić prywatne dane z DOM/RSC i pamięci klienta, zablokować wielokrotne akcje podczas pending oraz po reautoryzacji wrócić wyłącznie do bezpiecznej trasy.

## DS-FBK-021 — AnnouncementRegion

Kontrakt: niewidoczny kontrakt semantyczny. Nie powstał fikcyjny komponent wizualny ani osobny ekran.

- Board kontraktu: `efe3ac9b-6991-807f-8008-cf231feb3fc3`.
- Panel polite: `efe3ac9b-6991-807f-8008-cf231feb3fc6`.
- Panel assertive: `efe3ac9b-6991-807f-8008-cf231feb3fc7`.

```ts
type AnnouncementRegionProps = {
  politeness: "polite" | "assertive";
  message: string;
  dedupeKey?: string;
};
```

| Wariant | Kontrakt | Zastosowanie |
|---|---|---|
| `polite` | `role=status`, `aria-live=polite`, `aria-atomic=true` | wyniki filtrów, zakończenie zapisu, kopiowanie |
| `assertive` | `role=alert`, `aria-live=assertive`, `aria-atomic=true` | blokujący błąd zapisu, utrata sesji |

- Aktualizowany jest istniejący region; fokus nie jest przenoszony.
- Szybkie zmiany należy łączyć, identycznych tekstów nie powtarzać, a treści już odczytywanej z fokusu nie ogłaszać drugi raz.
- Assertive jest zarezerwowany dla problemów blokujących i nie dubluje każdego błędu pola w regionie globalnym.
- Mobile i desktop mają identyczny niewidoczny kontrakt, dlatego responsive i cele dotykowe są jawnie N/A.
- Audyt boardu potwierdził brak obcych kolorów/fontów, mikrotekstu, automatycznych nazw i overflow. Rzeczywiste timing, koalescencja i czytnik ekranu wymagają testów runtime.

## DS-FRM-010 — Checkbox

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf1b6b`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b00114c5e90a`.

| Oś | Wartości w katalogu |
|---|---|
| `value` | `unchecked`, `checked`, `indeterminate` |
| `state` | `default`, `hover`, `focus`, `disabled`, `error` |

```ts
type CheckboxProps = {
  checked: boolean | "indeterminate";
  label: string;
  disabled?: boolean;
  invalid?: boolean;
  required?: boolean;
  onCheckedChange?: (value: boolean | "indeterminate") => void;
};
```

- Kontener ma 56 px wysokości, a kontrolka 24×24 px; cały wiersz jest celem interakcji i przekracza minimum 44 px.
- Focus ma niezależne obramowanie całego wiersza, disabled zachowuje czytelną etykietę, a error dodaje jawny tekst `Wymagane`.
- Indeterminate jest osobną wartością semantyczną, nie dekoracyjną ikoną.
- W implementacji kontrolka wymaga dostępnej nazwy, `aria-invalid` dla błędu oraz powiązania komunikatu przez `aria-describedby`.

## DS-FRM-011 — RadioGroup

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf779d`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b04298d3f2af`.

| Oś | Wartości w katalogu |
|---|---|
| `layout` | `vertical`, `cards`, `inline` |
| `viewport` | `mobile`, `desktop` |
| `state` | `default`, `selected`, `focus`, `disabled` |

Dozwolone kombinacje layout/viewport to `vertical/mobile`, `cards/mobile`, `inline/desktop` i `cards/desktop`. Nie tworzymy sztucznego `inline/mobile` ani `vertical/desktop`, ponieważ SPEC wskazuje inne zachowanie na tych viewportach.

```ts
type RadioOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type RadioGroupProps = {
  legend: string;
  options: RadioOption[];
  value?: string;
  layout: "vertical" | "cards" | "inline";
  viewport: "mobile" | "desktop";
  disabled?: boolean;
  onValueChange?: (value: string) => void;
};
```

- Każdy wariant ma trzy edytowalne opcje, 20 px radio i jawny tekst stanu. Wiersze vertical/inline mają 44 px, a karty 64 px.
- Selected wykorzystuje pozycję wypełnionej kropki, mocniejsze obramowanie i tekst `Wybrano: Automatyczna`. Focus ma obramowanie 2 px i tekst `Fokus klawiatury: Automatyczna`; stan nie zależy wyłącznie od koloru.
- Implementacja używa `fieldset` i `legend` albo równoważnego `radiogroup` z dostępną nazwą. Strzałki zmieniają aktywną opcję, Tab opuszcza grupę, a disabled blokuje interakcję bez usuwania wartości z modelu formularza.

## DS-FRM-007 — Select

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf1be4`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b03c6f63f436`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `single`, `native` |
| `viewport` | `mobile`, `desktop` |
| `state` | `default`, `open`, `selected`, `error`, `disabled` |

```ts
type SelectProps = {
  label: string;
  value?: string;
  options: Array<{ value: string; label: string }>;
  mode?: "single" | "native";
  viewport: "mobile" | "desktop";
  disabled?: boolean;
  invalid?: boolean;
  onValueChange?: (value: string) => void;
};
```

- Dwadzieścia wariantów rozdziela zachowanie single od fallbacku natywnego oraz mobile od desktopu. Kontrolka ma 48 px wysokości i pełną szerokość wariantu: 296 px mobile lub 336 px desktop.
- `single/open` dokumentuje bottom sheet na mobile i popover na desktopie. `native/open` pokazuje jednowybieralną listę systemową.
- Selected ma jawny tekst wybranej opcji; error dodaje komunikat `Wybierz jedną opcję`; disabled ma osobny tekst i tokeny. Żaden stan nie opiera się wyłącznie na kolorze.
- Implementacja customowa wymaga etykiety, `aria-expanded`, `aria-controls`, `aria-activedescendant`, obsługi strzałek/Escape oraz `aria-invalid` z `aria-describedby`. Wariant native powinien użyć rzeczywistego `<select>`.

## DS-FRM-012 — Switch

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf1ba3`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b037e840b961`.

| Oś | Wartości w katalogu |
|---|---|
| `labelPosition` | `left`, `right` |
| `value` | `off`, `on` |
| `state` | `default`, `focus`, `disabled`, `loading` |

```ts
type SwitchProps = {
  checked: boolean;
  label: string;
  labelPosition?: "left" | "right";
  disabled?: boolean;
  loading?: boolean;
  onCheckedChange?: (checked: boolean) => void;
};
```

- Szesnaście wariantów ma 56 px wysokości; track ma 52×30 px, a thumb 22×22 px. Cały wiersz pozostaje celem interakcji większym niż 44 px.
- Wartość jest komunikowana pozycją thumba i tekstem `Włączone` / `Wyłączone`, nie wyłącznie kolorem. Loading zastępuje thumb symbolem `↻` i tekstem `Ładowanie`.
- Focus ma niezależne obramowanie całego wiersza. Disabled używa tokenów `surface.disabled` i `text.disabled`.
- Obie pozycje etykiety zachowują tę samą kolejność warstw; wariant `right` korzysta z kierunku Auto Layout `row-reverse`, co stabilizuje dziedziczenie tokenów w Penpocie.
- Implementacja webowa wymaga roli `switch`, `aria-checked`, dostępnej nazwy oraz `aria-busy` w stanie loading. Podczas loading zmiana wartości jest zablokowana.

## DS-FRM-013 — DateInput

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf1c6d`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b03f5c283951`.

| Oś | Wartości w katalogu |
|---|---|
| `kind` | `start`, `end`, `single-day` |
| `viewport` | `mobile`, `desktop` |
| `state` | `default`, `invalid`, `past-date`, `disabled` |

```ts
type LocalDate = string; // YYYY-MM-DD

type DateInputProps = {
  kind: "start" | "end" | "single-day";
  viewport: "mobile" | "desktop";
  value?: LocalDate;
  disabled?: boolean;
  invalid?: boolean;
  min?: LocalDate;
  onValueChange?: (value: LocalDate | undefined) => void;
};
```

- Dwadzieścia cztery warianty mają kontrolkę 48 px, szerokość 296 px mobile lub 336 px desktop oraz natywną ikonę wektorową Lucide Calendar.
- Mobile dokumentuje klawiaturę i picker, desktop wpisywanie tekstu i popover. Format prezentacji to `dd.mm.rrrr`, a kontrakt danych pozostaje `LocalDate` `YYYY-MM-DD` bez konwersji przez UTC.
- Invalid używa przykładu `31.02.2026` i tekstu `Nieprawidłowa data`; past-date używa jawnego tekstu `Data w przeszłości`. Disabled ma osobny komunikat i tokeny. Stany nie polegają wyłącznie na kolorze.
- „Dzisiaj” oraz ograniczenia przeszłych dat są liczone w `Europe/Warsaw`. Pole musi mieć powiązaną etykietę, `aria-invalid` i komunikat przez `aria-describedby`; otwarcie pickera nie może usuwać wartości wpisanej.

## DS-FRM-014 — DateRangeField

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf1d76`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b040d8384c2e`.

| Oś | Wartości w katalogu |
|---|---|
| `layout` | `two-inputs`, `compact` |
| `viewport` | `mobile`, `desktop` |
| `state` | `empty`, `partial`, `valid`, `invalid`, `checking` |

```ts
type DateRangeValue = {
  start: LocalDate;
  end: LocalDate;
};

type DateRangeFieldProps = {
  layout?: "two-inputs" | "compact";
  viewport: "mobile" | "desktop";
  value?: Partial<DateRangeValue>;
  state?: "empty" | "partial" | "valid" | "invalid" | "checking";
  onValueChange?: (value: Partial<DateRangeValue>) => void;
};
```

- Dwadzieścia wariantów używa rzeczywistych instancji `DateInput`: po dwie w `two-inputs` i jedną w `compact`. Mobile układa dwa pola pionowo, desktop w dwóch kolumnach.
- Zakres jest domknięty. `start === end` jest poprawny i oznacza jeden dzień; wariant valid pokazuje `24.09.2026 · 1 dzień`.
- Partial wskazuje brak daty końcowej, invalid wyjaśnia, że koniec nie może poprzedzać początku, a checking ma znak `↻` i tekst. Stan nie jest przekazywany wyłącznie kolorem.
- Walidacja działa na `LocalDate` w `Europe/Warsaw`; nie wolno porównywać dat po przypadkowej konwersji do UTC. Błąd zakresu powinien być powiązany z oboma polami przez `aria-describedby`, a checking sygnalizowany przez `aria-busy`.

## DS-FRM-015 — DateRangePicker

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf79ff`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b04763c26af7`.

| Oś | Wartości w katalogu |
|---|---|
| `context` | `public`, `admin` |
| `months` | `one`, `two` |
| `viewport` | `mobile`, `desktop` |
| `state` | `selecting-start`, `selecting-end`, `selected`, `unavailable` |

Dozwolone kombinacje responsywne to `one/mobile` oraz `two/desktop` dla obu kontekstów i wszystkich czterech stanów. Nie tworzymy dwumiesięcznego mobile ani jednomiesięcznego desktopu jako wariantów głównych.

```ts
type DateRangePickerProps = {
  context: "public" | "admin";
  viewport: "mobile" | "desktop";
  value?: Partial<{ start: LocalDate; end: LocalDate }>;
  state: "selecting-start" | "selecting-end" | "selected" | "unavailable";
  onValueChange?: (value: Partial<{ start: LocalDate; end: LocalDate }>) => void;
  onConfirm?: () => void;
};
```

- Każdy wariant korzysta z rzeczywistych instancji `CalendarGrid` i `Button`: jednej siatki na mobile oraz dwóch na desktopie.
- Mobile ma 390 px i pełnoekranowy sheet ze sticky headerem; desktop ma 840 px, dwa miesiące i zachowanie popoveru/panelu. Kontrola obejmuje również 320 px: sama siatka zachowuje pełne cele dni 44 px dzięki wariantowi full-bleed.
- `selecting-end` jawnie przypomina, że koniec zakresu jest wliczony. Selected pokazuje `10–14 września 2026 · 5 dni · Europe/Warsaw`.
- Publiczny unavailable nie ujawnia przyczyny. Wariant admin może podać typ konfliktu i pozwala skorygować daty przed zapisem.
- Po pierwszym eksporcie warianty desktop zwiększono do 620 px; ponowny eksport i kontrola bounds potwierdziły, że przycisk nie jest przycięty. Mobile ma 650 px i również mieści pełną akcję.
- Implementacja utrzymuje fokus w sheet/popover, obsługuje Escape i zwrot fokusu, a zakres przechowuje jako domknięte `LocalDate` w `Europe/Warsaw`.

## DS-FRM-016 — CalendarGrid

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2992bf789e`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b0454ffdf71a`.

| Oś | Wartości w katalogu |
|---|---|
| `context` | `public`, `admin` |
| `layout` | `month`, `fleet` |
| `viewport` | `mobile`, `desktop` |
| `state` | `default`, `loading`, `keyboard-focus`, `selected-range`, `unavailable` |

Dozwolone kombinacje to `public/month`, `admin/month` i `admin/fleet` na obu viewportach. `unavailable` dotyczy widoku miesiąca; flota ma cztery pozostałe stany. Nie istnieje publiczny wariant floty, aby nie stworzyć ścieżki wycieku prywatnego typu ani źródła blokady.

```ts
type LocalDate = string; // YYYY-MM-DD

type CalendarGridProps = {
  context: "public" | "admin";
  layout: "month" | "fleet";
  viewport: "mobile" | "desktop";
  state?:
    | "default"
    | "loading"
    | "keyboard-focus"
    | "selected-range"
    | "unavailable";
  visibleMonth: LocalDate;
  range?: { start: LocalDate; end: LocalDate };
  onRangeChange?: (range: { start: LocalDate; end: LocalDate }) => void;
};
```

- Miesiąc mobile ma 344 px, wewnętrzną siatkę 320 px i cele dni 44 px z odstępami 2 px. Na ekranie 320 px implementacja używa pełnego viewportu bez bocznego paddingu, zamiast zmniejszać cele dotykowe.
- Zakres `10–14 września` pokazuje pięć dni, a tekst jawnie potwierdza, że koniec jest wliczony. Focus ma niezależne obramowanie 2 px i nazwę dnia.
- Publiczne `unavailable` mówi wyłącznie „niedostępne”; nazwa typu blokady (`konserwacja`) występuje tylko w wariancie administracyjnym.
- Flota desktop używa macierzy z osiami pojazdów i dat. Mobile zachowuje pełną funkcjonalność przez listę pojazdów z zakresem i wejściem do szczegółów, nie przez ściśniętą tabelę.
- Implementacja kalendarza wymaga roving `tabindex`, strzałek, Home/End, PageUp/PageDown, dostępnego opisu zakresu i `aria-busy` dla loading. Wszystkie obliczenia dat działają na `LocalDate` w `Europe/Warsaw`.

## DS-FRM-017 — TimeZoneNotice

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a882f4`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b048c831bcb6`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `state` | `trigger`, `expanded`, `mismatch` |

```ts
type TimeZoneNoticeProps = {
  viewport: "mobile" | "desktop";
  state?: "trigger" | "expanded" | "mismatch";
  timeZone?: "Europe/Warsaw";
};
```

- Mobile trigger ma 344×44 px i tekst `Strefa czasu`; expanded pojawia się pod datami jako kompaktowa informacja. Desktop trigger ma 44×44 px i otwiera tooltip/info o szerokości 300 px.
- Mismatch jawnie informuje, że strefa urządzenia jest inna, ale daty nadal obowiązują według `Europe/Warsaw`. Informacja nie opiera się na samym kolorze.
- Ikona to edytowalny wektor Lucide `CircleInfo`; wszystkie cztery ścieżki mają semantyczne bindingi stroke. Powierzchnie, border, border width, radius i tekst również korzystają z tokenów.
- Trigger desktop wymaga dostępnej nazwy `Strefa czasu: Europe/Warsaw`, `aria-expanded` i powiązania z tooltipem. Mismatch powinien być odczytany jako status, nie jako błąd blokujący.

## DS-FRM-018 — SlugField

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a8831e`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b049d5b4f907`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `auto`, `manual` |
| `viewport` | `mobile`, `desktop` |
| `state` | `generated`, `edited`, `conflict`, `redirect-warning` |

```ts
type SlugFieldProps = {
  mode: "auto" | "manual";
  viewport: "mobile" | "desktop";
  value: string;
  state: "generated" | "edited" | "conflict" | "redirect-warning";
  domainPrefix: string;
  onValueChange?: (slug: string) => void;
};
```

- Każdy z 16 wariantów zawiera rzeczywistą instancję `TextInput`. Mobile ma pełnoszerokie pole, a desktop rozdziela nieedytowalny prefix `auterva.pl/pojazdy/` od edytowalnej wartości.
- Auto wyjaśnia pochodzenie z nazwy pojazdu; manual podaje dozwolone znaki. Generated i edited pokazują pełny podgląd URL.
- Conflict ma obramowanie 2 px i tekst `Adres jest już zajęty`; redirect-warning jawnie informuje o utworzeniu przekierowania 301 po zmianie opublikowanego URL.
- Implementacja normalizuje małe litery, cyfry i łączniki, waliduje unikalność po stronie serwera i nie zmienia istniejącego publicznego URL bez jawnego ostrzeżenia. Komunikaty są powiązane przez `aria-describedby`.

## DS-FRM-019 — CurrencyField

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a8839f`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b11a0e8eca03`.

| Oś | Wartości w katalogu |
|---|---|
| `kind` | `pln`, `price-from` |
| `viewport` | `mobile`, `desktop` |
| `state` | `empty`, `valid`, `error` |

```ts
type CurrencyFieldProps = {
  kind: "pln" | "price-from";
  viewport: "mobile" | "desktop";
  state: "empty" | "valid" | "error";
  value: string;
  currency?: "PLN";
  onValueChange?: (value: string) => void;
};
```

- Każdy z 12 wariantów zawiera dokładnie jedną rzeczywistą instancję `TextInput`. Wartość jest prezentowana z separatorem przecinkowym.
- Mobile używa pełnej szerokości i kontraktu klawiatury numerycznej; afiksy nie ściskają pola. Desktop pokazuje stały suffix `PLN`, a `price-from` dodatkowo stały prefix `od`.
- `empty` wyjaśnia, że brak wartości nie publikuje ceny. `valid` pokazuje podgląd `450,00 PLN / doba` albo `od 450,00 PLN`.
- `error` pokazuje wartość ujemną, obramowanie 2 px z tokenami `border.critical` / `border.width.active` oraz tekst `Kwota nie może być ujemna.`. Błąd nie jest komunikowany wyłącznie kolorem.
- Parsowanie, walidacja i zapis powinny używać wartości dziesiętnej, nie zmiennoprzecinkowej. Tekst pomocniczy/błąd wymaga `aria-describedby`, suffix i prefix nie mogą zastępować dostępnej etykiety pola.

## DS-FRM-020 — TagInput

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a88406`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b11c9362c521`.

| Oś | Wartości w katalogu |
|---|---|
| `kind` | `free`, `predefined` |
| `viewport` | `mobile`, `desktop` |
| `state` | `empty`, `duplicate`, `max` |

```ts
type TagInputProps = {
  kind: "free" | "predefined";
  viewport: "mobile" | "desktop";
  state: "empty" | "duplicate" | "max";
  values: string[];
  maxTags?: 5;
  onAdd?: (value: string) => void;
  onRemove?: (value: string) => void;
};
```

- Każdy z 12 wariantów zawiera dokładnie jedną rzeczywistą instancję `TextInput`. Mobile zawiera dodatkowo rzeczywistą instancję `BottomSheet`, a desktop jawny panel combobox.
- Empty rozróżnia brak tagów własnych i brak cech. Duplicate pokazuje wpisaną wartość, istniejące chipy i tekstowy błąd. Max komunikuje `5/5`, blokuje pole oraz wyjaśnia, że przed dodaniem następnej pozycji trzeba jedną usunąć.
- Chip zawiera tekst i widoczną akcję usunięcia; implementacja powinna użyć przycisku z ikoną Lucide `X`, nazwą dostępną `Usuń {nazwa}` i celem co najmniej 44×44 px na mobile. Nie wolno opierać duplicate/max wyłącznie na kolorze.
- Free tags dodaje się klawiszem Enter lub akcją arkusza. Predefined przyjmuje wyłącznie wartości z katalogu. Normalizacja i porównanie duplikatów powinny być niewrażliwe na wielkość liter i białe znaki.

## DS-FRM-021 — FeaturePicker

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a884e5`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b11fbed7c9b2`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `grouped`, `searchable` |
| `viewport` | `mobile`, `desktop` |
| `state` | grouped: `default`, `selected`; searchable: `default`, `selected`, `no-results` |

```ts
type FeaturePickerProps = {
  mode: "grouped" | "searchable";
  viewport: "mobile" | "desktop";
  state: "default" | "selected" | "no-results";
  selectedIds: string[];
  query?: string;
  onToggle: (featureId: string) => void;
  onQueryChange?: (query: string) => void;
  onApply: () => void;
};
```

- Macierz zawiera 10 sensownych kombinacji. `no-results` istnieje wyłącznie dla trybu searchable; grouped nie tworzy sztucznego stanu bez wyszukiwania.
- Każdy wariant ma rzeczywistą instancję `Button`. Warianty z wynikami mają cztery rzeczywiste instancje `Checkbox`; searchable zawiera dodatkowo rzeczywistą instancję `TextInput`.
- Mobile jest panelem sheet/accordion z wycentrowanym uchwytem, pełnymi celami Checkbox i akcją zastosowania. Desktop jest panelem/popoverem; Escape zamyka go i przywraca fokus do elementu otwierającego.
- Stan selected pokazuje licznik `3 wybrane` i dokładnie trzy zaznaczone pozycje. No-results zachowuje ten licznik, frazę `fotele masujące`, jawny komunikat oraz podsumowanie wcześniejszych wyborów.
- Implementacja akordeonu wymaga przycisków nagłówków z `aria-expanded` i `aria-controls`. Lista Checkbox powinna używać `fieldset`/`legend` lub równoważnej semantyki grup. Wyniki wyszukiwania powinny być ogłaszane przez dyskretne `aria-live`, bez przenoszenia fokusu.

## DS-FRM-022 — FileDropzone

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a88639`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b122486fa17b`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `state` | mobile: `empty`, `uploading`, `invalid-type`, `too-large`, `limit`; desktop dodatkowo `drag-over` |

```ts
type FileDropzoneProps = {
  viewport: "mobile" | "desktop";
  state:
    | "empty"
    | "drag-over"
    | "uploading"
    | "invalid-type"
    | "too-large"
    | "limit";
  accept: Array<"image/jpeg" | "image/png" | "image/webp" | "image/heic">;
  maxFiles?: 12;
  maxSizeMb?: 10;
  files?: Array<{ id: string; name: string; progress: number }>;
  onBrowse: () => void;
  onDrop?: (files: File[]) => void;
};
```

- Macierz zawiera 11 sensownych kombinacji. Mobile jest tap-first i nie ma sztucznego `drag-over`; desktop obsługuje przeciąganie oraz przeglądanie.
- Każdy wariant zawiera rzeczywistą instancję `Button`. Uploading pokazuje dwa niezależne pliki z wartościami `68%` i `24%`; błąd jednego pliku nie usuwa informacji o pozostałych.
- Invalid-type, too-large i limit mają ikonę Lucide, tekst błędu, wskazówkę odzyskania oraz tokeny `border.critical` / `border.width.active`. Status nie zależy wyłącznie od koloru.
- Kontrakt pokazuje JPEG, PNG i WebP. HEIC jest opisany wyłącznie jako warunkowy po włączeniu konwersji serwerowej. Limit demonstracyjny to 10 MB na plik i 12 plików; wartości produkcyjne wymagają zgodności z konfiguracją API.
- Natywny input plikowy pozostaje dostępny klawiaturą i ma widoczną etykietę. Drag and drop jest dodatkiem, nie jedyną ścieżką. Postęp plików powinien być ogłaszany oszczędnie przez `aria-live`; anulowanie i ponowienie należą do `UploadQueue`/`ImageUploader`.

## DS-FRM-023 — ImageUploader

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a8c86f`.
- Library component head: `a4abf4c9-2e1f-80fd-8008-b125ce535de1`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `logo`, `vehicle` |
| `viewport` | `mobile`, `desktop` |
| `state` | `empty`, `progress`, `success`, `error`, `retry` |

```ts
type ImageUploaderProps = {
  mode: "logo" | "vehicle";
  viewport: "mobile" | "desktop";
  state: "empty" | "progress" | "success" | "error" | "retry";
  files: Array<{
    id: string;
    name: string;
    progress?: number;
    status: "queued" | "uploading" | "success" | "error" | "retry";
    isCover?: boolean;
    alt?: string;
  }>;
  onChooseFiles: () => void;
  onOpenCamera?: () => void;
  onRetry: (fileId: string) => void;
  onReorder?: (fileId: string, direction: "up" | "down") => void;
  onSetCover?: (fileId: string) => void;
  onAltChange?: (fileId: string, alt: string) => void;
  onRemove?: (fileId: string) => void;
};
```

- Macierz ma 20 unikalnych wariantów. Empty składa prawdziwy `FileDropzone`; mobile pokazuje dwie równorzędne akcje aparat/pliki, desktop jedną akcję browse wewnątrz dropzone i dodatkowe drag & drop.
- Progress pokazuje niezależny postęp per plik. Error zachowuje dwa poprawne zdjęcia i pozwala ponowić wyłącznie plik uszkodzony; retry nie resetuje pozostałych wyników ani formularza.
- Vehicle success ma trzy rzeczywiste fill-e zdjęć DEMO, dokładnie jeden marker `GŁÓWNE`, instancję `TextInput` z edytowalną propozycją alt oraz instrukcję zmiany kolejności: przyciski w górę/w dół na mobile, drag & drop i `Ctrl+↑`/`Ctrl+↓` na desktopie.
- Usunięcie wymaga potwierdzenia. Jedynego zdjęcia głównego opublikowanego pojazdu nie wolno usunąć bez wybrania zamiennika albo cofnięcia publikacji.
- Error używa ikony, tekstu oraz `border.critical` / `border.width.active`, więc status nie zależy od koloru. Postęp powinien korzystać z oszczędnego `aria-live`; zmiany covera i kolejności wymagają komunikatu dla czytnika.
- Akceptowane formaty to JPEG, PNG i WebP. HEIC jest warunkowy po wdrożeniu konwersji serwerowej; demonstracyjne limity 10 MB i 12 zdjęć muszą zostać zsynchronizowane z konfiguracją API.

## DS-FRM-024 — MarkdownEditor

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2bf5a8ca88`.
- Library component head: `9425204d-c5c4-807f-8008-b15c884b3e0d`.

| Oś | Wartości w katalogu |
|---|---|
| `kind` | `description`, `legal` |
| `viewport` | `mobile`, `desktop` |
| `state` | `dirty`, `validation`, `preview` |

```ts
type MarkdownEditorProps = {
  kind: "description" | "legal";
  viewport: "mobile" | "desktop";
  state: "dirty" | "validation" | "preview";
  value: string;
  maxLength: number;
  validationMessage?: string;
  onChange: (markdown: string) => void;
  onModeChange: (mode: "edit" | "preview") => void;
};
```

- Mobile składa dwie rzeczywiste instancje `Tabs`: `Edycja` i `Podgląd`, ale renderuje tylko aktywny panel. Desktop pokazuje oba panele równolegle. Każdy wariant ma rzeczywistą instancję `Button`; przy błędzie akcja podglądu jest niedostępna do czasu poprawienia treści.
- Toolbar obejmuje pogrubienie, nagłówek H2, listę i ikonę Lucide Link. Licznik znaków jest informacyjny; wartości graniczne przekazuje konfiguracja pola.
- Podgląd korzysta wyłącznie z kontrolowanego renderera Markdown. Surowy HTML jest walidowany po stronie klienta i serwera, zabroniony lub rygorystycznie sanityzowany, i nigdy nie trafia bezpośrednio do `dangerouslySetInnerHTML`.
- Stan `validation` pokazuje ikonę, komunikat i aktywne obramowanie, więc nie zależy od koloru. Stan `dirty` musi współpracować z ochroną wyjścia `OVR-13`; samo otwarcie podglądu nie zapisuje ani nie publikuje treści.
- Wszystkie warianty `legal` mają stałą etykietę `TREŚĆ ROBOCZA` oraz informację, że treść wymaga zatwierdzenia prawnego. Makieta i tekst DEMO nie stanowią porady prawnej ani zatwierdzonego dokumentu.
- Przełączniki trybu muszą być obsługiwane klawiaturą z semantyką tablist/tab, a zmiana błędu i wyniku walidacji powinna być ogłaszana przez oszczędne `aria-live` bez powtarzania całej treści edytora.

## DS-FRM-025 — RichDescriptionField

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c7648d626`.
- Library component head: `9425204d-c5c4-807f-8008-b16357c71eb1`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `plain`, `markdown` |
| `viewport` | `mobile`, `desktop` |

```ts
type RichDescriptionFieldProps = {
  mode: "plain" | "markdown";
  viewport: "mobile" | "desktop";
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  onModeChange: (mode: "plain" | "markdown") => void;
};
```

- Komponent jest cienką kompozycją pola pełnego opisu pojazdu, nie drugim edytorem. Ma dokładnie cztery warianty. Nie ma osobnej osi `state`, osobnego zapisu, publikacji, trasy ani ekranu.
- `markdown` składa jedną rzeczywistą instancję `DS-FRM-024 MarkdownEditor` i pokazuje jego kontrolowany podgląd. `plain` używa pojedynczego pola tekstowego oraz podglądu, w którym znaczniki HTML nie są interpretowane.
- Mobile jest pojedynczą rozwiniętą sekcją akordeonu; nagłówek wdrożeniowy musi być przyciskiem z `aria-expanded` i `aria-controls`. Desktop pozostaje jedną pełną sekcją formularza z edycją i podglądem obok siebie.
- Pole pozostaje częścią `VehicleForm`. Zapis szkicu, walidacja publikacyjna, podgląd pojazdu i ochrona wyjścia należą do nadrzędnych `FormActions`, `ValidationSummary` i `OVR-13`, zgodnie z PRD.
- Pełny opis jest wymagany do publikacji według modelu danych PRD; szkic może pozostać niekompletny. Komponent nie rozszerza MVP o workflow CMS ani osobne wersjonowanie treści.

## DS-FRM-026 — FormSection

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c7649114c`.
- Library component head: `9425204d-c5c4-807f-8008-b167363eb815`.

| Oś | Wartości w katalogu |
|---|---|
| `presentation` | `accordion`, `card`, `plain` |
| `viewport` | `mobile`, `desktop` |
| `status` | `complete`, `incomplete`, `error` |

```ts
type FormSectionProps = {
  presentation: "accordion" | "card" | "plain";
  status: "complete" | "incomplete" | "error";
  title: string;
  description?: string;
  errorCount?: number;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  children: React.ReactNode;
};
```

- Macierz ma dokładnie 9 sensownych wariantów: `accordion` występuje tylko na mobile, a `card` i `plain` tylko na desktopie; nie utworzono sztucznego pełnego iloczynu 3×2×3. To jeden responsywny wzorzec, nie trzy nowe ekrany.
- Osiem rozwiniętych wariantów składa prawdziwą instancję `DS-FRM-001 FormField`. Kompletny akordeon mobile pokazuje reprezentatywny stan zwinięty i nie zawiera ukrytej kopii pola.
- `status` opisuje kompletność sekcji, nie stan zapisu całego formularza. Kompletność, brak oraz liczba błędów są przekazywane tekstem i ikoną; wariant błędu dodatkowo używa aktywnego obramowania i komunikatu pola.
- Mobile używa nagłówka-przycisku z `aria-expanded` i `aria-controls`; region treści ma odpowiadające `id` oraz dostępny nagłówek. Błąd publikacji otwiera właściwą sekcję, ale przenoszeniem fokusu zarządza `ValidationSummary`.
- `expanded` pozostaje stanem kontrolowanym, a nie kolejną osią katalogową. Makieta pokazuje complete jako collapsed oraz incomplete/error jako expanded; implementacja może zachować wybór użytkownika, o ile sekcja z błędem zostanie ujawniona przy walidacji publikacyjnej.
- Na szerokości poniżej 360 px status może przejść pod tytuł. Nie wolno zmniejszać celu nagłówka akordeonu poniżej 44 px ani ucinać liczby błędów.
- Ruch otwarcia używa `motion.base` 180 ms i standard easing; reduced motion usuwa przesunięcie i animuje co najwyżej natychmiastową zmianę widoczności.
- Komponent nie ma własnych akcji zapisu, publikacji, nawigacji sekcji ani nowej trasy. Te odpowiedzialności należą odpowiednio do `FormActions`, `FormSectionNav`, `ValidationSummary`, `UnsavedIndicator` i `OVR-13`.

## DS-FRM-027 — FormSectionNav

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c764911e5`.
- Library component head: `9425204d-c5c4-807f-8008-b529c843b815`.

| Oś | Wartości w katalogu |
|---|---|
| `presentation` | `steps`, `anchors` |
| `state` | `active`, `complete`, `error` |

```ts
type FormSectionNavItemProps = {
  presentation: "steps" | "anchors";
  state: "active" | "complete" | "error";
  label: string;
  errorCount?: number;
  href: `#${string}`;
  current?: "step";
};
```

- To pojedynczy cel nawigacji, nie drugi system formularza. Ekran składa jego instancje w poziomo przewijaną listę chipów `steps` na mobile albo sticky kolumnę `anchors` po lewej stronie desktopu.
- Macierz ma dokładnie sześć wariantów. Nie ma redundantnej osi `viewport`, bo prezentacja jednoznacznie określa responsywną anatomię. Nie powstał osobny komponent kontenera, trasa ani ekran.
- Cel mobile ma co najmniej 44 px wysokości, desktop 48 px. Pełna lista używa siedmiu sekcji formularza pojazdu; poziomy rail zachowuje widoczny fokus i nie może blokować przewijania strony.
- `active`, `complete` i `error` mają ikonę Lucide oraz jawny tekst. Liczba błędów jest częścią dostępnej nazwy, a nie tylko badge'em lub kolorem.
- Kontener wdrożeniowy ma semantyczne `<nav aria-label="Sekcje formularza">`. Aktywny element ustawia `aria-current="step"`; kliknięcie przenosi fokus do nagłówka sekcji, a błąd publikacji otwiera właściwy akordeon przed fokusem.
- Komponent nie zapisuje formularza, nie publikuje pojazdu i nie wykonuje rezerwacji. Podsumowanie i kolejność obsługi błędów należą do `DS-FRM-028 ValidationSummary`.

## DS-FRM-028 — ValidationSummary

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c76491211`.
- Library component head: `9425204d-c5c4-807f-8008-b52ce4a551ff`.

| Oś | Wartości w katalogu |
|---|---|
| `presentation` | `page`, `dialog` |
| `viewport` | `mobile`, `desktop` |

```ts
type ValidationSummaryError = {
  id: string;
  fieldId: string;
  sectionId: string;
  label: string;
  message: string;
};

type ValidationSummaryProps = {
  presentation: "page" | "dialog";
  errors: ValidationSummaryError[];
  onNavigate: (error: ValidationSummaryError) => void;
};
```

- Macierz ma trzy sensowne warianty: page/mobile, page/desktop i dialog/desktop. Nie ma dialog/mobile, ponieważ mobilny błąd publikacji pojawia się na górze formularza; brak wymagań nie otwiera pustego confirm dialogu.
- Każdy wariant składa trzy prawdziwe instancje `DS-ACT-001 Button` jako reprezentatywne cele: nazwa pojazdu, zdjęcie główne i okres dostępności. Lista jest generowana z błędów klienta i serwera, a nie ograniczona do trzech pozycji w implementacji.
- Region używa `role="alert"`, dostępnego nagłówka i listy. Liczba błędów jest zawarta w tekście; status nie zależy od koloru. Po nieudanej publikacji właściwa sekcja zostaje otwarta, a fokus trafia do pierwszego błędnego pola, zgodnie ze SPEC.
- Każda pozycja jest przyciskiem lub linkiem z pełną nazwą błędu. Wybranie jej otwiera odpowiedni akordeon, przewija pole z uwzględnieniem sticky nagłówka i przenosi fokus do kontrolki. Brakujący cel pozostaje widoczny w podsumowaniu i jest raportowany jako błąd integracji, nie usuwany po cichu.
- Wartości formularza oraz szkic pozostają po błędzie klienta i serwera. Błędy ogólne bez przypisania do pola trafiają do `Alert` lub osobnej pozycji podsumowania; `InlineMessage` pozostaje przy konkretnym polu.
- Komponent nie zapisuje ani nie publikuje pojazdu, nie otwiera `OVR-09` i nie wykonuje rezerwacji. Po poprawieniu wszystkich błędów znika z formularza; sukces obsługują `FormActions` i odpowiedni toast.

## DS-FRM-029 — CharacterCounter

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c7649123f`.
- Library component head: `9425204d-c5c4-807f-8008-b52f4a960e1c`.

| Oś | Wartości w katalogu |
|---|---|
| `state` | `default`, `warning`, `exceeded` |

```ts
type CharacterCounterProps = {
  current: number;
  max: number;
  warningAt?: number;
  id?: string;
};
```

- Mobile i desktop używają tej samej anatomii inline. Nie ma osobnej osi viewport ani interakcji; rodzic odpowiada za wyrównanie licznika pod polem.
- `state` jest wyliczany z `current`, `max` i opcjonalnego `warningAt`, a nie przekazywany jako niezależny stan biznesowy. Domyślny próg ostrzeżenia to 90% limitu, jeżeli schemat pola nie określa inaczej.
- `default` pokazuje tylko bieżącą wartość i limit. `warning` dodaje Lucide TriangleAlert i tekst „blisko limitu”; `exceeded` używa CircleAlert i tekstu „limit przekroczony”. Status nie zależy od koloru.
- Licznik jest metadanym `FormField` i jego `id` trafia do `aria-describedby` kontrolki. Nie powinien być osobnym elementem fokusowalnym.
- Nie używa się `aria-live` przy każdym naciśnięciu klawisza. Przejście do warning lub exceeded może zostać ogłoszone jednokrotnie jako `polite`; pełny błąd limitu pozostaje także w walidacji pola.
- Sposób liczenia znaków musi być wspólny z walidacją React Hook Form/Zod. Komponent tylko prezentuje wartości; nie decyduje samodzielnie, czy zapis szkicu lub publikacja są zablokowane.

## DS-FRM-030 — FormActions

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c76491250`.
- Library component head: `9425204d-c5c4-807f-8008-b532576f67ce`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `state` | `saving`, `saved`, `error`, `disabled` |

```ts
type FormActionsState = "saving" | "saved" | "error" | "disabled";

type FormActionsProps = {
  state: FormActionsState;
  disabledReason?: string;
  onSaveDraft: () => void;
  onPreview: () => void;
  onPublish: () => void;
};
```

- To jeden pasek trzech akcji złożony z istniejącego `DS-ACT-001 Button`: `Zapisz szkic`, `Podgląd` i `Opublikuj`. Nie należy tworzyć osobnych komponentów dla tych akcji ani osobnego ekranu.
- Mobile używa tego samego wariantu jako sticky bottom z uwzględnieniem safe area; desktop umieszcza go w nagłówku lub stopce strony. Przy 320 px ten sam mobile layout może zawinąć akcje zgodnie z dostępną szerokością — nie wymaga nowej osi wariantów.
- Niepełny formularz można zapisać jako szkic. `onPublish` najpierw uruchamia walidację: błędy prowadzą do `ValidationSummary`, a dopiero kompletny pojazd otwiera `OVR-09`. `onPreview` prowadzi do `ADM-08` i nie publikuje danych.
- `saving` ustawia `aria-busy`, zachowuje kontekstową etykietę „Zapisywanie…” i blokuje ponowne wywołanie zapisu/publikacji. `error` zachowuje wartości formularza i oferuje `Ponów zapis`.
- `disabled` wymaga jawnego `disabledReason`; wzorzec Penpot pokazuje brak połączenia. Podgląd ostatniej zapisanej wersji pozostaje dostępny. Status jest tekstem z ikoną i powinien być ogłaszany przez region `aria-live="polite"`.
- Komponent nie zawiera logiki zapisu, publikacji, autoryzacji ani routingu. Autoryzacja i mutacje pozostają po stronie serwera, a rodzic dostarcza callbacki oraz wyliczony stan.

## DS-FRM-031 — UnsavedIndicator

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c764912bb`.
- Library component head: `9425204d-c5c4-807f-8008-b5352a735d4e`.

| Oś | Wartości w katalogu |
|---|---|
| `presentation` | `banner-mobile`, `inline-desktop` |
| `state` | `clean`, `dirty`, `saving`, `saved` |

```ts
type UnsavedIndicatorProps = {
  state: "clean" | "dirty" | "saving" | "saved";
  presentation?: "banner" | "inline";
};
```

- To jeden nieinteraktywny status formularza. Nie ma callbacków i nie zapisuje danych; akcje należą do `FormActions`, a ochrona wyjścia do `OVR-13`.
- Mobile używa kompaktowego bannera sticky o szerokości kontenera, z marginesem 16 px i safe area. Desktop pokazuje wersję inline w nagłówku. Prezentacja zastępuje osobną oś viewport; przy 320 px banner zwęża się bez zmiany anatomii i bez nowego wariantu.
- Copy stanów: `clean` — „Brak niezapisanych zmian”, `dirty` — „Niezapisane zmiany”, `saving` — „Zapisywanie zmian…”, `saved` — „Zapisano przed chwilą”. Każdy stan ma ikonę i tekst, więc nie zależy wyłącznie od koloru.
- `saving` i `saved` są ogłaszane przez `aria-live="polite"`; `clean` i `dirty` pozostają ciche, aby nie powtarzać komunikatu po każdym wpisanym znaku. Kontener formularza może dodatkowo ustawić `aria-busy` podczas zapisu.
- `saved` jest potwierdzeniem przejściowym, po którym stan wraca do `clean`. Nie wolno przejść do `saved` po błędzie sieciowym ani symulować sukcesu offline. Błąd zapisu prezentuje `FormActions`/`Alert`.
- Penpot 2.18.0 nie pozwolił ponownie związać jednej już zarejestrowanej ścieżki SVG przez `applyToken`; użyto na niej semantycznego stylu bibliotecznego `Semantic / Text / Primary` oraz jawnego metadata fallbacku. Pozostałe elementy ikon mają natywne bindingi tokenów statusu.

## DS-FRM-032 — FieldArray

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2c764912ec`.
- Library component head: `9425204d-c5c4-807f-8008-b53940083c54`.

| Oś | Wartości w katalogu |
|---|---|
| `kind` | `contact`, `feature` |
| `presentation` | `cards-mobile`, `rows-desktop` |
| `state` | `empty`, `managed` |

```ts
type FieldArrayItem = {
  id: string;
  label: string;
  value: string;
};

type FieldArrayProps = {
  kind: "contact" | "feature";
  items: FieldArrayItem[];
  renderItem: (item: FieldArrayItem, index: number) => React.ReactNode;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
};
```

- To pojedyncza powłoka listy wielowartościowej z miejscem `renderItem`. Zawartość składa istniejące `FormField`/`TextInput`, `Select`, `TagInput` albo `FeaturePicker`; nie należy tworzyć kolejnego edytora ani osobnego ekranu.
- Macierz ma osiem wariantów. `empty` i `managed` są rzeczywistymi stanami UI. W `managed` dodawanie, reorder i usuwanie są dostępne jednocześnie, dlatego nie tworzymy czterech sztucznych stanów `add/reorder/remove/empty`.
- Mobile używa kart, desktop wierszy. Obie prezentacje wypełniają szerokość rodzica; 390 i 760 px w Penpot są szerokościami wzorców, nie stałymi szerokościami implementacji.
- Akcje dodania oraz usunięcia są instancjami `DS-ACT-001 Button`. Uchwyt GripVertical obsługuje wskaźnik, ale musi mieć równoważne polecenia klawiaturowe „W górę” i „W dół”; sama funkcja drag nie wystarcza.
- Usunięcie nowej, niezapisanej pozycji może być natychmiastowe. Usunięcie zapisanych danych stosuje politykę rodzica: confirm lub undo. FieldArray nie zawiera własnego dialogu, zapisu formularza ani routingu.
- `contact` obsługuje telefon, e-mail, WhatsApp i dozwolone kanały własne. Wybór kanału domyślnego należy do `ContactChannelEditor`, nie do ogólnego FieldArray. `feature` służy tylko prezentacji/porządkowaniu cech pojazdu.
- Komponent nie tworzy rezerwacji, płatności ani danych klienta.

## DS-LYT-001 — AppContainer

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3dde3d7`.
- Library component head: `9425204d-c5c4-807f-8008-b54c0aff24d6`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `public`, `admin`, `full-bleed`, `narrow` |
| `presentation` | `mobile`, `desktop`, `responsive` |

```ts
type AppContainerMode = "public" | "admin" | "fullBleed" | "narrow";
type AppContainerSafeArea = "none" | "top" | "bottom" | "both";

type AppContainerProps = {
  mode?: AppContainerMode;
  safeArea?: AppContainerSafeArea;
  children: React.ReactNode;
  className?: string;
};
```

| Szerokość viewportu | Kolumny | Margines | Gutter | Ograniczenie szerokości |
|---|---:|---:|---:|---|
| 320–479 px | 4 | 16 px | 16 px | szerokość dostępna |
| 480–767 px | 4 | 24 px | 20 px | szerokość dostępna |
| 768–1023 px | 8 | 32 px | 24 px | szerokość dostępna |
| 1024–1279 px | 12 | 40 px | 24 px | maks. 1200 px |
| 1280–1919 px | 12 | 48 px | 32 px | public 1200 px, admin 1440 px |
| 1920 px i więcej | 12 | auto | 32 px | public 1280 px, admin 1600 px |

- `narrow` ma maksymalnie 760 px, zgodnie z istniejącą treścią `PUB-05`. Poniżej 768 px używa zwykłych marginesów mobile, więc nie istnieje osobny wariant `narrow/mobile`.
- `fullBleed` nie nakłada marginesów ani `max-width`; zachowuje jedną anatomię responsive zamiast duplikować wariant mobile i desktop.
- `safeArea` jedynie składa istniejący kontrakt `DS-LYT-015 SafeArea`: top `max(12px, env(safe-area-inset-top))`, bottom `max(16px, env(safe-area-inset-bottom))`. Nie duplikuje zawartości.
- AppContainer jest neutralną powłoką układu bez własnej roli landmark, nawigacji, logiki domenowej i interakcji. Semantyczny `main`/`section` pozostaje odpowiedzialnością shella lub strony.
- Komponent nie tworzy nowych ekranów i nie rozszerza MVP o rezerwacje, płatności ani konta klientów.

## DS-LYT-002 — Stack

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3dde3f2`.
- Library component head: `9425204d-c5c4-807f-8008-b551f522c27c`.

| Oś | Wartości w katalogu |
|---|---|
| `direction` | `column`, `row` |

```ts
type StackDirection = "column" | "row" | "responsive";
type StackGap =
  | "space.1"
  | "space.2"
  | "space.3"
  | "space.4"
  | "space.5"
  | "space.6"
  | "space.8"
  | "space.10"
  | "space.12"
  | "space.16"
  | "space.20"
  | "space.24";
type StackAlign = "start" | "center" | "end" | "stretch";
type StackJustify =
  | "start"
  | "center"
  | "end"
  | "space-between"
  | "space-around"
  | "space-evenly";

type StackProps = {
  direction?: StackDirection;
  gap?: StackGap;
  align?: StackAlign;
  justify?: StackJustify;
  children: React.ReactNode;
  className?: string;
};
```

- Domyślny układ to `column`, `gap="space.4"` (16 px), `align="stretch"` i `justify="start"`. Dopuszczona skala gap odpowiada 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80 i 96 px.
- `responsive` oznacza column poniżej `breakpoint.md` (768 px) i row od 768 px. Jeśli układ ma pozostać pionowy na desktopie, rodzic jawnie wybiera `column`.
- Penpot pokazuje tylko dwa końcowe układy anatomii. Gap, align i justify są propsami Flex, więc nie wolno tworzyć dla nich pełnego iloczynu wariantów.
- Stack ma `flex-wrap: nowrap`. Zawijane grupy akcji i badge należą do `DS-LYT-003 Cluster`; Stack nie przejmuje tej odpowiedzialności.
- Kolejność wizualna musi pozostać zgodna z kolejnością DOM. Breakpoint nie używa `order`, nie odwraca listy i nie zmienia semantyki dzieci.
- Primitive nie dodaje roli ARIA, fokusu, interakcji ani motion. Semantykę zapewniają rodzic i dzieci.
- Stack nie zawiera logiki produktu, nawigacji ani nowych ekranów.

## DS-LYT-003 — Cluster

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3dde407`.
- Library component head: `9425204d-c5c4-807f-8008-b55475ce050c`.

| Oś | Wartości w katalogu |
|---|---|
| `align` | `start`, `center`, `end` |

```ts
type ClusterAlign = "start" | "center" | "end";
type ClusterGap =
  | "space.1"
  | "space.2"
  | "space.3"
  | "space.4"
  | "space.5"
  | "space.6";

type ClusterProps = {
  align?: ClusterAlign;
  gap?: ClusterGap;
  children: React.ReactNode;
  className?: string;
};
```

- Cluster jest zawsze poziomym Flex z `flex-wrap: wrap`; domyślnie używa `align="start"` i `gap="space.2"` (8 px). Brak zawijania należy do Stack, dlatego komponent nie ma boolean prop `wrap`.
- Mobile i desktop używają tej samej anatomii. Szerokość rodzica decyduje, ile elementów mieści się w wierszu; komponent nie ma osi viewport.
- `align` steruje wyrównaniem każdego zawiniętego wiersza. Cross-axis pozostaje wycentrowany, aby przyciski i badge o różnych wysokościach miały wspólną oś.
- Pojedyncze dziecko szersze od kontenera otrzymuje `max-width: 100%`, a jego własna etykieta może się zawinąć. Cluster nie wprowadza poziomego scrolla.
- Kolejność wizualna jest zgodna z DOM. Komponent nie dodaje roli ARIA, fokusu, interakcji ani motion; znaczenie grupy zapewnia rodzic i jej dzieci.
- Sloty w Penpocie są neutralną demonstracją geometrii. W rzeczywistym UI Cluster składa istniejące `DS-ACT-001 Button`, `DS-FBK-003 StatusBadge` lub inne zwarte kontrolki — nie należy na ich podstawie tworzyć nowych rodzin.
- Cluster nie zawiera logiki produktu, nawigacji ani nowych ekranów.

## DS-LYT-004 — ResponsiveGrid

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3dde429`.
- Library component head: `9425204d-c5c4-807f-8008-b559d0250c0d`.

| Oś | Wartości w katalogu |
|---|---|
| `columns` | `1`, `2`, `3`, `4` |

```ts
type ResponsiveGridColumns = {
  base: 1;
  md?: 2;
  lg?: 2 | 3;
  xl?: 2 | 3 | 4;
};

type ResponsiveGridGap = "space.4" | "space.6" | "space.8";

type ResponsiveGridProps = {
  columns?: ResponsiveGridColumns;
  gap?: ResponsiveGridGap;
  children: React.ReactNode;
  className?: string;
};
```

- Mobile zawsze zaczyna od jednej kolumny. Od `breakpoint.md` rodzic może wybrać dwie kolumny, a szersza kompozycja 2–4 kolumny zależnie od gęstości treści; nie istnieje osobna oś viewport.
- Implementacja używa `grid-template-columns: repeat(n, minmax(0, 1fr))`. Dzieci mają `min-width: 0`, aby długi polski tekst zawijał się bez poziomego przewijania całej strony.
- Domyślny gap to `space.4` (16 px) na mobile i `space.6` (24 px) od tabletu. `space.8` (32 px) jest dozwolone w szerokich sekcjach zgodnie z siatką AppContainer; nie tworzy kolejnego wariantu.
- Loading używa tego samego komponentu, mapy kolumn, gapu, kolejności oraz liczby elementów. Zmienia się wyłącznie zawartość komórek na istniejące skeletony; osobny `ResponsiveGridSkeleton` i oś `state` są zabronione.
- Kolejność wizualna musi odpowiadać DOM na każdym breakpointcie. Grid nie używa `order`, nie przenosi elementów wyłącznie wizualnie i nie dodaje roli ARIA, fokusu, interakcji ani motion.
- Cztery neutralne komórki w Penpocie pokazują geometrię, nie definiują nowej rodziny kart. W ekranach grid składa istniejące VehicleCard, karty benefitów lub inne elementy wskazane przez PRD/SPEC.
- ResponsiveGrid nie dodaje ekranu, trasy ani logiki rezerwacji.

## DS-NAV-005 — PublicFooter

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25429dc9ea`.
- Library component head: `9425204d-c5c4-807f-8008-b55f57774bcd`.

| Oś | Wartości w katalogu |
|---|---|
| `variant` | `full`, `compact` |
| `viewport` | `desktop`, `mobile`, `responsive` |

```ts
type PublicFooterProps = {
  variant?: "full" | "compact";
  navigation?: ReadonlyArray<{ label: string; href: string }>;
  phone?: string;
  legal?: string;
  className?: string;
};
```

- Dozwolone kombinacje w MVP to `full/desktop`, `full/mobile` oraz `compact/responsive`; brakujące kombinacje nie są osobnymi wariantami.
- Desktop pokazuje trzy kolumny: brand, nawigację i kontakt/legal. Mobile układa te sekcje pionowo w tej samej kolejności DOM.
- Compact zawiera wyłącznie brand oraz kontakt/legal. Nie przechowuje pustej sekcji nawigacji ani pustej kolumny.
- Każda sekcja zależna od danych jest renderowana warunkowo jako całość. Brak `navigation`, `phone` lub `legal` usuwa odpowiadający blok; nie zostawia pustego wrappera rezerwującego miejsce.
- Telefon jest zwykłym linkiem `tel:` i nie uruchamia rezerwacji. Footer nie tworzy klienta, konta, płatności ani procesu rezerwacyjnego.
- Dane telefonu i copyright w Penpocie są oznaczone `DEMO`; implementacja nie może traktować ich jako zatwierdzonych danych produkcyjnych.

## DS-LYT-005 — PublicPageShell

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3dde44e`.
- Library component head: `9425204d-c5c4-807f-8008-b561ec426889`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `desktop`, `mobile` |
| `state` | `default`, `loading`, `global-error` |

```ts
type PublicPageShellProps = {
  state?: "default" | "loading" | "global-error";
  children: React.ReactNode;
  onRetry?: () => void;
  className?: string;
};
```

- Shell składa istniejące `PublicHeader` i `PublicFooter`; nie kopiuje ich warstw i nie definiuje nowego ekranu ani trasy.
- Desktop korzysta z pełnego nagłówka i jego CTA kontaktowego. Mobile korzysta z uproszczonego nagłówka oraz jednego istniejącego `Button` jako sticky contact; przycisk ma odpowiadać `position: sticky`/safe-area w implementacji, a nie zasłaniać treści lub footera.
- `default` renderuje `children`. `loading` zachowuje tę samą geometrię shellu i wymienia wyłącznie zawartość slota na skeletony. `global-error` używa istniejącego `Alert` z akcją ponowienia; nie tworzy osobnego ekranu błędu.
- Sticky contact jest zewnętrzną akcją kontaktową. Nie tworzy rezerwacji, klienta, konta ani płatności i nie obiecuje dostępności terminu.
- Kompozycja respektuje główne viewporty 390 i 1440 px. Reguły AppContainer pozostają źródłem zachowania na 320/768/1024/1920 px; shell nie duplikuje breakpointów jako kolejnych wariantów.

## DS-LYT-006 — AdminPageShell

Wszystkie trzy warianty `session-expired` są ponownie połączone z odbudowanym `DS-FBK-020 SessionExpiredDialog`.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3dde4f8`.
- Library component head: `9425204d-c5c4-807f-8008-b56729df460e`.

| Oś | Wartości w katalogu |
|---|---|
| `navigation` | `expanded`, `collapsed`, `bottom-nav` |
| `state` | `online`, `offline`, `session-expired` |

```ts
type AdminPageShellProps = {
  navigation?: "expanded" | "collapsed" | "bottom-nav";
  state?: "online" | "offline" | "session-expired";
  children: React.ReactNode;
  onReconnect?: () => void;
  onRelogin?: () => void;
  onDiscardLocalData?: () => void;
  className?: string;
};
```

- Dozwolone kombinacje w MVP to `expanded` i `collapsed` na desktopie oraz `bottom-nav` na mobile, każda w trzech stanach. Nie należy implementować mobile sidebar ani desktop bottom navigation tylko po to, by domknąć iloczyn.
- Desktop składa istniejące `AdminSidebar` i `AdminTopbar`; mobile składa `AdminTopbar` oraz `AdminBottomNavigation`. Dolna nawigacja uwzględnia safe area i nie zasłania treści.
- `online` renderuje `children`. `offline` używa istniejącego `Alert`, blokuje mutacje i nie może komunikować fikcyjnego sukcesu; może pokazać wyłącznie bezpieczny, nieprywatny cache shellu.
- `session-expired` ma usuwać prywatną zawartość przed pokazaniem zarejestrowanego `DS-FBK-020 SessionExpiredDialog` z akcjami `onRelogin` i `onDiscardLocalData`. Scrim obejmuje cały shell, a dane użytkownika nie mogą pozostawać widoczne ani trafiać do tła dialogu.
- Instancje shellu po ponownym połączeniu: expanded desktop `92bfc32e-2dd6-801a-8008-bede1c718de7`, collapsed desktop `92bfc32e-2dd6-801a-8008-bede2afa974f` i mobile `92bfc32e-2dd6-801a-8008-bedea2528ab6`.
- Historyczne instancje prototypowe `OVR-14` to mobile `9425204d-c5c4-807f-8008-b6cfb14ea292` i desktop `9425204d-c5c4-807f-8008-b6cfbc665cc5`. Są osobnym elementem weryfikacji `OVR-14`; nie należy tworzyć ręcznej kopii overlayu ani dodatkowego ekranu.
- Shell jest komponentem kompozycyjnym. Nie dodaje trasy, ekranu, kolejki offline, zapisu w tle ani nowego procesu uwierzytelnienia.

## DS-LYT-007 — PageHeader

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3de2e0d`.
- Library component head: `9425204d-c5c4-807f-8008-b56a9f4eedcf`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `desktop`, `mobile` |
| `density` | `default`, `compact` |

```ts
type PageHeaderProps = {
  density?: "default" | "compact";
  title: string;
  description?: string;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  sticky?: boolean;
  headingLevel?: 1 | 2;
  className?: string;
};
```

- `default` pokazuje pełną anatomię: breadcrumbs, title, description i actions. `compact` zachowuje title i actions oraz nie rezerwuje miejsca na brakujące description lub breadcrumbs.
- Na desktopie actions są wyrównane do prawej strony nagłówka. Na mobile są układane pod tytułem; wiele akcji może przejść do pełnoszerokiego stosu.
- `breadcrumbs`, `description` i `actions` są opcjonalnymi slotami, a nie osobnymi osiami wariantów. Brak slota usuwa cały odpowiadający mu wrapper.
- `sticky` jest opcjonalnym zachowaniem implementacyjnym i nie zmienia anatomii, dlatego nie ma własnej osi. Włączenie sticky musi uwzględnić topbar/safe area, czytelny focus oraz nie może zasłaniać początku treści.
- Tytuł może się zawijać; nie należy wymuszać ellipsis na głównym nagłówku. Breadcrumbs wymagają semantycznego `nav` z etykietą, a poziom nagłówka musi wynikać z hierarchii strony, nie z samego rozmiaru wizualnego.
- Przykładowe akcje w Penpocie są rzeczywistymi instancjami `Button`. Komponent nie tworzy nowej trasy, ekranu ani rodziny przycisków.

## DS-LYT-008 — Section

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ca3de2e2e`.
- Library component head: `9425204d-c5c4-807f-8008-b56d34a04755`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `desktop`, `mobile` |
| `variant` | `default`, `compact`, `emphasized` |

```ts
type SectionProps = {
  variant?: "default" | "compact" | "emphasized";
  heading?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  as?: "section" | "div";
  className?: string;
};
```

- `default` używa paddingu 40 px na mobile i 64 px na desktopie. `emphasized` używa 40/80 px oraz semantycznych powierzchni inverse/strong. `compact` jest świadomym wyjątkiem 24/40 px dla krótszych bloków treści.
- Na desktopie action jest po prawej stronie headingu. Na mobile przechodzi pod heading i zajmuje pełną szerokość. Brak action usuwa wrapper; wariant compact w Penpocie pokazuje właśnie taki przypadek.
- `heading`, `description` i `action` są opcjonalnymi slotami, a nie osiami wariantów. `children` jest jedynym wymaganym slotem treści. Komponent nie wprowadza stanów biznesowych, zapisu, routingu ani nowego ekranu.
- Gdy renderowany jest semantyczny `<section>`, musi mieć dostępny nagłówek lub `aria-label`. Bez takiej etykiety implementacja powinna użyć neutralnego `<div>` przez prop `as`.
- Przykładowe akcje default/emphasized są prawdziwymi instancjami istniejącego `Button`; compact nie przechowuje ukrytej ani pustej akcji.

## DS-LYT-009 — TwoColumnLayout

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f29322`.
- Library component head: `9425204d-c5c4-807f-8008-b56f930b9295`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `desktop`, `mobile` |
| `ratio` | `50-50`, `7-5`, `8-4`, `stacked` |

Dozwolone kombinacje to wyłącznie trzy proporcje desktopowe oraz jeden `mobile/stacked`; wartości osi nie tworzą pełnego iloczynu.

```ts
type TwoColumnLayoutProps = {
  ratio?: "50/50" | "7/5" | "8/4";
  main: React.ReactNode;
  aside: React.ReactNode;
  stickyAside?: boolean;
  className?: string;
};
```

- Od 768 px układ ma dwie kolumny rozdzielone gapem 24 px. Proporcje dotyczą przestrzeni pozostałej po odjęciu gapu i odpowiadają `1fr 1fr`, `7fr 5fr` oraz `8fr 4fr`; oba tracki muszą używać `minmax(0, ...)`.
- Poniżej 768 px istnieje tylko jeden układ: `main`, następnie `aside`, pełna szerokość i gap 16 px. Nie należy tworzyć trzech kopii mobile zależnych od nieaktywnej proporcji desktopowej ani dodawać odwracania kolejności bez wymagania produktu.
- Komponent odpowiada za kolumny i gap, ale nie za zewnętrzny padding ani max-width. Te należą do `Section` i `AppContainer`, co zapobiega podwójnym odstępom w kompozycji.
- `stickyAside` na desktopie składa `DS-LYT-010 StickyAside`. Na mobile oraz przy zbyt małej wysokości viewportu aside pozostaje w normalnym przepływie. Zachowanie sticky nie ma własnej osi wizualnej w tym komponencie.
- `main` i `aside` są wymaganymi slotami. Wariant z jednym blokiem powinien używać `Section`/`Stack`, zamiast pozostawiać pustą kolumnę.

## DS-LYT-010 — StickyAside

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f29347`.
- Library component head: `9425204d-c5c4-807f-8008-b571e2967e23`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `sticky-public`, `sticky-admin`, `inline-mobile`, `inline-short-viewport` |

To jedna oś opisująca cztery rzeczywiste sposoby zachowania. Nie należy rozbudowywać jej do iloczynu context × viewport × wysokość.

```ts
type StickyAsideProps = React.ComponentPropsWithoutRef<"aside"> & {
  context: "public" | "admin";
  mode?: "auto" | "inline";
  children: React.ReactNode;
};
```

- W trybie `auto` sticky działa wyłącznie od breakpointu 768 px. Poniżej tego progu aside zawsze pozostaje inline i zachowuje miejsce w normalnym przepływie dokumentu.
- Publiczny `top` wynosi 88 px: `header.public.desktop` 72 px + `space.4` 16 px. Adminowy `top` wynosi 80 px: `topbar.admin` 64 px + `space.4` 16 px. Implementacja ma składać istniejące tokeny, a nie wprowadzać nowe arbitralne wartości offsetu.
- Przy małej dostępnej wysokości desktop wraca do inline zgodnie z regułą `viewportHeight < contentHeight + resolvedOffset + space.4`. Nie ma osobnego sztywnego progu wysokości viewportu.
- Wrapper odpowiada wyłącznie za pozycjonowanie. Nie dodaje powierzchni, paddingu, radiusu ani stylu dzieci. Widoczny slot w Penpocie jest wyłącznie ilustracją zachowania katalogowego.
- Należy zachować kolejność źródłową i naturalny focus order. Sticky nie może tworzyć zagnieżdżonego przewijania, zasłaniać fokusowanego elementu ani blokować dostępu do dalszej treści.
- Statyczna makieta potwierdza geometrię i warianty, ale nie dowodzi zachowania podczas scrollowania. Regułę sticky/fallback trzeba później przetestować w uruchamialnym preview przy różnych wysokościach viewportu.

## DS-LYT-011 — StickyActionBar

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f2935c`.
- Library component head: `9425204d-c5c4-807f-8008-b578b477ab96`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `contact-mobile`, `contact-desktop`, `save-mobile-unsaved`, `save-mobile-saving`, `save-mobile-success`, `save-mobile-error`, `multi-action-mobile`, `multi-action-desktop` |

Osiem wartości to sensowne przykłady, nie iloczyn purpose × viewport × state. Kontakt ma oba viewporty, pojedynczy zapis pokazuje cztery wymagane stany mobile, a multi-action oba viewporty i deleguje szczegóły do `DS-FRM-030 FormActions`.

```ts
type StickyActionBarState = "unsaved" | "saving" | "success" | "error";

type StickyActionBarProps = React.ComponentPropsWithoutRef<"div"> & {
  purpose: "contact" | "save" | "multi-action";
  state?: StickyActionBarState;
  placement?: "auto" | "inline";
  status?: React.ReactNode;
  children: React.ReactNode;
};
```

- Wrapper odpowiada wyłącznie za layout, pozycjonowanie, powierzchnię i safe area. Nie przejmuje callbacków, persystencji, autoryzacji ani logiki zapisu.
- W `placement="auto"` mobile używa sticky bottom z `z.sticky` oraz dolnym paddingiem `max(16px, env(safe-area-inset-bottom))`. Desktop pozostaje inline lub na końcu formularza. `z-index` i `env()` są metadanymi runtime — Penpot nie potwierdza ich natywnym bindingiem.
- Strona musi dodać dolny scroll padding równy rzeczywistej wysokości baru i safe area, aby nie zasłaniać pól, błędów ani fokusu. Przy klawiaturze ekranowej lub małej wysokości wrapper może wrócić inline albo przewinąć aktywne pole do widoku; nie wolno tworzyć zagnieżdżonego scrolla.
- Kontakt składa istniejący Button, prowadzi do `OVR-04`/`PUB-04` i zawsze komunikuje „Kontakt nie rezerwuje terminu”. Nie tworzy klienta ani rezerwacji.
- Pojedynczy zapis składa istniejący Button. Status ma tekst oraz ikonę Lucide; `saving`, `success` i `error` używają `aria-live="polite"`, a kontener w stanie saving ma `aria-busy="true"`. Stan unsaved pozostaje cichy dla czytnika.
- Multi-action składa `DS-FRM-030 FormActions`; nie duplikuje jego stanów, kolejności akcji ani obsługi disabled. Na 320 px przyciski są pełnej szerokości lub FormActions zawija je według własnego kontraktu — bez nowej osi wariantu.
- Statyczny eksport potwierdza anatomię i geometrię, ale nie scroll, klawiaturę, safe area ani ogłoszenia live. Te zachowania pozostają testami preview.

## DS-LYT-012 — Divider

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f293aa`.
- Library component head: `9425204d-c5c4-807f-8008-b57d80170dfc`.

| Oś | Wartości w katalogu |
|---|---|
| `type` | `horizontal`, `vertical`, `labeled` |
| `emphasis` | `subtle`, `default`, `strong` |

Macierz 3×3 odpowiada dokładnie SPEC. Nie ma osi viewport: mobile używa horizontal lub labeled, a vertical jest dostępny wyłącznie w układach desktop.

```ts
type DividerProps = React.ComponentPropsWithoutRef<"div"> & {
  orientation?: "horizontal" | "vertical";
  emphasis?: "subtle" | "default" | "strong";
  label?: React.ReactNode;
  decorative?: boolean;
};
```

- Komponent jest transparentnym primitive i nie posiada zewnętrznych marginesów ani katalogowego paddingu. Odstęp przed i po separatorze ustala rodzic przez `Stack`, `Section` lub właściwy layout.
- Horizontal i vertical bez etykiety używają `role="separator"` oraz poprawnego `aria-orientation`; wariant dekoracyjny ma `aria-hidden="true"`. Separator nie jest fokusowalny ani interaktywny.
- Labeled jest zawsze poziomy. Widoczna etykieta pozostaje zwykłym tekstem dla czytnika, a obie linie są `aria-hidden="true"`; nie należy dodawać drugiego, powielonego ogłoszenia roli separatora.
- „lub” jest wyłącznie treścią katalogową i może być zastąpione krótką etykietą. Długi tekst ma się zawijać poza komponentem jako osobny blok, zamiast ściskać obie linie.
- Linie używają `border.subtle`, `border.default` lub `border.strong`. Subtle i default mają 1 px (`border.width.hairline`), strong 2 px (`border.width.active`). Strong oznacza hierarchię, nie błąd ani status.
- Kolory są związane natywnie. Penpot nie pozwala powiązać tokenu typu border-width z wysokością/szerokością wypełnionego prostokąta, dlatego grubość ma jawne mapowanie metadanych i musi zostać użyta z tych samych tokenów w kodzie.
- Root source ma w Penpocie 328×1/2 px dla horizontal, 1/2×160 px dla vertical oraz 328×20 px dla labeled. W implementacji długość jest płynna (`inline-size: 100%` albo `block-size: 100%`), a grubość pozostaje tokenizowana.
- Jasne tło widoczne wokół dziewięciu wariantów należy wyłącznie do powierzchni katalogu Variant Set; nie jest częścią instancji Divider.

## DS-LYT-013 — AspectRatio

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f293c3`.
- Library component head: `9425204d-c5c4-807f-8008-b580120d6f7d`.

| Oś | Wartości w katalogu |
|---|---|
| `ratio` | `16:9`, `4:3`, `3:2`, `1:1` |

Jedna oś odpowiada dokładnie SPEC. Photo i skeleton są treścią slotu, a nie wariantami wrappera; viewport również nie tworzy redundantnej osi.

```ts
type AspectRatioValue = "16/9" | "4/3" | "3/2" | "1/1";

type AspectRatioProps = React.ComponentPropsWithoutRef<"div"> & {
  ratio: AspectRatioValue;
  children: React.ReactNode;
};
```

- Wrapper odpowiada wyłącznie za `aspect-ratio`, wypełnienie dostępnej szerokości oraz clipping treści. Nie dodaje radiusu, obramowania, tła, cienia ani zewnętrznych odstępów.
- Mobile używa najczęściej 4:3 lub 3:2, desktop 16:9 lub 3:2. 1:1 obsługuje kwadratowe miniatury i media. Dobór może zmieniać się responsywnie w rodzicu; komponent nie odczytuje viewportu i nie duplikuje wariantów.
- Dziecko musi wypełnić wrapper w obu osiach. `ResponsiveImage` odpowiada za `object-fit`, focal point, alt, loading, error i fallback. Dla logo może użyć `contain`; zdjęcia pojazdu zwykle używają `cover`.
- `Skeleton` musi otrzymać tę samą wartość ratio co docelowe medium, aby nie powodować zmiany układu. Nie należy tworzyć osobnego `AspectRatioSkeleton`.
- Wrapper jest semantycznie neutralnym `div`, nie otrzymuje roli ani fokusu. Semantyka i tekst alternatywny należą do zawartości.
- Main instances w Penpocie mają kontrolną szerokość 320 px: 16:9 = 320×180, 4:3 = 320×240, 3:2 = 320×213.333… i 1:1 = 320×320. Implementacja ma używać płynnej szerokości, nie tych wartości jako sztywnego rozmiaru.
- Osadzony asset `DEMO V01 front 3q 480w` jest wyłącznie ilustracją wymiennego slotu i potwierdza kadrowanie. Nie stanowi domyślnej treści produkcyjnej.
- Jasne tło Variant Setu jest powierzchnią katalogową i nie należy do instancji. Statyczny Penpot nie dowodzi braku CLS, CSS intrinsic sizing ani zachowania `object-fit`; pozostają one testami uruchamialnego preview.

## DS-LYT-014 — ScrollArea

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f293cc`.
- Library component head: `9425204d-c5c4-807f-8008-b58249d90f09`.

| Oś | Wartości w katalogu |
|---|---|
| `direction` | `horizontal`, `vertical` |
| `state` | `default`, `focus-visible` |

`state` dokumentuje widoczny stan interakcji w Penpocie, ale nie jest propem implementacyjnym. Fokus wynika z `:focus-visible`. Zastosowania mobile (oś czasu lub miniatury) i desktop (tabela lub sidebar) korzystają z tej samej anatomii i nie tworzą dodatkowej osi wariantów.

```ts
type ScrollAreaProps = React.ComponentPropsWithoutRef<"div"> & {
  direction: "horizontal" | "vertical";
  label: string;
  children: React.ReactNode;
  edgeFade?: "auto" | "none";
};
```

- Root kontroluje clipping i overflow wyłącznie na osi wskazanej przez `direction`; cross-axis nie może powodować drugiego paska przewijania.
- Natywny scrollbar ma pozostać dostępny. Wrapper staje się fokusowalny tylko, gdy zawartość rzeczywiście się przepełnia, i otrzymuje dostępną nazwę przez `aria-label` albo `aria-labelledby`.
- Poziomy wariant musi obsługiwać klawiaturę i widoczne cele; może dodatkowo mapować `Shift` + wheel na oś X. Wariant pionowy zachowuje standardowe przewijanie klawiaturą, Page Up i Page Down.
- Gradient końca jest nieinteraktywną warstwą `pointer-events: none`. W trybie `auto` jest widoczny wyłącznie, gdy w danym kierunku pozostała zawartość, i znika po osiągnięciu końca; `none` wyłącza wskazówkę bez zmiany geometrii.
- Fokus używa `focus.ring` 2 px oraz `focus.offset` 2 px. Penpot pokazuje bezpieczny wewnętrzny odpowiednik, aby pierścień nie został przycięty.
- Pięć prostokątów w main instances to wyłącznie edytowalne przykłady slotu, a nie domyślne dzieci ani nowy komponent. Poziomy przykład ma viewport 360×120 px i content 520×120 px; pionowy 280×240 px i content 280×360 px.
- Statyczny Penpot nie potwierdza natywnego przewijania, zmiany fokusowalności, reakcji gradientu na pozycję ani pełnej obsługi klawiatury. Te zachowania wymagają testów uruchamialnego preview.

## DS-LYT-015 — SafeArea

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f293ef`.
- Library component head: `9425204d-c5c4-807f-8008-b584d0cc0bfc`.

| Oś | Wartości w katalogu |
|---|---|
| `edges` | `top`, `bottom`, `both` |

iOS/Android standalone oraz desktop są kontekstem wykonania, nie osiami wariantów. Oba systemy korzystają z jednej anatomii i tych samych zmiennych środowiskowych CSS.

```ts
type SafeAreaProps = React.ComponentPropsWithoutRef<"div"> & {
  edges: "top" | "bottom" | "both";
  children: React.ReactNode;
};
```

- Top stosuje `padding-top: max(12px, env(safe-area-inset-top))`, bottom `padding-bottom: max(16px, env(safe-area-inset-bottom))`, a both obie reguły. Wartości bazowe odpowiadają `space.3` i `space.4`.
- Komponent jest przezroczystym wrapperem bez roli ARIA, tła, obramowania, cienia i własnej interakcji. Semantyka pozostaje odpowiedzialnością dziecka.
- Safe area jest włączana przez shell mobile/PWA i elementy przyklejone do krawędzi. Desktop nie zmienia geometrii; nie istnieje osobny wariant desktop.
- Jeden właściciel krawędzi odpowiada za inset. Nie należy zagnieżdżać dwóch aktywnych SafeArea dla tej samej krawędzi, bo podwoi to padding.
- Bottom navigation, StickyActionBar, BottomSheet i OfflineScreen mogą składać ten kontrakt albo używać identycznej reguły w swoim root, ale nie obu naraz.
- Main instances mają szerokość kontrolną 390 px i podglądowy content-slot 390×64 px. Wysokości wynoszą 76 px dla top, 80 px dla bottom i 92 px dla both. Szary slot tylko uwidacznia transparentne insety i jest zastępowany przez `children`; nie jest domyślną warstwą produkcyjną.
- Penpot nie utrzymał natywnego bindingu `space.3`/`space.4` do wysokości Board, dlatego mapowanie jest zapisane w metadanych insetów. Kolor i obramowanie podglądowego slotu mają natywne bindingi.
- Statyczna makieta nie dowodzi wartości `env()`, wykrycia standalone, zmiany orientacji ani braku podwójnego insetu. Wymagają one testów preview na iOS i Androidzie, z orientacją pionową i poziomą.

## DS-NAV-001 — SkipLink

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2cd4f293fa`.
- Library component head: `9425204d-c5c4-807f-8008-b586ace6306e`.

| Oś | Wartości w katalogu |
|---|---|
| `target` | `content`, `navigation` |
| `state` | `hidden`, `focus-visible` |

`state` dokumentuje CSS i nie jest propem React. Mobile i desktop używają tej samej anatomii; odmienny viewport nie tworzy wariantu.

```ts
type SkipLinkProps = Omit<
  React.ComponentPropsWithoutRef<"a">,
  "children" | "href"
> & {
  target: "content" | "navigation";
};
```

- `content` mapuje etykietę „Przejdź do treści” na `#main-content`, a `navigation` mapuje „Przejdź do nawigacji” na `#main-navigation`.
- To natywny element `a`, umieszczony przed headerem jako pierwszy fokusowalny element dokumentu. Nie używa `Button`, `role="button"` ani callbacku zastępującego standardową nawigację kotwicą.
- Hidden korzysta ze wzorca 1×1 px z clippingiem i przesunięciem poza kadr. Nie wolno używać `display: none`, `visibility: hidden`, `aria-hidden`, `tabIndex={-1}` ani usuwać linku z kolejności Tab.
- `:focus-visible` przywraca naturalny rozmiar, clipping i pozycję w lewym górnym rogu, ponad sticky headerem. Stacking odpowiada `z.popover`; pozycja respektuje top safe area i co najmniej `space.2` od krawędzi.
- Powierzchnia ma minimum 48 px wysokości, `surface.inverse`, `text.inverse`, `radius.sm` i styl `Type / Button / Default`. Pierścień korzysta z `focus.ring`, `border.width.active`, `focus.offset` i `focus.offset.color`.
- Link musi pozostać czytelny przy zoomie 200% i zwężać się do szerokości viewportu bez ellipsis. Nie ma animacji wejścia; fokus jest widoczny od razu.
- Docelowe landmarki muszą istnieć na każdej stronie używającej danego linku. Po aktywacji fokus i pozycja przewinięcia nie mogą zostać zasłonięte przez sticky header. Link do nawigacji jest pomijany, gdy strona nie ma takiego landmarku; nie renderuje się martwej kotwicy.
- Hidden ma kontrolny root 1×1 px; focus-visible mierzy 184×56 px dla treści i 216×56 px dla nawigacji. Statyczny Penpot nie potwierdza kolejności Tab, przeniesienia fokusu, istnienia celu ani zachowania scrollu — wymagają testów preview z klawiaturą i czytnikiem ekranu.

## DS-NAV-002 — BrandLogo

Finalny znak został zaprojektowany w Penpocie na wyraźne polecenie właściciela 09.10.2026 i pozostaje natywnym, edytowalnym komponentem.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ce873845f`.
- Library component head: `9425204d-c5c4-807f-8008-b5889a547e58`.

| Oś | Wartości w katalogu |
|---|---|
| `variant` | `symbol`, `wordmark`, `compact`, `inverse` |

```ts
type BrandLogoProps = Omit<
  React.ComponentPropsWithoutRef<"a">,
  "children" | "href"
> & {
  variant: "symbol" | "wordmark" | "compact" | "inverse";
  context: "public" | "admin";
};
```

- `context="public"` prowadzi do `/`, a `context="admin"` do `/admin`. Destination nie jest osią wizualną i nie tworzy dodatkowych wariantów.
- Symbol jest autorskim geometrycznym `A`. Zwężający się u góry negatyw buduje skojarzenie z drogą w perspektywie, ale znak nie używa dosłownej ikony auta. Dzięki jednej zwartej ścieżce zachowuje czytelność w 16–48 px.
- Wordmark składa ten sam symbol i edytowalny napis `AUTERVA` w Inter Tight 700. Desktop używa 18 px / tracking 0.6 / gap 6 px, compact 16 px / tracking 0.5 / gap 5 px. Nie wolno zastępować napisu innym krojem ani syntetycznym boldem.
- Kontrolne rozmiary rootów: symbol 48×48 px, wordmark 122×48 px, compact 113×44 px, inverse 122×48 px. Root jest transparentnym linkiem; symbol ma minimum 48×48 px, a compact zachowuje minimalny cel 44 px.
- Kolor normalny mapuje się na `text.primary` (`#151515`), inverse na `text.inverse` (`#f2f2f2`). Penpot 2.18 nie zachował natywnego powiązania tokenu po konwersji autorskiego znaku do Path, dlatego komponent zapisuje dokładną wartość oraz shared-plugin mapping `token.fill`; implementacja ma użyć tokenu, nie kopiować HEX do komponentu.
- Inverse jest przeznaczony wyłącznie na ciemną powierzchnię rodzica i nie dodaje własnego tła. Kontrolny render na `#151515` został wykonany, po czym root przywrócono do transparentności.
- Minimalna szerokość pełnego logo to 96 px, compact 88 px. Wokół symbolu zachować co najmniej 0.25 jego szerokości, a wokół wordmarku 0.5 szerokości symbolu. Nie ściskać proporcji ani nie kadrować negatywu wewnątrz `A`.
- Link otrzymuje etykietę „Auterva — strona główna” albo „Auterva — panel administratora”. Widoczny SVG jest dekoracyjny względem etykiety linku (`aria-hidden="true"` albo pusty `alt`), aby nazwa nie była czytana podwójnie.
- Focus-visible należy do wspólnego wrappera linku i nie tworzy osi wariantów. Musi używać systemowego focus ring oraz pozostać czytelny na jasnej i ciemnej powierzchni.
- Implementacyjne SVG są w `design/assets/brand/`: symbol, pełny wordmark i compact. Używają `currentColor`, więc inverse nie wymaga czwartego pliku. Favicon i ikony PWA mają używać wariantu `symbol`, nie mikroskopijnego wordmarku.
- Nie wolno rozciągać znaku, rasteryzować komponentu, dodawać gradientu, obwódki, cienia ani kolejnych wariantów kolorystycznych. Ewentualna zmiana nazwy marki wymaga nowej decyzji i ponownego eksportu; nie jest osią komponentu.

## DS-NAV-004 — PublicMobileDrawer

Kontrakt: projekt i kontrakt komponentu; zachowania fokusowe wymagają jeszcze testów implementacji w przeglądarce.

- Penpot Variant Set: `efe3ac9b-6991-807f-8008-cf25429dca0c`.
- Library component head: `9425204d-c5c4-807f-8008-b58cf60f6878`.
- Źródła open/closing: `9425204d-c5c4-807f-8008-b58b90371561` / `9425204d-c5c4-807f-8008-b58cf6143ce6`.

| Oś | Wartości w katalogu |
|---|---|
| `state` | `open`, `closing` |

```ts
type PublicPath = "/pojazdy" | "/pojazdy#dostepnosc" | "/#o-nas" | "/kontakt";

type PublicMobileDrawerProps = {
  open: boolean;
  activePath?: PublicPath;
  contactChannels: {
    phone?: string;
    whatsapp?: string;
    email?: string;
  };
  onOpenChange: (open: boolean) => void;
};
```

- To komponent wyłącznie mobilny. Referencyjny root ma 390×844 px, działa od 320 do 430 px i utrzymuje inset poziomy 16 px. Desktop jest N/A — nie należy tworzyć desktopowego hamburgera ani pustego wariantu.
- `BrandLogo` compact prowadzi do `/`. Menu zawiera `Pojazdy`, `Dostępność`, `O nas` i `Kontakt`; aktywna trasa jest propem runtime, nie osią wariantów.
- Sekcja „Szybki kontakt” renderuje tylko skonfigurowane kanały. Brak telefonu, WhatsAppa lub e-maila usuwa odpowiedni wiersz, zamiast pozostawiać pustą lub nieaktywną akcję. Akcja kontaktowa nie rezerwuje ani nie blokuje terminu.
- Root ma `role="dialog"`, `aria-modal="true"` i nazwę „Menu główne”. Po otwarciu fokus trafia na przycisk „Zamknij”, Tab pozostaje wewnątrz, Escape zamyka menu, a po zamknięciu fokus wraca do hamburgera. Treść pod spodem jest `inert`, a scroll dokumentu zablokowany.
- Przycisk „Zamknij”, linki i skróty kontaktowe mają co najmniej 48 px wysokości. `aria-current="page"` dotyczy wyłącznie aktywnego linku.
- `open` pokazuje pełną powierzchnię. `closing` ilustruje wyjście w prawo i spadek opacity; implementacja używa `motion.base.ms` 180 ms oraz krzywej exit. `prefers-reduced-motion` usuwa translację i ogranicza zmianę do natychmiastowego zamknięcia lub krótkiego fade.
- `action-close` ma w Penpocie rzeczywistą akcję `close-overlay`. Instancja `OVR-01` jest już otwierana z nagłówków P-01/P-02; docelowe przejścia czterech linków i kontrolowane protokoły kontaktu pozostają do podłączenia. Sam komponent nadal nie oznacza ukończenia zachowania overlayu.
- Statyczny Penpot nie potwierdza focus trap, Escape, `inert`, scroll lock ani zwrotu fokusu; wymagają testu klawiaturą i czytnikiem ekranu.

## DS-NAV-006 — Breadcrumbs

Kontrakt: projekt i kontrakt komponentu.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ce873846c`.
- Library component head: `9425204d-c5c4-807f-8008-b590f26b769c`.
- Źródła public/full, admin/full, public/collapsed i admin/collapsed: `9425204d-c5c4-807f-8008-b590a1c6776c`, `9425204d-c5c4-807f-8008-b590a1daad3e`, `9425204d-c5c4-807f-8008-b590a1f2857e`, `9425204d-c5c4-807f-8008-b590a20aebf8`.

| Oś | Wartości w katalogu |
|---|---|
| `context` | `public`, `admin` |
| `mode` | `full`, `collapsed` |

```ts
type BreadcrumbItem = {
  label: string;
  href?: string;
};

type BreadcrumbsProps = {
  context: "public" | "admin";
  items: readonly [BreadcrumbItem, ...BreadcrumbItem[]];
};
```

- Implementacja renderuje `nav` z `aria-label="Okruszki"` oraz uporządkowaną listę. Wszystkie elementy poza ostatnim są linkami; ostatni jest tekstem z `aria-current="page"` i nie może być klikalny.
- `full` pokazuje całą ścieżkę od strony głównej lub panelu. `collapsed` zachowuje pierwszy i bieżący element, a pominięte poziomy sygnalizuje dekoracyjnym wielokropkiem. Overflow i current page są zachowaniem/anatomią, nie dodatkowymi osiami wariantów.
- Separatory `/` i wielokropek mają `aria-hidden="true"`. Dostępna nazwa bieżącego elementu zachowuje pełny tytuł także wtedy, gdy implementacja wizualnie go skróci.
- Publiczne linki wzorcowe prowadzą do `/` i `/pojazdy`; administracyjne do `/admin`, `/admin/pojazdy` oraz `/admin/pojazdy/[id]`. Trasy pośrednie wynikają z danych i nie tworzą osobnych wariantów.
- Komponent używa `Inter Tight` 14 px w Penpocie (`Inter Variable` w kodzie), `text.secondary` dla linków, `text.tertiary` dla separatorów i `text.primary` + semibold dla bieżącej strony. Root jest transparentny.
- Każdy widoczny element ma 48 px wysokości. Publiczny układ collapsed zajmuje 288 px, dlatego mieści się przy 320 px z insetem 16 px; sprawdzono też 390 i 430 px. Nie należy dodawać osobnych wariantów viewportu.
- Cztery warianty mają unikalne kombinacje osi i brak `variantError`; tymczasowe plansze QA usunięto i potwierdzono jako nieobecne.

## DS-NAV-010 — AdminMoreMenu

Kontrakt: projekt i kontrakt komponentu; zachowanie fokusu wymaga testu implementacji w przeglądarce.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a50ff5`.
- Library component head: `9425204d-c5c4-807f-8008-b5942c34f856`.
- Źródła mobile/open, mobile/active, desktop/open i desktop/active: `9425204d-c5c4-807f-8008-b5932afb84d1`, `9425204d-c5c4-807f-8008-b5938ae0dcf3`, `9425204d-c5c4-807f-8008-b593c5532932`, `9425204d-c5c4-807f-8008-b593ed2d9244`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `mobile-sheet`, `desktop-dropdown` |
| `state` | `open`, `active` |

```ts
type AdminMoreMenuProps = {
  mode: "mobile-sheet" | "desktop-dropdown";
  open: boolean;
  activePath?: "/admin/usluga" | "/admin/ustawienia" | "/admin/konto";
  canInstallPwa: boolean;
  onInstallPwa?: () => void;
  onLogout: () => void;
  onOpenChange: (open: boolean) => void;
};
```

- Lista MVP ma pięć pozycji: Status usługi (`/admin/usluga`), Ustawienia (`/admin/ustawienia`), Konto (`/admin/konto`), warunkową instalację PWA i Wyloguj. Dziennik zmian (`/admin/logi`) jest przyszłym SHOULD i nie pojawia się jako martwe wejście. Aktywna trasa jest propem runtime; nie tworzy osobnych wariantów dla każdego modułu.
- Instalacja PWA pojawia się tylko wtedy, gdy istnieje obsługiwany prompt albo właściwa instrukcja platformowa. W przeciwnym razie pozycję należy pominąć, a nie renderować jako martwą/disabled.
- Wyloguj jest akcją, nie linkiem. Po sukcesie unieważnia bieżącą sesję i prowadzi do logowania. Komponent nie wykonuje tej operacji samodzielnie.
- Mobile używa modalnego dialogu/sheetu z nazwą „Więcej — menu administratora”, przyciskiem Zamknij i bezpiecznym dolnym insetem. Desktop jest menu/dropdownem zakotwiczonym w triggerze topbara. Escape i kliknięcie poza zamykają oba tryby, a fokus wraca do triggera.
- Każda pozycja ma ikonę Lucide i tekst. Stan active używa jednocześnie `surface.selected`, obramowania `border.strong`, semibold oraz `aria-current="page"`; kolor nie jest jedynym sygnałem.
- Mobile ma 390×408 px i reflow przy 320/430 px; wiersze mają 55–56 px. Desktop ma 320×313 px i wszystkie cele 48 px. Rooty korzystają z `surface.default`, `border.subtle` i `shadow.md`.
- Mobilne `OVR-17 User menu / Więcej` używa instancji `89433e5c-4f5c-80ad-8008-d5edfc7920c7` na stronie panelu firmy. Cel „Więcej” w `ADM-04` otwiera ją interakcją `open-overlay`; linki do statusu usługi, ustawień i konta prowadzą do istniejących boardów mobilnych, a Zamknij zamyka overlay. Stary identyfikator `9425204d-c5c4-807f-8008-b6ccfd8c33f6` nie występuje live. Instalacja PWA i wylogowanie wymagają akcji runtime; makieta nie dowodzi działania focus trapu ani unieważnienia sesji.
- Desktopowy `OVR-17` na stronie panelu firmy używa instancji `89433e5c-4f5c-80ad-8008-d5f3a39ca891` istniejącego wariantu `desktop-dropdown/open` (`9425204d-c5c4-807f-8008-b5942c39e014`). Widoczny przycisk użytkownika w topbarze `ADM-04` (`37f3ef1b-03c6-808f-8008-c344268aba06`) otwiera ją interakcją `open-overlay`; „Status usługi” prowadzi do desktopowego `TEN-04` (`/admin/usluga`), a Ustawienia i Konto do swoich boardów. Stary `open-url` `/admin?overlay=user-menu` na szerszym obszarze topbara usunięto. Instalacja PWA i wylogowanie pozostają akcjami runtime; prototyp nie potwierdza ich działania ani obsługi fokusu.

## DS-NAV-011 — UserMenu

Kontrakt: projekt i kontrakt komponentu; obsługa fokusu i wylogowania wymaga testu implementacji w przeglądarce.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2fb2a51098`.
- Library components: mobile `9425204d-c5c4-807f-8008-b597a3e742ba`, desktop `9425204d-c5c4-807f-8008-b597a3eb96c9`.
- Źródła mobile i desktop: `9425204d-c5c4-807f-8008-b595c0d75342`, `9425204d-c5c4-807f-8008-b59616442fc0`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `mobile-sheet`, `desktop-dropdown` |

```ts
type UserMenuProps = {
  mode: "mobile-sheet" | "desktop-dropdown";
  user: { displayName: string; initials: string };
  currentSession: true;
  onLogout: () => void;
  onOpenChange: (open: boolean) => void;
};
```

- Komponent MVP ma wspólną anatomię: profil, jawny status „Bieżąca sesja”, link Konto i hasło (`/admin/konto`) oraz akcję Wyloguj. Przegląd aktywnych sesji (`/admin/konto?sekcja=sesje`) jest przyszłym SHOULD i nie jest aktywną pozycją menu MVP. Nie tworzy się osobnych osi dla tych elementów ani danych użytkownika.
- `AD` jest wyłącznie placeholderem `DEMO`; implementacja podstawia inicjały i nazwę uwierzytelnionego użytkownika. Nie wolno utrwalać danych osobowych w bibliotece komponentów.
- Wyloguj jest przyciskiem, nie linkiem. Po sukcesie unieważnia bieżącą sesję i prowadzi do `/admin/login`; sam komponent nie wykonuje logiki serwerowej.
- Mobile jest modalnym dialogiem/sheetem z przyciskiem Zamknij i safe area. Desktop jest menu/dropdownem zakotwiczonym w triggerze. Escape i kliknięcie poza zamykają menu, a fokus wraca do triggera.
- Status sesji używa ikony Lucide i tekstu, więc kolor nie jest jedynym sygnałem. Wiersze mobile mają 55–56 px, desktop 48 px.
- Mobile po usunięciu wejścia do przeglądu sesji ma 390×320 px, desktop 320×209 px; reflow 320/430 px wymaga ponownego odbioru po tej korekcie. Rooty korzystają z `surface.default`, `border.subtle` i `shadow.md`; teksty i ikony mają semantyczne bindingi.
- Historyczna desktopowa instancja `DS-NAV-011` o ID `9425204d-c5c4-807f-8008-b6ccfd9712a5` nie występuje live i nie jest źródłem `OVR-17` w MVP. `DS-NAV-011` zachowuje odrębny wzorzec profilu/sesji; statyczny Penpot nie dowodzi focus trapu, Escape, kliknięcia poza, zwrotu fokusu ani unieważnienia sesji.

## DS-NAV-013 — SegmentedControl

Kontrakt: projekt i kontrakt komponentu; klawiatura i roving tabindex wymagają testu implementacji w przeglądarce.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ce87384ae`.
- Library component head: `9425204d-c5c4-807f-8008-b59addf0aa56`.
- Źródła ośmiu wariantów: `9425204d-c5c4-807f-8008-b59a2b77adaa`, `9425204d-c5c4-807f-8008-b59a5a2d1bbb`, `9425204d-c5c4-807f-8008-b59a5c308fef`, `9425204d-c5c4-807f-8008-b59a5ea72770`, `9425204d-c5c4-807f-8008-b59a6072dd39`, `9425204d-c5c4-807f-8008-b59a6277a94b`, `9425204d-c5c4-807f-8008-b59a64dae5cc`, `9425204d-c5c4-807f-8008-b59a672045a7`.

| Oś | Wartości w katalogu |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `items` | `2`, `3`, `4` |
| `state` | `default`, `focus-visible` |

Macierz jest celowo niepełna: `default` istnieje dla 2/3/4 opcji w obu viewportach, a `focus-visible` tylko dla reprezentatywnego układu 3-opcyjnego.

```ts
type SegmentedControlOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  options: readonly [
    SegmentedControlOption<T>,
    SegmentedControlOption<T>,
    ...SegmentedControlOption<T>[],
  ];
  value: T;
  onValueChange: (value: T) => void;
  ariaLabel: string;
  viewport: "mobile" | "desktop";
};
```

- Dozwolone są 2–4 opcje i dokładnie jedna wartość wybrana. Konkretna wybrana pozycja jest kontrolowanym propem runtime, nie osobną osią wariantów.
- Mobile wypełnia szerokość kontenera: źródło ma 358×48 px, a wszystkie segmenty `horizontalSizing=fill`. Sprawdzono content 288 px w viewport 320 oraz 398 px w viewport 430. Desktop obejmuje treść i ma kontrolne szerokości 176/260/344 px.
- Każdy segment ma 48 px wysokości. Wybrany używa `surface.selected`, `border.strong`, `text.primary` i semibold; nie jest sygnalizowany wyłącznie kolorem. Focus-visible używa `focus.ring` 2 px.
- Kontener ma semantykę `radiogroup`, segmenty `radio`, `aria-checked` i roving tabindex. Implementacja obsługuje ArrowLeft/ArrowRight oraz Home/End, bez zmiany wartości wyłącznie przy przesunięciu fokusu, jeśli przyjęty wzorzec formularza tego wymaga.
- Etykiety są edytowalnymi tekstami, bez ikon i badge’y w MVP. Długie wartości wymagają krótszego copy lub innego komponentu; nie należy zmniejszać fontu ani celu dotykowego.
- Statyczny Penpot potwierdza wygląd, tokeny i geometrię, lecz nie wykonanie klawiatury, ogłaszania wartości ani kolejności fokusu.

## DS-NAV-014 — Pagination

Kontrakt: projekt i kontrakt komponentu; aktualizacja adresu URL, fokusu po zmianie strony i komunikatów czytnika wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ce873d37b`.
- Library component head: `9425204d-c5c4-807f-8008-b59ef0029092`.
- Źródła sześciu wariantów: `9425204d-c5c4-807f-8008-b59d4610a313`, `9425204d-c5c4-807f-8008-b59d56e13e4a`, `9425204d-c5c4-807f-8008-b59d65f3ebb1`, `9425204d-c5c4-807f-8008-b59d7bab8c38`, `9425204d-c5c4-807f-8008-b59d7bb73654`, `9425204d-c5c4-807f-8008-b59d7bc32fbe`.

| Oś | Wartości w katalogu |
|---|---|
| `mode` | `compact`, `numbered` |
| `state` | `default`, `boundary`, `loading` |

`previous-next` ze SPEC jest wspólną anatomią obu trybów, nie trzecią osią. Początek i koniec zakresu korzystają z jednego stanu `boundary`; wyłączony kierunek wynika z bieżącej strony.

```ts
type PaginationProps = {
  mode: "compact" | "numbered";
  page: number;
  pageCount: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
  ariaLabel?: string;
};
```

- Root jest landmarkiem `navigation` z nazwą „Paginacja”. Bieżący numer ma `aria-current="page"`; niedostępne kierunki mają rzeczywisty `disabled` oraz `aria-disabled`.
- `compact` pokazuje Wstecz, „Strona X z Y” i Dalej. Trzy regiony mają `horizontalSizing=fill`, wysokość 48 px i reflow bez clippingu przy 288 oraz 398 px szerokości treści.
- `numbered` pokazuje strzałki Lucide, pierwszą/ostatnią stronę, okno bieżących numerów i nieinteraktywną elipsę. Kontrolne szerokości wynoszą 424–464 px.
- `loading` wyłącza obie akcje, ustawia `aria-busy=true` i wystawia krótki komunikat live. Nie dodaje spinnera ani osobnego ekranu.
- Liczba stron, bieżąca strona i kierunek boundary są danymi runtime. Nie wolno tworzyć wariantu dla każdego numeru ani osobnych osi start/end.
- Komponent jest dostępny na przyszły wzrost danych, lecz nie wymusza użycia w obecnym MVP. Zgodnie z PRD pełna przefiltrowana lista do około 100 pojazdów może zostać pokazana bez paginacji.
- Statyczny Penpot potwierdza geometrię, tokeny i semantyczny kontrakt. Obsługa adresu URL, zachowanie fokusu, pobieranie danych i ogłoszenia AT pozostają bramkami testów implementacji.

## DS-NAV-015 — BackButton

Kontrakt: projekt i kontrakt komponentu; rzeczywista historia przeglądarki, routing i kolejność fokusu wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ce873d3c8`.
- Library component head: `9425204d-c5c4-807f-8008-b5a194539529`.
- Źródła czterech wariantów: `9425204d-c5c4-807f-8008-b5a1372eee77`, `9425204d-c5c4-807f-8008-b5a1446e66e0`, `9425204d-c5c4-807f-8008-b5a14f3abb3d`, `9425204d-c5c4-807f-8008-b5a1530d6a1c`.

| Oś | Wartości w katalogu |
|---|---|
| `presentation` | `icon-label`, `icon-only` |
| `state` | `default`, `focus-visible` |

Viewport, konkretna trasa i semantyka link/przycisk są właściwościami użycia, nie osiami wariantów.

```ts
type BackButtonProps = {
  presentation?: "icon-label" | "icon-only";
  href?: string;
  onBack?: () => void;
  ariaLabel?: string;
};
```

- Gdy `href` jest znany, komponent renderuje link. Bez docelowej trasy używa przycisku wywołującego kontrolowaną akcję powrotu; nie należy tworzyć pustego odnośnika ani zakładać, że historia zawsze istnieje.
- Mobile domyślnie używa `icon-label` z tekstem „Wróć”. Desktop preferuje Breadcrumbs, gdy użytkownik potrzebuje hierarchii; BackButton pozostaje właściwy dla powrotu do bezpośredniego kontekstu.
- `icon-label` ma 104×48 px, ikonę Lucide `arrow-left`, gap 8 px i padding poziomy 12 px. `icon-only` ma 48×48 px i obowiązkową nazwę dostępną „Wróć”.
- `focus-visible` używa `focus.ring` oraz `border.width.active`; stan domyślny korzysta z `border.subtle` i `border.width.hairline`.
- Kliknięcie nie może kasować parametrów ani niezapisanych danych bez istniejącego mechanizmu ochronnego. Komponent sam nie implementuje dialogu niezapisanych zmian.
- Statyczny Penpot potwierdza wygląd, tokeny i geometrię. Routing, zachowanie historii, aktywacja Enter/Space i przywrócenie fokusu są bramkami testów implementacji.

## DS-NAV-016 — AnchorNavigation

Kontrakt: projekt i kontrakt komponentu; aktualizacja adresu URL, przewijanie, obsługa klawiatury i sticky target offset wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ce873d3df`.
- Library component head: `9425204d-c5c4-807f-8008-b5a3d2e5af55`.
- Źródła czterech wariantów: `9425204d-c5c4-807f-8008-b5a30436f226`, `9425204d-c5c4-807f-8008-b5a32f1d6ad7`, `9425204d-c5c4-807f-8008-b5a386a969bb`, `9425204d-c5c4-807f-8008-b5a374b0b297`.

| `context` | `mode` | Zastosowanie |
|---|---|---|
| `form` | `mobile-scroll` | pozioma lista sekcji formularza |
| `form` | `desktop-sticky` | boczna lista sticky formularza |
| `legal` | `mobile-dropdown` | zwarty wybór sekcji dokumentu |
| `legal` | `desktop-sticky` | boczny spis treści dokumentu |

Nie istnieją inne kombinacje. `currentSection`, elementy, adresy i sticky offset są danymi runtime, nie osiami wariantów.

```ts
type AnchorItem = {
  id: string;
  label: string;
  href: `#${string}`;
  status?: "active" | "complete" | "error";
};

type AnchorNavigationProps = {
  context: "form" | "legal";
  mode: "mobile-scroll" | "mobile-dropdown" | "desktop-sticky";
  items: AnchorItem[];
  currentSection: string;
  stickyOffset?: number;
  ariaLabel?: string;
};
```

- Dla `form` dozwolone są wyłącznie `mobile-scroll` i `desktop-sticky`; komponent składa rzeczywiste instancje `DS-FRM-027 FormSectionNav`.
- Dla `legal` dozwolone są wyłącznie `mobile-dropdown` i `desktop-sticky`; linki prawne nie dziedziczą stanów walidacji formularza.
- Root jest landmarkiem `navigation` z nazwą zależną od kontekstu. Dokładnie jeden link ma `aria-current="location"`.
- Mobile form zachowuje widoczny fragment kolejnego celu i kontrolowany poziomy scroll. Mobile legal używa triggera 48 px z `aria-expanded` oraz `aria-haspopup="listbox"`.
- Desktop używa celów 48 px i pozycji sticky. Implementacja musi uwzględnić offset kotwicy, fokus po wyborze oraz preferencję ograniczenia ruchu.
- Statyczny Penpot potwierdza anatomię, tokeny, geometrię i reflow 320/430 px. Zachowanie hash, scroll, klawiatura i czytnik ekranu pozostają bramkami testów implementacji.

## DS-PWA-001 — InstallPrompt

Kontrakt: projekt i kontrakt komponentu; dostępność natywnego promptu instalacji, standalone detection, fokus i instalacja wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ce873d41b`.
- Library component head: `9425204d-c5c4-807f-8008-b5a8ff3225e6`.
- Źródła trzech wariantów: `9425204d-c5c4-807f-8008-b5a89c61c70b`, `9425204d-c5c4-807f-8008-b5a89cb92867`, `9425204d-c5c4-807f-8008-b5a89d10be1c`.

| `platform` | `viewport` | Widoczna treść |
|---|---|---|
| `browser` | `mobile` | instalacja i odroczenie w układzie pionowym |
| `browser` | `desktop` | instalacja i odroczenie w bannerze |
| `ios` | `mobile` | trzy kroki instalacji z Safari |

`eligible` jest jedynym stanem renderowanym. `dismissed` i `installed` zwracają `null`; nie tworzą pustych wariantów ani stale widocznego potwierdzenia.

```ts
type InstallPromptProps = {
  platform: "browser" | "ios";
  viewport: "mobile" | "desktop";
  state: "eligible" | "dismissed" | "installed";
  onInstall?: () => void;
  onDismiss: () => void;
  onAcknowledge?: () => void;
};
```

- Kombinacja `ios/desktop` nie istnieje; instrukcja krok po kroku dotyczy instalacji z mobilnego Safari.
- Browser renderuje „Zainstaluj” tylko po wykryciu obsługiwanego mechanizmu. Brak capability, standalone, `dismissed` lub `installed` ukrywa komponent.
- iOS pokazuje kolejno: Udostępnij, „Do ekranu głównego”, „Dodaj”. Nie udaje natywnego promptu, którego platforma nie udostępnia.
- Wszystkie akcje są rzeczywistymi instancjami `DS-ACT-001 Button` o wysokości 48 px. Mobile ma fill width i został sprawdzony przy 320 oraz 430 px.
- Root ma rolę regionu z nazwą „Instalacja aplikacji”. `OVR-15` wykorzystuje trzy instancje komponentu na stronie prototypów: browser/mobile `9425204d-c5c4-807f-8008-b6cd13221e4c`, iOS/mobile `9425204d-c5c4-807f-8008-b6cd132bf9c5` i browser/desktop `9425204d-c5c4-807f-8008-b6cd1338b8fe`. Overlay ma status `created`; focus, powrót fokusu oraz prawdziwy prompt instalacji pozostają kontrolami runtime.
- Komponent dotyczy wyłącznie panelu `/admin`. Nie sugeruje instalacji części publicznej i nie obiecuje zapisu danych offline.

## DS-PWA-002 — OfflineBanner

Kontrakt: projekt i kontrakt komponentu; wykrywanie sieci, ogłoszenia live, sticky positioning oraz odblokowanie mutacji wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d05b4a4d0`.
- Library component head: `9425204d-c5c4-807f-8008-b5ac45223f2a`.
- Źródła sześciu wariantów: `9425204d-c5c4-807f-8008-b5ac09833a3e`, `9425204d-c5c4-807f-8008-b5ac20af9d6b`, `9425204d-c5c4-807f-8008-b5ac212aa198`, `9425204d-c5c4-807f-8008-b5ac21a73907`, `9425204d-c5c4-807f-8008-b5ac225a5aef`, `9425204d-c5c4-807f-8008-b5ac2319e4a4`.

| `presentation` | `state` | Komunikat |
|---|---|---|
| `compact` | `offline` | Brak internetu — zapis wyłączony |
| `compact` | `reconnecting` | Ponowne łączenie… |
| `compact` | `restored` | Połączenie przywrócone |
| `blocking` | `offline` | brak zapisu i ochrona otwartego formularza |
| `blocking` | `reconnecting` | zapis wyłączony do potwierdzenia sieci |
| `blocking` | `restored` | ponowne pobranie danych i zapis są możliwe |

```ts
type OfflineBannerProps = {
  presentation: "compact" | "blocking";
  state: "offline" | "reconnecting" | "restored";
  onRestoredComplete?: () => void;
};
```

- Komponent jest sticky top i wypełnia szerokość kontenera na mobile oraz desktopie. Viewport nie jest osią wariantu.
- `blocking/offline` używa `role="alert"`, `aria-live="assertive"` i `aria-atomic="true"`. Pozostałe warianty używają `role="status"` oraz `aria-live="polite"`.
- Stan nie opiera się na kolorze: każda wartość ma ikonę, tekst i charakter obramowania. Reconnecting używa przerywanego obramowania.
- `restored` może zostać schowany po odczytaniu komunikatu, ale czas jest zachowaniem runtime i nie tworzy wariantu.
- Banner nie włącza zapisów, nie kolejkuje mutacji i nie pokazuje fikcyjnego sukcesu. `DS-PWA-004 NetworkActionGuard` kontroluje działania wymagające sieci, a `DS-PWA-003 OfflineScreen` obsługuje pełny stan startowy bez danych.
- Statyczny Penpot potwierdza geometrię, tokeny oraz reflow 320/430/1440 px. Rzeczywiste zdarzenia online/offline i ogłoszenia AT pozostają bramkami testów implementacji.

## DS-PWA-003 — OfflineScreen

Kontrakt: projekt i kontrakt komponentu; detekcja sieci, cache aplikacji, ponowienie żądania, focus management i ogłoszenia czytnika ekranu wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d05b4a506`.
- Library component head: `9425204d-c5c4-807f-8008-b5af6b3ba635`.
- Źródła ośmiu wariantów: `9425204d-c5c4-807f-8008-b5af0f78d968`, `9425204d-c5c4-807f-8008-b5af3370f9ac`, `9425204d-c5c4-807f-8008-b5af34aed705`, `9425204d-c5c4-807f-8008-b5af35938ad0`, `9425204d-c5c4-807f-8008-b5af3dff0def`, `9425204d-c5c4-807f-8008-b5af3f263479`, `9425204d-c5c4-807f-8008-b5af409c604c`, `9425204d-c5c4-807f-8008-b5af4194ffc9`.

| `mode` | `viewport` | `state` | Akcje |
|---|---|---|---|
| `shell-cached` | `mobile` / `desktop` | `offline` | retry + otwarcie ostatniego dashboardu |
| `shell-cached` | `mobile` / `desktop` | `retrying` | loading retry + read-only cached shell |
| `no-data` | `mobile` / `desktop` | `offline` | retry |
| `no-data` | `mobile` / `desktop` | `retrying` | loading retry |

```ts
type OfflineScreenProps = {
  mode: "shell-cached" | "no-data";
  viewport: "mobile" | "desktop";
  state: "offline" | "retrying";
  onRetry: () => void;
  onOpenCachedDashboard?: () => void;
};
```

- Mobile jest pełnym ekranem, desktop pełną stroną. Jedna anatomia centruje ikonę, nagłówek, opis i akcje; przy 320 px treść oraz przyciski zwężają się do 272 px bez przycięcia.
- `shell-cached` pozwala wyłącznie przejrzeć ostatnio wczytany dashboard. Nie odblokowuje zapisu, nie kolejkuje mutacji i nie pokazuje fikcyjnego sukcesu.
- `retrying` składa istniejący wariant loading `DS-ACT-001 Button`, blokuje kolejne uruchomienie retry i dodaje `role="status"`, `aria-live="polite"` dla tekstu „Ponowne łączenie…”.
- Po wejściu fokus trafia na nagłówek poziomu 2; dekoracyjna ikona wifi-off jest ukryta przed technologiami asystującymi. Akcje pozostają realnymi instancjami Button o wysokości 48 px.
- `DS-PWA-004 NetworkActionGuard` nadal odpowiada za blokowanie działań sieciowych. `ADM-18` pozostaje osobną kompozycją ekranu i nie jest zastępowany samym komponentem.
- Statyczny Penpot potwierdza warianty i reflow 320/430/768/1024/1920 px. Cache, przejścia online/offline, fokus i czytnik ekranu pozostają bramkami testów implementacji.

## DS-PWA-004 — NetworkActionGuard

Kontrakt: projekt i kontrakt komponentu; wykrywanie sieci, blokada mutacji, idempotencja retry oraz zachowanie formularza wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d05b4a593`.
- Library component head: `9425204d-c5c4-807f-8008-b5b1a46931d1`.
- Źródła czterech wariantów: `9425204d-c5c4-807f-8008-b5b161d5ce15`, `9425204d-c5c4-807f-8008-b5b1851b721d`, `9425204d-c5c4-807f-8008-b5b18640c6e9`, `9425204d-c5c4-807f-8008-b5b187609ae4`.

| `mode` | `viewport` | Zachowanie |
|---|---|---|
| `save-disabled` | `mobile` / `desktop` | disabled „Zapisz zmiany” + jawna przyczyna |
| `retry` | `mobile` / `desktop` | komunikat „działanie nie zostało wykonane” + retry |

```ts
type NetworkActionGuardProps = {
  mode: "save-disabled" | "retry";
  viewport: "mobile" | "desktop";
  onRetry?: () => void;
  children?: React.ReactNode;
};
```

- Mobile składa komunikat i akcję pionowo; desktop zachowuje inline guard o maksymalnej szerokości 720 px. To jedyny powód osi `viewport`; nie powstały dodatkowe stany urządzeń ani osobne ekrany.
- `save-disabled` używa rzeczywistego wariantu disabled `DS-ACT-001 Button`. Powód blokady jest widoczny obok kontrolki, więc nie zależy od samego koloru ani niedostępnego tooltipa.
- `retry` nie używa komunikatu sukcesu. Tekst jawnie mówi, że działanie nie zostało wykonane, a implementacja może ponowić je dopiero po odzyskaniu sieci.
- Każdy wariant wymaga sieci, nie zapisuje offline, nie kolejkuje mutacji i nie renderuje sukcesu. Odpowiednie wartości są zapisane w kontrakcie komponentu.
- Statyczny Penpot potwierdza realne Button, tokeny i reflow w viewportach 320/430/768/1024/1920 px. Detekcja sieci, zachowanie danych formularza, idempotencja i serwerowa blokada mutacji pozostają bramkami testów.

## DS-PWA-005 — UpdatePrompt

Kontrakt: projekt i kontrakt komponentu; cykl życia service workera, przywrócenie trasy, wygaśnięcie sesji i ochrona niezapisanych danych wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d05b4a5d0`.
- Library component head: `9425204d-c5c4-807f-8008-b5b318bbe903`.
- Źródła trzech widocznych wariantów: `9425204d-c5c4-807f-8008-b5b294079a7b`, `9425204d-c5c4-807f-8008-b5b2a6c81c59`, `9425204d-c5c4-807f-8008-b5b2a7fc09e3`.

| `context` | `state` | Zachowanie |
|---|---|---|
| `safe` | `available` | „Odśwież teraz” + warunkowe „Później” |
| `safe` | `refreshing` | loading, brak kolejnej akcji i postpone |
| `unsaved` | `available` | „Zabezpiecz zmiany” otwiera `OVR-13`; tam użytkownik wybiera zapis, pozostanie lub jawne odrzucenie |

`postponed` zwraca `null`. Kombinacja `unsaved/refreshing` nie istnieje przed rozstrzygnięciem `OVR-13`.

```ts
type UpdatePromptProps = {
  context: "safe" | "unsaved";
  state: "available" | "postponed" | "refreshing";
  critical?: boolean;
  onRefresh: () => void;
  onPostpone?: () => void;
};
```

- Komponent dostarcza treść i akcje. `OVR-16` nadal odpowiada za banner/sheet na mobile oraz toast/dialog na desktopie; nie powstał drugi overlay.
- `Później` jest widoczne tylko przy `critical !== true`; ta polityka jest propem runtime, nie osią wariantu.
- Dla `unsaved` akcja „Zabezpiecz zmiany” najpierw otwiera `OVR-13 UnsavedChangesDialog`. Dopiero bezpieczne rozstrzygnięcie może przełączyć prompt do `safe/refreshing`.
- `refreshing` składa istniejący loading `DS-ACT-001 Button`, ma busy/disabled i nie pozwala ponowić odświeżenia. Po reloadzie router przywraca trasę albo kieruje do logowania po wygaśnięciu sesji.
- Statyczny Penpot potwierdza natywną ikonę, realne Button, tokeny i reflow 320/430/768/1024/1920 px. Service worker, route restore, sesja i utrzymanie danych formularza pozostają bramkami testów implementacji.

## DS-PWA-006 — OnlineStatusIndicator

Kontrakt: projekt i kontrakt komponentu; źródło stanu sieci, debounce zdarzeń online/offline i rzeczywiste ogłoszenia AT wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d05b4a5fc`.
- Library component head: `9425204d-c5c4-807f-8008-b5b3f65afae9`.
- Źródła trzech wariantów: `9425204d-c5c4-807f-8008-b5b3cf208ad1`, `9425204d-c5c4-807f-8008-b5b3cfc75a0b`, `9425204d-c5c4-807f-8008-b5b3d0b97844`.

```ts
type OnlineStatusIndicatorProps = {
  state: "online" | "offline" | "reconnecting";
};
```

- `online` używa circle-check i tekstu „Połączono”, `offline` wifi-off i tekstu „Brak połączenia”, a `reconnecting` refresh-cw oraz „Ponowne łączenie…”.
- Każdy stan ma ikonę, tekst i charakter obramowania; kolor nie jest jedynym nośnikiem informacji.
- Root ma `role="status"`, `aria-live="polite"` i `aria-atomic="true"`. Implementacja powinna ograniczyć powtarzalne ogłoszenia przy niestabilnej sieci.
- Komponent ma wysokość 40 px oraz szerokość hug 132/176/196 px. Viewport nie jest osią wariantu; wskaźnik składa się w istniejącym AdminTopbarze.
- Wskaźnik jest informacyjny i nie steruje zapisem. `DS-PWA-004` oraz runtime sieciowy blokują mutacje niezależnie od renderowanego statusu.
- Statyczny Penpot potwierdza ikony, tekst, border, tokeny i umieszczenie w viewportach 320/430/768/1024/1920 px. Zdarzenia sieciowe i AT pozostają bramkami testów implementacji.

## DS-PWA-007 — StandaloneHeader

Kontrakt: projekt i kontrakt komponentu; wykrywanie trybu standalone, rzeczywiste safe-area insety i przekazywanie stanu sieci wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d05b4a613`.
- Library component head: `9425204d-c5c4-807f-8008-b5b5005158f0`.
- Źródła dwóch wariantów: `9425204d-c5c4-807f-8008-b5b4caedeae3`, `9425204d-c5c4-807f-8008-b5b4e0ae517e`.

```ts
type StandaloneHeaderProps = {
  viewport: "mobile" | "desktop";
  connectionStatus: "online" | "offline" | "reconnecting";
};
```

- Jedyna oś wariantu to `viewport=mobile|desktop`. Stan sieci jest przekazywany do istniejącego `DS-NAV-008 AdminTopbar`, nie tworzy kolejnej osi.
- Mobile składa realne `DS-LYT-015 SafeArea(edges=top)` oraz realny `DS-NAV-008 AdminTopbar`; demonstracyjny `content-slot` SafeArea jest ukryty i jawnie zastąpiony przez topbar.
- Desktop składa realny `AdminTopbar` bez dodatkowego wrappera nawigacyjnego. Komponent nie renderuje paska adresu, przycisków przeglądarki ani imitacji systemowego chrome.
- Mobile/tablet przy 320/430/768 px ukrywa wyszukiwanie i zachowuje tytuł, status oraz awatar. Desktop przy 1024/1920 px pokazuje wyszukiwanie i pełne akcje bez clippingu.
- Warianty mają rozmiary bazowe 390×76 i 1216×72 px. Powierzchnia używa `surface.default`; wszystkie kolory mieszczą się w zatwierdzonej palecie.
- Statyczny Penpot potwierdza dokładnie 2/2 kombinacje, brak `variantError`, kontrakt `displayMode=standalone`, brak kontrolek przeglądarki oraz reflow 320/430/768/1024/1920 px.

## DS-SET-002 — CompanyDetailsForm

Kontrakt: projekt i kontrakt komponentu; zapis sieciowy, walidacja serwerowa i ostrzeżenie przed opuszczeniem strony wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ff7d9f560`.
- Library component head: `9425204d-c5c4-807f-8008-b5bb5604d1d1`.
- Źródła sześciu wariantów: `9425204d-c5c4-807f-8008-b5bb49f013a9`, `9425204d-c5c4-807f-8008-b5bb4b57d7b6`, `9425204d-c5c4-807f-8008-b5bb4d34e757`, `9425204d-c5c4-807f-8008-b5bb4f3fb788`, `9425204d-c5c4-807f-8008-b5bb51676650`, `9425204d-c5c4-807f-8008-b5bb539af501`.

```ts
type CompanyDetailsFormProps = {
  viewport: "mobile" | "desktop";
  state: "dirty" | "saving" | "error";
  values: {
    logo: UploadedImage;
    companyName: string;
    shortDescription: string;
    address: string;
    serviceArea: string;
    contactHours: string;
  };
  onSave: () => void;
};
```

- Macierz ma dokładnie sześć wariantów: mobile/desktop × dirty/saving/error. Clean i saved są stanami runtime bez osobnych wariantów katalogowych.
- Kolejność pól jest stała: logo, nazwa firmy, krótki opis, adres, obszar działania i godziny kontaktu. Adres i godziny kontaktu są jawnie oznaczone jako dane publiczne.
- Mobile składa `DS-FRM-026 FormSection` jako accordion, desktop jako section. Oba warianty używają realnych `DS-FRM-023 ImageUploader`, pięciu `DS-FRM-001 FormField`, `DS-FBK-001 Alert`, `DS-FRM-031 UnsavedIndicator` oraz jednego `DS-ACT-001 Button`.
- Formularz ma jedną akcję zapisu. Nie używa `DS-FRM-030 FormActions`, ponieważ jego trzy akcje szkic/podgląd/publikacja należą do edycji pojazdu.
- Saving ustawia `aria-busy`, loading i disabled przycisku. Error pokazuje błąd pola oraz alert zapisu, zachowuje wszystkie wartości i udostępnia „Ponów zapis”.
- `OVR-13` jest jedynym właścicielem ostrzeżenia o opuszczeniu niezapisanych zmian. Komponent nie tworzy nowej trasy, ekranu ani drugiego dialogu.
- Mobilna zawartość ma maksymalnie 288 px i pozostaje wycentrowana przy 320/390/430/768 px. Desktop ma maksymalnie 960 px przy 1024/1920 px.
- Statyczny Penpot potwierdza 6/6 kombinacji, brak `variantError`, wyłącznie dozwoloną paletę oraz zarejestrowane instancje przy 320/430/768/1024/1920 px.

## DS-SET-003 — ContactChannelEditor

Kontrakt: projekt i kontrakt komponentu; zapis, walidacja formatów, drag-and-drop i dialog potwierdzenia usunięcia wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ff7da0efc`.
- Library component head: `9425204d-c5c4-807f-8008-b5c18a3a65bd`.
- Źródła dwóch wariantów: `9425204d-c5c4-807f-8008-b5c1443498c6`, `9425204d-c5c4-807f-8008-b5c14535786c`.

```ts
type ContactChannel = {
  id: string;
  type: "phone" | "email" | "whatsapp" | "custom";
  label: string;
  value: string;
};

type ContactChannelEditorProps = {
  viewport: "mobile" | "desktop";
  channels: ContactChannel[];
  defaultChannelId: string;
  onAdd: () => void;
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onSave: () => void;
};
```

- Jedyną osią wariantu jest `viewport=mobile|desktop`. Typ kanału oraz akcje add/reorder/default/remove nie tworzą iloczynu wariantów.
- Jeden logiczny edytor obsługuje telefon, e-mail, WhatsApp i dozwolony kanał własny. Statyczny Penpot składa dwie połączone instancje `DS-FRM-032 FieldArray`, aby pokazać cztery rekordy; implementacja renderuje jedną tablicę danych.
- Mobile używa kart w kolumnie o szerokości 288 px. Desktop używa wierszy ograniczonych do 760 px. Oba układy mają widoczny uchwyt zmiany kolejności, akcję „Usuń” i jeden przycisk „Dodaj kanał”.
- Kanał domyślny ma jawny tekst „Telefon · domyślny”, więc stan nie zależy od koloru. Jego wybór jest źródłowo ustawieniem `DS-SET-004`; edytor pokazuje bieżącą wartość bez dublowania pola.
- Nie można usunąć ostatniego aktywnego kanału. Każde inne usunięcie wymaga potwierdzenia z nazwą kanału i skutkiem publicznym.
- Kolejność wpływa na publiczne CTA. Alert komunikuje ten skutek oraz minimalną liczbę jednego aktywnego kanału.
- Formularz ma jedną akcję zapisu, zachowuje niezapisane wartości, wymaga sieci, a ostrzeżenie przed wyjściem deleguje do `OVR-13`.
- Statyczny Penpot potwierdza 2/2 warianty, brak `variantError`, wyłącznie dozwoloną paletę oraz zarejestrowane instancje przy 320/430/768/1024/1920 px.

## DS-SET-004 — PresentationSettingsForm

Kontrakt: projekt i kontrakt komponentu; trwały zapis, pobranie liczby opublikowanych pojazdów i aktualizacja publicznego cache wymagają testów implementacji.

- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2ff7da0fc2`.
- Library component head: `9425204d-c5c4-807f-8008-b5c3b616f616`.
- Źródła czterech wariantów: `9425204d-c5c4-807f-8008-b5c302f404ba`, `9425204d-c5c4-807f-8008-b5c303fcd8fc`, `9425204d-c5c4-807f-8008-b5c304f69cbc`, `9425204d-c5c4-807f-8008-b5c306250526`.

```ts
type PresentationSettingsFormProps = {
  viewport: "mobile" | "desktop";
  state: "ready" | "no-featured";
  values: {
    priceVisibility: boolean;
    featuredCount: number;
    defaultContactChannelId: string;
    availabilityDisclaimer: string;
  };
  onSave: () => void;
};
```

- Macierz ma dokładnie cztery kombinacje mobile/desktop × ready/no-featured. Wartości switcha i selectów są danymi formularza, nie kolejnymi osiami wariantów.
- Formularz składa realne `DS-FRM-012 Switch`, dwa `DS-FRM-007 Select`, `DS-FRM-001 FormField`, warunkowy `DS-FBK-001 Alert`, `DS-FRM-031 UnsavedIndicator` i jeden `DS-ACT-001 Button`.
- Zakres obejmuje widoczność cen, liczbę wyróżnionych pojazdów, domyślny kanał kontaktu i disclaimer dostępności. Tytuł i opis SEO należą wyłącznie do `DS-SET-005 SEOFields`.
- W `no-featured` pole liczby wyróżnień jest disabled i wskazuje konieczność dodania oraz opublikowania pojazdu. Pozostałe ustawienia pozostają dostępne.
- Brak wyróżnionych pojazdów ukrywa publiczną sekcję zamiast renderować pusty blok. Alert wyjaśnia ten skutek tekstem, nie samym kolorem.
- Mobile zachowuje wycentrowaną kolumnę 288 px; desktop używa dwóch kolumn dla selectów i pola disclaimera do 760 px.
- Formularz ma jedną akcję zapisu, wymaga sieci i deleguje ochronę niezapisanych zmian do `OVR-13`.
- Statyczny Penpot potwierdza 4/4 kombinacje, brak `variantError`, wyłącznie dozwoloną paletę oraz zarejestrowane instancje przy 320/430/768/1024/1920 px.

## DS-SET-005 — SEOFields

Kontrakt: projekt i kontrakt komponentu; zapis ustawień, generowanie metadanych i rzeczywisty rendering preview wymagają testów implementacji.

- Źródła Penpot: mobile/default `9425204d-c5c4-807f-8008-b5c5d144f7fb`, mobile/limit `9425204d-c5c4-807f-8008-b5c5d21707c3`, desktop/default `9425204d-c5c4-807f-8008-b5c5d3343504`, desktop/limit `9425204d-c5c4-807f-8008-b5c5d45ec41b`.
- Variant Set `7cf0d39f-ce5c-80f6-8008-cf2ff7da10a1`, głowa biblioteczna `9425204d-c5c4-807f-8008-b692869fcb3f`. Minimalna macierz ma tylko osie `viewport=mobile|desktop` oraz `state=default|limit`. Długości i treści pól są danymi runtime.
- Kompozycja używa realnych `DS-FRM-026 FormSection`, dwóch `DS-FRM-001 FormField`, dwóch `DS-FRM-029 CharacterCounter`, `DS-FRM-031 UnsavedIndicator` i jednego `DS-ACT-001 Button`.
- Stan `limit` zachowuje wartości, pokazuje tekstowy warning dla tytułu oraz tekst i ikonę przekroczenia opisu. Kolor nie jest jedynym nośnikiem stanu.
- Search/social preview należy do `DS-SET-006 SEOPreview`. `SEOFields` zawiera wyłącznie jawny slot kompozycyjny, więc nie powstaje drugi podgląd.
- Statyczny Penpot potwierdza 4/4 kombinacje, brak `variantError`, dozwoloną paletę i brak przepełnień.

## DS-SET-006 — SEOPreview

Kontrakt: projekt i kontrakt komponentu; generowanie metadanych, limity platform oraz rzeczywisty rendering wymagają testów implementacji.

- Źródła Penpot: search/default `9425204d-c5c4-807f-8008-b695866abaff`, search/truncated `9425204d-c5c4-807f-8008-b6958abacf71`, social/default `9425204d-c5c4-807f-8008-b6958eb0cfb1`, social/truncated `9425204d-c5c4-807f-8008-b695950273de`.
- Variant Set `7cf0d39f-ce5c-80f6-8008-cf2ff7da1174`, głowa biblioteczna `9425204d-c5c4-807f-8008-b6968035ba83`. Minimalna macierz ma tylko osie `type=search|social` i `state=default|truncated`.
- Viewport nie jest wariantem. Karta ma 360 px w standardowej kompozycji i zwęża się do 288 px w widoku 320 px; na większych viewportach pozostaje wycentrowana zamiast rozciągać treść podglądu.
- Search zawiera typ podglądu, URL, tytuł i opis. Social zawiera typ podglądu, istniejący obraz DEMO `b564c72c-f31f-81ec-8008-afda3d695508`, domenę, tytuł i opis. Treści są danymi runtime.
- `default` komunikuje pełną treść ikoną potwierdzenia i tekstem. `truncated` zachowuje skróconą treść oraz pokazuje ikonę ostrzeżenia i tekst; kolor nie jest jedynym nośnikiem stanu.
- `DS-SET-005 SEOFields` zawiera jeden jawny slot należący do tego komponentu. Implementacja składa `SEOPreview` w tym slocie i nie kopiuje jego markupu.
- Statyczny Penpot potwierdza 4/4 kombinacje, brak `variantError`, dozwoloną paletę i brak przepełnień.

## DS-SET-007 — LegalContentEditor

Kontrakt: projekt i kontrakt komponentu; zapis/publikacja, zatwierdzenie prawne, walidacja serwerowa URL i ochrona wyjścia wymagają testów implementacji.

- Źródła Penpot: mobile/content/draft `9425204d-c5c4-807f-8008-b6990b15b531`, mobile/content/validation `9425204d-c5c4-807f-8008-b6990eaa5e43`, mobile/link/draft `9425204d-c5c4-807f-8008-b69912af6d2f`, mobile/link/validation `9425204d-c5c4-807f-8008-b699184b9020`, desktop/content/draft `9425204d-c5c4-807f-8008-b6991d92563c`, desktop/content/validation `9425204d-c5c4-807f-8008-b699225db8f1`, desktop/link/draft `9425204d-c5c4-807f-8008-b69926e9ff7b`, desktop/link/validation `9425204d-c5c4-807f-8008-b6992b46e60a`.
- Variant Set `7cf0d39f-ce5c-80f6-8008-cf2ff7da119d`, głowa biblioteczna `9425204d-c5c4-807f-8008-b69a617830a7`. Osie to wyłącznie `viewport=mobile|desktop`, `source=content|link` i `state=draft|validation`.
- Polityka prywatności i regulamin są wartościami runtime aktywnej zakładki, nie wariantami. Preview należy do złożonego `MarkdownEditor` albo bezpiecznej karty linku, dlatego nie tworzy dodatkowej osi.
- `content` składa cztery realne instancje `Tabs`, `DS-FRM-024 MarkdownEditor`, `DS-FRM-031 UnsavedIndicator` oraz dwie instancje `DS-ACT-001 Button`. Mobile pokazuje edit/preview przez zakładki edytora, desktop oba panele równolegle.
- `link` składa te same zakładki, `DS-FRM-001 FormField`, `DS-FBK-001 Alert`, bezpieczną kartę podglądu, `UnsavedIndicator` i dwa `Button`. Akceptowany jest pełny adres `https://`; implementacja ponownie waliduje go na serwerze, a otwarcie nowej karty używa `noopener,noreferrer`.
- Treść DEMO pozostaje oznaczona jako robocza i wymaga zatwierdzenia prawnego. Stan walidacji komunikuje błąd tekstem i ikoną oraz blokuje zapis i podgląd; kolor nie jest jedynym nośnikiem informacji.
- Poniżej 390 px zakładki dokumentu/źródła i akcje przechodzą w układ pionowy. Statyczny Penpot potwierdza instancję 288 px przy viewport 320 oraz rendery 430/768/1024/1920 px, brak `variantError`, obcych kolorów i overflow.
- Ochrona niezapisanych zmian należy do `OVR-13`. Sam podgląd nie zapisuje ani nie publikuje dokumentu; regulamin pozostaje opcjonalny zgodnie z PRD.

```ts
type LegalContentEditorProps = {
  viewport: "mobile" | "desktop";
  document: "privacy" | "terms";
  source: "content" | "link";
  state: "draft" | "validation";
  markdown: string;
  externalUrl: string;
  validationMessage?: string;
  onDocumentChange: (document: "privacy" | "terms") => void;
  onSourceChange: (source: "content" | "link") => void;
  onSaveDraft: () => void;
  onOpenPublicPreview: () => void;
};
```

## DS-SET-009 — AuditDetails

Kontrakt: projekt i kontrakt komponentu; pobranie wpisu, autoryzacja i polityka retencji wymagają testów implementacji.

- Źródło Penpot `dc32726c-e29a-8032-8008-b6e3e4fd8b63`, komponent biblioteczny `dc32726c-e29a-8032-8008-b6e44a552e44`, strona `01 — System projektu / sekcja Admin` (`a4abf4c9-2e1f-80fd-8008-afc9717972ba`).
- Komponent nie ma osi wariantów. Zdarzenie, administrator, akcja, encja, podsumowanie, bezpieczny diff i skrócona informacja techniczna są danymi runtime; sheet/dialog należy do kontenera `OVR-18`.
- Anatomia: kod akcji, podsumowanie, czas lokalny i administrator, encja, kopiowalny identyfikator zdarzenia, bezpieczny diff, czas UTC i skrócone IP oraz jawna informacja o redakcji.
- Hasła, tokeny i pełne sekrety nie mogą wejść do propsów ani DOM. Wartości chronione mają widoczny kontrakt `Pola chronione: [ukryto — bez wartości]`.
- Źródło ma 358×520 px. Wszystkie bezpośrednie i zagnieżdżone dzieci flex mają `horizontalSizing=fill`; instancje 358 i 752 px zachowują jedną anatomię bez overflow, więc nie powstał wariant viewportu.
- Powierzchnia, border, radius, tekst, subtelny diff i nota informacyjna są związane z semantycznymi tokenami. Audyt znalazł wyłącznie dozwolone kolory, semantyczne nazwy warstw i zero elementów poza bounds.

```ts
type AuditDetailsProps = {
  eventId: string;
  occurredAtUtc: string;
  occurredAtLocal: string;
  actorLabel: string;
  action: string;
  entityLabel: string;
  summary: string;
  safeDiff: Array<{ field: string; before?: string; after?: string }>;
  technicalSummary?: string;
  redactedFieldCount: number;
};
```

Implementacja filtruje `safeDiff` po stronie serwera i nie przyjmuje surowego obiektu encji. Identyfikator można kopiować, ale akcja musi mieć dostępną nazwę i widoczny feedback; sam statyczny komponent nie potwierdza obsługi schowka.

## DS-AVL-012 — BlockForm

Kontrakt: projekt i kontrakt komponentu; autoryzacja, transakcja zapisu, wykrywanie konfliktu współbieżnego, audyt i unieważnienie publicznego cache wymagają testów implementacji.

- Variant Set `7cf0d39f-ce5c-80f6-8008-cf2ff7da74b5`, głowa biblioteczna `9425204d-c5c4-807f-8008-b69fc772a86b`, strona `01 — System projektu / sekcja Admin`. Osie to wyłącznie `viewport=mobile|desktop` oraz `scenario=create|edit|quick|saving|conflict|delete-confirm`.
- Źródła mobile: create `9425204d-c5c4-807f-8008-b69db1a140b1`, edit `9425204d-c5c4-807f-8008-b69e92469948`, quick `9425204d-c5c4-807f-8008-b69e92501653`, saving `9425204d-c5c4-807f-8008-b69e92593c86`, conflict `9425204d-c5c4-807f-8008-b69e926251f0`, delete-confirm `9425204d-c5c4-807f-8008-b69e926b75f2`.
- Źródła desktop: create `9425204d-c5c4-807f-8008-b69e5d5ec456`, edit `9425204d-c5c4-807f-8008-b69ea195b4f0`, quick `9425204d-c5c4-807f-8008-b69ea19f42ad`, saving `9425204d-c5c4-807f-8008-b69ea1a89603`, conflict `9425204d-c5c4-807f-8008-b69ea1b22390`, delete-confirm `9425204d-c5c4-807f-8008-b69ea1bbb6d2`.
- Wspólna anatomia składa realne `DS-FRM-007 Select`, `DS-FRM-014 DateRangeField`, dwa `DS-FRM-001 FormField`, `DS-FBK-001 Alert`, `DS-FRM-031 UnsavedIndicator` oraz `DS-ACT-001 Button`. Mobile ma pełną kolumnę/sheet, desktop układ dialog/side-panel z polami w dwóch kolumnach.
- Daty są `LocalDate` w `Europe/Warsaw`, data końcowa jest wliczona, a zakres jednodniowy jest poprawny. Warstwa API zapisuje SQL `DATE` bez konwersji do północy UTC.
- Typ przyjmuje `RESERVED`, `MAINTENANCE`, `BLOCKED` lub `OTHER`. Typ, `reference` i `internalNote` są prywatne i nie mogą trafiać do publicznego API, HTML ani RSC props. Publiczny widok otrzymuje wyłącznie dostępny albo niedostępny.
- `create` zapisuje nową blokadę. `edit` pokazuje autora/źródło i czas zmiany, pozwala zapisać lub przejść do osobnego potwierdzenia usunięcia. Każda mutacja wymaga wpisu audytowego.
- `quick` ukrywa pola opcjonalne i deleguje maksymalnie czterokrokowy przepływ do `DS-AVL-013 QuickBlockFlow`; nie jest jego duplikatem. `conflict` zatrzymuje zapis i posiada slot dla `DS-FBK-019 ConflictPanel`. Oba zależne komponenty pozostają osobnymi pozycjami katalogu.
- `saving` wyłącza pola i akcje ponownego zapisu oraz ustawia `aria-busy`; sukces pojawia się dopiero po potwierdzeniu serwera i odświeżeniu danych. `delete-confirm` nie jest domyślnym stanem edycji i wymaga jawnej decyzji.
- Opcjonalne scalenie konfliktujących zakresów jest future-only i nie jest aktywną akcją MVP. Opuszczenie dirty form deleguje ochronę do `OVR-13`.
- Poniżej 390 px formularz używa kolumny 288 px, kontrolek 256 px i pionowych akcji. Statycznie sprawdzono 320/430/768/1024/1920 px, 12/12 kombinacji, brak `variantError`, obcych kolorów, automatycznych nazw i overflow.

```ts
type BlockType = "RESERVED" | "MAINTENANCE" | "BLOCKED" | "OTHER";

type BlockFormProps = {
  viewport: "mobile" | "desktop";
  scenario:
    | "create"
    | "edit"
    | "quick"
    | "saving"
    | "conflict"
    | "delete-confirm";
  vehicleId: string;
  startDate: string; // YYYY-MM-DD, LocalDate
  endDate: string; // inclusive YYYY-MM-DD, LocalDate
  type: BlockType;
  reference?: string;
  internalNote?: string;
  existingConflictId?: string;
  onSave: () => void;
  onOpenExistingConflict: (id: string) => void;
  onRequestDelete: () => void;
  onCancel: () => void;
};
```

## DS-AVL-013 — QuickBlockFlow

Kontrakt: projekt i kontrakt komponentu. Rzeczywisty zapis, autoryzacja, obsługa konfliktu i odświeżenie publicznej dostępności wymagają testów implementacji oraz prototypu `A-02`.

- Variant Set `7cf0d39f-ce5c-80f6-8008-cf308979d98d`, głowa biblioteczna `9425204d-c5c4-807f-8008-b6aa574115b9`, strona `01 — System projektu / sekcja Admin`.
- Pięć źródeł pokrywa tylko sensowne kombinacje: mobile vehicle `9425204d-c5c4-807f-8008-b6a9b4bacc4c`, dates `9425204d-c5c4-807f-8008-b6a9d909fa8a`, type `9425204d-c5c4-807f-8008-b6a9ec6e3686`, review `9425204d-c5c4-807f-8008-b6a9fea1f736` oraz desktop single-screen `9425204d-c5c4-807f-8008-b6aa139e6540`.
- Nie powstał pełny iloczyn `viewport × step`. Mobile realizuje dokładnie cztery kroki wymagane przez `FR-ADM-056`; desktop pokazuje pojazd, zakres, typ i zapis w jednym kompaktowym dialogu.
- Komponent składa rzeczywiste instancje `DS-FRM-007 Select`, `DS-FRM-014 DateRangeField`, `DS-FBK-001 Alert` i `DS-ACT-001 Button`. Nie kopiuje pól opcjonalnych `reference` ani `internalNote` z pełnego `BlockForm`.
- Daty są całodniowymi `LocalDate` w `Europe/Warsaw`, koniec jest wliczony, a krok review pokazuje pojazd, zakres, typ i liczbę dni. Typ pozostaje prywatny; publicznie wszystkie cztery typy oznaczają wyłącznie „niedostępny”.
- Mobile używa jednej kolumny akcji na każdej szerokości. Pozwala to zachować cele 48 px bez osobnego wariantu narrow. Przy 320 px pole zakresu ma 274 px, oba pola dat po 250 px, a dłuższy krok przewija się wyłącznie pionowo.
- Zapis przechodzi do `saving` w `BlockForm` i może zakończyć się dopiero po potwierdzeniu serwera. Konflikt deleguje do `OVR-08`/`ConflictPanel`; sukces, toast i odświeżony `ADM-09` należą do prototypu `A-02`.
- Klawiatura: Tab podąża za kolejnością treści, Shift+Tab wraca, Enter aktywuje główną akcję dopiero przy poprawnym kroku, Escape anuluje dialog po ochronie dirty form. Po zmianie kroku fokus przechodzi na jego tytuł; błędy trafiają do widocznego komunikatu i `aria-live` formularza. Zachowanie wymaga testu DOM/runtime.

```ts
type QuickBlockStep = "vehicle" | "dates" | "type" | "review";

type QuickBlockFlowProps = {
  viewport: "mobile" | "desktop";
  step: QuickBlockStep | "single-screen";
  vehicleId?: string;
  startDate?: string; // YYYY-MM-DD, LocalDate
  endDate?: string; // inclusive YYYY-MM-DD, LocalDate
  type?: BlockType;
  saving: boolean;
  error?: string;
  onBack: () => void;
  onNext: () => void;
  onSave: () => void;
  onCancel: () => void;
};
```

## DS-FBK-019 — ConflictPanel

Kontrakt: projekt i kontrakt komponentu. Wykrywanie konfliktu, blokada współbieżnych zapisów oraz autoryzacja pozostają odpowiedzialnością serwera i wymagają testów implementacji.

- Variant Set `7cf0d39f-ce5c-80f6-8008-cf2ff7da95c1`, głowa biblioteczna `9425204d-c5c4-807f-8008-b6a20bbe51a9`, strona `01 — System projektu / sekcja Admin`. Minimalne osie to wyłącznie `viewport=mobile|desktop` i `conflicts=single|multiple`.
- Źródła: mobile/single `9425204d-c5c4-807f-8008-b6a20af0e8ce`, mobile/multiple `9425204d-c5c4-807f-8008-b6a24160bdb2`, desktop/single `9425204d-c5c4-807f-8008-b6a26e6f31fb` oraz desktop/multiple `9425204d-c5c4-807f-8008-b6a299c34100`.
- Panel składa realne warianty `DS-ACT-001 Button` oraz realne instancje `DS-AVL-014 BlockConflictCard`. Każdy konflikt ma zakres, prywatny typ i akcję „Otwórz istniejącą”; „Wróć do edycji” anuluje panel bez zapisu.
- Wariant `single` zawiera jedną kartę, a `multiple` dwie karty. Liczba konfliktów pozostaje odpowiedzialnością panelu, więc `BlockConflictCard` nie powiela osi `single|multiple`.
- Mobile ma postać sheetu 390 px z uchwytem i pełnoszeroką akcją. Desktop jest dialogiem/inline panelem 680 px z akcją po prawej. Przy 320 px panel zwęża się do 288 px, treść do 240 px, a cel dotykowy zachowuje 48 px.
- Panel jest wyłącznie administracyjny. Dane zakresu, typu i identyfikatora konfliktu nie mogą trafić do publicznego API, HTML ani RSC props.
- Opcjonalne scalenie pozostaje `future-not-active`; w MVP nie ma przycisku merge. Próba zapisu nadal jest zatrzymana, dopóki administrator nie wróci do edycji albo nie otworzy istniejącej blokady.
- Kontrakt dostępności zapisuje `role=alertdialog`, `aria-live=assertive`, fokus początkowy na tytule, Escape jako powrót do edycji i zwrot fokusu do triggera. Statyczna makieta nie dowodzi działania focus trap ani czytnika ekranu.
- Sloty konfliktowe `DS-AVL-012 BlockForm` wskazują głowę komponentu i kontrakt `opens-OVR-08`, zamiast osadzać drugi zestaw tych samych akcji w formularzu.

```ts
type ConflictItem = {
  id: string;
  vehicleId: string;
  startDate: string; // YYYY-MM-DD, LocalDate
  endDate: string; // inclusive YYYY-MM-DD, LocalDate
  type: "RESERVED" | "MAINTENANCE" | "BLOCKED" | "OTHER";
};

type ConflictPanelProps = {
  viewport: "mobile" | "desktop";
  conflicts: "single" | "multiple";
  items: readonly [ConflictItem, ...ConflictItem[]];
  onOpenExisting: (id: string) => void;
  onCancel: () => void;
};
```

## DS-AVL-014 — BlockConflictCard

Kontrakt: projekt i kontrakt komponentu. Pobranie konfliktu, autoryzacja edycji i ochrona przed zapisem współbieżnym pozostają odpowiedzialnością serwera.

- Variant Set `7cf0d39f-ce5c-80f6-8008-cf308979da0c` na stronie `01 — System projektu / sekcja Admin` ma tylko jedną oś: `viewport=mobile|desktop`. Głowa mobile ma ID `9425204d-c5c4-807f-8008-b6b26ff583b2`, a wariant desktop `9425204d-c5c4-807f-8008-b6b26ff7b55b`.
- Źródła mają ID `9425204d-c5c4-807f-8008-b6b26ff53ec8` (342×156 px) i `9425204d-c5c4-807f-8008-b6b26ff76d89` (616×156 px). Jedna instancja zawsze oznacza jeden konflikt; wariant wielokrotny powstaje przez ułożenie kart w `ConflictPanel`, a nie przez kolejną oś komponentu.
- Cała karta jest celem akcji `open-existing-block`. Pokazuje nazwę wpisu, całodniowy zakres z wliczonym końcem, prywatny typ blokady, pojazd i tekst „Otwórz istniejącą”. Cel ma 156 px wysokości i jawny label dostępności.
- Komponent jest wyłącznie administracyjny (`public=false`). Typ i szczegóły konfliktu nie mogą trafić do publicznego API, HTML ani RSC props.
- Anulowanie lub powrót do edycji pozostaje akcją `ConflictPanel`. Opcjonalne scalanie ma metadane `future-not-active`, ale nie jest renderowane ani wystawione jako callback MVP.
- W czterech wariantach `ConflictPanel` działa łącznie sześć realnych instancji karty. Po podmianie placeholderów odtworzono lokalne interakcje `A-03`: pełna karta otwiera `OVR-07`, a panel wraca do edycji bez zapisu.

```ts
type BlockConflictCardProps = {
  viewport: "mobile" | "desktop";
  item: ConflictItem;
  onOpenExisting: (id: string) => void;
};
```

## DS-AVL-015 — UpcomingBlocksList

Kontrakt: lekka kompozycja istniejących elementów. Pobranie, sortowanie i odświeżenie blokad pozostają odpowiedzialnością runtime.

- Catalog board: `7cf0d39f-ce5c-80f6-8008-cf31083c4c81`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf31083c4c84`.
- Library component head: `92bfc32e-2dd6-801a-8008-be56a08ef429`.

| Oś | Wartości |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `context` | `dashboard`, `vehicle` |
| `state` | `default`, `empty`, `loading` |

Zestaw zawiera sześć celowych kombinacji zamiast pełnego iloczynu 12: dashboard i pojazd w stanie domyślnym na mobile i desktopie, pusty dashboard mobile oraz loading dashboardu desktop. Mobile używa kart 320 px, a desktop listy 720 px. Default składa trzy rzeczywiste `DS-AVL-010 BlockEvent` i istniejący `Button`; stany specjalne reużywają `DS-FBK-009 EmptyState` i `DS-FBK-008 Skeleton`.

Preview ma sześć rzeczywistych instancji w planszach 320, 390, 768, 1024, 1440 i 1920 px. Po uprzątnięciu roboczych kontenerów biblioteka ma dokładnie jeden head `DS-AVL-015` i jeden katalog.

```ts
type UpcomingBlocksListProps = {
  viewport: "mobile" | "desktop";
  context: "dashboard" | "vehicle";
  state?: "default" | "empty" | "loading";
  items: AvailabilityBlockSummary[];
  vehicleName?: string;
  onOpenCalendar?: () => void;
  onAddBlock?: () => void;
  onOpenBlock?: (blockId: string) => void;
};
```

## DS-AVL-016 — FleetCalendarGrid

Kontrakt: macierz floty dla tabletu i desktopu. Pobranie danych, wirtualizacja, rzeczywisty scroll, klawiaturowa nawigacja grid oraz unieważnienie cache pozostają odpowiedzialnością runtime.

- Catalog board: `7cf0d39f-ce5c-80f6-8008-cf31083cbd32`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf31083cbd35`.
- Library component head: `92bfc32e-2dd6-801a-8008-be64e9debf8b`.

| Oś | Wartości |
|---|---|
| `horizon` | `day`, `week`, `month` |
| `scroll` | `origin`, `middle` |

Zestaw zawiera cztery celowe kombinacje: `day/origin`, `week/origin`, `month/origin` i `month/middle`. Nie tworzy pełnego iloczynu sześciu stanów, ponieważ pośrednie pozycje scrolla nie zmieniają anatomii komponentu. Każdy wariant ma 1120×616 px, pięć wierszy pojazdów, sticky nagłówek dat, sticky pierwszą kolumnę, widoczny pasek poziomego przewijania i domknięty zakres dat.

Każdy wariant składa jedną rzeczywistą instancję `DS-AVL-018 CalendarToolbar` i pięć rzeczywistych instancji `DS-AVL-010 BlockEvent`. Nie powstał osobny komponent wiersza, komórki ani wydarzenia. Typy blokad są prywatne i występują wyłącznie w adminie. Kliknięcie nazwy pojazdu jest kontraktem przejścia do `ADM-09`; komórka lub zakres uruchamia quick block.

Końcowy render `ADM-10 desktop` używa jednej instancji 1120×616 px. Linie kolumn i wierszy są widoczną częścią macierzy, a nie warstwą zasłoniętą przez nieprzezroczyste wiersze.

Na 320 i 390 px macierz jest jawnie N/A i musi zostać zastąpiona przez `DS-AVL-017 FleetCalendarMobileList`.

```ts
type FleetCalendarGridProps = {
  horizon: "day" | "week" | "month";
  scroll?: "origin" | "middle";
  vehicles: FleetCalendarVehicle[];
  visibleRange: { from: LocalDate; to: LocalDate };
  onRangeChange: (range: { from: LocalDate; to: LocalDate }) => void;
  onOpenVehicle: (vehicleId: string) => void;
  onQuickBlock: (vehicleId: string, range: DateRange) => void;
  onOpenBlock: (blockId: string) => void;
};
```

## DS-AVL-017 — FleetCalendarMobileList

Kontrakt: mobilny odpowiednik macierzy floty. Rozwijanie, sterowanie fokusem, filtrowanie i pobieranie danych pozostają odpowiedzialnością runtime.

- Catalog board: `1e066793-8858-8051-8008-cf320ddcae79`.
- Penpot Variant Set: `1e066793-8858-8051-8008-cf320ddcae7c`.
- Library component head: `92bfc32e-2dd6-801a-8008-be6af7e658fc`.

| Oś | Wartości |
|---|---|
| `grouping` | `vehicle`, `date` |
| `state` | `default`, `expanded`, `loading`, `empty`, `filtered-empty` |

Zestaw zawiera sześć celowych kombinacji zamiast pełnego iloczynu dziesięciu: `vehicle/default`, `vehicle/expanded`, `date/default`, `vehicle/loading`, `vehicle/empty` oraz `date/filtered-empty`. Pojazd bez blokad jest rzeczywistym przypadkiem na liście `vehicle/default`, nie osobnym wariantem. Quick block jest akcją dostępną w odpowiednich stanach, a nie kolejną osią komponentu.

Źródło `vehicle/default` zawiera sześć demonstracyjnych pojazdów i szybką blokadę w jednym edytowalnym komponencie. `ADM-10 mobile` osadza jedną instancję źródła; nie utrzymuje równoległej ręcznej kopii listy.

Każdy wariant składa istniejący `CalendarToolbar` i `SegmentedControl`. Defaulty i rozwinięcie reużywają prawdziwe `BlockEvent` oraz `Button`; loading korzysta z `Skeleton`, a oba puste wyniki z `EmptyState`. Nie powstał osobny komponent karty pojazdu, grupy daty ani wiersza. Rozwinięcie zawiera link „Otwórz kalendarz pojazdu” do `ADM-09`, a zakres utrzymuje regułę końca wliczonego w strefie Europe/Warsaw.

Dla 768, 1024, 1440 i 1920 px jawnie wskazuje `DS-AVL-016 FleetCalendarGrid`, ponieważ pełna macierz jest podstawowym układem tabletu i desktopu.

```ts
type FleetCalendarMobileListProps = {
  grouping: "vehicle" | "date";
  state?: "default" | "loading" | "empty" | "filtered-empty";
  expandedVehicleId?: string;
  vehicles: FleetCalendarVehicle[];
  blocks: AvailabilityBlockSummary[];
  visibleRange: { from: LocalDate; to: LocalDate };
  onGroupingChange: (grouping: "vehicle" | "date") => void;
  onToggleVehicle: (vehicleId: string) => void;
  onOpenVehicleCalendar: (vehicleId: string) => void;
  onQuickBlock: () => void;
  onClearFilters: () => void;
};
```

## DS-AVL-018 — CalendarToolbar

Kontrakt: współdzielone sterowanie horyzontem floty. Zmiana zakresu, pobranie danych i zachowanie fokusu pozostają odpowiedzialnością runtime.

- Catalog board: `7cf0d39f-ce5c-80f6-8008-cf31083c4d6c`.
- Penpot Variant Set: `7cf0d39f-ce5c-80f6-8008-cf31083c4d6f`.
- Library component head: `92bfc32e-2dd6-801a-8008-be5d06fdd34b`.

| Oś | Wartości |
|---|---|
| `viewport` | `compact`, `full` |
| `state` | `default`, `horizon-start`, `horizon-end` |

Zestaw zawiera cztery celowe kombinacje zamiast pełnego iloczynu sześciu: `compact/default`, `compact/horizon-start`, `full/default` i `full/horizon-end`. W compact sterowanie mieści się w 320×164 px i rozdziela nawigację, zakres oraz presety na dwa wiersze. Full ma 720×112 px i układa te same akcje w jednym wierszu. Nie utworzono osobnego wariantu dla każdego breakpointu.

Wszystkie akcje są rzeczywistymi instancjami istniejących `IconButton` i `Button`. Na początku horyzontu wyłączone jest wyłącznie „wstecz”, a na końcu wyłącznie „dalej”; kierunek ikony po podmianie wariantu disabled został sprawdzony na świeżym eksporcie. Widoczny opis `Europe/Warsaw · koniec zakresu wliczony` utrwala reguły LocalDate i domkniętego końca bez dodawania nowego komponentu daty.

```ts
type CalendarToolbarProps = {
  viewport: "compact" | "full";
  state?: "default" | "horizon-start" | "horizon-end";
  rangeLabel: string;
  preset: "today" | "fortnight" | "month";
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onPresetChange: (preset: "fortnight" | "month") => void;
};
```

## DS-AVL-019 — DateRangePreset

Kontrakt: pojedynczy wybór szybkiego zakresu. Wyliczanie dat, locale, focus i otwarcie kalendarza custom pozostają odpowiedzialnością runtime.

- Catalog board: `1e066793-8858-8051-8008-cf320ddcb01e`.
- Penpot Variant Set: `1e066793-8858-8051-8008-cf320ddcb021`.
- Library component head: `92bfc32e-2dd6-801a-8008-be6f4ec51ee5`.

| Oś | Wartości |
|---|---|
| `presentation` | `chip`, `button`, `menu-item` |
| `preset` | `today`, `weekend`, `next-week`, `custom` |
| `state` | `default`, `selected` |

Zestaw zawiera siedem celowych kombinacji zamiast pełnego iloczynu 24. Wszystkie cztery presety są reprezentowane, natomiast selected pokazano dla chip i button. Mobilny chip ma 44 px wysokości; selected dodaje widoczny znak „✓” oraz zmianę kontrastu, więc stan nie zależy wyłącznie od koloru. Desktopowe buttony są prawdziwymi instancjami współdzielonego `Button`. `custom` ma także wariant `menu-item`, bez tworzenia osobnego komponentu menu.

Na 320 px chips kontrolowanie przechodzą do trzech wierszy; od 390 px mieszczą się w dwóch.

```ts
type DateRangePresetProps = {
  presentation: "chip" | "button" | "menu-item";
  preset: "today" | "weekend" | "next-week" | "custom";
  selected?: boolean;
  onSelect: (preset: DateRangePresetProps["preset"]) => void;
};
```

## DS-AVL-020 — BlockDetailsPanel

Kontrakt: prywatny panel szczegółów i wejście do edycji blokady. Autoryzacja, focus trap, zapis audytu, konflikt współbieżny i odświeżenie cache pozostają odpowiedzialnością runtime.

- Catalog board: `1e066793-8858-8051-8008-cf320ddcb084`.
- Penpot Variant Set: `1e066793-8858-8051-8008-cf320ddcb087`.
- Library component head: `92bfc32e-2dd6-801a-8008-be74c9834673`.

| Oś | Wartości |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `mode` | `view`, `edit` |
| `state` | `default`, `delete-confirm` |

Zestaw ma sześć celowych kombinacji: mobile i desktop dla view/default, edit/default oraz edit/delete-confirm. View nie otrzymuje redundantnego delete-confirm, ponieważ usunięcie jest mutacją w ścieżce edycji. Widoki szczegółów reużywają realny `BottomSheet` lub `SideDrawer`, domenowy `BlockTypeBadge` i wspólne `Button`. Edit i delete-confirm delegują bezpośrednio do istniejącego `DS-AVL-012 BlockForm`; pola ani potwierdzenie nie są duplikowane.

View pokazuje pojazd, domknięty zakres LocalDate, prywatny numer referencyjny, prywatną notatkę, źródło oraz metadane audytowe. Wszystkie te dane są wyłącznie adminowe. Publiczne API, HTML i RSC props nadal mogą otrzymać tylko status dostępny/niedostępny. Usunięcie zawsze wymaga jawnego potwierdzenia, a każda edycja i usunięcie tworzą wpis audytowy po stronie serwera.

Mobilny edit mieści rzeczywisty formularz 1350 px w kontrolowanym 760 px viewportcie `y-scroll`; ma widoczny komunikat przewijania. To jedyny zamierzony overflow.

```ts
type BlockDetailsPanelProps = {
  viewport: "mobile" | "desktop";
  mode: "view" | "edit";
  state?: "default" | "delete-confirm";
  block: {
    id: string;
    vehicleId: string;
    type: BlockType;
    startDate: string;
    endDate: string;
    reference?: string;
    internalNote?: string;
    source: "manual" | "external";
    audit: AuditMetadata;
  };
  onEdit: () => void;
  onRequestDelete: () => void;
  onClose: () => void;
};
```

## DS-MED-001 — ResponsiveImage

Kontrakt: projekt stanów obrazu. Dobór `srcset`, `sizes`, priorytetu ładowania i emisja tekstu alternatywnego wymagają testów runtime.

- Variant Set `efe3ac9b-6991-807f-8008-cf25429e27e5` na stronie `01 — System projektu / sekcja Public`; głowa biblioteczna: `dc32726c-e29a-8032-8008-b6eb1a9a822a`.
- Osie to `content=vehicle|logo|decorative` i `state=loaded|loading|error|fallback`, ale katalog zawiera tylko siedem sensownych kombinacji. Nie powstały sztuczne warianty `decorative/error` ani `decorative/fallback`.
- Kontrolna geometria każdego źródła to 320×200 px. Loaded vehicle i decorative korzystają z istniejącego assetu V02; decorative ma kontrakt `alt=""`. Logo używa `contain`, a zdjęcie pojazdu `cover`.
- Loading zachowuje tę samą geometrię, żeby nie powodować CLS. Error i fallback łączą ikonę z tekstem, więc status nie zależy od koloru.
- Eksport pełnego Variant Setu oraz audyt struktury potwierdziły 7/7 kombinacji bez `variantError` i zachowane wiązania tokenów semantycznych.

```ts
type ResponsiveImageProps = {
  src: string;
  alt: string;
  content: "vehicle" | "logo" | "decorative";
  sizes: string;
  loading?: "eager" | "lazy";
  fallbackLabel?: string;
};
```

## DS-MED-002 — VehicleGallery

Kontrakt: projekt galerii M/D. Swipe, klawiatura, lazy loading i otwarcie `OVR-05` pozostają zachowaniem runtime.

- Variant Set `efe3ac9b-6991-807f-8008-cf25429e27fc`; głowa biblioteczna: `dc32726c-e29a-8032-8008-b6eb96d42090`.
- Dokładna macierz to `viewport=mobile|desktop × state=many|one|loading`. Układ wynika z viewportu: mobile jest karuzelą, desktop mozaiką. Nie ma redundantnej osi `layout=carousel|mosaic`.
- Mobile/many składa rzeczywiste `ResponsiveImage`, trzy `GalleryThumbnail`, licznik `2 / 4` i trzy cele 44 px: poprzednie, pełny ekran, następne. Swipe ma te przyciski jako równoważny fallback.
- Desktop/many składa `ResponsiveImage`, cztery `GalleryThumbnail` oraz istniejący wspólny `Button` „Zobacz wszystkie zdjęcia”.
- One-image nie renderuje nieaktywnych strzałek. Loading zachowuje geometrię galerii i ma jawny status tekstowy.
- Eksport sześciu wariantów i audyt zagnieżdżonych komponentów potwierdziły 6/6 kombinacji bez `variantError`.

```ts
type VehicleGalleryProps = {
  images: readonly { src: string; alt: string }[];
  activeIndex: number;
  loading?: boolean;
  onActiveIndexChange: (index: number) => void;
  onOpenLightbox: (index: number) => void;
};
```

## DS-MED-003 — GalleryThumbnail

Kontrakt: mały komponent wyboru zdjęcia.

- Variant Set: `efe3ac9b-6991-807f-8008-cf25429dca7c` na stronie `01 — System projektu / sekcja Public`; głowa biblioteczna: `dc32726c-e29a-8032-8008-b6e61ac0d43b`.
- Źródła: default `dc32726c-e29a-8032-8008-b6e5e8472e7c` i selected `dc32726c-e29a-8032-8008-b6e60c29e641`.
- Jedyna oś to `state=default|selected`. Mobile i desktop używają tej samej anatomii 104×72 px; kierunek i przewijanie listy należą do galerii.
- Selected łączy obramowanie 2 px z widocznym tekstem „Wybrane”, więc stan nie zależy wyłącznie od koloru. Fokus runtime używa wspólnego `focus.ring`.
- Element implementacyjny jest przyciskiem z nazwą ujęcia i `aria-current=true` albo `aria-pressed=true` dla aktywnego zdjęcia.

```ts
type GalleryThumbnailProps = {
  src: string;
  alt: string;
  selected: boolean;
  onSelect: () => void;
};
```

## DS-MED-004 — Lightbox

Kontrakt: projekt komponentu. Klawiatura, swipe, focus trap i powrót fokusu wymagają testów implementacji w przeglądarce.

- Variant Set: `efe3ac9b-6991-807f-8008-cf25429dca86`; głowa biblioteczna: `dc32726c-e29a-8032-8008-b6e6f3721f80`.
- Cztery źródła pokrywają wyłącznie potrzebne kombinacje: mobile/gallery `dc32726c-e29a-8032-8008-b6e68506d08a`, mobile/single `dc32726c-e29a-8032-8008-b6e6bbb8b6c8`, desktop/gallery `dc32726c-e29a-8032-8008-b6e6d0bc57d8` i desktop/single `dc32726c-e29a-8032-8008-b6e6e522e268`.
- Osie to `viewport=mobile|desktop` i `mode=gallery|single`. Nie powstały warianty per zdjęcie ani oś zoom; zoom jest opcjonalny w SPEC i pozostaje poza MVP.
- Gallery desktop składa cztery rzeczywiste instancje `DS-MED-003`; single ukrywa miniatury oraz akcje poprzednie/następne. Wszystkie widoczne przyciski mają 48 px wysokości.
- Penpot używa istniejących osadzonych mediów V02 480w. Implementacja korzysta z manifestu assetów i wariantów AVIF/WebP 480w/960w, poprawnego `sizes` oraz opisów alternatywnych; aktywne zdjęcie nie powinno być ładowane leniwie po otwarciu, pozostałe mogą.
- Kontrakt klawiatury: `ArrowLeft` poprzednie, `ArrowRight` następne, `Escape` zamknięcie. Swipe ma przyciski jako równoważny fallback. Po zamknięciu fokus wraca do zdjęcia, które otworzyło warstwę.
- Audyt czterech źródeł wykazał 4/4 poprawne kombinacje, zero `variantError`, obcych kolorów, nazw automatycznych i widocznego overflow.

```ts
type LightboxProps = {
  images: readonly { src: string; alt: string }[];
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
};
```

## DS-CNT-001 — ContactCTA

Kontrakt: prosta, kontekstowa akcja kontaktu. Komponent nie jest rezerwacją, nie blokuje dat i nie zapisuje klienta.

- Katalog: `efe3ac9b-6991-807f-8008-cf25561d6e27`.
- Variant Set: `efe3ac9b-6991-807f-8008-cf25561d6e2a`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be7c1a59c523`.
- Osie: `context=generic|vehicle|vehicle-dates`, `placement=full|inline|sticky`, `state=enabled|disabled`. Zestaw zawiera sześć celowych kombinacji zamiast pełnego iloczynu 18.
- `disabled` wolno zastosować wyłącznie, gdy administrator nie skonfigurował żadnego kanału kontaktu. Brak pojazdu lub dat wybiera prostszy kontekst, ale sam w sobie nie blokuje akcji.
- Każdy wariant składa rzeczywistą instancję wspólnego `Button`. Akcja otwiera `OVR-04` albo prowadzi do `PUB-04`; listę kanałów, podgląd wiadomości i jej edycję realizują `DS-CNT-002`–`DS-CNT-005`.
- Dla `vehicle-dates` zakres jest parą `LocalDate`, koniec jest wliczony, a prezentacja używa `dd.MM.yyyy` i `Europe/Warsaw`. Sam komponent nie sprawdza dostępności i nie utrwala danych.
- `sticky` wymaga dolnego `scroll-padding` równego wysokości CTA i safe area. Przy klawiaturze ekranowej wrapper może wrócić inline; nie może zasłaniać pola, błędu ani fokusu.
- Nazwa dostępna przycisku obejmuje widoczny kontekst. Po otwarciu panelu fokus przechodzi zgodnie z kontraktem overlayu, a po zamknięciu wraca do CTA.

```ts
type LocalDate = `${number}-${number}-${number}`;

type ContactCTAProps = {
  context?: {
    vehicleName?: string;
    dateFrom?: LocalDate;
    dateTo?: LocalDate;
  };
  placement: "full" | "inline" | "sticky";
  hasConfiguredChannel: boolean;
  onOpenContact: () => void;
};
```

## DS-CNT-003 — ContactChannelButton

Kontrakt: pojedyncza akcja skonfigurowanego kanału kontaktu. Komponent nie przechowuje wiadomości i nie tworzy rezerwacji ani klienta.

- Katalog: `efe3ac9b-6991-807f-8008-cf258f4cea20`.
- Variant Set: `efe3ac9b-6991-807f-8008-cf258f4cea23`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be8324ccd584`.
- Osie: `channel=phone|whatsapp|email|messenger|copy` oraz `state=default|available|external`. Zestaw ma siedem potrzebnych kombinacji, a nie pełny iloczyn 15 wariantów.
- `default` jawnie pokazuje napis „Domyślny”; `external` ma opis otwarcia zewnętrznej aplikacji i znak `↗`; kopiowanie ma osobną ikonę. Znaczenie nie zależy wyłącznie od koloru.
- Ikony są edytowalnymi grupami wektorowymi zgodnymi z Lucide. Nie użyto rastrów ani wariantów per viewport.
- Mobile używa pełnej szerokości i wysokości 72 px. Desktop składa te same instancje w liście lub siatce; szerokość wynika z kontenera.
- Kolejność kanałów oraz kanał domyślny pochodzą z konfiguracji administratora. Jeśli nie ma kanału, nie renderujemy pustej listy: `ContactSheet` pokazuje jawny błąd konfiguracji.
- Implementacja używa semantycznego `button` dla kopiowania i lokalnych akcji oraz `a` albo przycisku uruchamiającego schemat dla kanałów zewnętrznych. Musi zapewnić fokus, aktywację klawiaturą, fallback błędu otwarcia oraz komunikat `aria-live` po skopiowaniu.

```ts
type ContactChannel = "phone" | "whatsapp" | "email" | "messenger" | "copy";

type ContactChannelButtonProps = {
  channel: ContactChannel;
  label: string;
  detail: string;
  isDefault?: boolean;
  external?: boolean;
  onActivate: () => void;
};
```

## DS-CNT-004 — PrefilledMessage

Kontrakt: lokalny podgląd lub pole edycji przygotowanej wiadomości. Komponent nie zapisuje treści i nie zawiera osobnej akcji kanału.

- Katalog: `efe3ac9b-6991-807f-8008-cf258f4ceae0`.
- Variant Set: `efe3ac9b-6991-807f-8008-cf258f4ceae3`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be8ace0b8a24`.
- Osie: `mode=preview|editable` i `context=vehicle|vehicle-dates`; istnieją dokładnie cztery wymagane kombinacje, bez wariantów per viewport.
- `vehicle` przygotowuje wiadomość bez dat. `vehicle-dates` używa domkniętego zakresu `LocalDate` i polskiego formatu prezentacji.
- `preview` jest tylko do odczytu. `editable` reprezentuje lokalne pole przed skopiowaniem lub uruchomieniem kanału; widoczna informacja mówi, że treść nie jest zapisywana ani wysyłana do analityki.
- Karta ma bazową szerokość 288 px dla viewportu 320 px i rozszerza się do kontenera na większych ekranach. Nie zmienia anatomii między mobile i desktop.
- Runtime nie może utrwalać draftu, tworzyć rekordu klienta ani emitować jego treści w zdarzeniach analitycznych. Pole edycji wymaga dostępnej etykiety, widocznego fokusu i zachowania tekstu podczas zmiany kanału w obrębie otwartego panelu.

```ts
type LocalDate = `${number}-${number}-${number}`;

type PrefilledMessageProps = {
  mode: "preview" | "editable";
  vehicleName: string;
  dateFrom?: LocalDate;
  dateTo?: LocalDate;
  value: string;
  onChange?: (value: string) => void;
};
```

## DS-CNT-005 — ContactContextSummary

Kontrakt: zwarty opis kontekstu przekazywanego do kontaktu.

- Katalog: `efe3ac9b-6991-807f-8008-cf258f4ceb57`.
- Variant Set: `efe3ac9b-6991-807f-8008-cf258f4ceb5a`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be8edf4d7426`.
- Jedyna oś to `context=vehicle|vehicle-dates`. Brak dat nie jest osobnym iloczynem stanu: wariant `vehicle` jawnie pokazuje „Nie wybrano terminu”.
- `vehicle-dates` pokazuje polski zakres `dd.MM.yyyy–dd.MM.yyyy` i słowo „włącznie”, zgodnie z regułą domkniętego końca.
- Mobile i desktop używają tej samej zwartej anatomii; komponent rozszerza się do kontenera bez wariantów viewportu.
- To prezentacja kontekstu, nie wynik dostępności. Nie rezerwuje terminu, nie tworzy blokady, klienta ani danych formularza.

```ts
type ContactContextSummaryProps = {
  vehicleName: string;
  dateFrom?: LocalDate;
  dateTo?: LocalDate;
};
```

## DS-CNT-002 — ContactSheet

Kontrakt: jeden wspólny panel kontaktu. Komponent składa istniejące elementy i nie tworzy rezerwacji, blokady dat ani klienta.

- Katalog: `efe3ac9b-6991-807f-8008-cf258f4cebaa`.
- Variant Set: `efe3ac9b-6991-807f-8008-cf258f4cebad`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be91c1d0b33b`.
- Osie: `viewport=mobile|desktop`, `view=channels|message` i `state=open|no-channel|copy-success`. Istnieje osiem celowych kombinacji; nie utworzono niepoprawnych message/no-channel ani message/copy-success.
- Mobile składa rzeczywisty `BottomSheet` i priorytetowe kanały telefon oraz WhatsApp. Desktop składa rzeczywisty `Dialog` oraz telefon, WhatsApp, e-mail i kopiowanie w siatce 2×2.
- Każdy wariant zawiera realny `ContactContextSummary`. Widok kanałów reużywa `ContactChannelButton`; widok wiadomości reużywa `PrefilledMessage`. No-channel i copy-success reużywają `InlineMessage`, a jawne zamknięcie współdzielony `Button`.
- Brak kanału jest opisany jako błąd konfiguracji, nigdy jako pusta lista. Copy-success ma tekst „Numer został skopiowany.” i nie zależy od koloru.
- Mobile przy 320 px zachowuje cały panel 320×520, dwie priorytetowe akcje i widoczne zamknięcie. Większe viewporty nie tworzą nowych wariantów źródła.
- Runtime zapewnia focus trap, `Escape`, zwrot fokusu do CTA, blokadę scrolla tła, bezpieczny fallback aplikacji zewnętrznych, `aria-live` po kopiowaniu i zachowanie lokalnego draftu podczas przełączania kanału.

```ts
type ContactSheetProps = {
  open: boolean;
  view: "channels" | "message";
  channels: readonly ContactChannel[];
  context: ContactContextSummaryProps;
  message: PrefilledMessageProps;
  copied: boolean;
  onOpenChange: (open: boolean) => void;
  onChannelActivate: (channel: ContactChannel) => void;
};
```

## DS-CNT-006 — ContactHours

Kontrakt: prosty odczyt skonfigurowanych godzin kontaktu. Nie oblicza bieżącego statusu i nie zawiera logiki rezerwacji ani dostępności.

- Katalog: `efe3ac9b-6991-807f-8008-cf25a15b7a36`.
- Variant Set: `efe3ac9b-6991-807f-8008-cf25a15b7a39`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be94db43fa10`.
- Osie to `format=open-text|structured` oraz `status=none|current`, ale istnieją tylko trzy celowe kombinacje. Nie utworzono niewykorzystywanego `open-text/current`, wariantów per viewport ani osobnego ekranu.
- `open-text` wyświetla treść administratora z zachowaniem podziału wierszy. `structured` renderuje uporządkowane pary dzień/zakres godzin oraz jawne „Nieczynne”. Oba formaty są alternatywną prezentacją tych samych ustawień.
- Opcjonalny status ma ikonę zegara, tekst i obramowanie, więc znaczenie nie zależy od koloru. Wartość, np. „Dziś otwarte · do 18:00”, dostarcza warstwa wywołująca; komponent nie odczytuje zegara i nie wykonuje logiki live.
- Mobile i desktop używają tej samej listy dopasowanej do szerokości rodzica. Minimalna sprawdzona szerokość treści to 288 px w viewportcie 320 px.
- Nagłówek powinien mieć semantykę odpowiednią do miejsca osadzenia, a lista strukturalna może być `dl`. Nie używać `aria-live`, jeśli status nie jest faktycznie aktualizowany w runtime.

```ts
type ContactHoursEntry = {
  label: string;
  value: string;
};

type ContactHoursProps = {
  format: "open-text" | "structured";
  text?: string;
  entries?: readonly ContactHoursEntry[];
  currentStatus?: {
    label: string;
  };
  timezoneLabel?: string;
};
```

## DS-CNT-007 — ContactShortcutBar

Kontrakt: opcjonalna kompozycja dwóch szybkich akcji kontaktu. Nie jest nawigacją aplikacji i nie tworzy rezerwacji ani klienta.

- Katalog: `efe3ac9b-6991-807f-8008-cf25a15b7ab7`.
- Variant Set: `efe3ac9b-6991-807f-8008-cf25a15b7aba`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be95f4f7165c`.
- Jedyna oś to `placement=fixed|inline`. Oba warianty składają dokładnie dwie rzeczywiste instancje wspólnego `Button`: „Zadzwoń” i „WhatsApp”. Nie ma osi kanału, stanu ani viewportu.
- `fixed` jest opcjonalny i przeznaczony wyłącznie do publicznego mobile. Ma 84 px wysokości, dolny safe area oraz dwa cele 48 px. Wrapper strony wymaga odpowiedniego `scroll-padding-bottom`, aby nie zasłaniać treści ani fokusu.
- `inline` ma 72 px wysokości i może pojawić się w desktopowej sekcji kontaktu. Nie jest sticky i nie zastępuje pełnej listy pozostałych kanałów.
- Pasek renderujemy tylko, gdy skonfigurowane są jednocześnie telefon i WhatsApp. Przy braku jednego kanału pozostaje zwykły `ContactCTA`/ `ContactSheet`; nie tworzymy wariantów jednoelementowych.
- Telefon używa bezpiecznego `tel:`. WhatsApp jawnie otwiera aplikację lub web fallback. Region ma nazwę dostępną „Szybki kontakt”, a etykiety przycisków pozostają widoczne.

```ts
type ContactShortcutBarProps = {
  placement: "fixed" | "inline";
  phoneHref: `tel:${string}`;
  whatsappHref: string;
  onExternalOpenError?: (channel: "phone" | "whatsapp") => void;
};
```

## DS-DAT-001 — Card

Kontrakt: neutralny wrapper treści dla układów grid/list. Nie zastępuje domenowych kart pojazdu, sesji, rekordu ani konfliktu.

- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d813a5b8e`.
- Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d813a5b91`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-be971465d954`.
- Osie to `appearance=default|interactive|selected|emphasized` oraz `state=default|hover|focus|disabled`, ale istnieje siedem celowych kombinacji. Hover, focus i disabled należą wyłącznie do `interactive`.
- Widoczne teksty katalogu są neutralnym przykładem slotu `children`, nie wymaganą anatomią kart domenowych. Implementacja udostępnia powierzchnię, padding, border, radius i semantyczny kontener dla dowolnej treści.
- `selected` ma znak `✓`, etykietę i obramowanie 2 px. `focus` ma widoczny obrys 2 px, `hover` podniesienie, a `disabled` tekst „Niedostępna” oraz obniżoną opacity. Znaczenie nie opiera się wyłącznie na kolorze.
- Mobile wypełnia kolumnę treści z minimalnym sprawdzonym rozmiarem 288×180 px. Tablet/desktop dobiera szerokość z rodzica; Card nie posiada breakpointu ani własnego gridu.
- Cała karta może być jednym linkiem albo przyciskiem. Nie wolno wtedy zagnieżdżać innych aktywnych kontrolek. Focus jest `:focus-visible`; disabled nie reaguje na aktywację i nie może udawać klikalnego elementu.

```ts
type CardAppearance = "default" | "interactive" | "selected" | "emphasized";

type CardProps = {
  appearance?: CardAppearance;
  disabled?: boolean;
  onActivate?: () => void;
  children: React.ReactNode;
  className?: string;
};
```

## DS-FRM-008 — Combobox

To jedna rodzina searchable single-select; nie dodaje trasy, ekranu ani drugiego mechanizmu wyboru obok istniejącego `Select`.

- Katalog: `7cf0d39f-ce5c-80f6-8008-cf2d813a5be8`.
- Variant Set: `7cf0d39f-ce5c-80f6-8008-cf2d813a5beb`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-becd14800250`.
- Kontrakt implementacyjny: `7cf0d39f-ce5c-80f6-8008-cf2d813a5bed`.

| Oś | Wartości w katalogu |
|---|---|
| `presentation` | `mobile-sheet`, `desktop-popover` |
| `state` | `typing`, `loading`, `empty`, `selected` |

Osiem członów to pełna, ale minimalna macierz wymagana przez SPEC. Open mobile składa istniejący `BottomSheet`, open desktop istniejący `Popover`, a każde pole jest rzeczywistą instancją `DS-FRM-003 SearchInput`. Loading korzysta ze Spinnera zawartego w SearchInput; nie powstał drugi wskaźnik ani komponent opcji. Wiersz opcji jest lokalną anatomią listboxa.

```ts
type ComboboxOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type ComboboxProps = {
  label: string;
  value?: string;
  query: string;
  options: readonly ComboboxOption[];
  loading?: boolean;
  emptyText?: string;
  onQueryChange: (query: string) => void;
  onValueChange: (value: string) => void;
  onOpenChange: (open: boolean) => void;
};
```

- Kontrolka ma `role="combobox"`, a lista `role="listbox"`; opcje używają `role="option"`. Aktywna opcja jest wskazana przez `aria-activedescendant`.
- ArrowUp/Down i Home/End zmieniają aktywną opcję, Enter zatwierdza, Escape zamyka warstwę i zwraca fokus do pola/triggera. Wybór nie zmienia się w trakcie samego filtrowania.
- Loading i empty są ogłaszane przez `aria-live="polite"`. Brak wyników nie tworzy nowej wartości; komponent nie jest creatable.
- Mobile używa modalnego sheetu / pełnego ekranu z pułapką fokusu i blokadą scrolla. Desktop używa popoveru do 400 px z collision padding 8 px.
- Runtime odpowiada za pobieranie danych, debounce/anulowanie requestów, błędy serwera i ewentualną wirtualizację długiej listy.

## DS-FRM-009 — MultiSelect

Kontrakt: alias użycia `DS-FRM-021 FeaturePicker` w trybie `searchable`. Nie powstał drugi komponent biblioteczny o tej samej anatomii.

- Katalog aliasu: `7cf0d39f-ce5c-80f6-8008-cf2d813a5d4c`.
- Obszar sześciu kompozycji: `7cf0d39f-ce5c-80f6-8008-cf2d813a5d4f`.
- Źródłowy Variant Set FeaturePicker: `7cf0d39f-ce5c-80f6-8008-cf2bf5a884e5`; głowa biblioteczna: `a4abf4c9-2e1f-80fd-8008-b11fbed7c9b2`.

| Prezentacja | `selected` | `max-reached` | `empty` |
|---|---|---|---|
| `mobile-sheet` | searchable/mobile/selected + chipy | to samo + limit | searchable/mobile/default |
| `desktop-popover` | searchable/desktop/selected + chipy | to samo + limit | searchable/desktop/default |

Selected i max-reached składają po trzy rzeczywiste, usuwalne instancje `DS-DAT-008 FeatureChip`, zgodne z trzema zaznaczonymi checkboxami źródła. Max-reached dodaje rzeczywisty `DS-FBK-002 InlineMessage` z tekstem limitu 3/3 i przełącza wyłącznie niezaznaczone Checkboxy w disabled. Wybrane wartości pozostają możliwe do usunięcia. Empty oznacza brak wyboru (`0 wybranych`), nie brak wyników wyszukiwania.

```ts
type MultiSelectProps = {
  label: string;
  selectedIds: readonly string[];
  options: readonly { value: string; label: string; disabled?: boolean }[];
  query: string;
  maxSelected?: number;
  onQueryChange: (query: string) => void;
  onSelectionChange: (values: readonly string[]) => void;
  onOpenChange: (open: boolean) => void;
};
```

- Grupa opcji używa checkboxów i wspólnej nazwy przez `fieldset`/`legend` lub równoważne `role="group"`. Licznik wyboru jest tekstem i polite live region.
- Chip ma osobny przycisk usunięcia z dostępną nazwą; znak `×` pozostaje dekoracyjny. Na 320 px chipy zawijają się, a cele usuwania zachowują 44 px.
- Mobile reużywa sheet i stosuje zmiany po akcji „Zastosuj”. Desktop używa popoveru/panelu; Escape zamyka warstwę i przywraca fokus triggerowi.
- Formularz nadrzędny odpowiada za stan wyboru, limit domenowy, pobieranie, filtrowanie, zapis i walidację serwerową.

## DS-MED-005 — ImageAdminTile

Kontrakt: pojedyncza karta administracyjna obrazu. Następna `ReorderableGallery` ma ją składać, a nie kopiować jej anatomię.

- Katalog: `1e066793-8858-8051-8008-cf334fe56bef`.
- Variant Set: `1e066793-8858-8051-8008-cf334fe56bf2`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-bed26ae93547`.
- Jedyna oś to `state=cover|regular|uploading|failed`. Pozycja, szerokość kolumny i sposób zmiany kolejności nie są wariantami karty.
- `cover` ma tekstowy marker „✓ GŁÓWNE” i wyłączoną akcję ponownego ustawienia jako główne; `regular` udostępnia tę akcję. Oba stany mają edycję tekstu alternatywnego i usuwanie.
- `uploading` składa istniejące `ResponsiveImage`, `ProgressBar` i `IconButton`; pokazuje nazwę pliku, procent i anulowanie. `failed` składa istniejący `InlineMessage` oraz akcje ponowienia i usunięcia.
- Uchwyt 44×44 px ma dostępną nazwę. Na desktopie wspiera drag/drop i `Ctrl+Arrow`; na mobile galeria dostarcza jawne przyciski „w górę/w dół”.
- Usunięcie wymaga potwierdzenia, jeśli obraz jest zapisany. Nie wolno usunąć jedynego obrazu ani aktywnego coveru bez wskazania następcy.
- Własne warstwy są powiązane z tokenami semantycznymi. Audyt czterech źródeł i dwunastu kopii preview potwierdził brak `variantError`, obcych kolorów, mikrotekstu, nazw automatycznych i niezamierzonego overflow.

```ts
type ImageAdminTileProps = {
  image: { id: string; src: string; alt: string; filename: string };
  state: "cover" | "regular" | "uploading" | "failed";
  position: number;
  total: number;
  progress?: number;
  onSetCover?: () => void;
  onEditAlt: () => void;
  onRetry?: () => void;
  onCancelUpload?: () => void;
  onDelete: () => void;
};
```

## DS-MED-006 — ReorderableGallery

Kontrakt: jeden region zarządzania kolejnością. Składa istniejący `DS-MED-005`; nie zawiera drugiej implementacji karty obrazu.

- Katalog: `1e066793-8858-8051-8008-cf339c931049`.
- Variant Set: `1e066793-8858-8051-8008-cf339c93104c`; głowa biblioteczna: `92bfc32e-2dd6-801a-8008-bed6ae0162d6`.

| Oś | Wartości |
|---|---|
| `viewport` | `mobile`, `desktop` |
| `state` | `default`, `saving`, `conflict` |

Sześć członów to pełna minimalna macierz. Drag/drop i klawiatura są dwoma sposobami sterowania tą samą kolejnością, więc nie tworzą osi. Mobile składa dwie kolumny ImageAdminTile oraz jawne 44 px przyciski góra/dół. Pierwszy przycisk „w górę” i ostatni „w dół” są disabled. Desktop składa cztery kafelki z uchwytem; `Ctrl+ArrowLeft/Right` zmienia pozycję i ogłasza nową wartość.

`saving` reużywa istniejący indeterminate `ProgressBar` i blokuje kolejne operacje zmiany kolejności. `conflict` reużywa istniejący warning `Alert`, zatrzymuje lokalny zapis i wymaga wczytania bieżącej kolejności przed retry. Karta cover pozostaje dokładnie jedna; reorder nie zmienia jej semantyki.

```ts
type ReorderableGalleryProps = {
  images: readonly ImageAdminTileProps["image"][];
  coverImageId: string;
  state: "default" | "saving" | "conflict";
  onReorder: (imageId: string, targetIndex: number) => void;
  onReloadAfterConflict: () => void;
};
```

- Region ma nazwę „Kolejność zdjęć pojazdu”. Po zmianie polite live region ogłasza nazwę obrazu oraz pozycję „x z y”.
- Drag nie jest jedynym mechanizmem. Klawiatura działa bez aktywowania trybu przeciągania, a mobile zawsze pokazuje przyciski.

## DS-MED-007 — CoverMarker

Kontrakt: alias anatomii `DS-MED-005 ImageAdminTile`. Nie powstał osobny komponent Badge/Radio, ponieważ marker bez karty nie ma samodzielnego zastosowania w MVP.

- Katalog aliasu: `1e066793-8858-8051-8008-cf339c934f76`.
- Obszar wzorców: `1e066793-8858-8051-8008-cf339c934f79`.
- Źródłowa głowa ImageAdminTile: `92bfc32e-2dd6-801a-8008-bed26ae93547`.

Aktywny cover składa znak `✓` oraz tekst „GŁÓWNE”; nie komunikuje statusu wyłącznie kolorem. Akcja ustawienia coveru na tej samej karcie jest disabled. Karta regular nie ma badge i udostępnia akcję `★ Ustaw jako główne`.

```ts
type CoverMarkerContract = {
  coverImageId: string;
  onSetCover: (imageId: string) => void;
};
```

- Zbiór z co najmniej jednym obrazem ma dokładnie jeden cover.
- Zmiana przenosi status atomowo; nie występuje stan z dwoma coverami ani bez coveru pomiędzy requestami.
- Usunięcie aktywnego coveru wymaga wskazania następcy, chyba że równocześnie cofnięto publikację zgodnie z regułą domenową.
- Mobile i desktop pokazują ten sam marker i tekst akcji.

## DS-MED-008 — UploadQueue

Kontrakt: alias stanów `DS-FRM-023 ImageUploader` dla `mode=vehicle`. Nie powstał drugi uploader ani rodzina wierszy pliku.

- Katalog aliasu: `1e066793-8858-8051-8008-cf339c935029`.
- Obszar sześciu wzorców: `1e066793-8858-8051-8008-cf339c93502c`.
- Kontrakt kolejki: `1e066793-8858-8051-8008-cf339c93502d`.
- Źródłowa głowa ImageUploader: `a4abf4c9-2e1f-80fd-8008-b125ce535de1`.

| Stan kolejki | Istniejący stan ImageUploader | Zachowanie |
|---|---|---|
| uploading | `progress` | procent per plik i Cancel |
| failed | `error` | poprawne pliki pozostają |
| retrying | `retry` | ponawiany jest tylko failed file |
| completed | `success` | wynik przechodzi do ImageAdminTile |

Katalog składa sześć rzeczywistych instancji: mobile/desktop progress, mobile error, desktop retry oraz mobile/desktop success. Źródłowa macierz ImageUploader pozostaje kompletna: 20 wariantów bez `variantError`.

```ts
type UploadQueueFile = {
  id: string;
  name: string;
  progress?: number;
  status: "queued" | "uploading" | "failed" | "retrying" | "completed";
  errorMessage?: string;
};

type UploadQueueProps = {
  files: readonly UploadQueueFile[];
  onCancel: (fileId: string) => void;
  onRetry: (fileId: string) => void;
};
```

- Błąd jednego pliku nie anuluje poprawnych i nie usuwa ukończonych wyników.
- Cancel dotyczy wyłącznie queued/uploading; retry jest idempotentne i dotyczy tylko failed file.
- Mobile używa pionowego stacku, desktop listy/gridu. Aktualizacje procentu są ogłaszane oszczędnie przez polite live region, a akcja zawiera nazwę pliku.

## DS-MED-009 — ImageAltEditor

Kontrakt: alias `FormField`/`TextInput` osadzany inline, w istniejącym `BottomSheet` albo `Dialog`. Nie ma osobnego inputu alt.

- Katalog aliasu: `1e066793-8858-8051-8008-cf339c9350ed`.
- Inline required/suggested/custom: `1e066793-8858-8051-8008-cf339c9350f0`.
- Mobile sheet, desktop dialog i kontrakt: `1e066793-8858-8051-8008-cf339c9350f1`.
- Źródłowa głowa FormField: `a4abf4c9-2e1f-80fd-8008-afceec4d1362`.

Trzy stany są wartościami formularza, nie osobnymi komponentami:

- `required`: puste pole i jawny błąd blokujący publikację;
- `suggested`: edytowalna propozycja na podstawie nazwy pojazdu i ujęcia;
- `custom`: zapisany tekst administratora, pokazywany jako bieżąca wartość.

```ts
type ImageAltEditorProps = {
  imageId: string;
  value: string;
  suggestedValue?: string;
  presentation: "inline" | "sheet" | "dialog";
  maxLength?: 120;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
};
```

- Mobile używa istniejącego BottomSheet; desktop preferuje inline, a Dialog pozostaje opcją dla akcji otwieranej z kafelka.
- Escape/anuluj nie zapisuje i zwraca fokus. Błąd zapisu zachowuje wpisaną wartość. Licznik nie zastępuje etykiety ani komunikatu walidacyjnego.

## DS-MED-010 — LogoUploader

Kontrakt: alias `DS-FRM-023 ImageUploader / mode=logo`. Jeden plik nie otrzymuje osobnej kolejki ani drugiego dropzone.

- Katalog aliasu: `1e066793-8858-8051-8008-cf339c935131`.
- Wzorce mobile/desktop: `1e066793-8858-8051-8008-cf339c935134`.
- Kontrakt single-file: `1e066793-8858-8051-8008-cf339c935135`.
- Źródłowa głowa ImageUploader: `a4abf4c9-2e1f-80fd-8008-b125ce535de1`.

| Stan LogoUploader | ImageUploader |
|---|---|
| empty | `mode=logo / state=empty` |
| preview | `mode=logo / state=success` |
| invalid | `mode=logo / state=error` |
| replacing/retry | istniejące `progress` / `retry` |

```ts
type LogoUploaderProps = {
  value?: { id: string; src: string; filename: string };
  state: "empty" | "progress" | "preview" | "invalid" | "retry";
  onChoose: () => void;
  onReplace: () => void;
  onRemove: () => void;
  onRetry: () => void;
};
```

- Dozwolony jest dokładnie jeden plik. Replace nie pokazuje dwóch aktywnych podglądów; poprzednie poprawne logo pozostaje do sukcesu nowego uploadu.
- Mobile i desktop mają ten sam model; desktop dodaje drag/drop jako skrót.

## DS-SET-008 — AuditFilters

Kontrakt: alias dwóch istniejących wzorców filtrowania. Mobile reużywa `DS-DAT-021 FilterSheet`, desktop reużywa `DS-DAT-020 FilterBar`; nie powstał trzeci komponent filtrów.

- Katalog aliasu: `1e066793-8858-8051-8008-cf339c938499`.
- Wzorce mobile/desktop: `1e066793-8858-8051-8008-cf339c93849c`.
- Kontrakt zapytania audytu: `1e066793-8858-8051-8008-cf339c93849d`.
- Mobile: `1e066793-8858-8051-8008-cf339c93849f`, źródło FilterSheet `1e066793-8858-8051-8008-cf334fe569c3`.
- Desktop: `1e066793-8858-8051-8008-cf339c9384a1`, źródło FilterBar `1e066793-8858-8051-8008-cf334fe506c6`.

```ts
type AuditFiltersValue = {
  dateFrom?: LocalDate;
  dateTo?: LocalDate;
  actor?: string;
  action?: string[];
  entityType?: string[];
  entityId?: string;
};

type AuditFiltersProps = {
  value: AuditFiltersValue;
  resultCount: number;
  presentation: "sheet" | "bar";
  onApply: (value: AuditFiltersValue) => void;
  onClear: () => void;
};
```

- Wszystkie pola aktualizują jedno zapytanie audytu. `Apply` stosuje komplet, a `Clear` usuwa wszystkie grupy, bez rozbieżności między viewportami.
- Zakres dat jest jawny i zachowuje strefę audytu. Liczba wyników oraz zmiana filtrów są ogłaszane przez `polite` live region.
- Mobile pokazuje grupy w sheet i stałe akcje na dole; desktop pokazuje pasek, aktywne chipy i liczbę wyników.

## DS-SET-010 — DataQualityIssue

Kontrakt: alias `DS-DAT-016 WarningList` i istniejącego `Alert`. Kategorie vehicle/contact/system są danymi tego samego wzorca, nie trzema komponentami ani osią wariantów anatomii.

- Katalog aliasu: `1e066793-8858-8051-8008-cf339c9384dc`.
- Wzorce: `1e066793-8858-8051-8008-cf339c9384df`.
- Kontrakt: `1e066793-8858-8051-8008-cf339c9384e0`.
- Mobile vehicle/action-required: `1e066793-8858-8051-8008-cf339c9384e4`.
- Desktop contact+system/action-required: `1e066793-8858-8051-8008-cf339c9384e5`.
- Desktop vehicle/resolved+action: `1e066793-8858-8051-8008-cf339c9384e6`.

```ts
type DataQualityIssue = {
  id: string;
  category: "vehicle" | "contact" | "system";
  state: "action-required" | "resolved";
  title: string;
  description: string;
  action?: { label: string; href: string };
};
```

- `action-required` używa alertu warning, jasnego opisu i jednej akcji prowadzącej do właściwej sekcji naprawy.
- `resolved` używa ikony i tekstu sukcesu; nie wymaga akcji korygującej.
- Brak issue oznacza brak wrappera, nie pustą kartę. Zmiana stanu jest ogłaszana przez `polite` live region.
- Mobile układa karty pionowo, desktop może użyć wiersza lub kart w panelu. Kategorie i stan nie zmieniają modelu danych między viewportami.

## Komponenty platformy MVP 3.1

Poniższe pięć pozycji jest częścią istniejącej biblioteki; component ID znajduje się w `traceability.json` → `platform.components`, a pełna ścieżka w załączniku A architektury.

| ID / komponent | Kontrakt implementacyjny |
|---|---|
| `DS-SRV-001 ServiceStatusSummary` | Pokazuje osobno opłacony okres, trial i widoczność publiczną. Data opłacenia jest włącznie, trial trwa 336 godzin od zakończenia rejestracji. Koniec okresu nie blokuje funkcji panelu. Archiwizacja jest odrębnym stanem blokującym dostęp. |
| `DS-CTX-001 CompanyContextBar` | W zagnieżdżonej obsłudze zawsze pokazuje wybraną firmę i powrót do platformy; aktorem nadal jest superadmin. Sama etykieta nie zastępuje serwerowej kontroli firmy i roli. |
| `DS-COM-001 ChatMessage` | Zwykły tekst, właściwy nadawca, czas i status wysłania/odczytu. Wiadomość staje się wysłana po potwierdzonym zapisie; retry nie tworzy duplikatu. Bez HTML i załączników. |
| `DS-COM-002 ConversationItem` | Nazwa firmy, skrót ostatniej wiadomości, nieprzeczytane i oznaczenie lokalnego szkicu. Wybór odbiorcy pochodzi z autoryzowanej rozmowy. Loading, empty, filtered-empty i error są różnymi stanami listy. |
| `DS-COM-003 MessageComposer` | Szkic lokalny osobno dla rozmowy, zachowany przy przejściu do innej rozmowy bez dialogu. Stan wysyłania/błędu/retry, typing i informacja o nowych wiadomościach; offline blokuje wysyłkę i nie tworzy kolejki. Po końcu opłaty czat nadal działa, po archiwizacji dostęp ustaje. |

### Nawigacja platformy

`PLT-01-02` łączy wejścia `/` i `/firmy`: oba pokazują listę firm z KPI opłaconych okresów i triali nad listą. Kanoniczne wzorce na stronach scenariuszy mobile (`fb4e1683-f05f-8095-8008-c7595a575f33`) i desktop (`fb4e1683-f05f-8095-8008-c759e3b05202`) nie tworzą osobnej trasy Pulpit ani `/ustawienia` platformy. Widoczne główne pozycje to Firmy i Wiadomości; mobile ma dodatkowy trigger „Więcej”, desktopowe Konto otwiera menu profilu. Sprawdzone cele: Firmy → PLT-01/02, Wiadomości → PLT-09, menu → mobilny board `89433e5c-4f5c-80ad-8008-d910ad0b18fd` lub desktopowy `89433e5c-4f5c-80ad-8008-d90d3f63bcb7`. Kanoniczne PLT-01/02, PLT-03 i PLT-09 oraz zagnieżdżony przykład Alfa Campers mają interakcje w aktualnym Penpocie. Historyczne ukryte warstwy nie są pozycjami runtime.

Menu profilu superadmina korzysta z anatomii `DS-NAV-011 UserMenu`, ale ma osobny kontekst aktora i cele: Konto → `/konto`, Wyloguj → serwerowe unieważnienie sesji, potem `/login`. Nie używa menu firmy ani `/admin/konto`. Penpot nie ma jeszcze boardu `/konto` platformy — #103 dostarczy cel i odbiór tego ekranu przed #19; pozycja Konto pozostaje bez pozornego przejścia w prototypie. Wyloguj prowadzi prototypowo do PLT-08, co nie dowodzi unieważnienia sesji. W implementacji menu ma nazwę, `aria-haspopup`, obsługę Escape/kliknięcia poza i zwrot fokusu do triggera.

Na PLT-03 i zagnieżdżonych ADM zachowaj identyfikację wybranej firmy oraz „Wróć do karty firmy”; globalne Firmy/Wiadomości nie zmieniają tożsamości superadmina. Przykładowe zagnieżdżone boardy Alfa Campers wracają do karty tej samej firmy: mobile `43eeb5e5-a1c6-801a-8008-d0265908f175` → `4e2ad814-13be-80ec-8008-ccaacecd969f`, desktop `43eeb5e5-a1c6-801a-8008-d02563417960` → `4e2ad814-13be-80ec-8008-ccadc80b0a41`. Widoczne kopie nawigacji w PLT-04 wymagają korekty #112 przed odbiorem formularza #25; ukryte stare warstwy nie są dowodem widocznego błędu. Inne kopie scenariuszy sprawdza ich pierwszy konsument przed użyciem jako golden.
