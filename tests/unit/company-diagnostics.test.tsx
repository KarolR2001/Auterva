// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CompanyDiagnostics } from "../../src/components/platform/company-diagnostics";
import { domainView, mailView, pickMail, type DiagnosticsDto } from "../../src/components/platform/launch-diagnostics-model";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const id = "11111111-1111-4111-8111-111111111111";
const fmt = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");
const now = new Date("2026-11-12T08:15:00Z");

function dto(patch: { domain?: Partial<DiagnosticsDto["domain"]>; custom?: Partial<NonNullable<DiagnosticsDto["domain"]["customDomain"]>> | null;
  delivery?: DiagnosticsDto["invitation"]["delivery"]; reminders?: DiagnosticsDto["reminders"]["items"]; lastMail?: DiagnosticsDto["lastMail"] } = {}): DiagnosticsDto {
  const custom = patch.custom === null ? null : {
    hostname: "wynajem.alfa.example", status: "ACTIVE" as const, state: "ACTIVE" as const, category: null, failureCode: null,
    checkedAt: "2026-11-12T08:15:00.000Z", retry: { action: "VERIFY_DOMAIN" as const, allowed: true, reason: null }, ...patch.custom };
  return {
    generatedAt: "2026-11-12T08:15:00.000Z", archived: false,
    domain: { severity: "OK", aliasHost: "ACTIVE", adminHost: "ACTIVE", customDomain: custom, ...patch.domain },
    invitation: { severity: "OK", state: "ISSUED", delivery: patch.delivery ?? null },
    reminders: { severity: "OK", items: patch.reminders ?? [] },
    ...(patch.lastMail !== undefined ? { lastMail: patch.lastMail } : {}),
  };
}
const delivery = (state: NonNullable<DiagnosticsDto["invitation"]["delivery"]>["state"], extra = {}) => ({
  state, errorCode: null, attempts: 1, maxAttempts: 5, lastAttemptAt: "2026-11-11T14:02:00.000Z", firstAttemptAt: "2026-11-11T14:00:00.000Z",
  nextAttemptAt: null, ...extra });

