# Zasoby Autervy do implementacji

- `brand/`: trzy istniejące logotypy SVG — znak, pełny i kompaktowy logotyp. Używają `currentColor`; nie zmieniaj proporcji. Warianty z tekstem wymagają fontu Inter/Inter Tight. Autorstwo i odrębna licencja logo nie zostały udokumentowane; przed publikacją należy je potwierdzić.
- `generated/`: 152 zoptymalizowane pliki AVIF/WebP (37 ujęć), pozostawione do odtworzenia makiet i testów wizualnych. Fotografie są syntetyczne i przedstawiają demonstracyjne pojazdy, nie rzeczywistą ofertę firmy.
- `manifest.json`: ID, zastosowanie, alt, focal point, pochodzenie i prompty oraz wymiary/rozmiary/SHA-256 zachowanych wariantów. `archivedOriginal` opisuje źródłowy PNG wycofany z repozytorium, nie plik wymagany do uruchomienia aplikacji.

Publiczny frontend docelowo używa mediów przypisanych do właściwej firmy zgodnie z architekturą. Obrazów demo nie seeduj jako opublikowanej floty produkcyjnej. W testach wizualnych używaj stałych fixture i kontrolowanych fontów.

Ciężkie PNG, arkusze QA i skrypty przygotowywania makiet usunięto z repozytorium. Źródłowe PNG nie są dystrybuowane z projektem; ich odzyskanie wymaga osobnej kopii, jeśli jest dostępna. Zachowane warianty nie potrzebują regeneracji do porównania z makietami.
