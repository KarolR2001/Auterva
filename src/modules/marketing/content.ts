/**
 * MKT-01 copy (docs/product/materials/auterva-v1.md, AUT-01–05, approved by D-17 for implementation and the marked preview).
 * Publication on production still needs the operator's real contact channels and privacy policy (#6).
 */

export const marketingMeta = {
  title: "Auterva — strona i panel dla wypożyczalni pojazdów",
  description:
    "Pokaż flotę i dostępne terminy na stronie swojej wypożyczalni. Zarządzaj ofertą z panelu i porozmawiaj z Autervą o uruchomieniu.",
} as const;

/**
 * Contact channels. `null` means the channel is not connected: the page then shows the inactive-contact notice and no
 * tel:/mailto:/wa.me link. The placeholder `+48 000 000 000` and `kontakt@example.invalid` must never be wired here.
 */
export const marketingContact: { phone: string | null; whatsapp: string | null; email: string | null } = {
  phone: null,
  whatsapp: null,
  email: null,
};

export const heroCopy = {
  title: "Flota online. Terminy pod kontrolą.",
  lead: "Pokaż flotę z najlepszej strony. Aktualizuj auta i wolne terminy w jednym panelu — także z telefonu.",
  cta: "Zadzwoń do Autervy",
  note: "Rozmowa, prezentacja i indywidualne uruchomienie.",
} as const;

export const benefits = {
  title: "Więcej czasu dla klientów",
  lead: "Klient poznaje ofertę na stronie. Ty aktualizujesz ją w jednym miejscu.",
  cards: [
    { icon: "globe", title: "Oferta, która przekonuje", text: "Zdjęcia, wyposażenie i wolne terminy pomagają klientom wybrać auto." },
    { icon: "car", title: "Mniej ręcznej pracy", text: "Zmieniasz opis lub zdjęcia w panelu. Klienci widzą aktualną ofertę na stronie." },
    { icon: "calendar-check", title: "Aktualne terminy", text: "Zapisujesz wynajem lub serwis. Kalendarz na stronie od razu pokazuje zmianę." },
    { icon: "smartphone", title: "Panel zawsze pod ręką", text: "Dodajesz zdjęcia i zmieniasz dostępność także przy aucie — z telefonu." },
  ],
} as const;

export const preview = {
  title: "Oferta dla klientów. Panel dla Ciebie.",
  lead: "Klient poznaje auta i wolne terminy. Ty zarządzasz ofertą w swoim panelu.",
  siteHeading: "Strona Twojej firmy — widok początkowy",
  panelHeading: "Twój panel do zarządzania flotą",
  siteCaption: "Przykładowy widok strony firmy",
  siteLabel: "Przykładowa publiczna strona wypożyczalni",
  panelCaption: "Przykładowy widok panelu",
  panelLabel: "Przykładowy widok panelu Autervy",
} as const;

export const steps = {
  title: "Od prezentacji do gotowej strony",
  lead: "Poznaj system, przekaż materiały i odbierz przygotowaną stronę oraz dostęp do panelu.",
  items: [
    { title: "Porozmawiajmy", text: "Telefonicznie ustalamy potrzeby Twojej wypożyczalni." },
    { title: "Zobacz rozwiązanie", text: "Zobacz, jak Twoja oferta i codzienna praca mogą wyglądać w Autervie." },
    { title: "Otrzymaj dostęp", text: "Odbierasz stronę swojej wypożyczalni i dostęp do panelu." },
  ],
} as const;

export const faq = {
  title: "Warto wiedzieć przed startem",
  lead: "Odpowiedzi na najważniejsze pytania o codzienną pracę z Autervą.",
  items: [
    {
      question: "Jak klient ustala termin?",
      answer: "Klient sprawdza termin na stronie, a szczegóły ustalacie telefonicznie. Administrator zapisuje uzgodniony zakres w panelu.",
    },
    {
      question: "Czy mogę pracować z telefonu?",
      answer: "Tak. Na telefonie zarządzasz pojazdami, zdjęciami i dostępnością tak samo jak na komputerze.",
    },
    { question: "Co przygotować na start?", answer: "Logo, dane firmy i zdjęcia pojazdów. Wspólnie przygotujemy stronę i pokażemy Ci obsługę panelu." },
  ],
} as const;

export const contactCopy = {
  title: "Porozmawiajmy o Twojej wypożyczalni",
  lead: "Pokażemy Ci prosty system dopasowany do prezentacji floty i codziennego zarządzania dostępnością.",
  whatsapp: "Napisz na WhatsApp",
  email: "Napisz e-mail",
  demoNotice: "Kontakt jeszcze nieaktywny",
  demoHint: "Prawdziwe kanały kontaktu pojawią się przed publikacją strony.",
} as const;

export const footerText = "Prosty system prezentacji floty i dostępności dla wypożyczalni pojazdów.";

export const navItems = [
  { href: "#podglad", label: "Funkcje" },
  { href: "#jak-to-dziala", label: "Jak to działa" },
  { href: "#korzysci", label: "Korzyści" },
  { href: "#kontakt", label: "Kontakt" },
] as const;
