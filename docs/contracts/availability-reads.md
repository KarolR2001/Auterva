# Odczyty dostępności — #33

Zakresy `from`–`to` są datami `YYYY-MM-DD` bez strefy klienta, z oboma końcami włącznie i długością 1–365 dni. Dzisiaj oznacza datę w `Europe/Warsaw`. Cały termin jest dostępny tylko wtedy, gdy mieści się w aktywności pojazdu i nie przecina żadnej blokady; puste `availableTo` oznacza otwarty koniec. Kalendarz ocenia każdy dzień osobno. SQL DATE nie służy jako chwila UTC ani lokalna północ przeglądarki.

Publiczny host firmy udostępnia:

- `POST /api/public/availability/check` z JSON `{slug,from,to}` → `{available:boolean}`;
- `GET /api/public/vehicles/[slug]/calendar?from=...&to=...` → `{days:[{date,available}]}`;
- `POST /api/public/availability/batch` z JSON `{slugs,from,to}` → `{results:[{slug,available}]}` w kolejności wejścia. Batch przyjmuje 1–50 różnych slugów; duplikat lub przekroczenie limitu to `400`, bez cichego obcinania. Nieznane, obce i nieopublikowane slugi są pomijane.

Zły format daje `400`; poprawny zakres zaczynający się przed dzisiaj daje `422`; niepubliczny host, firma po końcu okresu, firma archiwalna albo ukryty/obcy/nieistniejący pojedynczy pojazd dają `404`. Niedostępność aktywnego opublikowanego pojazdu daje tylko `available:false`, bez przyczyny. Publiczny kalendarz nie zwraca dat historycznych. Wszystkie trzy publiczne wejścia dzielą ruchome 60/min na zaufany adres klienta z ingress. Nagłówki klienta nie są źródłem IP. Odpowiedzi mają `no-store`; każdy odczyt ponownie sprawdza host, okres i bieżące rekordy.

Prywatne `GET /api/admin/vehicles/[id]/availability` działa dla pełnej sesji MFA administratora własnej firmy, a `GET /api/platform/companies/[organizationId]/vehicles/[id]/availability` dla pełnej sesji superadmina w jawnie wybranej firmie. Oba przyjmują `from`/`to` i zwracają historię, dzienne stany oraz własne blokady z typem, źródłem, reference i notatką. Obca firma/pojazd nie trafia do odpowiedzi. Odczyty podlegają wspólnemu limitowi 120/min na aktora i firmę. Zwykłe wygaśnięcie okresu nie zamyka panelu; archiwizacja nadal odmawia adminowi firmy.

`availabilityVehicleWhere(organizationId, range)` jest wspólnym predykatem dla filtra bieżącej dostępności w #28: `availableFrom <= from`, `availableTo >= to` lub otwarty koniec, oraz brak blokady z `block.from <= to && block.to >= from`. Lista #28 stosuje go do pełnego zbioru przed `count`, sortowaniem i paginacją. `findPrivateAvailability` służy do projekcji najwyżej 100 podanych identyfikatorów; ten limit nie ogranicza predykatu listy. #33 nie tworzy mutacji blokad ani pojazdów; przyszłe zapisy #28/#38 muszą zachować wspólną regułę i kontrolę aktualności po commit.
