# Regulamin — propozycja wariantu

**SZKIC — do weryfikacji prawnej, nie publikować.** Autor nie jest prawnikiem; tekst nie jest opinią prawną ani deklaracją zgodności. Ostatnia aktualizacja szkicu: 2026-11-12.

## Założenia i uzasadnienie wariantu (usunąć przed publikacją)

Platforma ma dwa różne poziomy, więc proponujemy dwa osobne dokumenty:

1. **Regulamin platformy dla firm (warunki usługi Autervy)** — zalecany. Firma przyjmuje go przy zaproszeniu i okresie usługi. Nie ma publicznej rejestracji i płatności online, więc kluczowa jest umowa B2B uzgadniana poza aplikacją (telefon, prezentacja wyglądu, akceptacja), a regulamin ją uzupełnia. Bez takiego dokumentu nie ma zapisanych zasad okresu usługi, wyłączenia strony publicznej, archiwizacji, eksportu i odpowiedzialności.
2. **Regulamin firmy dla jej klientów** — opcjonalny (PUB-06). Firma wybiera: brak, tekst albo odnośnik do własnego dokumentu (FIR-06). Strona nie przyjmuje rezerwacji ani płatności, więc nie zawiera umowy najmu z klientem; dokument firmy dotyczy co najwyżej zasad korzystania ze strony i warunków najmu poza aplikacją. Auterva nie dostarcza gotowej treści takiej firmie (nie jest jej doradcą prawnym); proponujemy tylko szkielet.
3. Regulamin świadczenia usług drogą elektroniczną wobec odwiedzających (zasady korzystania ze strony) jest prawdopodobnie wymagany (ustawa o świadczeniu usług drogą elektroniczną); do oceny prawnika, czy wystarczy sekcja w dokumencie platformy.

Miejsca do uzupełnienia: `{operator}`, `{adres}`, `{kontakt}`, `{prawo właściwe i sąd}`, `{cennik/odesłanie do umowy}`.

## A. Regulamin platformy dla firm

### Definicje

Platforma Auterva, Operator (`{operator}`), Firma, Administrator firmy (jedna osoba na firmę), Superadmin, Okres usługi (trial i opłacony), Strona publiczna firmy, Panel.

### Zakres usługi

- Platforma prezentuje flotę i dostępność oraz daje Firmie panel i czat z Operatorem.
- Platforma nie przyjmuje rezerwacji, płatności i nie prowadzi kont klientów końcowych. Kontakt klienta z Firmą odbywa się poza platformą.
- Dostępność w ofercie wynika z aktywności pojazdu oraz blokad wprowadzonych przez Firmę. Firma odpowiada za zgodność tych danych z rzeczywistością.

### Konto, bezpieczeństwo i MFA

- Konto powstaje wyłącznie przez zaproszenie wysłane przez Operatora na adres Administratora. Adres jest unikalny w całej platformie.
- Logowanie wymaga MFA. Administrator chroni dane dostępowe, kody odzyskania i urządzenie. Utrata wszystkich czynników wymaga procedury Operatora.
- Superadmin może działać w kontekście firmy jako własny aktor (zarządzanie flotą, treściami). Bez impersonacji; działania są odnotowywane w dzienniku audytu.

### Okres usługi i publikacja

- Strona publiczna jest publikowana tylko w okresie usługi (trial lub opłacony). Po jego wygaśnięciu strona publiczna jest wyłączona, a panel Firmy nadal działa. `{warunki trialu i opłaty określa umowa lub oferta Operatora}`.
- Archiwizacja firmy blokuje logowanie i sesje. Przywrócenie według procedury Operatora.
- Opłaty rozlicza się poza aplikacją (brak automatycznego billingu) `{potwierdzić}`.

### Treści Firmy

- Firma gwarantuje prawa do zdjęć, logo i opisów oraz zgodność ofert i cen z prawem (w tym informacje o cenie i dane przedsiębiorcy).
- Firma odpowiada za własną politykę prywatności i ewentualny regulamin na stronie publicznej; Operator może ich wymagać przed publikacją.
- Zakaz treści bezprawnych i naruszających prawa osób trzecich; Operator może wstrzymać publikację.

### Dane osobowe

Szczegóły w polityce prywatności platformy i umowie powierzenia przetwarzania `{do przygotowania}`.

### Dane po zakończeniu współpracy

Operator udostępnia eksport danych Firmy na prośbę w ciągu 30 dni po archiwizacji lub zakończeniu współpracy (D-40/E8). Retencja i kasowanie po tym okresie `{do decyzji}`. Kopie zapasowe są przechowywane 30 dni.

### Dostępność usługi i odpowiedzialność

Cele odtworzenia po awarii (RPO 24 h, RTO 4 h) to cele operacyjne, nie gwarancja SLA `{do decyzji, czy oferujemy SLA}`. Ograniczenie odpowiedzialności, siła wyższa, wsparcie (czat, telefon) `{prawnik}`.

### Zmiana regulaminu, rozwiązanie umowy, prawo właściwe

Tryb zmiany i powiadamiania Firm, wypowiedzenie, prawo polskie, sąd `{do uzupełnienia}`.

## B. Szkielet regulaminu firmy (opcjonalny, PUB-06)

Do wypełnienia przez firmę, bez treści prawnej dostarczanej przez Autervę:

- Dane przedsiębiorcy i kontakt.
- Zasady korzystania ze strony (przeglądanie oferty, brak rezerwacji online, dostępność informacyjna, nie jest ofertą w rozumieniu Kodeksu cywilnego, `{prawnik}`).
- Odesłanie do warunków najmu stosowanych poza stroną lub informacja, że ich brak.
- Reklamacje i prawa konsumenta `{firma}`.
- Odsyłacz do polityki prywatności firmy.

## Pytania do właściciela i prawnika

1. Czy akceptujemy podział na regulamin platformy (obowiązkowy dla firm) i opcjonalny regulamin firmy? Czy regulamin platformy ma być przyjmowany w aplikacji (checkbox przy aktywacji zaproszenia), czy umową poza nią?
2. Czy potrzebny jest regulamin dla odwiedzających stronę Autervy (usługi elektroniczne)?
3. Warunki trialu i opłaty, odpowiedzialność, SLA, kary, wypowiedzenie, prawo i sąd.
4. Retencja i kasowanie danych firmy po 30 dniach od zakończenia współpracy.
5. Czy Operator może wstrzymać treść firmy (zakres i tryb)?
6. Czy firma jest przedsiębiorcą w każdym przypadku (B2B), co wyłącza część przepisów konsumenckich?
