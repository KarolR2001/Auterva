// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelShell } from "../../src/components/panel/panel-shell";
import { navigation } from "../../src/components/panel/unsaved-changes-guard";
import { CompanyCard, type CompanyCardDto } from "../../src/components/platform/company-card";
import { NewCompanyForm } from "../../src/components/platform/new-company-form";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const base: CompanyCardDto = {
  organizationId: "11111111-1111-4111-8111-111111111111", slug: "alfa", name: "Alfa",
  organizationVersion: 1, archivedAt: null,
  registration: { status: "PENDING", firstAdminRegisteredAt: null },
  account: { id: "u1", name: null, email: "a@b.pl", emailVerified: false, mfaEnabled: false, disabledAt: null },
  period: { paidThrough: null, trialGranted: true, trialStartedAt: null, trialEndsAt: null, paidEndsAt: null,
    effectiveEndsAt: null, effectiveSource: "NONE", paidValid: false, trialValid: false, headline: "EXPIRED",
    publicVisible: false, periodVersion: 1 },
  publication: { visible: false, domainReady: true, unlockRequired: false, requiresPaid: false },
  hosts: [], invitation: null, conversationId: null,
};
const shell = (child: React.ReactNode) => render(
  <PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}>{child}</PanelShell>);

describe("karta firmy i zaproszenie (#25)", () => {
  it("po zapisie nie twierdzi, że firma jest opublikowana, i oddziela zapis od wysyłki", () => {
    shell(<CompanyCard initial={base} justSaved />);
    expect(screen.getByText(/Zapisano firmę\./)).toBeInTheDocument();
    expect(screen.getByText(/Strona nie jest opublikowana/)).toBeInTheDocument();
    expect(screen.getByText("Zaproszenie nie zostało wydane")).toBeInTheDocument();
    expect(screen.queryByText("Opublikowana")).toBeNull();
  });

  it("nagłówek karty ma nazwę firmy, kontekst adresów i główne akcje (#295)", () => {
    const hosts = [{ hostname: "alfa.sites.test", area: "COMPANY_ADMIN", kind: "PROVIDER", status: "ACTIVE" }] as unknown as CompanyCardDto["hosts"];
    shell(<CompanyCard initial={{ ...base, hosts }} justSaved={false} />);
    expect(screen.getByRole("heading", { level: 2, name: "Alfa" })).toBeInTheDocument();
    expect(screen.getByText(/Panel: alfa\.sites\.test/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Napisz do firmy" }).getAttribute("href")).toMatch(new RegExp(`/wiadomosci/?\\?firma=${base.organizationId}`));
    expect(screen.getByRole("link", { name: "Zarządzaj flotą" }).getAttribute("href")).toContain(`/firmy/${base.organizationId}/pojazdy`);
    expect(screen.getByRole("heading", { name: "Status firmy" })).toBeInTheDocument();
  });

  it("formularz nowej firmy ma nagłówek z akcjami i panel przed wysłaniem zaproszenia (#295)", () => {
    shell(<NewCompanyForm adminBaseDomain={null} publicBaseDomain={null} />);
    expect(screen.getByRole("heading", { level: 2, name: "Dodaj firmę" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Zapisz firmę" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Anuluj" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Przed wysłaniem zaproszenia" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Trial/)).toBeInTheDocument();
    expect(screen.getByText("Trial — 14 dni od rejestracji administratora")).toBeInTheDocument();
    expect(screen.queryByText(/336/)).toBeNull();
  });

  it("karta firmy opisuje trial jako 14 dni od rejestracji administratora (D-38)", () => {
    shell(<CompanyCard initial={base} justSaved={false} />);
    expect(screen.getByText("Trial (14 dni od rejestracji administratora)")).toBeInTheDocument();
    expect(screen.queryByText(/336/)).toBeNull();
  });

  it("karta prowadzi do materiałów publicznych i ustawień tej firmy (#37)", () => {
    shell(<CompanyCard initial={base} justSaved={false} />);
    expect(screen.getByRole("link", { name: "Edytuj logo i materiały publiczne" }).getAttribute("href")).toMatch(new RegExp(`^/firmy/${base.organizationId}/ustawienia/?\\?sekcja=wyglad$`));
    expect(screen.getByRole("link", { name: "Ustawienia firmy" }).getAttribute("href")).toMatch(new RegExp(`^/firmy/${base.organizationId}/ustawienia/?$`));
  });

  it("UNCERTAIN: brak wydania nowego zaproszenia, jest tylko cofnięcie", () => {
    const invitation = { id: "i", recipientEmail: "a@b.pl", issuedHost: "h", issuedAt: "2026-11-08T10:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z", usedAt: null, revokedAt: null, deliveryStatus: "UNCERTAIN" };
    shell(<CompanyCard initial={{ ...base, invitation }} justSaved={false} />);
    expect(screen.getByText("Wynik wysyłki jest niepewny")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Wyślij|Wydaj nowe/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Cofnij zaproszenie" })).toBeEnabled();
  });

  it("5xx przy wydaniu zachowuje klucz: ponowienie wysyła ten sam idempotencyKey", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (init?.method === "POST") {
        keys.push(JSON.parse(String(init.body)).idempotencyKey);
        return keys.length === 1 ? new Response(null, { status: 500 }) : Response.json({ id: "i" }, { status: 201 });
      }
      return Response.json(base);
    });
    shell(<CompanyCard initial={base} justSaved={false} />);
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await waitFor(() => expect(screen.getByText("Nie wiemy, czy zaproszenie zostało wydane.")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
  });

  it("503 bez kodu przy wydaniu to wynik niepewny z tym samym kluczem; 503 z kodem konfiguracji to odrzucenie", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    let answer: () => Response = () => new Response(null, { status: 503 });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") { keys.push(JSON.parse(String(init.body)).idempotencyKey); return answer(); }
      return Response.json(base);
    });
    shell(<CompanyCard initial={base} justSaved={false} />);
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await screen.findByText("Nie wiemy, czy zaproszenie zostało wydane.");
    answer = () => Response.json({ code: "OTHER" }, { status: 503 });
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await screen.findByText("Nie wiemy, czy zaproszenie zostało wydane.");
    for (const code of ["HOST_DOMAINS_NOT_CONFIGURED", "MAIL_NOT_CONFIGURED", "INGRESS_NOT_CONFIGURED"]) {
      answer = () => Response.json({ code }, { status: 503 });
      await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
      await screen.findByText("Nie wykonano operacji.");
      answer = () => new Response(null, { status: 503 });
      await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
      await screen.findByText("Nie wiemy, czy zaproszenie zostało wydane.");
    }
    // A definite refusal spends the key; the next attempt after it starts a new one.
    expect(new Set(keys).size).toBeGreaterThan(1);
  });

  it("503 bez kodu przy cofnięciu to wynik niepewny", async () => {
    const user = userEvent.setup();
    const invitation = { id: "i", recipientEmail: "a@b.pl", issuedHost: "h", issuedAt: "2026-11-08T10:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z", usedAt: null, revokedAt: null, deliveryStatus: "UNCERTAIN" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "DELETE" ? new Response(null, { status: 503 }) : Response.json({ ...base, invitation }));
    shell(<CompanyCard initial={{ ...base, invitation }} justSaved={false} />);
    await user.click(screen.getByRole("button", { name: "Cofnij zaproszenie" }));
    await screen.findByText("Nie wiemy, czy zaproszenie zostało cofnięte.");
  });

  it("błąd cofnięcia ma własny komunikat, nie o wydawaniu", async () => {
    const user = userEvent.setup();
    const invitation = { id: "i", recipientEmail: "a@b.pl", issuedHost: "h", issuedAt: "2026-11-08T10:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z", usedAt: null, revokedAt: null, deliveryStatus: "UNCERTAIN" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) =>
      init?.method === "DELETE" ? new Response(null, { status: 500 }) : Response.json({ ...base, invitation }));
    shell(<CompanyCard initial={{ ...base, invitation }} justSaved={false} />);
    await user.click(screen.getByRole("button", { name: "Cofnij zaproszenie" }));
    await screen.findByText("Nie wiemy, czy zaproszenie zostało cofnięte.");
    expect(screen.queryByText(/zostało wydane/)).toBeNull();
  });

  it("ponowienie po niepewnej próbie nie udaje nowego wydania; po potwierdzeniu wydania klucz jest zużyty", async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    const issued = { id: "new", recipientEmail: "a@b.pl", issuedHost: "h", issuedAt: "2026-11-08T10:00:00Z",
      expiresAt: "2099-01-01T00:00:00Z", usedAt: null, revokedAt: null, deliveryStatus: "SENT" };
    let confirmed = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      if (init?.method === "POST") {
        keys.push(JSON.parse(String(init.body)).idempotencyKey);
        return keys.length === 1 ? new Response(null, { status: 500 }) : Response.json({ id: "new" }, { status: 201 });
      }
      return Response.json(confirmed ? { ...base, invitation: issued } : base);
    });
    shell(<CompanyCard initial={base} justSaved={false} />);
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await screen.findByText("Nie wiemy, czy zaproszenie zostało wydane.");
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await screen.findByText(/Odtworzono wynik poprzedniej próby/);
    expect(screen.queryByText("Zaproszenie wydane i zapisane w kolejce.")).toBeNull();
    expect(keys[1]).toBe(keys[0]);
    cleanup();
    // Refresh after the unknown outcome shows the invitation: the key is spent, a resend is a new issue.
    keys.length = 0;
    confirmed = true;
    shell(<CompanyCard initial={base} justSaved={false} />);
    await user.click(screen.getByRole("button", { name: "Wyślij zaproszenie" }));
    await screen.findByText(/potwierdzono po odświeżeniu/);
    await user.click(await screen.findByRole("button", { name: "Wyślij ponownie" }));
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).not.toBe(keys[0]);
  });
});

