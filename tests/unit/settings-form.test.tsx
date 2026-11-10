// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGuardRegistry, UnsavedChangesGuardContext } from "../../src/components/panel/unsaved-changes-guard";
import { SettingsForm } from "../../src/components/settings/settings-form";
import type { SettingsSnapshot } from "../../src/components/settings/settings-model";
import { SettingsReadonly } from "../../src/components/settings/settings-readonly";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const snapshot: SettingsSnapshot = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  version: 2,
  archived: false,
  hosts: [{ hostname: "firma.example.test", area: "COMPANY_PUBLIC", kind: "PROVIDER", status: "ACTIVE" }],
  media: [{ id: "m1", kind: "LOGO", alt: "Logo firmy", width: 400, height: 200 }],
  settings: {
    profile: { name: "Firma Alfa", publicName: null, shortDescription: null, serviceArea: null },
    contact: { phone: "+48 600 100 200", whatsapp: null, email: null, contactChannel: "PHONE" },
    address: { addressLine: null, postalCode: null, city: null, country: null, mapLatitude: null, mapLongitude: null, contactHours: null },
    seo: { seoTitle: "Tytuł", seoDescription: null },
    legal: { availabilityNotice: null, privacyText: null, privacyUrl: null, termsText: null, termsUrl: null },
    display: { showPrices: false, featuredVehicleCount: 0 },
    branding: { heroText: null },
  },
};

function reply(status: number, body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

describe("formularz ustawień (superadmin)", () => {
  it("wysyła zmienione pola grupy z oczekiwaną wersją i kluczem zdarzenia, potem pokazuje zapis", async () => {
    const fetchMock = vi.fn(() => reply(200, { version: 3, changedFields: ["phone"] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SettingsForm snapshot={snapshot} section="kontakt" />);
    expect(screen.getByRole("button", { name: "Zapisz zmiany" })).toBeDisabled();
    await user.clear(screen.getByLabelText(/Telefon/));
    await user.type(screen.getByLabelText(/Telefon/), "+48 111 222 333");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    await screen.findByText("Zapisano zmiany");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/platform/companies/${snapshot.organizationId}/settings/`);
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ group: "contact", expectedVersion: 2, fields: { phone: "+48 111 222 333" } });
    expect(body.eventKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("błąd pola z serwera zachowuje dane, pokazuje podsumowanie i nie zgłasza sukcesu", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(400, { code: "INVALID_INPUT", fieldErrors: { phone: "INVALID_PHONE" } })));
    const user = userEvent.setup();
    render(<SettingsForm snapshot={snapshot} section="kontakt" />);
    await user.clear(screen.getByLabelText(/Telefon/));
    await user.type(screen.getByLabelText(/Telefon/), "12");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByRole("heading", { name: "Popraw zaznaczone pola" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Telefon/)).toHaveValue("12");
    expect(screen.getByLabelText(/Telefon/)).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Zapisano zmiany")).not.toBeInTheDocument();
  });

  it("konflikt wersji niczego nie nadpisuje i zostawia wartości do decyzji", async () => {
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => reply(409, { code: "SETTINGS_VERSION_CONFLICT", currentVersion: 5 }))
      .mockImplementationOnce(() => reply(200, { version: 6, changedFields: ["phone"] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SettingsForm snapshot={snapshot} section="kontakt" />);
    await user.clear(screen.getByLabelText(/Telefon/));
    await user.type(screen.getByLabelText(/Telefon/), "+48 700 800 900");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByRole("heading", { name: "Dane zmienił ktoś inny" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Telefon/)).toHaveValue("+48 700 800 900");
    await user.click(screen.getByRole("button", { name: "Zachowaj moje wartości" }));
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    await screen.findByText("Zapisano zmiany");
    expect(JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body)).expectedVersion).toBe(5);
  });

  it("błąd sieci zachowuje dane, a ponowienie używa tego samego klucza zdarzenia", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockImplementationOnce(() => reply(200, { version: 3, changedFields: ["phone"] }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<SettingsForm snapshot={snapshot} section="kontakt" />);
    await user.type(screen.getByLabelText(/Telefon/), "0");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByText("Nie udało się zapisać")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const keys = fetchMock.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).eventKey);
    expect(keys[0]).toBe(keys[1]);
  });

  it("zgłasza niezapisane zmiany powłoce panelu i pokazuje ostrzeżenie o braku kanału kontaktu", async () => {
    const registry = createGuardRegistry();
    const user = userEvent.setup();
    const empty = { ...snapshot, settings: { ...snapshot.settings, contact: { phone: null, whatsapp: null, email: null, contactChannel: null } } };
    render(
      <UnsavedChangesGuardContext.Provider value={registry}>
        <SettingsForm snapshot={empty} section="kontakt" />
      </UnsavedChangesGuardContext.Provider>,
    );
    expect(screen.getByText("Brak kanału kontaktowego")).toBeInTheDocument();
    expect(registry.state()).toBe("free");
    await user.type(screen.getByLabelText(/Telefon/), "600");
    expect(registry.state()).toBe("dirty");
    expect(registry.hasSave()).toBe(true);
  });

  it("sekcja prawna: polityka bez treści i linku jest ostrzeżeniem, regulamin opcjonalny, jest uwaga o zatwierdzeniu", () => {
    render(<SettingsForm snapshot={snapshot} section="prawne" />);
    expect(screen.getByText("Treść wymaga zatwierdzenia prawnego")).toBeInTheDocument();
    expect(screen.getByText(/Polityka prywatności jest wymagana/)).toBeInTheDocument();
    expect(screen.getByText("Regulamin jest opcjonalny; brak nie blokuje strony.")).toBeInTheDocument();
  });
});

describe("widok ustawień dla admina firmy", () => {
  it("pokazuje wartości bez żadnej kontrolki zapisu i kieruje zmianę logo na czat", () => {
    const html = renderToStaticMarkup(<SettingsReadonly snapshot={snapshot} section="dane" />);
    expect(html).toContain("Firma Alfa");
    expect(html).toContain("Logo jest ustawione");
    expect(html).toContain('href="/admin/czat"');
    expect(html).not.toMatch(/<input|<textarea|<select|type="submit"|Zapisz zmiany/);
  });

  it("w kontakcie pokazuje wartości tylko do odczytu", () => {
    const html = renderToStaticMarkup(<SettingsReadonly snapshot={snapshot} section="kontakt" />);
    expect(html).toContain("+48 600 100 200");
    expect(html).toContain("Telefon");
    expect(html).not.toMatch(/<input|Zapisz zmiany/);
  });
});
