# Lokalna kontrola komponentów #11

Po integracji scaffoldu #5 można tymczasowo dodać `src/app/ui-check/page.tsx`:

```tsx
import { UiCheckFixture } from "../../../tests/fixtures/ui-check";
export default function Page() {
  return <UiCheckFixture />;
}
```

Uruchom aplikację lokalnie z testową konfiguracją #5 i porównaj `/ui-check` w 390 i 1440 px z aktualnymi boardami Penpota DS-ACT-001, DS-FRM-001/002/004, DS-FBK-001/014 oraz DS-NAV-001. Sprawdź też 320, 768, 1024 i 1920 px: brak poziomego przewijania i 44 px obszaru trafienia małego przycisku przy widocznych 40 px. Zmierz szerokość przycisków `plain-loading-button` i `icon-loading-button` przed kliknięciem oraz po włączeniu loading z długim komunikatem; oba warianty `hug` mają zachować szerokość, pokazać spinner i udostępnić pełną etykietę stanu czytnikowi. Wariant `fill` pokazuje długi komunikat w obrębie przycisku. Otwórz destrukcyjny dialog bez podanej akcji drugorzędnej: fokus powinien zacząć się na „Anuluj”, Escape zamknąć arkusz, a fokus wrócić do wyzwalacza. Sprawdź Tab, ujawnianie hasła i reduced motion. Fixture używa danych testowych; usuń tymczasową trasę przed przekazaniem PR. Odbiór rzeczywistym czytnikiem ma osobną [procedurę VoiceOver](voiceover.md).
