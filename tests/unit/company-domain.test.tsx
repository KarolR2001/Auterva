// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PanelShell } from "../../src/components/panel/panel-shell";
import { CompanyDomain, type DomainDto } from "../../src/components/platform/company-domain";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const id = "11111111-1111-4111-8111-111111111111";
const domain = (status: DomainDto["status"], extra: Partial<DomainDto> = {}): DomainDto => ({
  hostname: "kamper.klient.pl", status, version: 3, lastFailureCode: null, checkedAt: null, activatedAt: null,
  instruction: { ownership: { type: "TXT", name: "_auterva-challenge.kamper.klient.pl", value: "auterva-verification=abc" },
    routing: { type: "CNAME", name: "kamper.klient.pl", value: "edge.auterva.test" } },
  ...extra,
});
const view = (value: DomainDto | null) => ({ aliasHostname: "alfa.auterva.test", domain: value });
const shell = (archived = false) => render(
  <PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}>
    <CompanyDomain organizationId={id} archived={archived} />
  </PanelShell>);

type Call = { method: string; path: string; body: Record<string, unknown> | null };
function mockApi(responder: (call: Call, n: number) => Response, initial: DomainDto | null = null) {
  const calls: Call[] = [];
  let current = initial;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const method = init?.method ?? "GET";
    const call = { method, path: String(input).replace(`/api/platform/companies/${id}/domains/`, ""),
      body: init?.body ? JSON.parse(String(init.body)) : null };
    if (method === "GET") return Response.json(view(current));
    calls.push(call);
    return responder(call, calls.length);
  });
  return { calls, set: (next: DomainDto | null) => { current = next; } };
}

