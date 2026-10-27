# Plan #57: zabezpieczenia serwera i regresja izolacji przed wydaniem

Cel: domknąć nagłówki/CSP, Origin/CSRF, limity wejść, bezpieczne parsowanie, redakcję błędów/logów i izolację A/B; mieć automatyczną regresję negatywną TEST-MVP-01..10, 32, 33, 34, 45, 47, 53 oraz macierz OWASP z dowodami. Wymagania: C-N001–020, C-N028–038, C-N044, C-N057, C-N059, C-N061, C-N062.

## Etapy

1. Inwentaryzacja wszystkich wejść (HTTP, upload, publiczne API, auth, WS, strony) i luk — wynik w [macierzy](../security/OWASP_CONTROLS.md).
2. Poprawki małe z testem, który bez nich pada: nagłówki i CSP z nonce, jeden ograniczony parser JSON, odrzucenie NUL w filtrach (500 → 400).
3. Regresja: `tests/integration/security-regression.test.ts` (wszystkie handlery z systemu plików, PostgreSQL, sesje z MFA i bez, firmy A/B), `tests/e2e/security-headers.spec.ts` (zbudowana aplikacja, prawdziwa przeglądarka), testy jednostkowe nagłówków, CSP i polityki tras.
4. Dokumentacja: macierz OWASP, lista przypadków pentestu staging (`not-run`, zależy od #90), traceability.
5. Bramki: lint, typecheck, unit, integracja z bootstrapem, build, e2e.

## Poza zakresem tego przebiegu (zapisane)

- Pentest staging: zależy od #90 (płatne środowiska, D-16). Lista przypadków w macierzy.
- Izolacja WS dla kanału `/ws/platform` i listy rozmów superadmina (#167, PR #170): testy A/B dopisać po scaleniu #170. Przypadki: handshake `/ws/platform` odrzuca admina firmy, nieznany/publiczny Origin i sesję bez MFA; zdarzenia platformy nie trafiają do połączeń firmy A/B; cofnięcie sesji superadmina zamyka kanał; limity ramek i połączeń jak w `/ws`.
- Kopie i odtwarzanie (#60, PR #168): izolacja kopii poza tym przebiegiem.
