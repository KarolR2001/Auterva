# Publiczna oferta firmy, filtrowanie i SEO — kontrakt #40

Warstwa serwerowa dla stron #41–#44 oraz publiczne API JSON. Moduł: `src/modules/public-offer/`. Strony React/SSR i komponenty należą do Frontendu; ten kontrakt dostarcza funkcje, DTO, trasy metadanych i testy. Obowiązują [okres usługi](service-period-runtime.md), [odczyty dostępności](availability-reads.md), [publikacja pojazdów](company-settings-and-vehicle-publication.md), [media](media-upload-processing.md) i [domeny](custom-domain-lifecycle.md).

## Zasady wspólne

- Każda funkcja odczytu (`getPublicHome`, `listPublicVehicles`, `getPublicVehicle`, `getPublicContact`, `getPublicLegal`, `getPublicSiteState`) oraz trasy `robots.txt` i `sitemap.xml` wywołuje `resolvePublicVisibility` przy każdym wywołaniu, zanim odczyta dane firmy. Wynik pozytywny nie jest przechowywany. `null` oznacza „firma niepubliczna”: koniec okresu, archiwum, blokada po przywróceniu, nieznany host, host panelu, alias bez aktywnej domeny własnej. Wyłączenie ma pierwszeństwo nad 404 pojazdu i nad SEO; błąd nie ujawnia powodu (C-N057).
- Wyłącznie `PUBLISHED`. Zapytania zawsze zawierają `organizationId` hosta; sesja administratora nie jest nigdzie czytana (C-N030). Allowlista kolumn: brak `status`, `version`, `organizationId`, `sortOrder` (poza kolejnością), `internalNote`, `reference`, typu/źródła blokady, `operatorNote`, kluczy storage, danych okresu usługi i czatu. Dostępność: tylko filtr „dostępny w całym zakresie” (ten sam predykat `availabilityVehicleWhere(…, publishedOnly)` przed `count`, sortowaniem i paginacją) oraz istniejące API dostępności.
- Opisy i treści prawne to niezaufany tekst: DTO zwraca tekst, renderer escapuje (React domyślnie); HTML wymaga osobnej sanitizacji i testów. JSON-LD serializuje `serializeJsonLd` (escape `<`, `>`, `&`, U+2028/9).
- Brak ceny, cena `0` albo wyłączony przełącznik firmy (`showPrices`) = `price: null`, nigdy „0 zł”. Sortowanie po cenie jest dostępne tylko przy włączonym przełączniku (inaczej `400 INVALID_QUERY`, `field: "sort"`).
- Zdjęcia: do DTO trafiają tylko `READY` z obydwoma wariantami (`large`, `thumb`). Alt jest liczony przy odczycie: pusty albo wygenerowany domyślny (`<nazwa>, zdjęcie N`, `Zdjęcie pojazdu N`) wraca przez `defaultImageAlt` z aktualną nazwą i pozycją; alt wpisany przez edytora zostaje (wymaganie CR #32). Ograniczenie: ręczny alt o dokładnie takim samym kształcie jak domyślny jest także przeliczany. Przed produkcją rozstrzygnąć, czy worker ma zapisywać `null`.
- Kontakt nie zapisuje niczego: brak leadu, klienta, rezerwacji i blokady; trasa kontaktu ma tylko `GET` (inne metody to `405`). Wiadomość z pojazdem i terminem (FR-PUB-032) jest składana na serwerze jako domyślny tekst (`message.text`) i linki `tel:`, `https://wa.me/…`, `mailto:`; treść komunikatu może zmienić klient.

## API JSON (host publiczny, `GET`, `no-store`, `X-Robots-Tag: noindex, nofollow`)

| Ścieżka | Wynik 200 |
|---|---|
| `/api/public/offer/` | home: `offerState` `EMPTY` (zapowiedź) lub `HAS_VEHICLES`, firma, wyróżnione (`featuredVehicleCount`), kontakt, `seo` |
| `/api/public/vehicles/` | katalog (poniżej) |
| `/api/public/vehicles/{slug}/` | `{kind:"FOUND", vehicle, availabilityNotice, contact, display, seo}`; stary slug opublikowanego pojazdu `308` + `Location`; nieznany/obcy/nieopublikowany `404 {code:"NOT_FOUND", offerPath:"/"}` |
| `/api/public/contact/?vehicle=&from=&to=` | kanały, godziny, adres, `message`, `seo` |
| `/api/public/legal/{privacy|terms}/` | `status` `TEXT`/`LINK`/`MISSING`, `text`, `url`, `seo` |

Błędy: `404 NOT_FOUND` (firma niepubliczna, ten sam kształt co brak zasobu), `400 INVALID_QUERY|INVALID_CURSOR`, `422 PAST_DATE`, `429 RATE_LIMITED` + `Retry-After`, `503 TRUSTED_INGRESS_REQUIRED`, `500 INTERNAL_ERROR`. SSR wywołuje funkcje bezpośrednio i nie używa tych tras ani ich limitu.

## Katalog: filtry, sortowanie, paginacja

Parametry (nieznane są ignorowane, powtórzony znany jest błędem): `category` (kod kategorii), `seats` (minimum 1–99), `transmission` (bez rozróżniania wielkości liter), `from` i `to` (oba albo żadne; `LocalDate`, końce włącznie, 1 dzień poprawny, 1–365 dni, początek nie wcześniej niż dzisiaj w `Europe/Warsaw`), `sort` (`recommended` domyślnie, `name`, `price_asc`, `price_desc`), `limit` (domyślnie 12, maksymalnie 50), `cursor`.

Odpowiedź: `state` `EMPTY_OFFER` (brak opublikowanych pojazdów, filtry nie udają wyników) | `NO_RESULTS` | `RESULTS`; `items`, `total`, `limit`, `nextCursor`, `applied`, `filters` (opcje: kategorie, skrzynie, zakres miejsc, dostępne sortowania), `display.showPrices`, `seo`. Z datami lista zawiera tylko pojazdy wolne przez cały zakres; pojedyncze niedostępne daje istniejące `/api/public/availability/*`.

Kursor jest nieprzejrzysty, zbudowany na kluczu `(pole sortowania, id)` i związany z filtrami oraz sortowaniem (`INVALID_CURSOR` przy niezgodności). Kolejność jest całkowita (remisy rozstrzyga `id`), więc zmiany w trakcie przeglądania nie powielają pozycji; element przeniesiony przed kursor może zostać pominięty. Brak ceny sortuje się na końcu w obu kierunkach; zapisana cena `0` sortuje się jako najniższa (walidacja zapisu ceny należy do #28).

## SEO i indeksowanie

`seo` każdej odpowiedzi: `title`, `description`, `canonical`, `robots`, `openGraph`, `jsonLd`; `toNextMetadata(seo)` mapuje na `Metadata` Next 16 (`generateMetadata`), `serializeJsonLd` na `<script type="application/ld+json">`.

- Canonical: absolutny adres hosta + ścieżka z końcowym `/` (`/`, `/pojazdy/`, `/pojazdy/{slug}/`, `/kontakt/`, `/polityka-prywatnosci/`, `/regulamin/`). Host z `canonicalTarget` (alias) przekierowuje Proxy `307` na aktywną domenę własną z zachowaniem ścieżki i query; gdyby funkcja została wywołana dla aliasu, canonical wskazuje domenę własną, a przy nieaktywnym celu wynik to `null`. Schemat: `https`, a host z portem (lokalna fixture) `http`.
- Tytuł: `seoTitle` firmy (strona główna) lub `<strona> | <firma>`; opis: `seoDescription`/`shortDescription` skrócony do 160 znaków, z neutralnym zapasem. Pojazd: `seoTitle`/`seoDescription` pojazdu, potem opis krótki.
- Open Graph: `website`, `pl_PL`, obraz `large` (hero/logo albo zdjęcie główne) jako absolutny URL kontrolowanego odczytu mediów.
- Schema.org: strona główna i kontakt `AutoRental` (nazwa, URL, telefon, e-mail, adres, geo — tylko podane pola; bez godzin otwarcia z tekstu wolnego); pojazd `["Product","Car"]` (marka, model, rok, miejsca, drzwi, skrzynia, paliwo, napęd, kolor, kategoria, obrazy). **Bez `offers`**: cena nie ma walidowanej waluty ani semantyki „od”, a dostępność zależy od dat.
- Indeksowanie (domyślna polityka, do potwierdzenia przez właściciela): `/pojazdy/` z jakimkolwiek filtrem, sortowaniem, kursorem lub `limit`, a także pusta oferta, ma `noindex, follow` i canonical na gołą listę; szczegóły z `?from=&to=` mają canonical bez dat; strona prawna bez tekstu (`LINK`/`MISSING`) jest `noindex`.
- `sitemap.xml`: strona główna, `/pojazdy/` (tylko gdy są pojazdy), każdy `PUBLISHED` pojazd (do 5000, `lastmod` z `updatedAt`), `/kontakt/`, strony prawne z tekstem; na kanonicznym originie hosta. `robots.txt` hosta publicznego: `Allow: /`, `Allow: /api/public/media/`, `Disallow: /api/`, `Sitemap:`. Obie trasy są `no-store` i działają tylko za bramką; wyłączona firma daje `404` na obu.
- Panele: `robots.txt` hosta `COMPANY_ADMIN` i `PLATFORM` to `Disallow: /`; Proxy dodaje `X-Robots-Tag: noindex, nofollow` do każdej odpowiedzi tych obszarów i do każdej trasy `/api/`. Podgląd pojazdu jest częścią panelu. Hosty `MARKETING` nie mają `robots.txt`/sitemap w tym zadaniu.
- Strony SSR (#41–#44) ustawiają `robots` z `seo.robots`, a globalny 404 sprawdza `getPublicSiteState` (link do oferty tylko przy `ACTIVE`, C-F113). Oś czasu: kopie w cache CDN/przeglądarki pobrane wcześniej nie są cofane (C-N033).

## Budżet ruchu publicznych wariantów mediów

**Decyzja orkiestratora do potwierdzenia przez właściciela.** Warianty `GET /api/public/media/{id}/{large|thumb}/` mają własny klucz limitu `api:public:media:ip:<adres>` i budżet **600/min/IP** zamiast wspólnego 120/min z ustawieniami (galeria to do 30 zdjęć × 2 warianty przy `no-store`; 600 pokrywa około dziesięciu pełnych galerii na minutę zza jednego NAT). Pozostałe odczyty oferty mają `api:public:offer:ip` 120/min; dostępność nadal 60/min, ustawienia publiczne 120/min, limity prywatne i auth bez zmian. Wartości są w jednym miejscu (`src/modules/public-offer/config.ts`), z nadpisaniem `AUTERVA_PUBLIC_MEDIA_RATE_LIMIT` i `AUTERVA_PUBLIC_OFFER_RATE_LIMIT` (1–10 000); przekroczenie to `429 RATE_LIMITED` z `Retry-After`. Wartości i koszt licznika (okno ruchome czyta do `limit` zdarzeń na żądanie) potwierdza test obciążenia (#58/#62).

## Poza zakresem

Strony i komponenty (#41–#44), kalendarz i wynik dostępności w UI, zapis leadu (poza MVP), cache wyniku publicznego, indeksowanie hosta `MARKETING`.
