# #90 — profil i budżet środowisk: materiał do decyzji

**Status: propozycja, bez akceptacji właściciela i bez zobowiązania finansowego.** D-16 odracza wybór płatnego wariantu do osobnej zgody przed pierwszym zakupem. D-18 dopuszcza tymczasowo darmowy host dostawcy, lecz nie potwierdza, że obsłuży wymagane hosty firm. Ten dokument nie poświadcza wdrożenia, wydajności, restore ani działania ingressu. Kwoty są w USD/miesiąc, bez podatków; ceny i limity trzeba ponownie sprawdzić w koncie dostawcy przed zgodą.

## 1. Profil do zatwierdzenia i pomiaru

Propozycja z [kontraktu środowisk](../contracts/environments-hosts-operations.md), a nie limit produktu: **2 firmy**, każda po **100 pojazdów i 100 000 okresów**, łącznie **100 000 odsłon/miesiąc**, szczyt **25 publicznych żądań/s przez 15 minut**, **20 równoczesnych WS**, **100 zaległych jobs**, **1 000 e-maili/miesiąc**. Test obejmie równoległe odczyty A/B, zapis blokady, upload/przetwarzanie zdjęć, WS reconnect, retry i zaległy worker. Wynik ma podać rzeczywiste CPU/RAM każdego procesu, rozmiar DB i eksportu, aktywne i kopijne bajty R2, operacje A/B, egress, liczbę wiadomości oraz dzienne maksimum poczty. Ruch miesięczny sam nie wyznacza szczytu.

Zachowane cele kontraktu: availability check p95 ≤500 ms; zapis blokady p95 ≤800 ms; lista ≤100 aut p95 ≤600 ms; dostarczenie WS p95 ≤2 s; publiczne CWV p75 LCP ≤2,5 s, INP ≤200 ms, CLS ≤0,1; cel dostępności ≥99,9%/miesiąc (nie SLA dostawcy); **spójne DB+media RPO ≤24 h i RTO ≤4 h**. Profil, rozmiary usług i koszty wymagają korekty, jeśli pomiar nie spełni tych progów.

Właściciel ma potwierdzić liczbę firm i plan wzrostu, dane na firmę, liczbę/wielkość oryginałów **oraz wariantów zdjęć**, odsłony i transfer mediów, szczyt i rozkład żądań, WS, jobs, liczbę i dzienny szczyt e-maili oraz tolerowany miesięczny koszt/pułap nadwyżek. Żadna z tych liczb nie jest obecnie zaakceptowana jako reprezentatywna.

## 2. Wariant referencyjny do wyceny

