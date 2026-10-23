# Lokalna kontrola komponentów #11

Po integracji scaffoldu #5 można tymczasowo dodać `src/app/ui-check/page.tsx`:

```tsx
import { UiCheckFixture } from "../../../tests/fixtures/ui-check";
export default function Page() {
  return <UiCheckFixture />;
}
```

Uruchom aplikację lokalnie i porównaj `/ui-check` w 390 i 1440 px z aktualnymi boardami Penpota DS-ACT-001, DS-FRM-001/002/004, DS-FBK-001/014 oraz DS-NAV-001. Sprawdź też Tab/focus, Escape, ujawnianie hasła i reduced motion. Fixture używa danych testowych; usuń tymczasową trasę przed przekazaniem PR.