describe("formularz nowej firmy w shellu (#25)", () => {
  const fill = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByLabelText(/Nazwa firmy/), "Alfa Campers");
    await user.type(screen.getByLabelText(/E-mail administratora/), "Admin@Alfa.pl");
    await user.click(screen.getByLabelText(/^Trial/));
  };

  it("slug podąża za nazwą do ręcznej edycji, błędy walidacji wskazują pola", async () => {
    const user = userEvent.setup();
    shell(<NewCompanyForm adminBaseDomain="a.test" publicBaseDomain="p.test" />);
    await user.click(screen.getByRole("button", { name: "Zapisz firmę" }));
    expect(screen.getByText("Wpisz nazwę firmy.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Nazwa firmy/)).toHaveFocus());
    await user.type(screen.getByLabelText(/Nazwa firmy/), "Łódź Rent");
    expect(screen.getByLabelText(/Slug panelu/)).toHaveValue("lodz-rent");
    await user.clear(screen.getByLabelText(/Slug panelu/));
    await user.type(screen.getByLabelText(/Slug panelu/), "moj");
    await user.type(screen.getByLabelText(/Nazwa firmy/), "2");
    expect(screen.getByLabelText(/Slug panelu/)).toHaveValue("moj");
  });

  it("awaria wysyłki zachowuje dane i ponawia z tym samym kluczem; zapis przechodzi dalej bez ostrzeżenia", async () => {
    const user = userEvent.setup();
    const assign = vi.spyOn(navigation, "assign").mockImplementation(() => {});
    const keys: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      keys.push(JSON.parse(String(init?.body)).idempotencyKey);
      return keys.length === 1 ? new Response(null, { status: 502 })
        : Response.json({ organizationId: "22222222-2222-4222-8222-222222222222" });
    });
    shell(<NewCompanyForm adminBaseDomain="a.test" publicBaseDomain="p.test" />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zapisz firmę" }));
    await waitFor(() => expect(screen.getByText(/Nie udało się zapisać firmy/)).toBeInTheDocument());
    expect(screen.getByLabelText(/Nazwa firmy/)).toHaveValue("Alfa Campers");
    await user.click(screen.getByRole("button", { name: "Ponów zapis" }));
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
    expect(keys[1]).toBe(keys[0]);
    expect(assign.mock.calls[0][0]).toBe("/firmy/22222222-2222-4222-8222-222222222222/?zapisano=1");
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("konflikt 409 wskazuje pola, a brudny formularz chroni link shellu", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input).includes("search=") ? Response.json({ items: [] })
        : Response.json({ code: "COMPANY_CONFLICT" }, { status: 409 }));
    shell(<NewCompanyForm adminBaseDomain="a.test" publicBaseDomain="p.test" />);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Zapisz firmę" }));
    await waitFor(() => expect(screen.getAllByText(/zajęty/).length).toBeGreaterThan(0));
    await user.click(screen.getByRole("link", { name: "Anuluj" }));
    expect(screen.getByRole("alertdialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Zostań" }));
    expect(screen.getByLabelText(/Nazwa firmy/)).toHaveValue("Alfa Campers");
  });
});
