# Flota firmy: odczyt, zapis, publikacja i kolejność (#28)

Źródła: PRD 3.1 U3/U4, WYMAGANIA C-F095–097 i FR-ADM-020–032, [D-02](company-settings-and-vehicle-publication.md), [dostępność #33](availability-reads.md). Ten kontrakt opisuje implementowane wejścia serwerowe; UI i rzeczywisty upload należą do odrębnych issue.

## Wejścia i uprawnienia

Te same use case obsługują admina firmy na aktywnym hoście `COMPANY_ADMIN` oraz superadmina na hoście `PLATFORM` w jawnie wybranej firmie:

| Panel firmy | Platforma | Metoda |
| --- | --- | --- |
| `/api/admin/vehicles` | `/api/platform/companies/{organizationId}/vehicles` | GET lista, POST szkic |
| `/api/admin/vehicles/{id}` | `/api/platform/companies/{organizationId}/vehicles/{id}` | GET szczegóły, PATCH pola |
| `/api/admin/vehicles/{id}/{publish\|unpublish\|archive}` | `/api/platform/companies/{organizationId}/vehicles/{id}/{publish\|unpublish\|archive}` | POST status |
| `/api/admin/vehicles/reorder` | `/api/platform/companies/{organizationId}/vehicles/reorder` | POST kolejność |

Każde wejście sprawdza host, pełną sesję MFA, rolę i firmę. Zapisy wymagają zgodnego Origin; odpowiedzi mają `Cache-Control: no-store` i serwerowy `X-Request-Id`. Nie ma zapisu na hoście publicznym. Po zwykłym wygaśnięciu okresu panel i zapis pozostają dostępne, lecz centralna bramka nadal odmawia publicznego odczytu. Archiwizacja firmy blokuje sesję i zapis administratora; superadmin w jej kontekście nadal zapisuje flotę i zdjęcia (D-23, #151: tworzenie, edycja, status, kolejność; publikacja zmienia status, ale strona publiczna pozostaje wyłączona), a audyt niesie `context: "ARCHIVED_COMPANY"` ([archiwizacja](company-archive-restore.md)). ID obcej firmy lub pojazdu zwraca kontrolowaną odmowę bez ujawniania rekordu.

`GET` lista: `search`, `status`, `categoryId`, `activeToday`, `availableToday`, `page` (od 1), `pageSize` (1–100). Dziś oznacza lokalną datę Europe/Warsaw. Wyszukiwanie obejmuje nazwę, markę, model, wariant i slug. Wspólny predykat `availabilityVehicleWhere` (#33) jest stosowany przed `count` i paginacją; oba odczyty korzystają z jednego snapshotu. Sortowanie jest stabilne: `sortOrder ASC, id ASC`. Miniatura to ID/alt gotowego cover; DTO listy nie zawiera powodu ani technicznych danych blokady. `GET` szczegóły zwraca prywatne pola auta, wyposażenie oraz metadane zdjęć bez klucza storage.

## Zapis

`POST` tworzy wyłącznie `DRAFT`; `fields` może być niekompletne, ale ma ścisłą allowlistę typów i zakresów. `PATCH` przyjmuje `expectedVersion`, `fields` oraz `confirmSlugChange` przy zmianie slugu opublikowanego auta. Slug jest normalizowany do małych liter i unikalny w firmie; zmiana opublikowanego slugu wymaga świadomego potwierdzenia. Przekierowania starych slugów opisuje sekcja „Przekierowanie starego slugu” (#153, D-27); publiczna oferta należy do #40. Wyposażenie w `fields.features` jest zastępowane atomowo. Cena jest decimal string albo `null`, nigdy automatyczne zero. Tekst pól (#176): wspólna polityka `src/lib/text-policy.ts`; NUL i pozostałe znaki sterujące dają `400 INVALID_INPUT`, zanim cokolwiek trafi do bazy. Opis i krótki opis (`description`, `shortDescription`) dopuszczają TAB, LF i CR, pozostałe pola tekstowe oraz kod cechy są jednowierszowe.

Gdy przy tworzeniu podano nazwę, lecz pominięto slug, serwer generuje go z nazwy; jawny slug ma pierwszeństwo, a zmiana samej nazwy istniejącego auta nie zmienia slugu. Pusty szkic może mieć `slug=null`. `fuel` (rodzaj paliwa) i `drive` (napęd) to odrębne opcjonalne pola, zgodnie z FR-ADM-030 i bazową definicją floty; addytywna kolumna `fuel` nie ma backfillu ani wartości domyślnej.

`description` jest niezaufanym tekstem/Markdown. Walidacja publikacji traktuje pusty markup jako pustą treść, lecz sam zapis nie nadaje HTML uprawnień do renderowania. Konsument publiczny #40 musi renderować tekst bez wykonywania surowego HTML albo użyć rygorystycznej sanitacji zgodnej z bazowym kontraktem §bezpieczeństwo.

`POST .../publish|unpublish|archive` przyjmuje `expectedVersion`. Publikacja ponownie sprawdza aktualny zapis, kategorię, daty i gotowy cover według D-02; brak wymagań daje `409 PUBLISHING_REQUIREMENTS_NOT_MET` z `fieldErrors` i pozostawia poprzedni stan. Zmiana opublikowanego auta, która usunęłaby wymagane pole, także cofa się w całości. `UNPUBLISHED` i `ARCHIVED` usuwają publiczną widoczność bez kasowania danych, blokad lub audytu. `ARCHIVED` nie jest cicho przywracany przez PATCH. Wcześniejsze `HIDDEN` z zasiedlonej bazy migrują do `UNPUBLISHED`; historyczny audyt `VEHICLE_HIDDEN` i jego starszy snapshot pozostają czytelne.

`POST .../reorder` przyjmuje `items: [{ id, expectedVersion, sortOrder }]` (1–100). Wszystkie ID są unikalne i należą do jednej firmy; jakikolwiek konflikt wersji wycofuje całą partię. Każda zmieniona pozycja zwiększa wersję i zapisuje audyt. Wszystkie mutacje blokują najpierw firmę, potem wiersze pojazdów według ID; przyszły konsument zdjęć #32 i blokad #38 musi blokować ten sam wiersz `Vehicle` przed zmianą zależnych danych. Aktualna edycja aktywności pod tą blokadą odmawia zakresu, który pozostawiłby istniejącą blokadę poza aktywnością. Obie role korzystają z tej samej atomowej operacji i rzeczywistego aktora w audycie.

Kontrolowany test na dwóch połączeniach PostgreSQL dowodzi obu kolejności: gdy pisarz bloku trzyma `Vehicle FOR UPDATE`, edycja #28 czeka, następnie widzi dopisany blok i odmawia niespójnego zakresu; gdy edycja #28 trzyma blokadę, pisarz bloku czeka i po jej zwolnieniu odczytuje nową aktywność. Druga połowa jest protokołem przyszłego #38 na fixture, a nie testem gotowego API blokad; jego mutator musi ponownie sprawdzać zakres po zdobyciu blokady.

## Dane i rollout

Migracja dodaje `Vehicle.updatedAt TIMESTAMPTZ`, konwertuje bieżące `HIDDEN` na `UNPUBLISHED` i wprowadza CHECK czterech statusów. `updatedAt` jest datą ostatniej zmiany w nowych operacjach; backfill bierze najnowszy audyt przypisany do **tego pojazdu i tej firmy**. Gdy brak takiego wpisu, wartość to czas migracji, techniczny punkt odniesienia, a nie deklarowana data historycznej edycji. Migrować po backupie i sprawdzić także zasiedloną bazę; bez przepisywania historii audytu. Nie jest to procedura produkcyjnego wdrożenia.

API nie implementuje uploadu (#29/#32), mutacji blokad (#38), publicznej strony oferty (#40), ani schedulera. Kontrolowany `VehicleImage READY` w testach dowodzi reguły publikacji, nie rzeczywistego przetwarzania pliku.

## Zdjęcia pojazdu (#32)

Mutacje zdjęć (`PATCH/DELETE .../images/{imageId}/`, `PUT .../images/order/`) blokują wiersz `Vehicle` tym samym protokołem co publikacja i edycja (Organization → Vehicle), więc publikacja widzi stan zdjęć po zatwierdzeniu równoległej zmiany i odwrotnie. Usunięcie jedynego cover opublikowanego pojazdu zwraca `409 MEDIA_COVER_REQUIRED`, a usunięcie cover opublikowanego pojazdu bez `replacementCoverId` `409 MEDIA_COVER_REPLACEMENT_REQUIRED`; wersja zdjęcia konfliktuje jako `409 MEDIA_VERSION_CONFLICT`. Szczegóły pojazdu zwracają tylko zdjęcia niewykasowane, z `version`, wymiarami i adresami preview. Zdjęcie z `alt = NULL` (domyślnie dla nowych) dostaje w odpowiedziach domyślny alt z aktualnej nazwy pojazdu i numeru w galerii (`resolveImageAlt`, #40), ręczny alt bez zmian, a `replacementCoverId` bez zastosowania daje `422 MEDIA_REPLACEMENT_INVALID`. Pełny opis, decyzje cache i optymalizatora: [media-upload-processing.md](media-upload-processing.md).

## Przekierowanie starego slugu (#153, D-27)

- **Kiedy zapis.** `PATCH` zmieniający slug pojazdu `PUBLISHED` (z `confirmSlugChange`) albo ukrytego `UNPUBLISHED` (bez potwierdzenia) zapisuje w tej samej transakcji `SlugRedirect(organizationId, oldSlug=stary, vehicleId)` (upsert po `(organizationId, oldSlug)`), poza walidacją publikacji. Ukryty pojazd był opublikowany, więc zachowuje stary adres na czas ponownej publikacji: do tego czasu odczyt daje `404`, potem `308`. Zmiana sluga szkicu (`DRAFT`, nigdy nieopublikowanego) nie zapisuje przekierowania. Audyt to zwykły wpis `VEHICLE_UPDATED`, w którego `changedFields` jest `slug` (bez wartości slugu).
- **Łańcuch.** Przekierowanie wskazuje pojazd, nie slug. Po A→B→C wpisy A i B wskazują ten sam pojazd, więc odczyt A i B kończy się jednym skokiem na C; pętla ani rozgałęzienie nie są możliwe.
- **Pierwszeństwo aktywnego sluga.** Gdy slug staje się aktywny (zmiana sluga dowolnego pojazdu firmy, w tym powrót do starego sluga, albo `POST` nowego pojazdu, także szkicu), wpis `SlugRedirect` o tym `oldSlug` jest usuwany w tej samej transakcji. Dlatego żaden aktywny slug firmy nie jest jednocześnie starym adresem przekierowania.
- **Współbieżność.** Każda mutacja floty blokuje wiersz firmy (`authorizedCompany`), więc zapisy slugów jednej firmy są szeregowane. Test trzyma blokadę wiersza firmy na osobnym połączeniu, ustawia operacje w kolejce w ustalonej kolejności (`pg_stat_activity`, `wait_event_type='Lock'`) i zwalnia blokadę: obie kolejności zmiany sluga vs zmiana sluga oraz zmiany vs `POST` dają deterministyczny wynik. Druga zmiana na ten sam slug kończy się `FLEET_SLUG_CONFLICT` (bez zmiany wersji i bez przekierowania); `POST` po zmianie zajmuje slug i usuwa wpis, a `POST` przed zmianą daje konflikt.
- **Odczyt.** Przekierowanie jest używane tylko dla pojazdu `PUBLISHED`; `UNPUBLISHED` i `ARCHIVED` dają `404` (zob. `public-offer-seo.md`). Izolacja: unikalność `(organizationId, oldSlug)` i złożone FK; przekierowania firmy A nie istnieją dla B. Migracja nie była potrzebna.
