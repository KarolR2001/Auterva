// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/components/marketing/marketing-images", () => ({
  depotPicture: { avif: [], webp: [], fallback: "/depot.webp", width: 1536, height: 1024, alt: "", focal: "50% 50%" },
}));
import { MarketingPage } from "../../src/components/marketing/marketing-page";

afterEach(cleanup);
const inactive = { phone: null, whatsapp: null, email: null };

describe("MKT-01 onepage", () => {
  it("ma jeden h1, sekcje z nagłówkami i nawigację do sekcji", () => {
    render(<MarketingPage contact={inactive} />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const id of ["korzysci", "podglad", "jak-to-dziala", "faq", "kontakt"]) expect(document.getElementById(id)).not.toBeNull();
    const nav = screen.getByRole("navigation", { name: "Sekcje strony" });
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["#podglad", "#jak-to-dziala", "#korzysci", "#kontakt"]);
  });

  it("bez prawdziwych danych kontakt jest nieaktywny: CTA prowadzi do sekcji, brak tel/mailto/wa.me", () => {
    const { container } = render(<MarketingPage contact={inactive} />);
    expect(screen.getByText("Kontakt jeszcze nieaktywny")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/DEMO/);
    for (const link of screen.getAllByRole("link", { name: /Zadzwoń/ })) expect(link).toHaveAttribute("href", "#kontakt");
    expect(container.querySelector('a[href^="tel:"], a[href^="mailto:"], a[href*="wa.me"]')).toBeNull();
    expect(screen.getByText("Napisz na WhatsApp").closest("p")).toHaveTextContent("nieaktywne");
  });

  it("po podłączeniu numeru CTA staje się linkiem tel:", () => {
    render(<MarketingPage contact={{ phone: "+48 600 100 200", whatsapp: null, email: null }} />);
    expect(screen.getAllByRole("link", { name: /Zadzwoń do Autervy/ })[0]).toHaveAttribute("href", "tel:+48600100200");
  });

  it("oznacza podglądy jako przykładowe i nie obiecuje rezerwacji ani płatności", () => {
    const { container } = render(<MarketingPage contact={inactive} />);
    expect(screen.getByText("Przykładowy widok strony firmy")).toBeInTheDocument();
    expect(screen.getByText("Przykładowy widok panelu")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Przykładowy widok panelu Autervy" })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/rezerwuj|zapłać|cennik|zarejestruj|okres próbny|za darmo/i);
    expect(container.querySelector("form")).toBeNull();
  });

  it("statusy w podglądzie mają tekst obok ikony", () => {
    render(<MarketingPage contact={inactive} />);
    expect(screen.getAllByText("Opublikowany").length).toBeGreaterThan(0);
    expect(screen.getByText("Wersja robocza")).toBeInTheDocument();
  });
});
