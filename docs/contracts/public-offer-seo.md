# Publiczna oferta firmy, filtrowanie i SEO — kontrakt #40

Warstwa serwerowa dla stron #41–#44 oraz publiczne API JSON. Moduł: `src/modules/public-offer/`. Strony React/SSR i komponenty należą do Frontendu; ten kontrakt dostarcza funkcje, DTO, trasy metadanych i testy. Obowiązują [okres usługi](service-period-runtime.md), [odczyty dostępności](availability-reads.md), [publikacja pojazdów](company-settings-and-vehicle-publication.md), [media](media-upload-processing.md) i [domeny](custom-domain-lifecycle.md).

## Zasady wspólne

- Każda funkcja odczytu (`getPublicHome`, `listPublicVehicles`, `getPublicVehicle`, `getPublicContact`, `getPublicLegal`, `getPublicSiteState`) oraz trasy `robots.txt` i `sitemap.xml` wywołuje `resolvePublicVisibility` przy każdym wywołaniu, zanim odczyta dane firmy. Wynik pozytywny nie jest przechowywany. `null` oznacza „firma niepubliczna”: koniec okresu, archiwum, blokada po przywróceniu, nieznany host, host panelu, alias bez aktywnej domeny własnej. Wyłączenie ma pierwszeństwo nad 404 pojazdu i nad SEO; błąd nie ujawnia powodu (C-N057).
- Wyłącznie `PUBLISHED`. Zapytania zawsze zawierają `organizationId` hosta; sesja administratora nie jest nigdzie czytana (C-N030). Allowlista kolumn: brak `status`, `version`, `organizationId`, `sortOrder` (poza kolejnością), `internalNote`, `reference`, typu/źródła blokady, `operatorNote`, kluczy storage, danych okresu usługi i czatu. Dostępność: tylko filtr „dostępny w całym zakresie” (ten sam predykat `availabilityVehicleWhere(…, publishedOnly)` przed `count`, sortowaniem i paginacją) oraz istniejące API dostępności.
- Opisy i treści prawne to niezaufany tekst: DTO zwraca tekst, renderer escapuje (React domyślnie); HTML wymaga osobnej sanitizacji i testów. JSON-LD serializuje `serializeJsonLd` (escape `<`, `>`, `&`, U+2028/9).
- Brak ceny, cena `0` albo wyłączony przełącznik firmy (`showPrices`) = `price: null`, nigdy „0 zł”. Sortowanie po cenie jest dostępne tylko przy włączonym przełączniku (inaczej `400 INVALID_QUERY`, `field: "sort"`).
- Zdjęcia: do DTO trafiają tylko `READY` z obydwoma wariantami (`large`, `thumb`); okładka karty i szczegółów to ta sama pozycja galerii (`isCover`, w razie braku pierwsza). Alt: `resolveImageAlt` (zapisany `NULL` → `<nazwa>, zdjęcie N` z aktualną nazwą i numerem w tej galerii; ręczny alt bez zmian), zob. [media](media-upload-processing.md).
- Kontakt nie zapisuje niczego: brak leadu, klienta, rezerwacji i blokady; trasa kontaktu ma tylko `GET` (inne metody to `405`). Wiadomość z pojazdem i terminem (FR-PUB-032) jest składana na serwerze jako domyślny tekst (`message.text`) i linki `tel:`, `https://wa.me/…`, `mailto:`; treść komunikatu może zmienić klient.

## API JSON (host publiczny, `GET`, `no-store`, `X-Robots-Tag: noindex, nofollow`)

