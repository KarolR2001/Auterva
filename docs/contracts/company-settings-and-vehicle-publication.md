# Kontrakt D-01/D-02: ustawienia firmy i publikacja pojazdu

Stan decyzji: zatwierdzone przez właściciela 23.10.2026 w [issue #1](https://github.com/KarolR2001/Auterva/issues/1). Obowiązuje MVP 3.1. Źródła: [PRD §6.2, §9.2, U3/U4](../product/PRD.md), [wymagania C-F081, C-F085, C-F096 i FR-ADM-032](../WYMAGANIA_AUTERVA.md), [architektura §8, §11–12](../ARCHITEKTURA_AUTERVA.md) oraz [bazowe FR-ADM-030–046, 060–063](../product/BASELINE_FLEET.md). Bazowy PRD pozostaje historycznym źródłem pól, a niniejsze uprawnienia i warunek pełnego opisu rozstrzygają jego sprzeczności.

## Macierz pól i operacji

`R` oznacza chroniony odczyt własnej firmy lub firmy jawnie wybranej przez superadmina, `W` zapis po autoryzacji serwera, `—` odmowę. Publiczny gość otrzymuje tylko osobną projekcję opublikowanej strony, gdy firma i zasób są publicznie dostępne; nie otrzymuje chronionego `SiteSettings` ani pól operatora. Wiersze dotyczą również bezpośredniego żądania API, uploadu, podmiany ID i mutacji złożonej, niezależnie od widoczności kontrolek.

| Pole / grupa atomowa | Admin firmy | Superadmin | Uwagi do zapisu |
|---|---|---|---|
| Nazwa firmy w platformie, nazwa publiczna, krótki opis firmy, obszar działania | R / — | R / W | Zmiana nazwy nie zmienia samoczynnie sluga ani hosta. |
| Publiczny telefon, WhatsApp, e-mail, domyślny kanał kontaktu | R / — | R / W | E-mail zaproszenia konta jest osobnym polem i nie staje się publicznym kontaktem. |
| Pełny adres firmy, dane mapy, godziny kontaktu | R / — | R / W | Dane publiczne publikowane tylko przez projekcję właściwej firmy. |
| Domyślny tytuł i opis SEO | R / — | R / W | Podgląd SEO jest wyliczany dla właściwego hosta i nie ma osobnej mutacji. |
| Tekst zastrzeżenia dostępności, link/treść polityki prywatności i regulaminu firmy | R / — | R / W | Dokumenty prawne Autervy są osobne i nie należą do ustawień firmy. |
| Logo publiczne, obrazy i tekst hero, pozostałe publiczne zdjęcia i treści marki | R / — | R / W | Własność obejmuje inicjację uploadu, metadane, kolejność, zamianę i usunięcie. Stałe kolory, fonty, ikony, login i motyw panelu nie są polami edytowalnymi. |
| Liczba wyróżnionych pojazdów, przełącznik publicznej widoczności cen firmy | R / — | R / W | Przełącznik jest odrębny dla każdej firmy; cena konkretnego pojazdu pozostaje operacyjnym polem floty. |
| Slug panelu i domena publiczna | R / — | R / W | Host jest wyliczany ze sluga/konfiguracji; nie przyjmuje dowolnego URL. Zapis i aktywacja domeny mają osobne endpointy. |
| Host panelu, stan weryfikacji domeny i wyliczony stan publicznej strony | R / — | R / — | Stan powstaje z konfiguracji i weryfikacji, nie przez bezpośredni PATCH. Superadmin uruchamia jawne akcje weryfikacji/aktywacji i odblokowania. |
| Przyznanie trialu, koniec opłaconego okresu i odblokowanie po archiwum | R / — | R / W | Osobne akcje platformowe z warunkami z PRD; odczyt firmy nie daje prawa do zapisu. |
| Notatka operatora o firmie | — / — | R / W | Nigdy w odpowiedzi panelu firmy ani publicznym DTO. |
| Dane pojazdu (w tym cena, opisy, kategoria, slug i daty), status, zdjęcia pojazdu i ręczne blokady | R / W | R / W | Admin: wyłącznie własna firma. Superadmin: jawnie wybrana firma, własna tożsamość i audyt. Obie role podlegają walidacji domenowej. |

`R / —` oznacza odczyt dozwolony, zapis zabroniony. Domyślna reguła dla każdego pola ustawień, którego nie ma w tabeli lub jawnej decyzji właściciela, to odmowa zapisu; brak pola w formularzu nie jest mechanizmem autoryzacji. Odmowa dotyczy też zagnieżdżonych kluczy JSON, nazw alternatywnych i pól dołączonych do dozwolonej mutacji. Decyzja D-03 definiuje zawartość kategorii i publicznych pól, nie rozszerza uprawnień admina firmy.

### Egzekwowanie na serwerze

1. Każdy odczyt chroniony i zapis sprawdza sesję, aktualny stan konta, obszar hosta, rolę, ID firmy i własność zasobu. Superadmin wskazuje firmę jawnie, pozostaje aktorem zapisu; nie używa sesji firmy. Obce ID daje bezpieczną odmowę bez ujawniania danych. Archiwizacja blokuje aktywną sesję admina, lecz nie zapis superadmina w kontekście firmy (D-23, #151: ustawienia i media publiczne zapisuje jak w firmie aktywnej; dawny `409 SETTINGS_COMPANY_ARCHIVED` nie istnieje, audyt ma `context: "ARCHIVED_COMPANY"`); koniec okresu usługi sam nie blokuje panelu.
2. `GET /api/admin/settings` daje adminowi chroniony odczyt własnej firmy. `PATCH /api/admin/settings` nie przyjmuje pól publicznych, kontaktowych, SEO, prawnych, brandingu ani platformowych od admina firmy; dla tych prób zwraca `403 FORBIDDEN` i niczego nie zapisuje. Projekt endpointu może pozostać dla przyszłych dozwolonych ustawień konta, ale nie stanowi ogólnego zapisu `SiteSettings`.
3. Superadmin zapisuje ustawienia tylko pod `/api/platform/companies/[id]/…` dla wybranej firmy. Każda mutacja stosuje jawną allowlistę swojej grupy, walidację wejścia i oczekiwaną wersję. Przesłanie pola niedozwolonego lub obcego ID odrzuca całą mutację przed zapisem; nie wolno po cichu zignorować zabronionej części. Media publiczne mają tę samą kontrolę przy init/upload, metadanych i usuwaniu. Zapis, audyt oraz wymagany outbox pozostają spójne.
4. Operacje floty przez `/api/admin/vehicles/…` i `/api/admin/availability/…` albo zagnieżdżony odpowiednik platformy wywołują te same use cases. Parametr firmy z payloadu nie nadpisuje kontekstu sesji/hosta. Zapis pojazdu nie jest furtką do aktualizacji `SiteSettings`, publicznych mediów firmy ani przełącznika cen.

## Jedna walidacja publikacji na kliencie i serwerze

Klient pokazuje błędy przy polu i blokuje przycisk publikacji, gdy zna braki. Serwer ponownie sprawdza **aktualny zapis** po każdej próbie `publish`; stan formularza, ukryty przycisk i stary wynik walidacji nie zastępują kontroli. Ta sama lista dotyczy publikacji przez admina firmy i superadmina.

| Warunek | Klient | Serwer |
|---|---|---|
| `name`: niepusty tekst po przycięciu białych znaków | Błąd pola | Wymagane przed zmianą statusu. |
| `slug`: niepusty, poprawny i unikalny **w obrębie firmy** | Format i dostępne sprawdzenie pomocnicze | Format oraz unikalność gwarantowana przy zapisie; konflikt równoległy mapowany na błąd pola/konflikt. |
| `category`: istniejąca dozwolona kategoria | Błąd pola | Kategoria musi należeć do aktualnej definicji; nie zgadywać kategorii po etykiecie. |
| `shortDescription` i `description`: dwa osobne niepuste pola | Błędy obu pól; pełny opis z samymi spacjami lub pustym markupem jest pusty | Obydwa obowiązkowe; pełny opis po normalizacji tekstowej nie może być pusty. Nie wprowadzamy niezatwierdzonej minimalnej liczby znaków. |
| Zdjęcia: co najmniej jedno przypisane, gotowe zdjęcie oraz dokładnie jedno główne | Błąd sekcji zdjęć | Sprawdzić zapisane media i cover, nie tylko upload w toku. Usunięcie ostatniego cover opublikowanego auta wymaga zamiennika albo cofnięcia publikacji. |
| `seats`: dodatnia liczba, jeżeli wymagana przez definicję kategorii | Błąd pola przy kategorii wymagającej miejsc | Stosować regułę kategorii z serwera; brak rozstrzygniętej reguły dla kategorii nie jest zgodą na pominięcie miejsc. |
| `availableFrom` i opcjonalne `availableTo`: daty kalendarzowe, koniec nie wcześniejszy od początku | Błędy dat | `LocalDate`, granice włącznie; jeden dzień jest prawidłowy. |

Pola takie jak marka, model, rok, drzwi, wyposażenie, cena i jednostka ceny nie są dodatkowymi warunkami publikacji. Warunek publikacji pojazdu jest odrębny od bramki publicznej strony firmy: nawet `PUBLISHED` nie omija okresu usługi, archiwizacji i stanu domeny. Publiczny odczyt zwraca wyłącznie `PUBLISHED` w uprawnionej firmie.

Niekompletny nowy pojazd można zapisać jako `DRAFT`; żądanie publikacji zwraca `409 PUBLISHING_REQUIREMENTS_NOT_MET` z listą pól i zachowuje `DRAFT`. Zmiana opublikowanego pojazdu lub zdjęć, która zniosłaby warunek publikacji, jest odrzucana atomowo, dopóki operator jawnie nie cofnie publikacji. Nie wolno zwrócić sukcesu zapisu z niekompletnym `PUBLISHED` ani cicho zmienić statusu. Walidacja szkicu dopuszcza braki publikacyjne, lecz nadal odrzuca niepoprawne typy, wartości i cudze zasoby.

### Przykłady do implementacji i QA

Minimalnie poprawny pojazd firmy A (fixture): definicja kategorii `bus` istnieje i wymaga liczby miejsc; `name="Bus 9"`, `slug="bus-9"` unikalny w A, `category="bus"`, `shortDescription="Bus na wyjazdy"`, `description="Dziewięciomiejscowy bus z klimatyzacją."`, `seats=9`, `availableFrom="2026-10-23"`, `availableTo="2026-10-23"`, jedno zapisane i gotowe zdjęcie `isCover=true`. Pozostałe pola opcjonalne. Przy aktywnym aktorze i niearchiwalnym zasobie `publish` przechodzi; sam dzień dostępności jest poprawny. Nazwa kategorii `bus` jest danymi fixture, a nie narzuconym produkcyjnym enumem.

Niekompletny szkic: te same dane, lecz `description=" <p><br></p> "` i bez zdjęć. Zapis `DRAFT` przechodzi, `publish` zwraca poniższy błąd, a publiczna lista nie zawiera pojazdu:

```json
{
  "code": "PUBLISHING_REQUIREMENTS_NOT_MET",
  "message": "Uzupełnij dane wymagane do publikacji pojazdu.",
  "fieldErrors": {
    "description": "Dodaj pełny opis pojazdu.",
    "images": "Dodaj co najmniej jedno gotowe zdjęcie i oznacz główne."
  },
  "requestId": "fixture-request-1"
}
```

Przykład odmowy D-01: admin firmy A wysyła `PATCH /api/admin/settings` z `phone` i `seo.title`; serwer zwraca `403 FORBIDDEN`, oba pola pozostają bez zmian i nie powstaje częściowy zapis. Ten sam admin może zaktualizować własny pojazd A, lecz nie pojazd B nawet po podmianie ID. Superadmin może zmienić `phone` firmy A przez zagnieżdżoną mutację platformy, z audytem własnego aktora.

To kontrakt dokumentacyjny dla przyszłego API, nie dowód wykonania kodu, testu integracyjnego ani aktualności makiet. Implementacja, ścieżki testów i rzeczywiste porównanie Penpota zostaną powiązane z odpowiednimi issue po scaffoldzie.
