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

test("the one visible range field submits the same from/to GET contract", async () => {
  const user = userEvent.setup();
  const { container } = render(<AvailabilityChecker today="2026-11-02" />);
  const range = screen.getByRole("textbox", { name: "Termin od — do" });
  await user.type(range, "2026-11-05 – 2026-11-06");
  expect(container.querySelectorAll("input:not([type='hidden'])")).toHaveLength(1);
  expect((container.querySelector("input[name='from']") as HTMLInputElement).value).toBe("2026-11-05");
  expect((container.querySelector("input[name='to']") as HTMLInputElement).value).toBe("2026-11-06");
});

test("the catalog restores an applied range in the same single field", () => {
  window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
  const result = { ok: true, applied: { from: "2026-11-05", to: "2026-11-06", sort: "recommended",
    category: null, seats: null, transmission: null }, filters: { categories: [], transmissions: [], seats: null,
    sorts: ["recommended"] } } as unknown as Parameters<typeof CatalogFilters>[0]["result"];
  const { container } = render(<CatalogFilters result={result} today="2026-11-02" />);
  expect((within(container).getByRole("textbox", { name: "Termin od — do", hidden: true }) as HTMLInputElement).value)
    .toBe("2026-11-05 – 2026-11-06");
  expect(container.querySelectorAll("input:not([type='hidden'])")).toHaveLength(1);
});

test("range field rejects a past start and a reversed range before navigation", async () => {
  const user = userEvent.setup();
  render(<AvailabilityChecker today="2026-11-02" />);
  const range = screen.getByRole("textbox", { name: "Termin od — do" }) as HTMLInputElement;
  await user.type(range, "2026-11-01 – 2026-11-03");
  expect(range.validity.valid).toBe(false);
  expect(range.validationMessage).toContain("przeszłości");
  await user.clear(range);
  await user.type(range, "2026-11-06 – 2026-11-05");
  expect(range.validity.valid).toBe(false);
  expect(range.validationMessage).toContain("poprzedzać");
});
