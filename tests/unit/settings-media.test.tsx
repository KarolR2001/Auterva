// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGuardRegistry, UnsavedChangesGuardContext } from "../../src/components/panel/unsaved-changes-guard";
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

const second = "33333333-3333-4333-8333-333333333333";
const two: SettingsSnapshot = {
  ...base,
  media: [...base.media, { id: second, kind: "BRAND", alt: "Biuro", position: 1, width: 800, height: 600, version: 2 }],
};

describe("zarządzanie zdjęciami: dane, guard i niepewny upload", () => {
  it("zapis jednego zdjęcia nie gubi niezapisanych szkiców pozostałych", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json(200, { id: "x", version: 5 }))
      .mockImplementationOnce(() => json(200, { ...two, media: [{ ...two.media[0], alt: "Hala nowa", version: 5 }, two.media[1]] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MediaManager snapshot={two} />);
    const [heroAlt, brandAlt] = screen.getAllByLabelText(/Opis alternatywny/);
    await user.clear(brandAlt);
    await user.type(brandAlt, "Biuro robocze");
    await user.clear(heroAlt);
    await user.type(heroAlt, "Hala nowa");
    await user.click(screen.getAllByRole("button", { name: "Zapisz opis i kolejność" })[0]);
    await screen.findByText("Zapisano zdjęcie");
    expect(screen.getAllByLabelText(/Opis alternatywny/)[1]).toHaveValue("Biuro robocze");
    expect(screen.getAllByRole("button", { name: "Zapisz opis i kolejność" })[1]).toBeEnabled();
  });

  it("guard ma zapis wszystkich zmienionych zdjęć, a porażka przerywa opuszczenie strony", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => json(200, { id: "x", version: 5 }))
      .mockImplementationOnce(() => json(409, { code: "SETTINGS_VERSION_CONFLICT", currentVersion: 9 }));
    vi.stubGlobal("fetch", fetchMock);
    const registry = createGuardRegistry();
    const user = userEvent.setup();
    render(
      <UnsavedChangesGuardContext.Provider value={registry}>
        <MediaManager snapshot={two} />
      </UnsavedChangesGuardContext.Provider>,
    );
    expect(registry.hasSave()).toBe(false);
    const [heroAlt, brandAlt] = screen.getAllByLabelText(/Opis alternatywny/);
    await user.type(heroAlt, "!");
    await user.type(brandAlt, "!");
    expect(registry.state()).toBe("dirty");
    expect(registry.hasSave()).toBe(true);
    await expect(registry.save()).rejects.toThrow("MEDIA_SAVE_FAILED");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await screen.findByText("Nie zapisano wszystkich zdjęć")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Opis alternatywny/)[1]).toHaveValue("Biuro!");
  });

  it("błąd sieci przy uploadzie odświeża listę, mówi o nieznanym wyniku i ponawia z tym samym kluczem", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(() => json(200, base))
      .mockImplementationOnce(() => json(200, { state: "READY" }))
      .mockImplementationOnce(() => json(200, base));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MediaManager snapshot={base} />);
    const file = new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" });
    const input = screen.getByLabelText("Wybierz plik: Logo");
    await user.upload(input, file);
    expect(await screen.findByText("Wynik wysyłania jest nieznany")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/platform/companies/${org}/settings/`);
    await user.upload(input, file);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const keys = [0, 2].map((index) => ((fetchMock.mock.calls[index] as unknown as [string, RequestInit])[1].headers as Record<string, string>)["Idempotency-Key"]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("5xx też kończy się odczytem listy i komunikatem o nieznanym wyniku, a nowy plik dostaje nowy klucz", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) =>
      url.endsWith("/settings/") ? json(200, base) : json(503, { code: "MEDIA_BUSY" }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<MediaManager snapshot={base} />);
    const input = screen.getByLabelText("Wybierz plik: Logo");
    await user.upload(input, new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    expect(await screen.findByText("Wynik wysyłania jest nieznany")).toBeInTheDocument();
    await user.upload(input, new File([new Uint8Array([2, 2])], "b.png", { type: "image/png" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes("public-media"))).toHaveLength(2));
    const posts = fetchMock.mock.calls.filter((call) => String(call[0]).includes("public-media"));
    const key = (call: unknown[]) => ((call[1] as RequestInit).headers as Record<string, string>)["Idempotency-Key"];
    expect(key(posts[0])).not.toBe(key(posts[1]));
  });
});