| Ścieżka | Wynik 200 |
|---|---|
| `/api/public/offer/` | home: `offerState` `EMPTY` (zapowiedź) lub `HAS_VEHICLES`, firma, wyróżnione (patrz niżej), kontakt, `seo` |
| `/api/public/vehicles/` | katalog (poniżej) |
| `/api/public/vehicles/{slug}/` | `{kind:"FOUND", vehicle, availabilityNotice, contact, display, seo}`; stary slug (zapisany przez #153 przy zmianie sluga opublikowanego pojazdu) prowadzący do pojazdu `PUBLISHED` `308` z `Location: /api/public/vehicles/{nowy}/` (query zachowane) i `body.path` = ścieżka strony; nieznany/obcy/nieopublikowany `404 {code:"NOT_FOUND", offerPath:"/"}` |
| `/api/public/contact/?vehicle=&from=&to=` | kanały, godziny, adres, `message`, `seo` |
| `/api/public/legal/{privacy|terms}/` | `status` `TEXT`/`LINK`/`MISSING`, `text`, `url`, `updatedAt`, `seo` |

`updatedAt` (D-36, #325): chwila ostatniej zmiany **tekstu** tego dokumentu firmy jako ISO 8601 UTC (`"2026-11-10T14:46:32.441Z"`) albo `null` (brak tekstu, status `LINK`/`MISSING`, albo dokument sprzed #325, którego tekst nie był jeszcze zmieniany). Serwer zwraca instant; **konwersję na `LocalDate` w `Europe/Warsaw` do wiersza „Ostatnia aktualizacja” robi klient/SSR** (Frontend #232); przy `null` wiersz się nie pokazuje. Pole nie niesie żadnych danych prywatnych; ta sama wartość jest w podglądzie `/legal/{privacy|terms}/` (preview).

Błędy: `404 {code:"NOT_FOUND"}` (firma niepubliczna lub nieznany host; brak pojazdu dodaje `offerPath`, więc oba przypadki da się odróżnić tylko dla aktywnej firmy), `400 INVALID_QUERY|INVALID_CURSOR`, `422 PAST_DATE`, `429 RATE_LIMITED` + `Retry-After`, `503 TRUSTED_INGRESS_REQUIRED`, `500 INTERNAL_ERROR`. SSR wywołuje funkcje bezpośrednio i nie używa tych tras ani ich limitu.

## Wyróżnione pojazdy na home (#67, FR-PUB-002, D-22)

`featured` to najwyżej `featuredVehicleCount` (0–12, ustawienie firmy) pojazdów `PUBLISHED` z flagą `featured`, w kolejności firmy (`sortOrder`, potem `id`), z tą samą kartą co katalog. Pojazd ukryty, zarchiwizowany lub szkic nie jest wyróżniony, a kolejny wyróżniony zajmuje jego miejsce; ponowna publikacja przywraca go na właściwe miejsce. Odczyt nie jest cache'owany, więc zmiana flagi, statusu, kolejności lub liczby działa od następnego odczytu i dotyczy tylko firmy hosta. Fallback jest jawny: przy `featuredVehicleCount` 0, braku wyróżnionych lub `offerState` `EMPTY` lista `featured` jest pusta (`[]`), bez uzupełniania innymi pojazdami i bez danych zastępczych; pełna oferta pozostaje w katalogu, a UI (#68) ukrywa sekcję. Zmiana flagi lub kolejności w `PATCH` pojazdu zapisuje audyt `VEHICLE_UPDATED` z `featured`/`sortOrder` w `changedFields` oraz wartościami przed/po.

## Katalog: filtry, sortowanie, paginacja

Parametry (nieznane są ignorowane, powtórzony znany jest błędem): `category` (kod kategorii), `seats` (minimum 1–99), `transmission` (bez rozróżniania wielkości liter), `from` i `to` (oba albo żadne; `LocalDate`, końce włącznie, 1 dzień poprawny, 1–365 dni, początek nie wcześniej niż dzisiaj w `Europe/Warsaw`), `sort` (`recommended` domyślnie, `name`, `price_asc`, `price_desc`), `limit` (domyślnie 12, maksymalnie 50), `cursor`.

Odpowiedź: `state` `EMPTY_OFFER` (brak opublikowanych pojazdów, filtry nie udają wyników) | `NO_RESULTS` | `RESULTS`; `items`, `total`, `limit`, `nextCursor`, `applied`, `filters` (opcje: kategorie, skrzynie, zakres miejsc, dostępne sortowania), `display.showPrices`, `seo`. Z datami lista zawiera tylko pojazdy wolne przez cały zakres; pojedyncze niedostępne daje istniejące `/api/public/availability/*`.

Karta (`path`) nie niesie dat: klient (#42) dokleja `applied.from`/`applied.to` do linku (C-F092). Kursor jest nieprzejrzysty (klucz `k` musi mieć typ pola sortowania: liczba całkowita, tekst lub null, dziesiętny tekst lub null; inaczej `400 INVALID_CURSOR`), zbudowany na kluczu `(pole sortowania, id)` i związany z filtrami oraz sortowaniem (`INVALID_CURSOR` przy niezgodności). Kolejność jest całkowita (remisy rozstrzyga `id`), więc zmiany w trakcie przeglądania nie powielają pozycji; element przeniesiony przed kursor może zostać pominięty. Brak ceny sortuje się na końcu w obu kierunkach; zapisana cena `0` sortuje się jako najniższa (walidacja zapisu ceny należy do #28).

## SEO i indeksowanie

`seo` każdej odpowiedzi: `title`, `description`, `canonical`, `robots`, `openGraph`, `jsonLd`; `toNextMetadata(seo)` mapuje na `Metadata` Next 16 (`generateMetadata`), `serializeJsonLd` na `<script type="application/ld+json">`.

- Canonical: absolutny adres hosta + ścieżka z końcowym `/` (`/`, `/pojazdy/`, `/pojazdy/{slug}/`, `/kontakt/`, `/polityka-prywatnosci/`, `/regulamin/`). Host z `canonicalTarget` (alias) przekierowuje Proxy `307` na aktywną domenę własną z zachowaniem ścieżki i query; gdyby funkcja została wywołana dla aliasu, canonical wskazuje domenę własną, a przy nieaktywnym celu wynik to `null`. Schemat: `https`, a host z portem (lokalna fixture) `http`.
- Tytuł: jawny `seoTitle` (firmy na stronie głównej, pojazdu na jego stronie) bez zmian, inaczej `<strona> | <firma>`; opis: `seoDescription`/`shortDescription` skrócony do 160 znaków, z neutralnym zapasem. Pojazd: `seoTitle`/`seoDescription` pojazdu, potem opis krótki.
- Open Graph: `website`, `pl_PL`, obraz `large` (hero/logo albo zdjęcie główne) jako absolutny URL kontrolowanego odczytu mediów.
- Schema.org: strona główna i kontakt `AutoRental` (nazwa, URL, telefon, e-mail, adres, geo — tylko podane pola; bez godzin otwarcia z tekstu wolnego); pojazd `["Product","Car"]` (marka, model, rok, miejsca, drzwi, skrzynia, paliwo, napęd, kolor, kategoria, obrazy). **Bez `offers`**: cena nie ma walidowanej waluty ani semantyki „od”, a dostępność zależy od dat.
- Indeksowanie (zatwierdzone przez właściciela, D-25): `/pojazdy/` z jakimkolwiek filtrem, sortowaniem, kursorem lub `limit`, a także pusta oferta, ma `noindex, follow` i canonical na gołą listę; szczegóły z `?from=&to=` mają canonical bez dat; strona prawna bez tekstu (`LINK`/`MISSING`) jest `noindex`.
- `sitemap.xml`: strona główna, `/pojazdy/` (tylko gdy są pojazdy), każdy `PUBLISHED` pojazd (do 5000, `lastmod` z `updatedAt`), `/kontakt/`, strony prawne z tekstem; na kanonicznym originie hosta. `robots.txt` hosta publicznego: `Allow: /`, `Allow: /api/public/media/`, `Disallow: /api/`, `Sitemap:`. Obie trasy są `no-store` i działają tylko za bramką; wyłączona firma daje `404` na obu.
- Panele: `robots.txt` hosta `COMPANY_ADMIN` i `PLATFORM` to `Disallow: /`; Proxy dodaje `X-Robots-Tag: noindex, nofollow` do każdej odpowiedzi tych obszarów i do każdej trasy `/api/`, z jednym wyjątkiem: warianty mediów publicznych `GET|HEAD /api/public/media/{id}/{large|thumb}/` na hoście `COMPANY_PUBLIC` nie mają `X-Robots-Tag` (indeksowanie zdjęć, D-25). Wyłączona lub zarchiwizowana firma daje na nich `404` `no-store`; cache i limity mediów bez zmian. Wszystkie inne `/api/public/*` zostają `noindex, nofollow`. Podgląd pojazdu jest częścią panelu i ma oddzielny kontrakt: [chroniony preview #46](preview.md). Host `MARKETING` jest indeksowany (D-25, #154): `robots.txt` to `Allow: /`, `Disallow: /api/`, `Sitemap: <origin hosta marketingu>/sitemap.xml`, a `sitemap.xml` zawiera wyłącznie strony marketingowe istniejące jako trasy (dziś `/`; dokumenty Autervy dojdą razem z trasami), bez hostów, nazw i danych firm. Obie trasy są `no-store`, bez `X-Robots-Tag`, objęte budżetem `offerRead`; polityka tras hosta marketingu dopuszcza `/robots.txt` i `/sitemap.xml`.
- Strony SSR (#41–#44) ustawiają `robots` z `seo.robots`, a globalny 404 sprawdza `getPublicSiteState` (link do oferty tylko przy `ACTIVE`, C-F113). Kopie pobrane wcześniej przez przeglądarkę lub CDN nie są cofane (C-N033).

## Budżet ruchu publicznych wariantów mediów

**Zatwierdzone przez właściciela (D-25, 27.10.2026).** Warianty `GET /api/public/media/{id}/{large|thumb}/` mają własny klucz limitu `api:public:media:ip:<adres>` i budżet **600/min/IP** zamiast wspólnego 120/min z ustawieniami (galeria to do 30 zdjęć × 2 warianty przy `no-store`; 600 pokrywa około dziesięciu pełnych galerii na minutę zza jednego NAT). Pozostałe odczyty oferty mają `api:public:offer:ip` 120/min; dostępność nadal 60/min, ustawienia publiczne 120/min, limity prywatne i auth bez zmian. Wartości są w jednym miejscu (`src/modules/public-offer/config.ts`), z nadpisaniem `AUTERVA_PUBLIC_MEDIA_RATE_LIMIT` i `AUTERVA_PUBLIC_OFFER_RATE_LIMIT` (1–10 000; błędna wartość to wartość domyślna z jednym logiem, nie błąd odczytów); przekroczenie to `429 RATE_LIMITED` z `Retry-After`. Wartości i koszt licznika (okno ruchome czyta do `limit` zdarzeń na żądanie) potwierdza test obciążenia (#58/#62).

## Poza zakresem

Strony i komponenty (#41–#44), kalendarz i wynik dostępności w UI, zapis leadu (poza MVP), cache wyniku publicznego.

## Przekierowanie starego sluga (#153)

Wpis `SlugRedirect` wskazuje pojazd, więc stary slug z dowolnego ogniwa łańcucha trafia jednym skokiem na aktualny slug (strona: wynik `REDIRECT` z `path` `/pojazdy/{aktualny}/`, API: `308` z zachowanym query). Aktywny slug w dowolnym statusie ma pierwszeństwo przed wpisem (wpis jest usuwany przy zapisie sluga), a pojazd `DRAFT`, `UNPUBLISHED` lub `ARCHIVED` nie jest celem: odczyt daje `404`. Reguły zapisu: `fleet-crud-publication.md`.
