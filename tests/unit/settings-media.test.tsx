// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MediaManager } from "../../src/components/settings/media-manager";
import { SettingsForm } from "../../src/components/settings/settings-form";
import type { SettingsSnapshot } from "../../src/components/settings/settings-model";
import { SettingsReadonly } from "../../src/components/settings/settings-readonly";
import { renderToStaticMarkup } from "react-dom/server";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const org = "11111111-1111-4111-8111-111111111111";
const base: SettingsSnapshot = {
  organizationId: org,
  version: 1,
  archived: false,
  hosts: [],
  media: [{ id: "22222222-2222-4222-8222-222222222222", kind: "HERO", alt: "Hala", position: 0, width: 800, height: 600, version: 4 }],
  settings: {
    profile: { name: "Firma", publicName: null, shortDescription: null, serviceArea: null },
    contact: { phone: null, whatsapp: null, email: null, contactChannel: null },
    address: { addressLine: null, postalCode: null, city: null, country: null, mapLatitude: null, mapLongitude: null, contactHours: null },
    seo: { seoTitle: null, seoDescription: null },
    legal: { availabilityNotice: null, privacyText: null, privacyUrl: null, termsText: null, termsUrl: null },
    display: { showPrices: false, featuredVehicleCount: 0 },
    branding: { heroText: "Wynajem aut" },
  },
};
const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("wygląd publiczny", () => {
  it("lista zdjęć używa chronionego podglądu platformy i pokazuje limity rodzajów", () => {
    render(<MediaManager snapshot={base} />);
    expect(screen.getByRole("heading", { name: "Zdjęcia hero (1 z 5)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Logo (0 z 1)" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Hala" })).toHaveAttribute("src", `/api/platform/companies/${org}/preview/media/22222222-2222-4222-8222-222222222222/thumb/`);
  });

  it("zapis opisu wysyła wersję zdjęcia i klucz zdarzenia, a konflikt niczego nie gubi", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json(409, { code: "SETTINGS_VERSION_CONFLICT", currentVersion: 5 }))
      .mockImplementationOnce(() => json(200, { id: "x", version: 6 }))
      .mockImplementationOnce(() => json(200, { ...base, media: base.media }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MediaManager snapshot={base} />);
    const alt = screen.getByLabelText(/Opis alternatywny/);
    await user.clear(alt);
    await user.type(alt, "Nowy opis");
    await user.click(screen.getByRole("button", { name: "Zapisz opis i kolejność" }));
    expect(await screen.findByText("Zdjęcie zostało zmienione w międzyczasie")).toBeInTheDocument();
    expect(screen.getByLabelText(/Opis alternatywny/)).toHaveValue("Nowy opis");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/platform/companies/${org}/public-media/22222222-2222-4222-8222-222222222222/`);
    expect(JSON.parse(String(init.body))).toMatchObject({ expectedVersion: 4, alt: "Nowy opis", position: 0 });
  });

  it("usunięcie wymaga potwierdzenia", async () => {
    const fetchMock = vi.fn().mockImplementation(() => json(200, { deleted: true }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MediaManager snapshot={base} />);
    await user.click(screen.getByRole("button", { name: /Usuń \(Zdjęcia hero 0\)/ }));
    expect(fetchMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Potwierdź usunięcie" }));
    await waitFor(() => expect(fetchMock.mock.calls[0]).toBeDefined());
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("sekcja pokazuje tekst hero bez opcji kolorów, fontów i motywu", () => {
    render(<SettingsForm snapshot={base} section="wyglad" />);
    expect(screen.getByLabelText(/Tekst hero/)).toHaveValue("Wynajem aut");
    expect(screen.queryByLabelText(/kolor|font|motyw/i)).not.toBeInTheDocument();
    expect(screen.getByText(/układ, kolory, fonty i ikony strony publicznej są stałe/)).toBeInTheDocument();
  });

  it("admin firmy widzi wygląd tylko do odczytu, bez uploadu i usuwania", () => {
    const html = renderToStaticMarkup(<SettingsReadonly snapshot={base} section="wyglad" />);
    expect(html).toContain("Wynajem aut");
    expect(html).toContain("/api/admin/preview/media/");
    expect(html).not.toMatch(/type="file"|Usuń|Dodaj:|<input/);
  });
});