describe("model diagnostyki (#78)", () => {
  it.each([
    ["ok", dto(), "Aktywna"],
    ["brak domeny", dto({ custom: null }), "Brak domeny własnej"],
    ["w toku", dto({ custom: { state: "WAITING", status: "PENDING_OWNERSHIP", category: "OWNERSHIP" } }), "Weryfikacja w toku"],
    ["błąd DNS", dto({ custom: { state: "FAILED", category: "DNS", failureCode: "CNAME_MISMATCH" } }), "Błąd: DNS domeny"],
    ["konfiguracja", dto({ custom: { state: "FAILED", category: "CONFIG" } }), "Błąd: konfiguracja Autervy"],
    ["nie sprawdzano", dto({ custom: { state: "NOT_CHECKED", checkedAt: null } }), "Jeszcze nie sprawdzono"],
    ["alias", dto({ domain: { aliasHost: "PENDING" } }), "Błąd: adres Autervy"],
  ])("domena: %s", (_name, input, label) => {
    expect(domainView(input, fmt, now).label).toBe(label);
  });

  it("certyfikat: pole opcjonalne z #417; brak daty nie zgaduje ostrzeżenia", () => {
    const soon = dto({ custom: { tlsNotAfter: "2026-11-20T00:00:00.000Z" } });
    expect(domainView(soon, fmt, now)).toMatchObject({ tone: "warning", label: "Certyfikat wygasa wkrótce" });
    expect(domainView(soon, fmt, now).detail).toContain("20.11.2026");
    expect(domainView(dto({ custom: { tlsNotAfter: "2027-06-01T00:00:00.000Z" } }), fmt, now).tone).toBe("ok");
    expect(domainView(dto({ custom: { tlsNotAfter: "2026-11-01T00:00:00.000Z" } }), fmt, now).tone).toBe("error");
    expect(domainView(dto(), fmt, now).tone).toBe("ok");
  });

  it("poczta: stany wysyłki i ogólna przyczyna bez kodu błędu", () => {
    expect(mailView(dto(), fmt).label).toBe("Brak wysyłek");
    expect(mailView(dto({ delivery: delivery("ACCEPTED_BY_PROVIDER") }), fmt)).toMatchObject({ tone: "ok", label: "Ostatnia wysyłka przyjęta" });
    expect(mailView(dto({ delivery: delivery("RETRYING", { attempts: 2, nextAttemptAt: "2026-11-12T09:00:00.000Z" }) }), fmt).subject).toContain("próba 2 z 5");
    expect(mailView(dto({ delivery: delivery("QUEUED") }), fmt).label).toBe("Wysyłka w kolejce");
    expect(mailView(dto({ delivery: delivery("UNCERTAIN") }), fmt).label).toBe("Nie wiadomo, czy wysłano");
    const failed = mailView(dto({ delivery: delivery("FAILED", { errorCode: "DELIVERY_REJECTED" }) }), fmt);
    expect(failed).toMatchObject({ tone: "error", label: "Błąd: wysyłka nieudana" });
    expect(failed.detail).toContain("odrzucił");
    expect(JSON.stringify(failed)).not.toContain("DELIVERY_REJECTED");
    expect(JSON.stringify(mailView(dto({ delivery: delivery("FAILED", { errorCode: "SOMETHING_NEW" }) }), fmt))).not.toContain("SOMETHING_NEW");
  });

  it("poczta: błąd ma pierwszeństwo przed nowszym sukcesem, przyszłe przypomnienie nie jest wysyłką, lastMail z #417 wygrywa", () => {
    const reminder = (state: "DELIVERED" | "PENDING" | "FAILED", at: string) => ({ offsetDays: 7, slotAt: at, state, errorCode: null, attempts: 1, lastAttemptAt: at, nextAttemptAt: null });
    const mixed = dto({ delivery: delivery("FAILED"), reminders: [reminder("DELIVERED", "2026-11-12T07:00:00.000Z")] });
    expect(pickMail(mixed)?.kind).toBe("INVITATION");
    expect(pickMail(dto({ reminders: [reminder("PENDING", "2026-12-01T07:00:00.000Z")] }))).toBeNull();
    const preferred = dto({ delivery: delivery("FAILED"), lastMail: { kind: "REMINDER", at: "2026-11-12T07:00:00.000Z", state: "DELIVERED" } });
    expect(mailView(preferred, fmt).label).toBe("Ostatnia wysyłka przyjęta");
  });
});

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(responder: Responder) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    return responder(String(input), init);
  });
  return calls;
}
const block = (title: string) => within(screen.getByRole("region", { name: title }));

