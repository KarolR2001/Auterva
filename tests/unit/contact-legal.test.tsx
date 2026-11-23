// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContactPage } from "../../src/components/public/contact-page";
import { LegalPage } from "../../src/components/public/legal-page";
import { contactContext, mapHref, safeDocumentUrl } from "../../src/modules/public-offer/contact-presentation";

afterEach(cleanup);
const brand = { name: "Firma A", logo: null };
const seo = { title: "Kontakt | Firma A", description: null, canonical: "https://a.example/kontakt/", robots: { index: true, follow: true },
  openGraph: { title: "", description: null, url: "", siteName: "", locale: "pl_PL", images: [] }, jsonLd: [] };
const base = { name: "Firma A", hours: null, address: { line: null, postalCode: null, city: null, country: null, map: null },
  availabilityNotice: null, seo, message: { text: null, vehicle: null, range: null } };
const phone = { kind: "PHONE", value: "+48 600 000 111", href: "tel:+48600000111", preferred: true };
const mail = { kind: "EMAIL", value: "a@example.test", href: "mailto:a@example.test?subject=Zapytanie", preferred: false };
type ContactProp = Parameters<typeof ContactPage>[0]["contact"];
const contact = (extra: Partial<ContactProp>) => ({ ...base, channels: [phone, mail], ...extra }) as unknown as ContactProp;

describe("kontakt (PUB-04)", () => {
  it("pokazuje kanały z linkami i oznacza preferowany tekstem", () => {
    render(<ContactPage contact={contact({})} brand={brand} header={[]} termsAvailable />);
    expect(screen.getByRole("heading", { level: 1, name: "Porozmawiajmy o właściwym samochodzie" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Zadzwoń teraz" })).toHaveAttribute("href", "tel:+48600000111");
    expect(screen.getByRole("link", { name: "Napisz e-mail →" })).toHaveAttribute("href", "mailto:a@example.test?subject=Zapytanie");
    expect(screen.getByText("Preferowany kanał")).toBeInTheDocument();
  });

  it("preferowany kanał jest ciemną kartą z nagłówkiem akcji, pozostałe są zwykłe", () => {
    render(<ContactPage contact={contact({})} brand={brand} header={[]} termsAvailable />);
    expect(screen.getByText("Zadzwoń — odpowiadamy najszybciej")).toBeInTheDocument();
    const items = screen.getByRole("list", { name: "Kanały kontaktu" }).querySelectorAll(":scope > li");
    expect(items).toHaveLength(2);
    expect(items[0].className).toMatch(/channelPreferred/);
    expect(items[1].className).not.toMatch(/channelPreferred/);
  });

  it("blok Przygotuj do rozmowy tylko przy wejściu bez kontekstu", () => {
    const { rerender } = render(<ContactPage contact={contact({})} brand={brand} header={[]} termsAvailable />);
    expect(screen.getByRole("heading", { level: 2, name: "Przygotuj do rozmowy" })).toBeInTheDocument();
    rerender(<ContactPage brand={brand} header={[]} termsAvailable
      contact={contact({ message: { text: "x", vehicle: { slug: "k", name: "K" }, range: null } })} />);
    expect(screen.queryByRole("heading", { name: "Przygotuj do rozmowy" })).not.toBeInTheDocument();
  });

  it("pokazuje pojazd, termin i treść wiadomości oraz nie obiecuje rezerwacji", () => {
    const text = "Dzień dobry, interesuje mnie pojazd Kamper X w terminie 2026-11-10 – 2026-11-12.";
    const { container } = render(<ContactPage brand={brand} header={[]} termsAvailable
      contact={contact({ message: { text, vehicle: { slug: "kamper-x", name: "Kamper X" }, range: { from: "2026-11-10", to: "2026-11-12" } } })} />);
    expect(screen.getByText("Kamper X")).toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.getByText(/Sprawdzenie nie jest rezerwacją/)).toBeInTheDocument();
    expect(container.querySelector("form, input, textarea")).toBeNull();
  });

  it("bez kanału pokazuje jawny stan zamiast pustej akcji", () => {
    const { container } = render(<ContactPage contact={contact({ channels: [] })} brand={brand} header={[]} termsAvailable />);
    expect(screen.getByText("Firma nie podała jeszcze kanału kontaktu")).toBeInTheDocument();
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toBeNull();
  });

  it("link Regulamin pojawia się tylko, gdy regulamin jest dostępny", () => {
    const { rerender } = render(<ContactPage contact={contact({})} brand={brand} header={[]} termsAvailable={false} />);
    expect(screen.queryByRole("link", { name: "Regulamin" })).not.toBeInTheDocument();
    rerender(<ContactPage contact={contact({})} brand={brand} header={[]} termsAvailable />);
    expect(screen.getByRole("link", { name: "Regulamin" })).toHaveAttribute("href", "/regulamin/");
  });

  it("kopiuje wartość kanału i ogłasza wynik", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<ContactPage contact={contact({})} brand={brand} header={[]} termsAvailable />);
    await user.click(screen.getByRole("button", { name: "Kopiuj: Telefon +48 600 000 111" }));
    expect(writeText).toHaveBeenCalledWith("+48 600 000 111");
    expect(await screen.findByText("Skopiowano")).toBeInTheDocument();
    expect(screen.getAllByRole("status").map((el) => el.textContent)).toContain("Skopiowano: Telefon +48 600 000 111");
  });

  it("gdy schowek jest niedostępny, podaje komunikat tekstowy", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<ContactPage contact={contact({})} brand={brand} header={[]} termsAvailable />);
    await user.click(screen.getByRole("button", { name: "Kopiuj: Telefon +48 600 000 111" }));
    expect(await screen.findByText(/Nie udało się skopiować/)).toBeInTheDocument();
  });
});

