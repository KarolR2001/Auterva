// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { companyContext, platformContext, type FleetItem } from "../../src/components/admin/fleet-api";
import { PreviewHome, PreviewVehicle } from "../../src/components/platform/company-preview";
import { PlatformVehicleList } from "../../src/components/platform/company-fleet";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const org = "11111111-1111-4111-8111-111111111111";
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));

describe("flota superadmina w kontekście firmy (#47)", () => {
  it("kontekst platformy wskazuje trasy /firmy/{id} i zagnieżdżone API tej firmy, kontekst firmy nie ma podglądu", () => {
    expect(platformContext(org)).toEqual({ apiBase: `/api/platform/companies/${org}`, hrefBase: `/firmy/${org}`, previewBase: `/firmy/${org}/podglad` });
    expect(companyContext.previewBase).toBeUndefined();
    expect(companyContext.hrefBase).toBe("/admin");
  });

  it("lista pojazdów czyta API tej firmy i linkuje do formularza, kalendarza i podglądu pod kartą firmy; archiwalny nie ma podglądu", async () => {
    const item = (id: string, status: FleetItem["status"]): FleetItem => ({ id, name: `Auto ${status}`, slug: id.slice(0, 6), status, category: null,
      sortOrder: 0, version: 1, updatedAt: "2026-11-09T10:00:00Z", price: null, cover: null, activeToday: true, availableToday: true });
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string) => { urls.push(url); return json({ total: 2, page: 1, pageSize: 20, items: [item("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "DRAFT"), item("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "ARCHIVED")] }); }));
    render(<PlatformVehicleList organizationId={org} title="Flota" />);
    await waitFor(() => expect(screen.getAllByText("Auto DRAFT").length).toBeGreaterThan(0));
    expect(urls.find((url) => url.includes("/vehicles/?"))).toContain(`/api/platform/companies/${org}/vehicles/`);
    expect(screen.getByRole("link", { name: /Edytuj\s*Auto DRAFT/ }).getAttribute("href")).toBe(`/firmy/${org}/pojazdy/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/`);
    expect(screen.getByRole("link", { name: /Kalendarz\s*Auto DRAFT/ }).getAttribute("href")).toBe(`/firmy/${org}/pojazdy/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/kalendarz/`);
    expect(screen.getByRole("link", { name: /Podgląd\s*Auto DRAFT/ }).getAttribute("href")).toBe(`/firmy/${org}/podglad/pojazdy/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/`);
    expect(screen.queryByRole("link", { name: /Podgląd\s*Auto ARCHIVED/ })).toBeNull();
    // A listing never calls the company panel API.
    expect(urls.every((url) => !url.startsWith("/api/admin/"))).toBe(true);
  });
});

const media = { id: "m", alt: "Logo", width: 10, height: 10, urls: { large: `/api/platform/companies/${org}/preview/media/m/large/`, thumb: `/api/platform/companies/${org}/preview/media/m/thumb/` } };

describe("podgląd chroniony (#47)", () => {
  it("strona główna: baner nie-publiczny, stan niepublicznej strony, bez linków na adres publiczny", () => {
    const home = { preview: { mode: "OFFER" as const }, offerState: "EMPTY" as const,
      company: { name: "Alfa", shortDescription: "Wynajem", serviceArea: null, heroText: "Busy dla firm", logo: media, hero: null, brand: [] },
      featured: [], contact: [{ kind: "PHONE", value: "+48 111", href: "tel:+48111", preferred: true }], availabilityNotice: null, display: { showPrices: false } };
    render(<PreviewHome home={home as never} company="Alfa" organizationId={org} publicNow={false} />);
    expect(screen.getByText("Podgląd chroniony — to nie jest publiczny adres")).toBeInTheDocument();
    expect(screen.getByText("Strona publiczna tej firmy jest teraz wyłączona")).toBeInTheDocument();
    expect(screen.getByText(/Oferta jest pusta/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Logo" }).getAttribute("src")).toContain(`/api/platform/companies/${org}/preview/media/`);
    expect(screen.queryByRole("link", { name: /Zobacz pojazdy|publiczn/i })).toBeNull();
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).toMatch(new RegExp(`^/firmy/${org}/`));
  });

  it("pojazd: szkic pokazany ze statusem tekstem i ikoną, opis jako tekst, bez adresu publicznego", () => {
    const data = { preview: { mode: "VEHICLE" as const, vehicle: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "DRAFT", version: 1, public: false } },
      kind: "FOUND" as const, availabilityNotice: null, contact: [], display: { showPrices: true },
      vehicle: { slug: null, path: null, name: "Bus roboczy", brand: "Ford", model: null, year: 2020, category: { id: "c", name: "Bus" }, seats: 9, doors: null,
        transmission: null, fuel: null, drive: null, color: null, luggage: null, shortDescription: "Krótko", description: "<script>alert(1)</script>\nLinia",
        price: { amount: "350", unit: null }, features: [{ code: "Klimatyzacja", value: null }], cover: null, gallery: [{ alt: "Przód", urls: media.urls, width: 1, height: 1 }] } };
    const { container } = render(<PreviewVehicle data={data as never} company="Alfa" organizationId={org} publicNow />);
    expect(screen.getByText("Szkic")).toBeInTheDocument();
    expect(screen.getByText(/Pojazd nie jest widoczny publicznie/)).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Przód" })).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect(container).toHaveTextContent("<script>alert(1)</script>");
    expect(screen.getByRole("link", { name: "Edytuj pojazd" }).getAttribute("href")).toMatch(new RegExp(`^/firmy/${org}/pojazdy/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/?$`));
    for (const link of screen.getAllByRole("link")) expect(link.getAttribute("href")).toMatch(new RegExp(`^/firmy/${org}/`));
  });
});
