# Przypomnienia 7/1/0 o okresie usługi: kontrakt #54

Realizuje kroki 1–5 [kontraktu harmonogramu](service-periods-kpi-reminders.md) (D-07/D-14) na [outboxie #17](jobs-mail-outbox.md). Poczta usługi jest osobna od czatu; czat nie wysyła e-maili.

## Model

- `ReminderIntent`: jedna trwała intencja na `(organizationId, effectiveEndsAt, offsetDays ∈ {7,1,0}, channel ∈ {PANEL, EMAIL})` — unikalny klucz doręczenia. Pola: `slotAt` (09:00 `Europe/Warsaw` dla `endDate − offset`, liczone na datach kalendarzowych), `source` (PAID/TRIAL), `periodVersion`, `status` (`PENDING`, `QUEUED`, `DELIVERED`, `FAILED`, `UNCERTAIN`, `SKIPPED`, `SUPERSEDED`), `jobId` (tylko e-mail), `deliveredAt`, `errorCode`.
- `ReminderPlan`: ostatnio uzgodniona granica i `periodVersion` firmy. FK do firmy jest `ON DELETE RESTRICT` jak w reszcie schematu (bez kaskadowego usuwania firmy); tylko `jobId` ma `SET NULL`. Cleanupy testów i reset wierszowy fixture usuwają intencje i plan jawnie.
- `endDate`: dla opłaty `paidThrough`, dla trialu lokalna data `trialEndsAt` (także przy 00:00). Efektywna granica to późniejsza z opłaty i trialu, remis należy do opłaty; jedna seria na firmę.

## Uzgadnianie (atomowe, ta sama transakcja i blokada organizacji)

`reconcileReminders(tx, organizationId, { now })` jest wołane przez `changePaidThrough` (#21), aktywację konta i pierwszą rejestrację (#22), archiwizację i przywrócenie (#48) zaraz po podniesieniu `periodVersion`. Prerejestracja i firma zarchiwizowana nie mają granicy.

- Zmieniona granica: niedoręczone intencje innej granicy → `SUPERSEDED`; brakujące sloty tworzone **tylko**, gdy `slotAt > now`. Sloty przeszłe nie powstają wstecz (zapis o 08:59 tworzy slot 09:00, zapis o 09:01 nie).
- Niezmieniona granica: wszystkie intencje zostają (także zaległe), niedoręczone dostają nową wersję i aktualne źródło; `slotAt` przyszłego slotu jest przeliczany według nowego źródła. Zakolejkowany e-mail zachowuje `Job.id` i treść, a jego wersję odświeża `rebindReminder` (#17). Intencje w stanie końcowym (`DELIVERED`, `FAILED`, `UNCERTAIN`, `SKIPPED`) nigdy nie są wysyłane ponownie pod tym kluczem.
- Archiwizacja unieważnia niedoręczone intencje (granica `null`); przywrócenie ożywia lub tworzy tylko przyszłe sloty. Slot, który minął w archiwum, nie wraca.
- `rebindReminder` potrzebuje `MAIL_PAYLOAD_KEY` w procesie WWW (zgodnie z #17), ale tylko gdy istnieje zakolejkowany e-mail do odświeżenia; brak klucza przerywa mutację zamiast zostawić starą wersję.

## Worker (`processDueReminders`, krok pętli `runWorkerLoop`)

1. Samonaprawa: firma bez planu lub z planem o innej `periodVersion` jest uzgadniana (dane sprzed #54, pominięty hook).
2. Każda należna intencja `PENDING` jest obsługiwana pod blokadą firmy po ponownym odczycie okresu, archiwizacji i adresata. PANEL → `DELIVERED`. EMAIL → `enqueueMail(MAIL_REMINDER)` z treścią opisującą bieżący stan (np. „Trial już wygasł”, gdy koniec nastąpił przed 09:00 slotu 0) i status `QUEUED`. Brak jedynego zweryfikowanego administratora z MFA albo aktywnego hosta panelu → `SKIPPED` (`RECIPIENT_INVALID`, `ADMIN_HOST_MISSING`) bez zadania.
   Trwały błąd doręczenia intencji (np. adres odrzucany przez walidację outboxu) zwiększa `attempts`; po 5 próbach intencja kończy `FAILED` z `DELIVERY_ERROR` i nie zajmuje partii workera. Sweep działa najwyżej raz na `pollMs`.
3. Zaległe sloty po awarii są nadrabiane osobno, najwyżej raz na kanał (nie łączymy 7/1/0).
4. Wynik zadania poczty jest kopiowany na intencję. `UNCERTAIN` pozostaje końcowe: bez nowego zadania i bez ponownej wysyłki; operator uzgadnia wynik zgodnie z #17.
5. Procesor poczty tuż przed doręczeniem wymaga: zgodnej `periodVersion`, firmy niearchiwalnej, bieżącego adresata oraz intencji `QUEUED` należącej do aktualnej efektywnej granicy. Stare zdarzenie kończy `SKIPPED/STALE_INTENT` i nie zmienia strony ani okresu.

Statusy audytu: zmiany okresu, archiwizacji i aktywacji są audytowane jak dotąd; kontrakt audytu #16 wymaga aktora rzeczywistej sesji i nie przewiduje zdarzeń systemowych (poczta #17 też ich nie audytuje), więc wynik doręczenia zapisuje intencja i `Job`, bez wpisu `AuditLog`.

## API odczytu (prywatne, `Cache-Control: no-store`, `X-Request-Id`, limit odczytów, bez zapisu)

| Metoda i ścieżka | Aktor |
|---|---|
| `GET /api/admin/service-period/` | administrator firmy z hosta `COMPANY_ADMIN` własnej firmy |
| `GET /api/platform/companies/{organizationId}/service-period/` | superadmin z pełnym MFA na hoście `PLATFORM` (własny aktor w karcie firmy) |

Odpowiedź 200: `organizationId`, `periodVersion`, `serverTime`, `period` (`headline` PAID/TRIAL/EXPIRED/NOT_STARTED — przy obu ważnych PAID; `paidThrough`, `paidValid`, `trialEndsAt`, `trialValid`, `effectiveEndsAt`, `effectiveSource`), `site` (`state`: VISIBLE, ARCHIVED, PERIOD_EXPIRED, DOMAIN_PENDING, RESTORE_LOCKED, REGISTRATION_PENDING; `publicVisible`), `expiredNotice` (dokładny komunikat D-11 po wygaśnięciu wszystkich okresów, inaczej `null`) oraz `reminders` — doręczone powiadomienia panelowe **bieżącej** granicy (`id`, `offsetDays`, `effectiveEndsAt`, `source`, `deliveredAt`, `message`). Po przedłużeniu lub skróceniu poprzednie powiadomienia znikają natychmiast; treść jest liczona dla chwili odczytu, a fraza względna („za N dni”, „jutro”, „dziś”) wynika z różnicy dat kalendarzowych Europe/Warsaw między chwilą odczytu lub wysyłki a datą końca, nie z offsetu slotu. Wygaśnięcie nie zwraca błędu ani nie blokuje panelu. Błędy: `400 INVALID_INPUT`/`INVALID_ID`, `403 FORBIDDEN`, `404 NOT_FOUND`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`. Odczyt nie jest cache'owany ani publiczny; nie zawiera danych innej firmy, adresu odbiorcy ani treści e-maila.

## Decyzje do potwierdzenia przez właściciela

- Brak jedynego zweryfikowanego administratora z MFA lub aktywnego hosta panelu w chwili slotu kończy intencję jako `SKIPPED` (`RECIPIENT_INVALID`, `ADMIN_HOST_MISSING`) bez ponowienia (test: `service-reminders.test.ts`).
- Przyznanie trialu przy tworzeniu firmy (#20) nie uzgadnia przypomnień, bo przed rejestracją nie ma granicy; harmonogram powstaje przy aktywacji konta.

## Ograniczenia

- Okno między ostatnim sprawdzeniem procesora a wysyłką do dostawcy nie jest objęte blokadą firmy (jak w #17); stare zdarzenie nie może jednak zmienić okresu ani strony.
- Wybór dostawcy, SPF/DKIM/DMARC i realna dostarczalność pozostają poza zakresem (#90/#10). `SENT` oznacza przyjęcie przez dostawcę.
- Odblokowanie publikacji po przywróceniu (`unlockPublicAfterRestore`) nie zmienia `periodVersion` ani granicy, więc nie uzgadnia przypomnień.
