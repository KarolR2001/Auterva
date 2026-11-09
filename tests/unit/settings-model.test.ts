import { describe, expect, it } from "vitest";

import {
  changedGroups,
  fieldDefs,
  legalStatus,
  parseSection,
  serverErrorMessage,
  validate,
  valuesFor,
  type SettingsSnapshot,
} from "../../src/components/settings/settings-model";

const snapshot: SettingsSnapshot = {
  organizationId: "org",
  version: 3,
  archived: false,
  hosts: [],
  media: [],
  settings: {
    profile: { name: "Firma", publicName: null, shortDescription: null, serviceArea: null },
    contact: { phone: "+48 600 100 200", whatsapp: null, email: null, contactChannel: "PHONE" },
    address: { addressLine: null, postalCode: null, city: null, country: null, mapLatitude: 52.1, mapLongitude: null, contactHours: null },
    seo: { seoTitle: null, seoDescription: null },
    legal: { availabilityNotice: null, privacyText: null, privacyUrl: "https://example.test/p", termsText: null, termsUrl: null },
    display: { showPrices: false, featuredVehicleCount: 4 },
    branding: { heroText: null },
  },
};

describe("model ustawień firmy", () => {
  it("nieznana sekcja wraca do danych firmy", () => {
    expect(parseSection("kontakt")).toBe("kontakt");
    expect(parseSection("hasla")).toBe("dane");
    expect(parseSection(undefined)).toBe("dane");
  });

  it("żadna sekcja nie ma pól motywu, opłaty ani hosta", () => {
    const names = Object.values(fieldDefs).flat().map((field) => field.name.toLowerCase());
    for (const forbidden of ["theme", "color", "host", "domain", "slug", "paidthrough", "trial", "operatornote"])
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
  });

  it("wysyła tylko zmienione pola, pogrupowane jak API, z pustym tekstem jako czyszczeniem", () => {
    const initial = valuesFor(snapshot, "prezentacja");
    const current = { ...initial, seoTitle: "Nowy", availabilityNotice: "Informacja", featuredVehicleCount: "6", showPrices: true };
    expect(changedGroups("prezentacja", initial, current)).toEqual([
      { group: "seo", fields: { seoTitle: "Nowy" } },
      { group: "display", fields: { featuredVehicleCount: 6, showPrices: true } },
      { group: "legal", fields: { availabilityNotice: "Informacja" } },
    ]);
    const kontakt = valuesFor(snapshot, "kontakt");
    expect(changedGroups("kontakt", kontakt, { ...kontakt, phone: "", contactChannel: "" })).toEqual([
      { group: "contact", fields: { phone: "", contactChannel: null } },
    ]);
    expect(changedGroups("kontakt", kontakt, kontakt)).toEqual([]);
  });

  it("waliduje wcześnie: e-mail, link https, zakresy, para współrzędnych i kanał domyślny", () => {
    const kontakt = { ...valuesFor(snapshot, "kontakt"), email: "x", phone: "" };
    expect(Object.keys(validate("kontakt", kontakt)).sort()).toEqual(["contactChannel", "email"]);
    expect(validate("prawne", { ...valuesFor(snapshot, "prawne"), termsUrl: "http://example.test" }).termsUrl).toMatch(/https/);
    const dane = valuesFor(snapshot, "dane");
    expect(validate("dane", dane).mapLongitude).toBeDefined();
    expect(validate("dane", { ...dane, mapLongitude: "21", name: " " }).name).toBeDefined();
    expect(validate("prezentacja", { ...valuesFor(snapshot, "prezentacja"), featuredVehicleCount: "13" }).featuredVehicleCount).toBeDefined();
  });

  it("stan treści prawnej to TEXT, LINK albo MISSING; tekst ma pierwszeństwo", () => {
    expect(legalStatus("Treść", "https://example.test")).toBe("TEXT");
    expect(legalStatus(null, "https://example.test")).toBe("LINK");
    expect(legalStatus("", null)).toBe("MISSING");
  });

  it("kody serwera mają polskie komunikaty, nieznany kod ma bezpieczny komunikat", () => {
    expect(serverErrorMessage("INVALID_LINK")).toMatch(/https/);
    expect(serverErrorMessage("COS_NOWEGO")).toBe("Wartość jest nieprawidłowa.");
  });
});

describe("klucz zdarzenia", () => {
  it("działa także bez crypto.randomUUID (host http poza bezpiecznym kontekstem)", async () => {
    const { newEventKey } = await import("../../src/components/settings/settings-model");
    const original = crypto.randomUUID;
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newEventKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});