**Render Pro**, osobne stałe procesy `web`, `ws`, `worker`, `media-worker` i osobny Postgres dla **produkcji oraz stagingu**; obie grupy w regionie Frankfurt. **Cloudflare R2** Standard z osobnymi bucketami aktywnymi i chronionymi kopiami dla każdego środowiska, lokalizacja EU; **Resend Pro** dla poczty; **Better Stack Nano** dla zwykłych logów 30 dni. To projekt opcji, nie uruchomione zasoby. Render ma [Frankfurt](https://render.com/docs/regions), a R2 umożliwia wybór [jurysdykcji EU](https://developers.cloudflare.com/r2/reference/data-location/) przy tworzeniu bucketa. Region wysyłania Resend można wybrać osobno, ale [retencja i lokalizacja danych Resend](https://resend.com/security/gdpr) wymagają sprawdzenia prawnego przed użyciem danych rzeczywistych.

`web` i `media-worker` wymagają każdy **co najmniej 3 GiB** według [kontraktu mediów](../contracts/media-upload-processing.md); najbliższy rozpatrywany plan usług Render to `2c-4g`. Pomiar RSS z macOS nie dowodzi, że 4 GiB wystarczy pod limitem Linux. `ws` i zwykły `worker`: `0.5c-512mb` jedynie jako hipoteza do testu, nie dowiedziona pojemność. Postgres: `1c-2g`, 10 GB danych na środowisko w przykładzie. Render Pro daje [PITR 7 dni](https://render.com/docs/postgresql-backups), a nie wymagane 30 dni. Osobny dzienny szyfrowany eksport DB oraz spójny snapshot mediów, chroniony przez ≥30 dni, pozostaje wymagany; pełen restore do izolowanej bazy/bucketa i weryfikacja muszą zmieścić się w RTO. Nie wolno liczyć samego PITR jako kompletnej kopii.

Plan logów wymaga dwóch retencji: zwykłe 30 dni, bezpieczeństwo/audyt 365 dni, po redakcji sekretów i URL zaproszeń. [Render Pro](https://render.com/pricing) nie zapewnia sam 365 dni. [Better Stack Nano](https://betterstack.com/pricing) podaje 40 GB logów i 30 dni za $30/mies. przy rozliczeniu miesięcznym; 365-dniowe logi bezpieczeństwa trzeba osobno kierować do chronionego archiwum R2 albo uzyskać potwierdzoną ofertę retencji. Koszt pipeline'u i rzeczywisty wolumen są otwarte. Dostęp do archiwum, test odczytu i usuwanie po terminie są częścią odbioru, nie wynikiem samego zakupu storage.

## 3. Kalkulacja dla **jawnego przykładu**, obu środowisk

Fixture kosztowy: 20 GB aktywnych mediów na środowisko, DB 10 GB na środowisko, dzienna pełna kopia 20 GB mediów + 10 GB DB trzymana 30 dni. Przy założeniu niezmiennego rozmiaru i braku deduplikacji daje **920 GB-mies. R2/środowisko**, łącznie 1 840 GB-mies. To może zaniżać koszt wariantów zdjęć, wzrostu, wersji i logów. Przykładowy transfer z Render: 600 GB/mies. eksportów DB (2 × 10 × 30), 20 GB odpowiedzi produkcyjnych i 5 GB stagingu. Kopia R2→R2 przez [`CopyObject`](https://developers.cloudflare.com/r2/api/s3/api/) nie jest transferem z Render, lecz nalicza operacje R2. Transfer prywatnych mediów przez aplikację **nie jest w tych 25 GB odpowiedzi wiarygodnie oszacowany**.

| Pozycja | Produkcja | Staging | Wspólne / kalkulacja | USD/mies. |
| --- | ---: | ---: | --- | ---: |
| Render `web` `2c-4g` | $85 | $85 | 4 GiB na proces | $170 |
| Render `media-worker` `2c-4g` | $85 | $85 | osobny proces | $170 |
| Render `ws` + `worker` `0.5c-512mb` | $14 | $14 | 2 × $7, do walidacji | $28 |
| Render Postgres `1c-2g` | $40 | $40 | osobne bazy | $80 |
| Render Pro workspace | — | — | 1 × $25 | $25 |
| Render Postgres storage | $2.70 | $2.70 | 9 GB ponad 1 GB w cenie × $0.30 | $5.40 |
| R2 Standard: aktywne media + 30 kopii DB/mediów | — | — | (1 840 − 10 darmowych GB-mies.) × $0.015 | $27.45 |
| Render egress | — | — | (625 − 25 GB w Pro) × $0.15 | $90 |
| Resend Pro | — | — | 50 000 e-maili/mies. | $20 |
| Better Stack Nano, logi zwykłe | — | — | 40 GB/mies., retencja 30 dni | $30 |
| **Suma części wycenionej** | | | **nie jest pełnym budżetem** | **$645.85** |

Źródła stawek: [Render pricing](https://render.com/pricing), [Render outbound](https://render.com/docs/outbound-bandwidth), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Resend pricing](https://resend.com/pricing?product=transactional), [Better Stack pricing](https://betterstack.com/pricing). Plan usług i workerów Render `2c-4g` jest wyceniony na **$85**, podczas gdy **$75** w osobnej tabeli dotyczy PostgreSQL `2c-4g`; przed akceptacją trzeba zapisać bieżącą cenę z konta rozliczeniowego. Dawna kwota ~$266 z kontraktu zakładała tylko trzy procesy na środowisko, w tym `web` 2 GB, i pomijała osobny `media-worker`; nie spełnia obecnego wymogu pamięci.

Ta suma **nie obejmuje**: archiwum bezpieczeństwa 365 dni i jego przesyłania, dodatkowych operacji R2 A/B, backup cron/egress poza fixture, transferu zdjęć do klientów, ewentualnego pośrednika TLS/proxy, domen i certyfikatu dla wymaganej struktury hostów, nadwyżek logów/e-maili/build minutes, testowych przywróceń (tymczasowa baza i kopia mediów), podatków i opłat walutowych. Dla przykładu archiwum logów 1 GB/mies. produkcji + 0,25 GB/mies. stagingu daje po 12 miesiącach 15 GB aktywnej retencji, około **$0.23/mies. samego R2 Standard** przy wolnej kwocie już zużytej; dostarczenie i niezawodność archiwum nadal nie są wycenione. Bez limitu wolumenu i działającej ścieżki nie ma uczciwej kwoty „pełnej”.

**Wzór do finalizacji budżetu:** suma części wycenionej + `max(0, egress_GB − 625) × $0.15` + dodatkowe R2 GB-mies. × $0.015 + operacje A/B ponad darmowe pule + log ingest/retencja/archiwizacja ponad 40 GB + poczta/hosty/build ponad pule + domena/TLS/proxy + zapas dla restore i podatki. Przeliczyć na rzeczywistych wolumenach i wskazać maksymalny akceptowany koszt; progi alertów oraz wyłączenie automatycznych nadwyżek tam, gdzie możliwe.

## 4. Oszczędniejszy wariant i warunki

**Resend Free** zmniejsza część wycenioną o $20 do **$625.85/mies.**, jeśli pomiar wykaże ≤100 wiadomości **każdego dnia**, ≤3 domeny nadawcze i ≤3 000/mies. ([limity](https://resend.com/pricing?product=transactional)). Samo 1 000/mies. nie dowodzi dziennego limitu; zaproszenia, reset i alerty muszą działać także przy szczycie. Jeśli limit nie przejdzie, wrócić do Pro; nadwyżki płatne Pro to $0.90 za rozpoczęty 1 000 e-maili po 50 000, po osobnym włączeniu pay-as-you-go.

R2 Infrequent Access może obniżyć cenę samych 30-dniowych kopii z $0.015 do $0.01/GB-mies., lecz ma **minimum 30 dni**, wyższe stawki operacji i **$0.01/GB odczytu/kopiowania** ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)). Przy 1 800 GB-mies. kopii oszczędność storage to około $9/mies. przed opłatami za restore i operacje. Wybrać tylko po próbie spójnego restore ≤4 h; w przeciwnym razie Standard. Mniejszy plan dla `web`/`media-worker` przeczy warunkowi 3 GiB i nie jest tu wariantem kwalifikującym się. Plan darmowy Render nie nadaje się na trwały staging z workerem, backupem i pomiarem RPO/RTO.

## 5. Hosty, ingress i bramki przed płatnym stagingiem

D-18 nie wpisuje własnej domeny do budżetu na dziś. Render daje host `*.onrender.com` dla pojedynczej usługi, ale z tego nie wynika działanie hostów `{slug}.sites.<domena>`, wildcard DNS/TLS ani oddzielnego apex. Kontrakt wymaga serwerowej izolacji firm i poprawnego routingu hostów. Trzeba wykazać działający wariant na hoście dostawcy **lub** przedłożyć konkretną domenę, topologię DNS/TLS i jej cenę do osobnej zgody. [Render custom domains](https://render.com/docs/custom-domains) i [Cloudflare Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/) nie zastępują tego testu. Nie zakładać bez wyceny planu Cloudflare for SaaS ani certyfikatów głębszej subdomeny.

Na stagingu sprawdzić warunki z komentarza #90 / CR #172: klient HTTP/2 z mutacją dochodzi do handlera bez 411; upstream do `next start` to HTTP/1.1 z `Content-Length`; zewnętrzny chunked kończy 411; edge wymusza limit rozmiaru i timeout ciała; logi/proxy maskują URL zaproszenia w ostrzeżeniu Next; limit handshake WS na źródło (#173) opiera się na zaufanym adresie proxy. Bez dowodów z rzeczywistej trasy nie uznać ingressu za zgodny. Testować także TLS, DNS, izolację staging/produkcja, alerty, opóźnienia p95/CWV oraz spójny restore A/B bez naruszenia B.

## 6. Dane i decyzje wymagane do zamknięcia #90

1. **Właściciel:** zatwierdza lub koryguje profil z §1 i miesięczny maksymalny budżet wraz z limitem nadwyżek, walutą/podatkiem oraz wariantem płatnym; potwierdza politykę domeny i docelową domenę przed produkcją. D-16 wymaga **osobnej jawnej zgody przed pierwszym wydatkiem**.
2. **Operator:** mierzy na fixture rozmiar DB/backupów/mediów (także warianty), transfer media i eksportów, operacje R2, logi zwykłe/audytowe, szczyt poczty, RSS/CPU i czas restore. Wycenia w koncie Render plan `2c-4g`, sprawdza limity usług, cenę egress oraz lokalizację danych wszystkich dostawców.
3. **Operator:** uzupełnia konkretną ofertę dla archiwum 365 dni, jego niezawodnego eksportu, domeny/TLS/proxy i backup job; wskazuje koszty testowych przywróceń oraz próg alarmu kosztowego. Finalna tabela ma zawierać produkcję, staging i sumę, nie tylko część referencyjną.
4. **QA/CR po wykonaniu:** kontroluje zgodność wyceny ze źródłami i decyzją, a po provisioningu oddzielnie dowody pomiarów, ingressu, izolacji i restore. Ten dokument nie jest dowodem tych testów.

Do czasu tych danych i zgody #90 pozostaje `needs:decision`; żaden wariant ani budżet nie jest zatwierdzony, a usługi nie zostały zakupione.