describe("dokumenty firmy (PUB-05/06)", () => {
  const legal = (over: object) => ({ kind: "privacy", status: "MISSING", text: null, url: null, seo, ...over }) as unknown as Parameters<typeof LegalPage>[0]["legal"];
  it("renderuje tekst jako tekst, bez interpretacji HTML", () => {
    const { container } = render(<LegalPage legal={legal({ status: "TEXT", text: "Treść <b>polityki</b>" })} brand={brand} contact={[]} />);
    expect(screen.getByRole("heading", { level: 1, name: "Polityka prywatności" })).toBeInTheDocument();
    expect(container.querySelector("main b")).toBeNull();
    expect(screen.getByText("Treść <b>polityki</b>")).toBeInTheDocument();
  });
  it("nagłówki ## to numerowane h2 ze spisem treści i kotwicami, reszta akapity, bez HTML", () => {
    const text = "Wstęp <i>x</i>\n\n## Dane\nTreść <b>1</b>\n\n## Cele\nTreść 2";
    const { container } = render(<LegalPage legal={legal({ status: "TEXT", text })} brand={brand} contact={[]} />);
    expect(screen.getByRole("navigation", { name: "Spis treści" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "1. Dane" })).toHaveAttribute("href", "#sekcja-1");
    expect(screen.getByRole("heading", { level: 2, name: "2. Cele" })).toHaveAttribute("id", "sekcja-2");
    expect(container.querySelector("main b, main i")).toBeNull();
    expect(screen.getByText("Treść <b>1</b>")).toBeInTheDocument();
    expect(screen.getByText("Informacje prawne")).toBeInTheDocument();
  });
  it("bez nagłówków nie ma spisu treści; eyebrow regulaminu", () => {
    render(<LegalPage legal={legal({ kind: "terms", status: "TEXT", text: "Sam tekst" })} brand={brand} contact={[]} />);
    expect(screen.queryByRole("navigation", { name: "Spis treści" })).toBeNull();
    expect(screen.getByText("Zasady wynajmu")).toBeInTheDocument();
  });
  it("data aktualizacji tylko gdy pole istnieje; link powrotny tylko z pojazdem", () => {
    const { rerender } = render(<LegalPage legal={legal({ status: "TEXT", text: "x" })} brand={brand} contact={[]} />);
    expect(screen.queryByText(/Ostatnia aktualizacja/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Wróć do pojazdu/ })).toBeNull();
    rerender(<LegalPage legal={legal({ status: "TEXT", text: "x", updatedAt: "2026-11-10" })} brand={brand} contact={[]} vehicle={{ slug: "kamper", name: "Kamper <b>" }} />);
    expect(screen.getByText(/Ostatnia aktualizacja: 10 listopada 2026/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Wróć do pojazdu: Kamper <b>/ })).toHaveAttribute("href", "/pojazdy/kamper/");
  });
  it("link do dokumentu tylko dla http(s)", () => {
    render(<LegalPage legal={legal({ kind: "terms", status: "LINK", url: "https://firma.example/regulamin.pdf" })} brand={brand} contact={[]} />);
    expect(screen.getByRole("link", { name: /Otwórz: Regulamin/ })).toHaveAttribute("href", "https://firma.example/regulamin.pdf");
    cleanup();
    render(<LegalPage legal={legal({ status: "LINK", url: "javascript:alert(1)" })} brand={brand} contact={[]} />);
    expect(screen.getByText(/nie udostępniła jeszcze tego dokumentu/)).toBeInTheDocument();
  });
  it("brak dokumentu to jawny stan, bez wymyślonej treści", () => {
    render(<LegalPage legal={legal({})} brand={brand} contact={[]} />);
    expect(screen.getByText(/nie udostępniła jeszcze tego dokumentu/)).toBeInTheDocument();
  });
});

describe("pomocnicze", () => {
  it("safeDocumentUrl i mapHref", () => {
    expect(safeDocumentUrl("ftp://x")).toBeNull();
    expect(safeDocumentUrl("not a url")).toBeNull();
    expect(mapHref({ latitude: 52.2, longitude: 21 })).toContain("mlat=52.2&mlon=21");
    expect(mapHref({ latitude: 999, longitude: 21 })).toBeNull();
    expect(mapHref({ latitude: null, longitude: null })).toBeNull();
  });
  it("contactContext bierze pierwszą wartość", () => {
    expect(contactContext({ vehicle: ["a", "b"], from: "2026-11-10" })).toEqual({ vehicle: "a", from: "2026-11-10", to: null });
  });
});
