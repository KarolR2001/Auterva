// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";

import { AvailabilityChecker, CatalogFilters } from "../../src/components/public/catalog-filters";
import { PublicHome } from "../../src/components/public/public-home";

afterEach(cleanup);

test("PUB-01 mobile places configured hero media before the title and date form", () => {
  const home = {
    offerState: "HAS_VEHICLES", company: { name: "Firma A", heroText: "W drogę", shortDescription: null,
      logo: null, hero: { urls: { large: "/api/public/media/hero/large/" }, alt: "Samochód", width: 1200, height: 700 } },
    contact: [], featured: [], availabilityNotice: null, seo: { jsonLd: [] },
  } as unknown as Parameters<typeof PublicHome>[0]["home"];
  const markup = renderToStaticMarkup(<PublicHome home={home} today="2026-11-02" />);
  const document = new DOMParser().parseFromString(markup, "text/html");
  const hero = document.querySelector("section[aria-labelledby='home-title']");
  expect(hero).not.toBeNull();
  const image = hero!.querySelector("img[alt='Samochód']");
  const title = hero!.querySelector("#home-title");
  const checker = hero!.querySelector("form");
  expect(image).not.toBeNull();
  expect(image!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(image!.compareDocumentPosition(checker!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("FLOW-MVP-02 M/09: the empty offer keeps the company hero, announces the offer and lists the contact channels", () => {
  const home = {
    offerState: "EMPTY", company: { name: "Alfa Campers", heroText: "Podróż zaczyna się od dobrego auta.", shortDescription: "Kampery i auta na wyjazdy.",
      logo: null, hero: null },
    contact: [{ kind: "PHONE", value: "+48 600 100 200", href: "tel:+48600100200", preferred: true },
      { kind: "WHATSAPP", value: "+48 600 100 200", href: "https://wa.me/48600100200", preferred: false },
      { kind: "EMAIL", value: "kontakt@alfa.example", href: "mailto:kontakt@alfa.example", preferred: false }],
    featured: [], availabilityNotice: null, seo: { jsonLd: [] },
  } as unknown as Parameters<typeof PublicHome>[0]["home"];
  render(<PublicHome home={home} today="2026-11-02" />);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Podróż zaczyna się od dobrego auta.");
  expect(screen.getByRole("heading", { level: 2, name: "Nasza oferta pojawi się wkrótce" })).toBeTruthy();
  const channels = within(screen.getByRole("list", { name: "Kanały kontaktu" })).getAllByRole("link");
  expect(channels.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
    ["Zadzwoń: +48 600 100 200", "tel:+48600100200"], ["Napisz na WhatsApp", "https://wa.me/48600100200"], ["kontakt@alfa.example", "mailto:kontakt@alfa.example"]]);
  expect(screen.queryByText(/zł/)).toBeNull();
  expect(screen.queryByRole("form")).toBeNull();
});

const enabledFields = (container: HTMLElement) => container.querySelectorAll("input:not([type='hidden']):not(:disabled)");
const description = (element: HTMLElement) => (element.getAttribute("aria-describedby") ?? "").split(" ")
  .map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
const wideScreen = (wide: boolean) => {
  window.matchMedia = vi.fn(() => ({ matches: wide, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia;
};

test("on a phone the one compact range field (DD.MM.RRRR) submits the same from/to GET contract", async () => {
  wideScreen(false);
  const user = userEvent.setup();
  const { container } = render(<AvailabilityChecker today="2026-11-02" />);
  const range = screen.getByRole("textbox", { name: "Termin od — do" });
  await user.type(range, "05.11.2026 – 06.11.2026");
  expect(enabledFields(container)).toHaveLength(1);
  expect((container.querySelector("input[name='from']") as HTMLInputElement).value).toBe("2026-11-05");
  expect((container.querySelector("input[name='to']") as HTMLInputElement).value).toBe("2026-11-06");
  // The compact form of the mockup (start without the year) is understood as well.
  await user.clear(range);
  await user.type(range, "28.12 – 03.01.2027");
  expect((container.querySelector("input[name='from']") as HTMLInputElement).value).toBe("2026-12-28");
  expect((container.querySelector("input[name='to']") as HTMLInputElement).value).toBe("2027-01-03");
  expect(description(range)).toMatch(/DD\.MM\.RRRR/);
});

test("from 768 px two fields Od and Do (DD.MM.RRRR) submit the same from/to GET contract", async () => {
  wideScreen(true);
  const user = userEvent.setup();
  const { container } = render(<AvailabilityChecker today="2026-11-02" />);
  await user.type(screen.getByRole("textbox", { name: "Od" }), "05.11.2026");
  await user.type(screen.getByRole("textbox", { name: "Do" }), "6.11.2026");
  expect(enabledFields(container)).toHaveLength(2);
  expect(description(screen.getByRole("textbox", { name: "Od" }))).toMatch(/DD\.MM\.RRRR/);
  expect((container.querySelector("input[name='from']") as HTMLInputElement).value).toBe("2026-11-05");
  expect((container.querySelector("input[name='to']") as HTMLInputElement).value).toBe("2026-11-06");
  const to = screen.getByRole("textbox", { name: "Do" }) as HTMLInputElement;
  await user.clear(to);
  await user.type(to, "04.11.2026");
  expect(to.validity.valid).toBe(false);
  expect(to.validationMessage).toContain("poprzedzać");
  await user.tab();
  expect(description(to)).toContain("Data końcowa nie może poprzedzać początkowej.");
});

test("the catalog restores an applied range in the date fields", () => {
  wideScreen(false);
  const result = { ok: true, applied: { from: "2026-11-05", to: "2026-11-06", sort: "recommended",
    category: null, seats: null, transmission: null }, filters: { categories: [], transmissions: [], seats: null,
    sorts: ["recommended"] } } as unknown as Parameters<typeof CatalogFilters>[0]["result"];
  const { container } = render(<CatalogFilters result={result} today="2026-11-02" />);
  expect((within(container).getByRole("textbox", { name: "Termin od — do", hidden: true }) as HTMLInputElement).value)
    .toBe("05.11.2026 – 06.11.2026");
  expect(enabledFields(container)).toHaveLength(1);
  expect((within(container).getByRole("textbox", { name: "Od", hidden: true }) as HTMLInputElement).value).toBe("05.11.2026");
});

test("range field rejects a past start and a reversed range before navigation", async () => {
  wideScreen(false);
  const user = userEvent.setup();
  render(<AvailabilityChecker today="2026-11-02" />);
  const range = screen.getByRole("textbox", { name: "Termin od — do" }) as HTMLInputElement;
  await user.type(range, "01.11.2026 – 03.11.2026");
  expect(range.validity.valid).toBe(false);
  expect(range.validationMessage).toContain("przeszłości");
  await user.clear(range);
  await user.type(range, "06.11.2026 – 05.11.2026");
  expect(range.validity.valid).toBe(false);
  expect(range.validationMessage).toContain("poprzedzać");
});

test("PUB-01 renders featured vehicles with the featured card and hides the section when there are none", () => {
  const vehicle = (name: string, slug: string) => ({ name, slug, path: `/pojazdy/${slug}/`, category: null, seats: 5, transmission: "Manualna",
    shortDescription: null, price: { kind: "none" }, cover: { urls: { thumb: "/t/", large: "/l/" }, alt: null, width: 600, height: 400 } });
  const base = { offerState: "HAS_VEHICLES", company: { name: "Firma A", heroText: "W drogę", shortDescription: null, logo: null, hero: null },
    contact: [], availabilityNotice: null, seo: { jsonLd: [] } };
  const withCars = { ...base, featured: [vehicle("Alfa", "alfa"), vehicle("Beta", "beta")] } as unknown as Parameters<typeof PublicHome>[0]["home"];
  const doc = new DOMParser().parseFromString(renderToStaticMarkup(<PublicHome home={withCars} today="2026-11-02" />), "text/html");
  const section = doc.querySelector("section[aria-labelledby='featured-title']");
  expect(section).not.toBeNull();
  expect(section!.querySelectorAll("article[data-layout='featured']")).toHaveLength(2);
  expect(section!.querySelector("img")?.getAttribute("src")).toBe("/l/");
  const none = { ...base, featured: [] } as unknown as Parameters<typeof PublicHome>[0]["home"];
  const empty = new DOMParser().parseFromString(renderToStaticMarkup(<PublicHome home={none} today="2026-11-02" />), "text/html");
  expect(empty.querySelector("#featured-title")).toBeNull();
  expect(empty.body.textContent).not.toContain("Pojazdy gotowe na Twoją trasę");
});
