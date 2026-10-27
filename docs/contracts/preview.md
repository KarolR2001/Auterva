# Chroniony preview szkicu, pojazdu i oferty firmy — kontrakt #46

Źródła: PRD 3.1 (U3/U4, `ADM-08`), WYMAGANIA C-F016–018, C-F058, C-F099, C-N030, FR-ADM-034. Moduł: `src/modules/preview/`. UI `ADM-08` należy do Frontendu; ten kontrakt dostarcza trasy, DTO i testy. Preview jest **oddzielny** od publicznej oferty ([#40](public-offer-seo.md)): nie przechodzi centralnej bramki publicznej, nie ma publicznego adresu i niczego nie zmienia.

## Kto i na jakich warunkach

- Administrator firmy na własnym hoście `COMPANY_ADMIN` (`/api/admin/preview/…`) albo superadmin na hoście `PLATFORM` w jawnie wybranej firmie (`/api/platform/companies/{organizationId}/preview/…`), pod własną tożsamością, bez impersonacji i bez globalnej listy. Obie ścieżki przechodzą ten sam `actor()` co flota: host zgodny z obszarem, pełna sesja z MFA, rola, firma, stan konta (wyłączone konto, archiwizacja admina), osobny budżet odczytu. Dopiero potem następuje odczyt danych firmy.
- Preview **nie** wywołuje `resolvePublicVisibility`: działa po końcu okresu usługi (C-F058, C-F099). Nie ma bramki okresu, więc nie ma też zależności od `paidThrough`/trialu.
- Host `COMPANY_PUBLIC` i `MARKETING` nie obsługują tych tras (404 z polityki hostów); sesja admina nie jest czytana nigdzie w publicznych odczytach.
- Odmowa: brak sesji, obca sesja, zła rola lub host → `403 {code:"FORBIDDEN"}`; nieprawidłowy `organizationId`/`id` → `400 INVALID_ID`; rekord obcej firmy, zarchiwizowany pojazd, nieistniejący zasób lub zły wariant → `404 NOT_FOUND` (nie do odróżnienia od braku); `429 RATE_LIMITED` + `Retry-After`; `500 INTERNAL_ERROR`. Odmowy nie zawierają danych firmy.

## Nagłówki (każda odpowiedź, także odmowa)

`Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`, `Vary: Cookie`, `X-Request-Id`. Preview nie ma `canonical`, Open Graph ani JSON-LD, nie występuje w `sitemap.xml` ani `robots.txt` (panele: `Disallow: /`), a trasy `/api/` dostają dodatkowo noindex z Proxy. Dozwolona jest tylko metoda `GET`; zapisy preview nie istnieją.

## Trasy (`GET`)

Poniżej `{base}` to `/api/admin/preview` albo `/api/platform/companies/{organizationId}/preview`.

| Trasa | Wynik |
| --- | --- |
| `{base}/` | strona główna firmy: ten sam kształt co `/api/public/offer/` bez `seo`, plus `preview.mode = "OFFER"` |
| `{base}/vehicles/` | katalog tego, co zobaczy publiczność (wyłącznie `PUBLISHED`), z tymi samymi filtrami, sortowaniem i kursorem co `/api/public/vehicles/`, bez `seo`; błędy zapytania `400 INVALID_QUERY\|INVALID_CURSOR`, `422 PAST_DATE` |
| `{base}/vehicles/{id}/` | pojazd po **id** (świeży szkic nie ma jeszcze sluga): `DRAFT`, `UNPUBLISHED` albo `PUBLISHED` |
| `{base}/contact/?vehicle=&from=&to=` | kanały kontaktu i domyślna wiadomość; `vehicle` (slug) może wskazywać także niepublikowany pojazd |
| `{base}/legal/{privacy\|terms}/` | treść prawna firmy (`TEXT`/`LINK`/`MISSING`) |
| `{base}/media/{mediaId}/{large\|thumb}/` | bajty `image/webp` zdjęcia pojazdu (`READY`, pojazd nie `ARCHIVED`, dowolny status publikacji) albo gotowego logo/hero/brand firmy |

### Pojazd: DTO

`{ preview: { mode: "VEHICLE", vehicle: { id, status, version, public } }, kind: "FOUND", vehicle, availabilityNotice, contact, display }`. `vehicle` to publiczna projekcja szczegółów (nazwa, opisy, parametry, `price` zgodnie z przełącznikiem firmy, wyposażenie, `cover`, `gallery`), z dwiema różnicami: `slug` i `path` mogą być `null` (szkic bez sluga) i adresy zdjęć wskazują trasę `{base}/media/…`, nigdy `/api/public/media/`. `public` jest `true` tylko dla `PUBLISHED` (podstawa banera „Tryb podglądu — pojazd nie jest publiczny”). Do galerii trafiają tylko zdjęcia `READY` z obydwoma wariantami; alt liczy `resolveImageAlt` jak w ofercie. Archiwizowany pojazd i pojazd innej firmy to `404`.

### DTO: czego nie ma

Allowlista jest wspólna z publiczną ([#40](public-offer-seo.md)): brak `internalNote`, `reference`, typu i technicznych danych blokad (blokady nie są w ogóle czytane), `operatorNote`, kluczy storage, `variants`, `organizationId`, danych okresu usługi i czatu. Dostępność pojazdu w preview to osobny prywatny kalendarz (`/api/admin/vehicles/{id}/availability/`, `/api/platform/companies/{organizationId}/vehicles/{id}/availability/`), a nie część preview.

## Zasoby (zdjęcia, logo)

Adres z DTO jest chroniony tak samo jak strona: bez sesji, z sesją obcego admina, z hosta publicznego albo z obcego `organizationId` odpowiedź nie zawiera bajtów (`403`/`404`, bez `image/webp`). Skopiowany adres z cudzego kontekstu nie omija więc ukrycia pojazdu ani wygaśnięcia firmy: publiczna trasa `/api/public/media/…` nadal serwuje wyłącznie `READY` zdjęcia `PUBLISHED` pojazdów firmy przechodzącej bramkę. Storage nigdy nie jest adresowany przez przeglądarkę; bajty płyną przez aplikację z `Cache-Control: private, no-store`.

## Zapisy zagnieżdżone superadmina (audyt adapterów)

Zapisy floty, zdjęć, blokad i ustawień w `/api/platform/companies/{organizationId}/…` i `/api/admin/…` to cienkie adaptery tego samego use case (`createVehicle`, `editVehicle`, `setVehicleStatus`, `reorderVehicles`, mutacje zdjęć i blokad, `updateCompanySettings`): te same walidacje Zod, ograniczenia, wersje i konflikty (`FLEET_VERSION_CONFLICT`, `BLOCK_OVERLAP`, `MEDIA_VERSION_CONFLICT`, `SETTINGS_VERSION_CONFLICT`), te same blokady wiersza `Organization` → `Vehicle` i ten sam audyt z rzeczywistym aktorem (`actorId`, `actorRole`) oraz `organizationId` wybranej firmy; `requireAuditActor`/`requireAuditScope` powtarzają sprawdzenie sesji, MFA i firmy wewnątrz transakcji. Ustawienia zapisuje tylko superadmin (D-01); admin dostaje odczyt i odmowę zapisu.

Znaleziona i naprawiona rozbieżność: prywatny kalendarz dostępności (`privateCalendar`) liczył budżet odczytu superadmina per odwiedzana firma (`api:read:{actor}:{organizationId}`), a pozostałe adaptery wspólnym kluczem `platform`. Teraz wszystkie odczyty chronione superadmina mają jeden klucz `api:read:{actor}:platform`, więc przełączanie firm nie zeruje budżetu.

## Decyzje do potwierdzenia (needs:decision)

1. **Zakres preview oferty**: katalog i strona główna pokazują wyłącznie to, co zobaczyłaby publiczność (`PUBLISHED`); szkice i ukryte pojazdy są widoczne tylko w widoku pojedynczego pojazdu po id. Inny wariant (lista wszystkich niezarchiwizowanych w katalogu preview) wymaga decyzji produktowej.
2. **Archiwalny pojazd** nie ma preview (`404`), bo wypada z oferty. Podgląd archiwum wymaga decyzji.
3. **Preview bez `seo`**: brak podglądu snippetu SEO; `OVR-20`/`ADM-13` korzysta z danych ustawień, nie z preview.
4. **Zarchiwizowana firma**: admin traci sesję (blokada logowania), superadmin nadal czyta preview (odczyt, jak reszta odczytów platformy).

## Testy

`tests/integration/preview.test.ts` (PostgreSQL, firmy A/B, admin A, admin B, superadmin, anonim): wygasła firma + szkic + superadmin; brak SEO i pól prywatnych; izolacja stron i zasobów; publiczna trasa mediów nie serwuje szkicu; brak zmiany rekordów, wersji i sitemap; równoległe PATCH pojazdu i POST blokady z dwóch paneli (jeden wygrywa, drugi dostaje konflikt, audyt wskazuje właściwego aktora i firmę); jeden budżet odczytu kalendarza superadmina. `tests/e2e/preview.spec.ts`: zimne żądania HTTP z zasobem po skopiowaniu adresu.

## Poza zakresem

UI `ADM-08` i baner, zapisy z preview, link publiczny lub tokenowy, preview hosta `MARKETING`, preview zarchiwizowanych pojazdów, kalendarz w preview.
