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
  archivedAt: null, registration: { status: "PENDING" }, account: { email: "a@b.pl" },
  period: { paidThrough: null, trialGranted: true }, publication: { visible: false, domainReady: true },
  hosts: [], invitation: null,
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
