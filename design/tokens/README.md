# Tokeny Autervy

[auterva.tokens.json](auterva.tokens.json) jest manifestem wartości i aliasów. [auterva.tokens.css](auterva.tokens.css) jest generowanym wynikiem; nie edytować go niezależnie.

Z katalogu głównego repozytorium:

```bash
node scripts/generate_design_tokens.mjs
```

Skrypt waliduje manifest i generuje CSS. Przy zmianie tokenu porównaj wynik oraz rzeczywiste wartości/bindings w Penpocie; generator nie synchronizuje zdalnego projektu. Nazwy semantyczne są wspólne dla aplikacji i projektu. Obowiązuje jasna monochromatyczna paleta, Inter Variable, Lucide i odstępy na bazie 4 px.

Odczyt Penpota z 22.10.2026: **174 tokeny natywne** — `Primitives` 94, `Semantic/Light` 56, `Component` 24. Manifest lokalny ma 175. Udokumentowane różnice:

- API odrzuca `font.family.sans = Inter Variable`; 17 stylów tekstu biblioteki używa fallbacku `Inter Tight`. W aplikacji pozostaje **Inter Variable**.
- Motion jest zapisany jako liczby; CSS składa je w `ms` i `cubic-bezier(...)`. Nie jest to natywne wiązanie typu duration/easing w Penpocie.
- `action.destructive.pressed.content` wymaga mapowania nazwy po stronie Penpota: natywny token-liść nie może jednocześnie być prefiksem następnego tokenu. Nie zmieniaj przez to kontraktu CSS.

Przed nową synchronizacją potwierdź aktualne API i odczytaj wartości ponownie po zapisie. Brak połączenia lub bindingu zapisz jako brak; nie uznawaj samej nazwy warstwy za zastosowany token.
