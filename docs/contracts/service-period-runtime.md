# Okres usługi: kontrakt runtime dla #21 i konsumentów

Źródłem reguł jest [kontrakt D-06/D-07/D-11/D-14](service-periods-kpi-reminders.md). Implementacja używa `ServiceAccess.paidThrough` jako `LocalDate`/SQL `DATE` włącznie, granicy o następnym 00:00 `Europe/Warsaw` i trialu dokładnie 336 godzin UTC od `Organization.firstAdminRegisteredAt`. `resolveServicePeriod` zwraca efektywną późniejszą granicę, ale gdy oba okresy są ważne, główna etykieta i KPI wskazują opłatę. Odczyt nie zapisuje stanu wygaśnięcia. Archiwum osobno blokuje panel i stronę; zwykłe wygaśnięcie nie blokuje panelu.

`resolvePublicVisibility(db, authority, now)` jest serwerową bramą istniejącego publicznego `/`. Wymaga aktywnego `COMPANY_PUBLIC` hosta, ukończonej pierwszej rejestracji, niezarchiwizowanej firmy, braku blokady odblokowania i ważnego okresu. Gdy `publicRequiresPaid=true`, sam trial nie wystarcza nawet po wcześniejszym odblokowaniu: musi nadal istnieć ważna opłata. Wyniku pozytywnego nie wolno przechowywać między żądaniami. Przyszłe publiczne trasy, API oferty, sitemap/SEO, aliasy i media muszą wywołać tę samą bramę przed ujawnieniem danych; sama allowlista Proxy nie jest bramą okresu. Ich implementacja jest w osobnych issue.

Przywrócenie z archiwum ustawia atomowo `archivedAt=null`, `publicRequiresPaid=true`, `publicUnlockRequired=true` i wersję organizacji. Archiwizacja ustawia blokadę publiczną; nie zwalnia danych ani historii. Migracja #21 konserwatywnie ustawia `publicRequiresPaid=true` dla istniejących rekordów `archivedAt IS NOT NULL OR publicUnlockRequired=true`. Przyszły konsument operacji archiwum/przywrócenia musi zachować ten zapis w tej samej transakcji co audyt. Odblokowanie nigdy nie kasuje `publicRequiresPaid`.

## Mutacje dla superadmina i panelu #27

Oba wejścia wymagają aktywnego hosta `PLATFORM`, własnego zgodnego `Origin`, pełnej sesji MFA i rzeczywistej roli `SUPERADMIN_AUTERVA`; nie ufają ID firmy z hosta ani z sesji bez serwerowej autoryzacji celu. Odpowiedzi, także błędy, mają `Cache-Control: no-store` i serwerowy `X-Request-Id`. Ścieżki wymagają końcowego `/` w obecnym Next.js; bez niego Next odpowiada przekierowaniem 308. Nie przenosić sekretu ani danych prywatnych do publicznych props.

Po autoryzacji wejścia współdzielą z auth limit **60 zapisów na ruchomą minutę** dla jednego superadmina na platformie; zmiana docelowej firmy nie resetuje budżetu. Odmowa to `429 RATE_LIMITED` z `Retry-After` w sekundach i bez cache. Błędne żądanie uwierzytelnionego aktora również zużywa próbę.

| Metoda i ścieżka | JSON żądania | Wynik 200 |
|---|---|---|
| `PATCH /api/platform/companies/{organizationId}/period/` | `{ "paidThrough": "YYYY-MM-DD" lub null, "expectedVersion": int, "eventKey": UUID }` | `{ "paidThrough": LocalDate lub null, "periodVersion": int }` |
| `POST /api/platform/companies/{organizationId}/public-unlock/` | `{ "expectedOrganizationVersion": int, "eventKey": UUID }` | `{ "publicUnlockRequired": false, "publicRequiresPaid": true, "version": int }` |

`expectedVersion` odnosi się wyłącznie do `ServiceAccess.periodVersion`, a `expectedOrganizationVersion` do `Organization.version`. `eventKey` identyfikuje zdarzenie audytu; jego ponowne użycie z inną zmianą kończy się konfliktem, bez drugiej mutacji. Konflikt wersji nie obiecuje idempotentnego sukcesu ponowienia. Własne pole `requestId` od klienta jest niedozwolone. Płatny okres można usunąć `null`; wpis nie oznacza potwierdzenia przelewu ani przyszłej daty startu. Unlock wymaga jednocześnie niearchiwalnej firmy, blokady po przywróceniu, zgodnej wersji i ważnej opłaty. Zmiana opłaty oraz unlock blokują ten sam wiersz organizacji, więc nie bazują na przedwczesnym odczycie. Jeśli opłata zostanie później skrócona, publiczny odczyt natychmiast odmawia, nawet przy ważnym trialu.

Odmowy: `400 INVALID_INPUT` lub `INVALID_ORGANIZATION_ID`, `422 INVALID_PAID_THROUGH` albo `PERIOD_PAYMENT_REQUIRED`/`PERIOD_ARCHIVED`, `409 PERIOD_VERSION_CONFLICT`/`PUBLIC_RESTORE_NOT_LOCKED`/`EVENT_KEY_CONFLICT`, `403 FORBIDDEN`, `404 NOT_FOUND`. Nieznane błędy dają neutralne `500 INTERNAL_ERROR`; klient nie powinien odtwarzać mutacji z lokalnego stanu po błędzie. Dane do widoku odczytu oraz UI, w tym odpowiedni stan formularza i komunikat D-11, należą do #27 i powiązanych modułów.

Wersję okresu trzeba spiąć transakcyjnie z intencjami przypomnień według [kontraktu harmonogramu](service-periods-kpi-reminders.md); przyszłe przyznanie trialu przy rejestracji należy do konsumenta zaproszeń. Ten dokument określa regułę integracji, nie deklaruje wdrożenia tych przepływów, publicznych tras floty ani doręczenia poczty.

Operacje archiwizacji i przywrócenia, które ustawiają te pola, opisuje [kontrakt #48](company-archive-restore.md).
