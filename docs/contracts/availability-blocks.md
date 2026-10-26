# Ręczne blokady dostępności — kontrakt #38

Źródła: FR-ADM-050–056/058, C-F100–105, D-15, [odczyty #33](availability-reads.md), [flota #28](fleet-crud-publication.md), [audyt #16](audit-append-and-access.md).

## Wejścia

Te same use case obsługują admina firmy (host `COMPANY_ADMIN`) i superadmina (host `PLATFORM`, jawna firma): `POST .../vehicles/{id}/blocks` (`{fields:{from,to,type,reference?,internalNote?}}`, 201), `PATCH .../blocks/{blockId}` (`{expectedVersion,fields}`), `DELETE .../blocks/{blockId}` (`{expectedVersion}`), z prefiksem `/api/admin` albo `/api/platform/companies/{organizationId}`. Wymagane: host, pełna sesja MFA, rola, zgodny `Origin`, limit zapisów; odpowiedzi `no-store` z `X-Request-Id`. Odczyt prywatny zostaje w `GET .../availability` i zwraca także `typeLabel` ("Serwis" dla `MAINTENANCE`).

Typy: `RESERVED`, `MAINTENANCE` ("Serwis"), `BLOCKED`, `OTHER`; źródło zawsze `MANUAL`. `reference` ≤ 120, `internalNote` ≤ 2000 znaków, puste → `NULL`. Daty to LocalDate włącznie, `from <= to` (jeden dzień poprawny); przeszłe daty w aktywności są dozwolone jako historia.

## Współbieżność

Transakcja: aktor → blokada `Organization` → `Vehicle FOR UPDATE` (ta sama kolejność co #28) → **dopiero potem** odczyt aktywności i blokad, kontrola kolizji, zapis i audyt (`BLOCK_CREATED/UPDATED/DELETED`, tylko daty i wersja). Dzięki temu edycja aktywności #28 i zapis blokady wzajemnie się szeregują i obie kolejności kończą się spójnie: po zakończeniu nie istnieje blokada poza aktywnością pojazdu. Ograniczenie GiST `availability_no_overlap` pozostaje ostatnią barierą i mapuje się na ten sam `BLOCK_OVERLAP`. Edycja używa `version` (`updateMany ... WHERE version`), bez cichego nadpisania.

## Odmowy (wszystkie atomowe, bez częściowej mutacji i audytu)

`400 INVALID_INPUT`; `404 NOT_FOUND` (obca firma/pojazd/blokada, brak ujawnienia); `409 BLOCK_OVERLAP` z `conflict:{id,from,to,type,version}` istniejącego wpisu (tylko uwierzytelniony aktor tej firmy); `409 BLOCK_OUTSIDE_ACTIVITY` (aktywność bez początku, przed początkiem lub po końcu); `409 BLOCK_VERSION_CONFLICT`; `409 BLOCK_VEHICLE_ARCHIVED` (zapis i edycja; usunięcie pozostaje dozwolone); `403 FORBIDDEN`; `429 RATE_LIMITED`.

## Aktualność publiczna i okres usługi

Publiczne odczyty #33 nie mają cache aplikacyjnego i przy każdym żądaniu czytają bieżące rekordy (`no-store`); commit blokady jest więc widoczny dla każdej instancji i osobnego kontekstu przy następnym odczycie. Jeśli kiedykolwiek powstanie cache publicznej dostępności, jego unieważnienie po commit musi zostać dodane w tych mutacjach. DTO publiczne nie zawierają typu, `reference`, `internalNote` ani danych technicznych. Koniec okresu usługi nie zmienia blokad ani historii i nie zatrzymuje prywatnego zapisu, także rozpoczętego przed wygaśnięciem; publiczny odczyt pozostaje zamknięty.

## Migracja

`20261026180000_availability_block_integrity_issue_38` jest addytywna: CHECK `NOT VALID` na długość `reference`/`internalNote` i nieujemną wersję (typ i źródło chroni #8). Istniejące wiersze nie są skanowane ani zmieniane; nowe i edytowane muszą spełniać limity. Odtworzenie: backup, bez resetu.
