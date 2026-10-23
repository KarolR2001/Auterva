# Auterva

Platforma prezentacji floty i informacyjnej dostępności dla wielu firm. MVP 3.1 obejmuje superadmina, panel firmy, strony publiczne oraz czat superadmin–firma.

Repozytorium jest przygotowaniem do implementacji: zawiera wymagania, architekturę, kontrakt Penpota, skille i zasady współpracy. Nie zawiera jeszcze działającej aplikacji.

## Źródła

- [PRD MVP 3.1](docs/product/PRD.md) — nadrzędny zakres, w tym zatwierdzone U3/U4.
- [Wymagania](docs/WYMAGANIA_AUTERVA.md) — funkcje, jakość, priorytety i otwarte decyzje.
- [Architektura](docs/ARCHITEKTURA_AUTERVA.md) — moduły, model danych, hosty, API, testy i dokładne ścieżki Penpota.
- [Design System](docs/design/SPEC.md) i [kontrakt Penpota](design/README.md) — tokeny, komponenty, ekrany i mapowanie.
- [Instrukcje agentów](AGENTS.md), [workflow GitHub](docs/development/WORKFLOW.md), [quality gates](docs/quality-gates.md).
- [Stan dostępu GitHub](docs/development/GITHUB_ACCESS.md).

## Początek implementacji

Manifest, lockfile, skrypty uruchomieniowe, testy i CI aplikacji powstaną w zadaniu scaffoldingu po [walidacji stosu](docs/adr/0002-version-validation.md). Wymagane kontrole opisują [quality gates](docs/quality-gates.md).

## Organizacja pracy

Jedno issue ma jednego właściciela roli: frontend, backend albo QA. Opis zawiera wymagania, kryteria akceptacji, zależności i odpowiednie ID Penpota. QA weryfikuje zachowanie oraz zgodność z makietami. Szablony issue i PR są w `.github`; etykiety i statusy projektu opisuje workflow.

Skille w `.agents/skills/` oraz `skills-lock.json` są częścią repozytorium. Materiały demo nie przedstawiają rzeczywistej floty. Zasoby, ich przeznaczenie i pochodzenie opisuje [README zasobów](design/assets/README.md).
