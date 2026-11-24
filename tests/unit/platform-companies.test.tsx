// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
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
    purge: { scheduledAt: null, startedAt: null, completedAt: null },
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
    expect(periodLabel(pending)).toBe("Okres próbny jeszcze nie rozpoczęty");
    expect(visibilityReason(pending)).toBe("Czeka na rejestrację administratora.");
  });

  it("podgląd skrócenia opisuje skutek i milczy przy przedłużeniu", () => {
    const c = company();
    expect(shorteningEffect(c, "2027-01-31", "2026-10-30")).toBeNull();
    expect(shorteningEffect(c, "2026-11-30", "2026-10-30")).toMatch(/kończy się 30\.11\.2026 włącznie/);
    expect(shorteningEffect(c, null, "2026-10-30")).toMatch(/natychmiast wyłączona/);
    const withTrial = company({ period: { ...c.period, trialValid: true } });
    expect(shorteningEffect(withTrial, "2026-10-01", "2026-10-30")).toMatch(/do końca okresu próbnego/);
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
    expect(screen.getByText("Aktywne okresy próbne").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByRole("link", { name: "Otwórz firmę Alfa Campers" })).toHaveAttribute("href", `/firmy/${ID}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("includeArchived=false");
  });

  it("pokazuje tabelę z kolumnami, chipami statusu oraz akcjami Otwórz i Czat do skrzynki firmy (PLT-01-02)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ items: [company()], total: 1, page: 1, pageSize: 20, kpis: { paidCompanies: 1, trialCompanies: 0 } }),
    );
    render(<CompanyListView />);
    await screen.findByText("Alfa Campers", { exact: false });
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).toEqual(["Firma", "Okres usługi", "Widoczność", "Rejestracja", "Akcje"]);
    const row = screen.getByRole("row", { name: /Alfa Campers/ });
    expect(within(row).getByText("Widoczna")).toBeVisible();
    expect(within(row).getByText("Zakończona")).toBeVisible();
    expect(within(row).getByRole("link", { name: "Czat z firmą Alfa Campers" })).toHaveAttribute("href", expect.stringMatching(new RegExp(`^/wiadomosci/?\\?firma=${ID}$`)));
    expect(screen.getByRole("link", { name: "Wiadomości" })).toHaveAttribute("href", expect.stringMatching(/^\/wiadomosci\/?$/));
    expect(screen.getByRole("link", { name: "Dodaj firmę" })).toHaveAttribute("href", expect.stringMatching(/^\/firmy\/nowa\/?$/));
  });

  it("powód wyłączenia strony jest tekstem na liście, a lista nie linkuje do tras bez ekranów", async () => {
    const off = company({ publication: { visible: false, domainReady: true, unlockRequired: false, requiresPaid: false },
      period: { ...company().period, paidValid: false, publicVisible: false, headline: "EXPIRED" } });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ items: [off], total: 1, page: 1, pageSize: 20, kpis: { paidCompanies: 0, trialCompanies: 0 } }),
    );
    render(<CompanyListView />);
    expect(await screen.findByText("Okres usługi wygasł.")).toBeVisible();
    expect(document.querySelector('a[href*="pojazdy"]')).toBeNull();
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

describe("archiwizacja, restore i odblokowanie w karcie (#49)", () => {
  const archivedAt = "2026-11-01T10:00:00.000Z";
  type Op = { url: string; body: { expectedOrganizationVersion: number; eventKey: string } };

  function setup(opts: { card: () => PlatformCompany; post?: (url: string) => Response }) {
    const ops: Op[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/domains/")) return Response.json({ aliasHostname: "alfa.oferta.example", domain: null });
      if (init?.method === "POST" && /\/(archive|restore|public-unlock)\/$/.test(url)) {
        ops.push({ url, body: JSON.parse(String(init.body)) });
        return opts.post ? opts.post(url) : Response.json({});
      }
      return Response.json(opts.card());
    });
    return ops;
  }
  async function open(initial: PlatformCompany) {
    render(
      <PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}>
        <CompanyCard initial={initial} justSaved={false} />
      </PanelShell>,
    );
    await screen.findByRole("heading", { name: "Archiwum i publikacja" });
    return userEvent.setup();
  }

  it("potwierdzenie archiwizacji ma nazwę firmy i skutki; anulowanie nie wysyła żądania", async () => {
    const ops = setup({ card: () => company() });
    const user = await open(company());
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    const dialog = await screen.findByRole("alertdialog").catch(() => screen.findByRole("dialog"));
    expect(dialog).toHaveTextContent("Zarchiwizować firmę Alfa Campers?");
    expect(dialog).toHaveTextContent(/niczego nie usuwa/);
    expect(dialog).toHaveTextContent(/Dane firmy zostaną trwale usunięte 12 miesięcy po archiwizacji/);
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(ops).toHaveLength(0);
    expect(screen.queryByText(/została zarchiwizowana/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Usuń firmę|Usuń trwale/);
  });

  describe("trwałe usunięcie danych (D-58, #445)", () => {
    const archivedAt = "2025-11-30T10:00:00.000Z";
    const archived = (purge: Partial<PlatformCompany["purge"]>, extra: Partial<PlatformCompany> = {}) => company({
      archivedAt, publication: { visible: false, domainReady: true, unlockRequired: true, requiresPaid: false },
      purge: { scheduledAt: "2026-11-30T10:00:00.000Z", startedAt: null, completedAt: null, ...purge }, ...extra });

    it("zaplanowane: data (Europe/Warsaw), nieodwracalność po starcie i dostępne przywrócenie", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-22T10:00:00.000Z") });
      try {
        setup({ card: () => archived({}) });
        await open(archived({}));
        const region = screen.getByRole("region", { name: "Trwałe usunięcie danych" });
        expect(region).toHaveTextContent("Zaplanowane usunięcie danych");
        expect(region).toHaveTextContent("Najwcześniej 30.11.2026");
        expect(region).toHaveTextContent(/Po starcie jest to nieodwracalne/);
        expect(screen.getByRole("button", { name: "Przywróć firmę" })).toBeEnabled();
      } finally { vi.useRealTimers(); }
    });

    it("termin minął, job nie wystartował: komunikat o terminie, przywrócenie nadal możliwe", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-12-05T10:00:00.000Z") });
      try {
        setup({ card: () => archived({}) });
        await open(archived({}));
        expect(screen.getByRole("region", { name: "Trwałe usunięcie danych" })).toHaveTextContent("Termin usunięcia danych minął");
        expect(screen.getByRole("button", { name: "Przywróć firmę" })).toBeEnabled();
      } finally { vi.useRealTimers(); }
    });

    it("w trakcie: nieodwracalne, bez przywrócenia i bez wejść do czatu i floty", async () => {
      setup({ card: () => archived({ startedAt: "2026-11-30T12:00:00.000Z" }) });
      await open(archived({ startedAt: "2026-11-30T12:00:00.000Z" }));
      expect(screen.getByRole("region", { name: "Trwałe usunięcie danych" })).toHaveTextContent("Trwa trwałe usunięcie danych");
      expect(screen.queryByRole("button", { name: "Przywróć firmę" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Odblokuj stronę publiczną" })).toBeNull();
      expect(screen.queryByRole("link", { name: "Zarządzaj flotą" })).toBeNull();
      expect(screen.getByText(/Przywrócenie firmy nie jest możliwe/)).toBeInTheDocument();
    });

    it("usunięta: karta bez nazwy, sluga, e-maila i akcji; tekst oznaczenia", async () => {
      const purged = archived({ startedAt: "2026-11-30T12:00:00.000Z", completedAt: "2026-11-30T12:05:00.000Z" },
        { name: null, slug: "purged-11111111", account: null, hosts: [] });
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(purged));
      render(<PanelShell area="platform" accessState="allowed" title="Firma usunięta" currentPath="/firmy" onLogout={vi.fn()}>
        <CompanyCard initial={purged} justSaved={false} /></PanelShell>);
      expect(await screen.findByRole("heading", { level: 2, name: "Firma usunięta" })).toBeInTheDocument();
      expect(screen.getByRole("region", { name: "Trwałe usunięcie danych" })).toHaveTextContent("Usunięta");
      expect(screen.getByRole("region", { name: "Trwałe usunięcie danych" })).toHaveTextContent("30.11.2026");
      expect(document.body.textContent).not.toMatch(/purged-|admin@alfa|Alfa Campers/);
      expect(screen.queryByRole("button", { name: /Przywróć|Archiwizuj|Odblokuj|Wyślij|Zapisz/ })).toBeNull();
      expect(screen.queryByRole("link", { name: /Napisz do firmy|Zarządzaj flotą/ })).toBeNull();
      expect(screen.getByRole("link", { name: "Wróć do firm" })).toBeInTheDocument();
    });

    it("niezarchiwizowana firma nie pokazuje sekcji usunięcia", async () => {
      setup({ card: () => company() });
      await open(company());
      expect(screen.queryByRole("region", { name: "Trwałe usunięcie danych" })).toBeNull();
    });

    it("lista: zaplanowana data przy firmie zarchiwizowanej i oznaczenie Usunięta bez nazwy i adresów", async () => {
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-22T10:00:00.000Z") });
      try {
        const items = [archived({}), archived({ startedAt: "2026-11-30T12:00:00.000Z" }, { organizationId: "22222222-2222-4222-8222-222222222222", name: "Beta" }),
          archived({ startedAt: "2026-11-30T12:00:00.000Z", completedAt: "2026-11-30T12:05:00.000Z" },
            { organizationId: "33333333-3333-4333-8333-333333333333", name: null, slug: "purged-33333333", account: null, hosts: [] })];
        vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ items, total: 3, page: 1, pageSize: 20, kpis: { paidCompanies: 0, trialCompanies: 0 } }));
        render(<PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}><CompanyListView /></PanelShell>);
        expect(await screen.findByText(/najwcześniej 30\.11\.2026/)).toBeInTheDocument();
        expect(screen.getByText("Trwa usuwanie danych")).toBeInTheDocument();
        const rows = screen.getAllByRole("row");
        const gone = rows.find((row) => row.getAttribute("data-purge-state") === "done")!;
        expect(gone).toHaveTextContent("Firma usunięta");
        expect(gone).toHaveTextContent("Usunięta 30.11.2026");
        expect(gone.textContent).not.toMatch(/purged-|Czat|Panel:|Strona:/);
        expect(within(gone).queryByRole("link", { name: /Czat/ })).toBeNull();
        expect(within(gone).getByRole("link", { name: /Otwórz kartę usuniętej firmy/ })).toBeInTheDocument();
        const running = rows.find((row) => row.textContent?.includes("Beta"))!;
        expect(within(running).queryByRole("link", { name: /Czat/ })).toBeNull();
      } finally { vi.useRealTimers(); }
    });
  });

  it("archiwizacja wysyła wersję i klucz, a sukces czeka na odczyt stanu", async () => {
    let done = false;
    const ops = setup({
      card: () => (done ? company({ archivedAt, organizationVersion: 4 }) : company()),
      post: () => {
        done = true;
        return Response.json({ archivedAt, version: 4 });
      },
    });
    const user = await open(company());
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    await user.click(screen.getByRole("button", { name: "Archiwizuj" }));
    expect(await screen.findByText(/Firma została zarchiwizowana/)).toBeVisible();
    expect(ops[0].url).toContain("/archive/");
    expect(ops[0].body.expectedOrganizationVersion).toBe(3);
    expect(ops[0].body.eventKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole("button", { name: "Przywróć firmę" })).toBeVisible();
  });

  it("restore bez ważnej opłaty pokazuje rzeczywisty stan i kroki; odblokowanie jest wyłączone", async () => {
    let restored = false;
    const after = company({
      organizationVersion: 5,
      period: { ...company().period, paidValid: false, publicVisible: false, headline: "EXPIRED" },
      publication: { visible: false, domainReady: true, unlockRequired: true, requiresPaid: true },
    });
    const ops = setup({
      card: () => (restored ? after : company({ archivedAt, organizationVersion: 4 })),
      post: () => {
        restored = true;
        return Response.json({ archivedAt: null, version: 5 });
      },
    });
    const user = await open(company({ archivedAt, organizationVersion: 4 }));
    await user.click(screen.getByRole("button", { name: "Przywróć firmę" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(/Nie publikuje strony/);
    await user.click(screen.getByRole("button", { name: "Przywróć" }));
    expect(await screen.findByText(/Firma została przywrócona/)).toBeVisible();
    expect(ops[0].url).toContain("/restore/");
    expect(await screen.findByText(/Przywrócenie nie publikuje strony/)).toBeVisible();
    expect(screen.getAllByText("Wyłączona").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Odblokuj stronę publiczną" })).toBeDisabled();
    expect(screen.getByText(/Wpisz ważną opłatę/)).toBeVisible();
  });

  it("odblokowanie wymaga potwierdzenia z nazwą firmy", async () => {
    const locked = company({
      publication: { visible: false, domainReady: true, unlockRequired: true, requiresPaid: true },
    });
    const ops = setup({ card: () => locked });
    const user = await open(locked);
    await user.click(screen.getByRole("button", { name: "Odblokuj stronę publiczną" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent("Odblokować stronę publiczną firmy Alfa Campers?");
    expect(ops).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    expect(ops).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Odblokuj stronę publiczną" }));
    await user.click(screen.getByRole("button", { name: "Odblokuj stronę" }));
    await waitFor(() => expect(ops).toHaveLength(1));
    expect(ops[0].url).toContain("/public-unlock/");
  });

  it("5xx: odczyt potwierdza zapis i komunikat mówi, że zapisano", async () => {
    let done = false;
    setup({
      card: () => (done ? company({ archivedAt, organizationVersion: 4 }) : company()),
      post: () => {
        done = true;
        return Response.json({}, { status: 502 });
      },
    });
    const user = await open(company());
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    await user.click(screen.getByRole("button", { name: "Archiwizuj" }));
    expect(await screen.findByText(/Operacja została zapisana/)).toBeVisible();
    expect(screen.queryByText(/Nie wiemy, czy operacja/)).toBeNull();
  });

  it("5xx bez zmiany wersji: nie zapisano, ponowienie używa tego samego klucza", async () => {
    const ops = setup({ card: () => company(), post: () => Response.json({}, { status: 500 }) });
    const user = await open(company());
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    await user.click(screen.getByRole("button", { name: "Archiwizuj" }));
    expect(await screen.findByText(/Nie znaleziono zapisu tej operacji/)).toBeVisible();
    expect(screen.queryByText(/Firma została zarchiwizowana/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    await user.click(screen.getByRole("button", { name: "Archiwizuj" }));
    await waitFor(() => expect(ops).toHaveLength(2));
    expect(ops[1].body.eventKey).toBe(ops[0].body.eventKey);
  });

  it("5xx i nieudany odczyt: ostrzeżenie z przyciskiem sprawdzenia stanu, bez sukcesu", async () => {
    let failing = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("/domains/")) return Response.json({ aliasHostname: "alfa.oferta.example", domain: null });
      if (init?.method === "POST") {
        failing = true;
        return Response.json({}, { status: 500 });
      }
      return failing ? Response.json({}, { status: 500 }) : Response.json(company());
    });
    const user = await open(company());
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    await user.click(screen.getByRole("button", { name: "Archiwizuj" }));
    expect(await screen.findByText(/odczyt stanu się nie udał/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Sprawdź stan" })).toBeVisible();
    expect(screen.queryByText(/została zarchiwizowana/)).toBeNull();
  });

  it("konflikt wersji: bez sukcesu, nowy klucz i odświeżona karta", async () => {
    const ops = setup({
      card: () => company({ organizationVersion: 4 }),
      post: () => Response.json({ code: "COMPANY_VERSION_CONFLICT" }, { status: 409 }),
    });
    const user = await open(company());
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    await user.click(screen.getByRole("button", { name: "Archiwizuj" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/zmieniona w innej sesji/);
    await user.click(screen.getByRole("button", { name: "Archiwizuj firmę" }));
    await user.click(screen.getByRole("button", { name: "Archiwizuj" }));
    await waitFor(() => expect(ops).toHaveLength(2));
    expect(ops[1].body.expectedOrganizationVersion).toBe(4);
    expect(ops[1].body.eventKey).not.toBe(ops[0].body.eventKey);
  });
});
