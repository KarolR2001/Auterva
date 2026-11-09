// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelShell } from "../../src/components/panel/panel-shell";
import { CompanyCard } from "../../src/components/platform/company-card";
import { CompanyListView } from "../../src/components/platform/company-list";
import {
  periodLabel,
  shorteningEffect,
  visibilityReason,
  type PlatformCompany,
} from "../../src/components/platform/platform-api";

const ID = "11111111-1111-4111-8111-111111111111";

function company(overrides: Partial<PlatformCompany> = {}): PlatformCompany {
  return {
    organizationId: ID,
    slug: "alfa",
    name: "Alfa Campers",
    organizationVersion: 3,
    archivedAt: null,
    registration: { status: "REGISTERED", firstAdminRegisteredAt: "2026-10-12T08:00:00.000Z" },
    account: { id: "u1", name: null, email: "admin@alfa.example", emailVerified: true, mfaEnabled: true, disabledAt: null },
    period: {
      paidThrough: "2026-12-31",
      trialGranted: false,
      trialStartedAt: null,
      trialEndsAt: null,
      paidEndsAt: "2026-12-31T23:00:00.000Z",
      effectiveEndsAt: "2026-12-31T23:00:00.000Z",
      effectiveSource: "PAID",
      paidValid: true,
      trialValid: false,
      headline: "PAID",
      publicVisible: true,
      periodVersion: 4,
    },
    publication: { visible: true, domainReady: true, unlockRequired: false, requiresPaid: false },
    hosts: [
      { hostname: "alfa.sites.example", area: "COMPANY_ADMIN", kind: "PROVIDER", status: "ACTIVE", canonicalTarget: null },
      { hostname: "alfa.oferta.example", area: "COMPANY_PUBLIC", kind: "PROVIDER", status: "ACTIVE", canonicalTarget: null },
    ],
    invitation: null,
    conversationId: null,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("etykiety okresu i widoczności", () => {
  it("rozdziela okres, rejestrację i widoczność zamiast jednej flagi active", () => {
    const expired = company({
      period: { ...company().period, paidValid: false, publicVisible: false, headline: "EXPIRED" },
      publication: { visible: false, domainReady: true, unlockRequired: false, requiresPaid: false },
    });
    expect(periodLabel(expired)).toBe("Okres wygasł 31.12.2026");
    expect(visibilityReason(expired)).toBe("Okres usługi wygasł.");
    const pending = company({
      registration: { status: "PENDING", firstAdminRegisteredAt: null },
      period: { ...company().period, paidValid: false, paidThrough: null, trialGranted: true },
      publication: { visible: false, domainReady: true, unlockRequired: false, requiresPaid: false },
    });
    expect(periodLabel(pending)).toBe("Trial jeszcze nie rozpoczęty");
    expect(visibilityReason(pending)).toBe("Czeka na rejestrację administratora.");
  });

  it("podgląd skrócenia opisuje skutek i milczy przy przedłużeniu", () => {
    const c = company();
    expect(shorteningEffect(c, "2027-01-31", "2026-10-30")).toBeNull();
    expect(shorteningEffect(c, "2026-11-30", "2026-10-30")).toMatch(/kończy się 30\.11\.2026 włącznie/);
    expect(shorteningEffect(c, null, "2026-10-30")).toMatch(/natychmiast wyłączona/);
    const withTrial = company({ period: { ...c.period, trialValid: true } });
    expect(shorteningEffect(withTrial, "2026-10-01", "2026-10-30")).toMatch(/do końca trialu/);
  });
});

describe("lista firm", () => {
  it("pokazuje wygasłą firmę, dwa KPI z API i wejście do karty", async () => {
    const expired = company({
      organizationId: "22222222-2222-4222-8222-222222222222",
      name: "Gamma Car",
      period: { ...company().period, paidValid: false, publicVisible: false, paidThrough: "2026-10-16" },
      publication: { visible: false, domainReady: true, unlockRequired: false, requiresPaid: false },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ items: [company(), expired], total: 2, page: 1, pageSize: 20, kpis: { paidCompanies: 1, trialCompanies: 0 } }),
    );
    render(<CompanyListView />);
    expect(await screen.findByText("Gamma Car", { exact: false })).toBeVisible();
    expect(screen.getByText("Okres wygasł 16.10.2026")).toBeVisible();
    expect(screen.getByText("Opłacone").nextElementSibling).toHaveTextContent("1");
    expect(screen.getByText("Aktywne triale").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByRole("link", { name: "Otwórz firmę Alfa Campers" })).toHaveAttribute("href", `/firmy/${ID}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("includeArchived=false");
  });

  it("powód wyłączenia strony jest tekstem na liście, a lista nie linkuje do tras bez ekranów", async () => {
    const off = company({ publication: { visible: false, domainReady: true, unlockRequired: false, requiresPaid: false },
      period: { ...company().period, paidValid: false, publicVisible: false, headline: "EXPIRED" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ items: [off], total: 1, page: 1, pageSize: 20, kpis: { paidCompanies: 0, trialCompanies: 0 } }),
    );
    render(<CompanyListView />);
    expect(await screen.findByText("Okres usługi wygasł.")).toBeVisible();
    expect(document.querySelector('a[href*="pojazdy"], a[href*="wiadomosci"]')).toBeNull();
  });

  it("filtr archiwum i szukanie trafiają do zapytania", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      Response.json({ items: [], total: 0, page: 1, pageSize: 20, kpis: { paidCompanies: 0, trialCompanies: 0 } }),
    );
    const user = userEvent.setup();
    render(<CompanyListView />);
    await screen.findByText("Brak firm dla wybranych kryteriów.", {}, { timeout: 100 }).catch(() => undefined);
    await user.click(screen.getByRole("checkbox", { name: "Pokaż zarchiwizowane" }));
    await user.type(screen.getByRole("searchbox"), "alfa");
    await waitFor(() => {
      const last = String(fetchMock.mock.calls.at(-1)?.[0]);
      expect(last).toContain("includeArchived=true");
      expect(last).toContain("search=alfa");
    });
  });

  it("błąd 500 pokazuje ponowienie z identyfikatorem zgłoszenia", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ code: "INTERNAL_ERROR" }, { status: 500, headers: { "X-Request-Id": "req-1" } }),
    );
    render(<CompanyListView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać listy firm");
    expect(screen.getByText(/req-1/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Spróbuj ponownie" })).toBeVisible();
  });
});

describe("karta firmy i zmiana okresu", () => {
  function route(handlers: { patch?: () => Response; card?: () => PlatformCompany }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/domains/")) return Response.json({ aliasHostname: "alfa.oferta.example", domain: null });
      if (init?.method === "PATCH") return handlers.patch!();
      return Response.json((handlers.card ?? (() => company()))());
    });
  }
  async function openAndEdit(date: string) {
    const user = userEvent.setup();
    render(
      <PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}>
        <CompanyCard initial={company()} justSaved={false} />
      </PanelShell>,
    );
    const field = await screen.findByLabelText("Opłacono do dnia włącznie");
    await user.clear(field);
    await user.type(field, date);
    return user;
  }

  it("firma zarchiwizowana ma pole okresu wyłączone z podpowiedzią o przywróceniu", async () => {
    route({ card: () => company({ archivedAt: "2026-11-01T10:00:00.000Z" }) });
    render(
      <PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}>
        <CompanyCard initial={company({ archivedAt: "2026-11-01T10:00:00.000Z" })} justSaved={false} />
      </PanelShell>,
    );
    expect(await screen.findByLabelText("Opłacono do dnia włącznie")).toBeDisabled();
    expect(screen.getByText(/Najpierw ją przywróć/)).toBeVisible();
  });

  it("zapisuje okres z wersją i kluczem zdarzenia", async () => {
    const fetchMock = route({ patch: () => Response.json({ paidThrough: "2027-01-31", periodVersion: 5 }) });
    const user = await openAndEdit("2027-01-31");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    const call = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(String(call[0])).toContain(`/api/platform/companies/${ID}/period/`);
    const body = JSON.parse(String(call[1]?.body));
    expect(body).toMatchObject({ paidThrough: "2027-01-31", expectedVersion: 4 });
    expect(body.eventKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Okres usługi został zapisany.")).toBeVisible();
  });

  it("konflikt wersji nie nadpisuje po cichu i zachowuje wpisaną datę", async () => {
    route({ patch: () => Response.json({ code: "PERIOD_VERSION_CONFLICT" }, { status: 409 }) });
    const user = await openAndEdit("2027-01-31");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("zmieniony przez inną sesję");
    expect(screen.getByLabelText("Opłacono do dnia włącznie")).toHaveValue("2027-01-31");
    expect(screen.getByRole("button", { name: "Zapisz zmiany" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Wczytaj aktualny stan" }));
    expect(await screen.findByText(/Aktualnie zapisano/)).toBeVisible();
    expect(screen.getByLabelText("Opłacono do dnia włącznie")).toHaveValue("2027-01-31");
  });

  it("skrócenie wymaga potwierdzenia z opisem skutku", async () => {
    const fetchMock = route({ patch: () => Response.json({ paidThrough: null, periodVersion: 5 }) });
    const user = await openAndEdit("2026-01-01");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
    expect(screen.getAllByRole("status").some((node) => /natychmiast wyłączona/.test(node.textContent ?? ""))).toBe(true);
    await user.click(screen.getByRole("button", { name: "Potwierdź skrócenie" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true));
  });

  it("5xx: najpierw odczyt stanu; niezmieniona wersja oznacza, że nie zapisano, a data zostaje w polu", async () => {
    const fetchMock = route({ patch: () => Response.json({ code: "INTERNAL_ERROR" }, { status: 500 }) });
    const user = await openAndEdit("2027-01-31");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByText(/Nie znaleziono zapisu tej zmiany/)).toBeVisible();
    expect(screen.queryByText(/Nie wiemy, czy zmiana/)).toBeNull();
    expect(screen.getByLabelText("Opłacono do dnia włącznie")).toHaveValue("2027-01-31");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
  });

  it("5xx: odczyt pokazuje nową wartość i wyższą wersję, więc komunikat mówi, że zapisano", async () => {
    let saved = false;
    route({
      patch: () => {
        saved = true;
        return Response.json({ code: "INTERNAL_ERROR" }, { status: 502 });
      },
      card: () =>
        saved ? company({ period: { ...company().period, paidThrough: "2027-01-31", periodVersion: 5 } }) : company(),
    });
    const user = await openAndEdit("2027-01-31");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByText(/Zmiana została zapisana/)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Sprawdź stan" })).toBeNull();
  });

  it("5xx: inna wersja z inną wartością to konflikt, a data zostaje w polu", async () => {
    let touched = false;
    route({
      patch: () => {
        touched = true;
        return Response.json({}, { status: 503 });
      },
      card: () =>
        touched ? company({ period: { ...company().period, paidThrough: "2027-06-30", periodVersion: 6 } }) : company(),
    });
    const user = await openAndEdit("2027-01-31");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByText(/zmieniony w innej sesji/)).toBeVisible();
    expect(screen.getByLabelText("Opłacono do dnia włącznie")).toHaveValue("2027-01-31");
  });

  it("5xx i nieudany odczyt: komunikat niepewny z ponowieniem sprawdzenia", async () => {
    let failing = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/domains/")) return Response.json({ aliasHostname: "alfa.oferta.example", domain: null });
      if (init?.method === "PATCH") {
        failing = true;
        return Response.json({}, { status: 500 });
      }
      return failing ? Response.json({}, { status: 500 }) : Response.json(company());
    });
    const user = await openAndEdit("2027-01-31");
    await user.click(screen.getByRole("button", { name: "Zapisz zmiany" }));
    expect(await screen.findByText(/odczyt stanu się nie udał/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Sprawdź stan" })).toBeVisible();
  });

});