describe("domena własna na karcie firmy (#25 / API #23)", () => {
  it("dodanie domeny: PUT z expectedVersion null i eventKey, stan oczekuje, bez deklaracji publikacji", async () => {
    const user = userEvent.setup();
    const api = mockApi(() => Response.json(view(domain("PENDING_OWNERSHIP"))));
    shell();
    await user.type(await screen.findByLabelText(/Nazwa domeny/), " kamper.klient.pl ");
    await user.click(screen.getByRole("button", { name: "Dodaj domenę" }));
    await screen.findByText("kamper.klient.pl — Oczekuje na potwierdzenie własności");
    expect(api.calls[0]).toMatchObject({ method: "PUT", path: "", body: { hostname: "kamper.klient.pl", expectedVersion: null } });
    expect(api.calls[0].body?.eventKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(screen.getByText(/_auterva-challenge\.kamper\.klient\.pl/)).toBeInTheDocument();
    expect(screen.queryByText(/Opublikowana|Aktywna/)).toBeNull();
  });

  it("błędna i zajęta domena pokazują błąd przy polu i zachowują wpis", async () => {
    const user = userEvent.setup();
    mockApi((_call, n) => Response.json({ code: n === 1 ? "INVALID_HOSTNAME" : "DOMAIN_TAKEN" }, { status: n === 1 ? 400 : 409 }));
    shell();
    const field = await screen.findByLabelText(/Nazwa domeny/);
    await user.type(field, "zly");
    await user.click(screen.getByRole("button", { name: "Dodaj domenę" }));
    await waitFor(() => expect(screen.getAllByText("Niepoprawna nazwa domeny.").length).toBeGreaterThan(0));
    expect(field).toHaveValue("zly");
    await waitFor(() => expect(field).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Dodaj domenę" }));
    await waitFor(() => expect(screen.getAllByText("Ta domena jest już zajęta.").length).toBeGreaterThan(0));
  });

  it("weryfikacja bez dowodu pokazuje przyczynę i nie aktywuje", async () => {
    const user = userEvent.setup();
    const api = mockApi(() => Response.json(view(domain("PENDING_OWNERSHIP", { lastFailureCode: "OWNERSHIP_TXT_MISSING" }))),
      domain("PENDING_OWNERSHIP"));
    shell();
    await user.click(await screen.findByRole("button", { name: "Sprawdź konfigurację" }));
    await screen.findByText("Konfiguracja jeszcze niepełna.");
    expect(screen.getAllByText("Nie znaleziono rekordu TXT potwierdzającego własność.").length).toBeGreaterThan(0);
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "verify/" });
    expect(screen.queryByRole("button", { name: "Aktywuj domenę" })).toBeNull();
  });

  it("READY wymaga jawnej aktywacji z wersją; ACTIVE nie twierdzi o publikacji", async () => {
    const user = userEvent.setup();
    const api = mockApi(() => Response.json(view(domain("ACTIVE", { version: 4 }))), domain("READY"));
    shell();
    expect(await screen.findByText(/Gotowa do aktywacji/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Aktywuj domenę" }));
    await screen.findByText("Domena aktywna.");
    expect(api.calls[0]).toMatchObject({ method: "POST", path: "activate/", body: { expectedVersion: 3 } });
    expect(screen.getAllByText(/ważnym okresie/).length).toBeGreaterThan(0);
  });

  it("422 DOMAIN_NOT_READY odświeża stan i nic nie aktywuje", async () => {
    const user = userEvent.setup();
    mockApi(() => Response.json({ code: "DOMAIN_NOT_READY" }, { status: 422 }), domain("READY"));
    shell();
    await user.click(await screen.findByRole("button", { name: "Aktywuj domenę" }));
    await screen.findByText("Domena nie jest gotowa do aktywacji.");
    expect(screen.queryByText("Domena aktywna.")).toBeNull();
  });

  it("5xx: niepewny wynik, odświeżenie, bez fałszywego sukcesu", async () => {
    const user = userEvent.setup();
    const api = mockApi(() => new Response(null, { status: 500 }), domain("READY"));
    shell();
    await user.click(await screen.findByRole("button", { name: "Aktywuj domenę" }));
    await screen.findByText("Nie wiemy, czy operacja została wykonana.");
    expect(screen.queryByText("Domena aktywna.")).toBeNull();
    expect(api.calls).toHaveLength(1);
  });

  it("503 (bez kodu i z kodem) to niepewny wynik: odświeżenie, bez fałszywego sukcesu ani odrzucenia", async () => {
    const user = userEvent.setup();
    const api = mockApi((_call, n) => n === 1 ? new Response(null, { status: 503 })
      : Response.json({ code: "MAIL_NOT_CONFIGURED" }, { status: 503 }), domain("READY"));
    shell();
    await user.click(await screen.findByRole("button", { name: "Aktywuj domenę" }));
    await screen.findByText("Nie wiemy, czy operacja została wykonana.");
    await user.click(await screen.findByRole("button", { name: "Aktywuj domenę" }));
    await waitFor(() => expect(api.calls).toHaveLength(2));
    await screen.findByText("Nie wiemy, czy operacja została wykonana.");
    expect(screen.queryByText("Domena aktywna.")).toBeNull();
    expect(screen.queryByText("Nie wykonano operacji.")).toBeNull();
  });

  it("błąd sieci przy usuwaniu to także niepewny wynik", async () => {
    const user = userEvent.setup();
    const original = vi.spyOn(globalThis, "fetch");
    original.mockImplementation(async (_input, init) => {
      if (init?.method === "DELETE") throw new TypeError("network");
      return Response.json(view(domain("READY")));
    });
    shell();
    await user.click(await screen.findByRole("button", { name: "Usuń domenę" }));
    await screen.findByText("Nie wiemy, czy operacja została wykonana.");
    expect(screen.queryByText("Domena usunięta.")).toBeNull();
  });

  it("zarchiwizowana firma nie ma akcji zapisu", async () => {
    mockApi(() => new Response(null, { status: 500 }), domain("READY"));
    shell(true);
    await screen.findByText(/Gotowa do aktywacji/);
    expect(screen.queryByRole("button", { name: /Aktywuj|Usuń|Sprawdź/ })).toBeNull();
  });

  describe("odczyt a trwająca operacja (#460)", () => {
    const withKey = (key: number) => (
      <PanelShell area="platform" accessState="allowed" title="Firmy" currentPath="/firmy" onLogout={vi.fn()}>
        <CompanyDomain organizationId={id} archived={false} reloadKey={key} />
      </PanelShell>);
    const gate = () => { let open!: (value: Response) => void; const promise = new Promise<Response>((resolve) => { open = resolve; }); return { promise, open }; };

    it("przeładowanie z reloadKey nie zdejmuje busy trwającej operacji", async () => {
      const user = userEvent.setup();
      const put = gate();
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => (init?.method === "PUT" ? put.promise : Response.json(view(null))));
      const { rerender } = render(withKey(0));
      await user.type(await screen.findByLabelText(/Nazwa domeny/), "kamper.klient.pl");
      await user.click(screen.getByRole("button", { name: "Dodaj domenę" }));
      await screen.findByText(/Trwa operacja na domenie/);
      rerender(withKey(1));
      await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method || init.method === "GET")).toHaveLength(2));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.getByText(/Trwa operacja na domenie/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Dodawanie domeny/ })).toBeDisabled();
      put.open(Response.json(view(domain("PENDING_OWNERSHIP"))));
      await screen.findByText("kamper.klient.pl — Oczekuje na potwierdzenie własności");
    });

    it("udany cichy odczyt czyści ostrzeżenie o nieaktualnym stanie", async () => {
      let ok = false;
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => (ok ? Response.json(view(null)) : new Response(null, { status: 500 })));
      const { rerender } = render(withKey(0));
      await screen.findByText("Nie udało się wczytać stanu domeny.");
      ok = true;
      rerender(withKey(1));
      await waitFor(() => expect(screen.queryByText("Nie udało się wczytać stanu domeny.")).toBeNull());
      await screen.findByLabelText(/Nazwa domeny/);
    });

    it("spóźniona odpowiedź cichego GET po zapisie nie nadpisuje świeższego stanu", async () => {
      const user = userEvent.setup();
      const late = gate();
      let reads = 0;
      vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
        if (init?.method === "PUT") return Response.json(view(domain("PENDING_OWNERSHIP")));
        reads += 1;
        return reads === 1 ? Response.json(view(null)) : late.promise;
      });
      const { rerender } = render(withKey(0));
      await user.type(await screen.findByLabelText(/Nazwa domeny/), "kamper.klient.pl");
      rerender(withKey(1));
      await waitFor(() => expect(reads).toBe(2));
      await user.click(screen.getByRole("button", { name: "Dodaj domenę" }));
      await screen.findByText("kamper.klient.pl — Oczekuje na potwierdzenie własności");
      late.open(Response.json(view(null)));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(screen.getByText("kamper.klient.pl — Oczekuje na potwierdzenie własności")).toBeInTheDocument();
    });
  });
});