describe("karta Diagnostyka (#78)", () => {
  it("pokazuje bloki Domena i Poczta ze statusem tekstowym i datą sprawdzenia", async () => {
    mockApi(() => Response.json(dto({ delivery: delivery("ACCEPTED_BY_PROVIDER") })));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    expect(await block("Domena").findByText("Aktywna")).toBeInTheDocument();
    expect(block("Domena").getByText("wynajem.alfa.example")).toBeInTheDocument();
    expect(block("Domena").getByText(/Ostatnie sprawdzenie: 12\.11\.2026/)).toBeInTheDocument();
    expect(block("Poczta").getByText("Ostatnia wysyłka przyjęta")).toBeInTheDocument();
    expect(block("Poczta").getByText(/Nie potwierdza to odczytu/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Sprawdź ponownie" })).toHaveLength(2);
    expect(document.body.textContent).not.toMatch(/auterva-verification|_auterva-challenge|DELIVERY_|MAIL_/);
  });

  it("archiwum: stan Nie dotyczy bez przycisków i bez zapytań", () => {
    const calls = mockApi(() => Response.json({}));
    render(<CompanyDiagnostics organizationId={id} archived />);
    expect(screen.getByText("Nie dotyczy — firma zarchiwizowana")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("Sprawdź ponownie w domenie: POST weryfikacji, stan w toku z komunikatem live i zablokowanym przyciskiem, potem odczyt i fokus na przycisku", async () => {
    const user = userEvent.setup();
    let release: () => void = () => {};
    let reads = 0;
    const calls = mockApi(async (url, init) => {
      if (init?.method === "POST") { await new Promise<void>((resolve) => { release = resolve; }); return Response.json({ domain: {} }); }
      reads += 1;
      return Response.json(reads === 1 ? dto({ custom: { state: "FAILED", category: "DNS" } }) : dto());
    });
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Błąd: DNS domeny");
    const button = block("Domena").getByRole("button", { name: "Sprawdź ponownie" });
    button.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(block("Domena").getByText("Weryfikacja w toku")).toBeInTheDocument());
    expect(block("Domena").getByRole("status")).toHaveTextContent("Sprawdzanie teraz… Wynik pojawi się tutaj.");
    expect(block("Domena").getByRole("button", { name: "Sprawdzanie…" })).toBeDisabled();
    expect(block("Domena").getByText(/Poprzednie sprawdzenie/)).toBeInTheDocument();
    release();
    await block("Domena").findByText("Aktywna");
    expect(calls.find((call) => call.method === "POST")).toMatchObject({ url: `/api/platform/companies/${id}/domains/verify/` });
    expect((calls.find((call) => call.method === "POST")?.body as { eventKey: string }).eventKey).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(block("Domena").getByRole("button", { name: "Sprawdź ponownie" })).toHaveFocus());
  });

  it("5xx przy weryfikacji: Wynik niepewny z ostatnim potwierdzonym wynikiem, bez fałszywego sukcesu i bez odczytu", async () => {
    const user = userEvent.setup();
    const calls = mockApi((url, init) => init?.method === "POST" ? new Response("boom", { status: 503 }) : Response.json(dto()));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Aktywna");
    await user.click(block("Domena").getByRole("button", { name: "Sprawdź ponownie" }));
    expect(await block("Domena").findByText("Wynik niepewny")).toBeInTheDocument();
    expect(block("Domena").getByText(/Ostatni potwierdzony wynik: Aktywna, 12\.11\.2026/)).toBeInTheDocument();
    expect(block("Domena").queryByText(/^Aktywna$/)).toBeNull();
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
    expect(block("Poczta").queryByText("Wynik niepewny")).toBeNull();
  });

  it("Poczta nie ma aktywnego sprawdzenia: ponowny odczyt GET, bez POST", async () => {
    const user = userEvent.setup();
    let reads = 0;
    const calls = mockApi(() => { reads += 1; return Response.json(reads === 1 ? dto() : dto({ delivery: delivery("FAILED", { errorCode: "MAIL_PERMANENT" }) })); });
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Poczta").findByText("Brak wysyłek");
    await user.click(block("Poczta").getByRole("button", { name: "Sprawdź ponownie" }));
    expect(await block("Poczta").findByText("Błąd: wysyłka nieudana")).toBeInTheDocument();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("błąd odczytu przy pierwszym wczytaniu: oba bloki niepewne, bez zgadywania wyniku", async () => {
    mockApi(() => new Response("x", { status: 500 }));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    expect(await block("Domena").findByText("Wynik niepewny")).toBeInTheDocument();
    expect(block("Domena").getByText("Brak potwierdzonego wyniku.")).toBeInTheDocument();
    expect(block("Poczta").getByText("Wynik niepewny")).toBeInTheDocument();
  });

  it("brak konfiguracji platformy blokuje sprawdzenie domeny z wyjaśnieniem", async () => {
    mockApi(() => Response.json(dto({ custom: { state: "FAILED", category: "CONFIG",
      retry: { action: "VERIFY_DOMAIN", allowed: false, reason: "PLATFORM_CONFIG_REQUIRED" } } })));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Błąd: konfiguracja Autervy");
    expect(block("Domena").getByRole("button", { name: "Sprawdź ponownie" })).toBeDisabled();
    expect(block("Domena").getByText(/Najpierw uzupełnij konfigurację/)).toBeInTheDocument();
  });

  it("429 przy weryfikacji: komunikat o limicie, aktualny zapisany stan, bez niepewności", async () => {
    const user = userEvent.setup();
    mockApi((url, init) => init?.method === "POST" ? Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": "30" } }) : Response.json(dto()));
    render(<CompanyDiagnostics organizationId={id} archived={false} />);
    await block("Domena").findByText("Aktywna");
    await user.click(block("Domena").getByRole("button", { name: "Sprawdź ponownie" }));
    expect(await block("Domena").findByText(/Limit sprawdzeń. Spróbuj ponownie za 30 s/)).toBeInTheDocument();
    expect(block("Domena").queryByText("Wynik niepewny")).toBeNull();
  });
});
