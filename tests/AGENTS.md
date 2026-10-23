# Testy i odbiór Autervy — MVP 3.1

- Agent QA jest osobną sesją Codex na tym samym koncie GitHub co pozostali agenci. Korzysta z widoku QA: Ready to test z aktualnym CR: PASS orkiestratora → Test. Review należy do orkiestratora. Nie tworzy własnych issue ani nie zmienia Role zadania.
- Testuj przekazany commit w osobnym worktree, z odrębnymi portami/danymi. Raport QA: PASS/FAIL/BLOCKED podpisz rolą, sesją i SHA; uwzględnij scenariusze, wyniki i dowody. Fail → Re-open do wykonawcy. PASS pozostaje w Test do integracji; orkiestrator po merge i kontrolach ustawia Done. Zmiana commita wymaga ponownego CR i QA. Raport nie jest formalnym Approve własnego konta.

- Źródła: `docs/WYMAGANIA_AUTERVA.md`, `docs/ARCHITEKTURA_AUTERVA.md`, `docs/development/WORKFLOW.md`, `docs/quality-gates.md`. TEST-MVP-01–55 rozszerzają UC-01–10; lista scenariuszy nie jest raportem wykonania.
- Testy aplikacji powstają wraz z implementacją. Brak manifestu, runtime, bazy lub komendy oznacza niewykonany test; kontrola dokumentacji nie zastępuje integracji.
- Unit: LocalDate, dostępność, publikacja, okres/trial i archiwizacja. Przy błędzie odtwórz istotną regresję; proste zmiany dokumentacji nie wymagają testu powtarzającego tekst.
- Integracja: prawdziwy PostgreSQL, transakcje, constraints, migracje, A/B, role/hosty, adapter auth, DTO, cache, outbox i idempotencja. SQLite/mock nie zastępuje współbieżności, RLS i FK.
- Dwa równoległe klienty DB wykazują konflikt blokad i edycji admin–superadmin; także wyścig zmiany aktywności z dodaniem okresu.
- Auth: oba panele MFA, brak signup, zaproszenie 7 dni/resend/GET, cofnięte sesje/archiwizacja również dla WebSocket. Zwykły koniec opłaty pozostawia panel i czat.
- E2E Playwright: oddzielne konteksty superadmina, adminów A/B i odwiedzającego. Zapis blokady → świeży wynik publiczny; brak obcych danych po zmianie hosta/ID i rozgrzaniu cache.
- Wygaśnięcie: wszystkie publiczne hosty/ścieżki/API/media niedostępne; pusta aktywna oferta i archiwum to inne stany. Trial 336 h i opłacony dzień testuj przez DST/północ Warszawa.
- Czat: trwały zapis przed sent, retry bez duplikatu, typing/read/unread, reconnect, właściwy odbiorca szkicu; bez emaili czatu/załączników. Poczta usługi testowana osobno.
- Testing Library: role/etykiety, klawiatura, focus, komunikaty i właściwe loading/empty/error/validation/saving/conflict/offline.
- Trwałe testy w repo; interaktywne `playwright-cli` nie zastępuje suite CI. Stabilne locatory, bez stałych sleepów; zegar i fixture zamrożone.
- QA czyta Penpot bez zmieniania stron, komponentów, tokenów, interakcji i wzorca. Bieżący board ID sprawdź w pliku; brak zgłoś z ID/wymaganiem.
- Porównanie: commit/build, data, realne file/page/board ID, stan/fixture, viewport, screenshot aplikacji, eksport wzorca i różnice. Obraz nie potwierdza zapisu, auth, WebSocket ani dostępności.
- Chromium, Firefox, WebKit; 390/1440 jako referencje, 320/430/768/1024/1920 według ryzyka. Automat + ręczna klawiatura/fokus/czytnik, kontrast, zoom i reduced motion.
- PWA na produkcyjnym buildzie: host firmy, start_url/scope `/admin/`, offline bez zapisu/prywatnego cache, logout, update z dirty form. Instalacja na prawdziwym iOS/Android; emulacja WebKit nie jest dowodem instalacji.
- Dowody wyłącznie na fixture, bez sekretów/sesji/produkcji. Nie zmieniaj golden screenshotów/asercji, by ukryć regresję. Raportuj pass/fail/blocked/not-run z komendą i rzeczywistym wynikiem.

## Interpretacja dostępności

- SC 1.4.12: brak utraty treści/funkcji po zmianie odstępów przez użytkownika, nie domyślne wartości CSS.
- SC 2.4.11 AA: komponent z fokusem nie jest całkowicie zasłonięty treścią autora, np. sticky CTA.
- Cel dotykowy 44 px jest regułą projektu, nie minimum każdego kryterium WCAG AA. Automat nie jest certyfikatem; wymagania sprawdzaj w źródłach W3C.
