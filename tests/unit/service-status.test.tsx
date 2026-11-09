// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServiceStatusCard, ServiceStatusProvider, formatLocalDate } from "../../src/components/panel/service-status";
import type { ServiceStatusDto } from "../../src/modules/reminders/read";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function status(over: Omit<Partial<ServiceStatusDto>, "period"> & { period?: Partial<ServiceStatusDto["period"]> } = {}): ServiceStatusDto {
  const { period, ...rest } = over;
  return {
    organizationId: "org", periodVersion: 1, serverTime: "2026-11-09T09:00:00.000Z",
    period: { headline: "TRIAL", paidThrough: null, paidValid: false, trialEndsAt: "2026-11-12T23:00:00.000Z", trialValid: true,
      effectiveEndsAt: "2026-11-12T23:00:00.000Z", effectiveSource: "TRIAL", ...period },
    site: { state: "VISIBLE", publicVisible: true }, expiredNotice: null, reminders: [], ...rest,
  };
}

function Form() { const [value, setValue] = useState("Auterva V01");
  return <input aria-label="Nazwa pojazdu" value={value} onChange={(event) => setValue(event.target.value)} />; }

function mount(initial: ServiceStatusDto) {
  return render(
    <ServiceStatusProvider area="company" initial={initial} publicHost="firma.example.test" title="Firma" currentPath="/admin/usluga" onLogout={vi.fn()}>
      <ServiceStatusCard /><Form />
    </ServiceStatusProvider>);
}

const sessionOk = (extra: (url: string) => Response | null) => vi.fn(async (url: string) =>
  extra(url) ?? new Response(JSON.stringify({ session: { id: "s" } }), { status: 200 }));

describe("status usługi w panelu firmy", () => {
  it("formatuje datę końca w Europe/Warsaw", () => {
    expect(formatLocalDate("2026-11-12T23:00:00.000Z")).toBe("13.11.2026");
    expect(formatLocalDate("2026-11-30")).toBe("30.11.2026");
  });

  it("nie podpisuje trialu jako opłaty i pokazuje konkretną datę oraz adres", () => {
    vi.stubGlobal("fetch", sessionOk(() => null));
    mount(status());
    const card = screen.getByTestId("service-status");
    expect(card).toHaveTextContent("Okres próbny do 13.11.2026 (to nie jest opłata)");
    expect(card).not.toHaveTextContent(/opłacone do/i);
    expect(screen.getByRole("link", { name: "firma.example.test" })).toHaveAttribute("href", "https://firma.example.test/");
    expect(card).not.toHaveTextContent(/zmień|edytuj/i);
    expect(screen.getByRole("link", { name: "Napisz do Autervy" })).toHaveAttribute("href", "/admin/czat");
  });

  it("po wygaśnięciu zachowuje formularz, pokazuje komunikat i link do czatu", () => {
    vi.stubGlobal("fetch", sessionOk(() => null));
    mount(status({ period: { headline: "EXPIRED", trialValid: false }, site: { state: "PERIOD_EXPIRED", publicVisible: false },
      expiredNotice: "Konto aktywne. Publiczna oferta jest obecnie wyłączona. Skontaktuj się z Autervą w sprawie uruchomienia okresu usługi." }));
    expect(screen.getByText(/Publiczna oferta jest obecnie wyłączona/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /czat/i })[0]).toHaveAttribute("href", "/admin/czat");
    expect(screen.getByRole("textbox", { name: "Nazwa pojazdu" })).toBeEnabled();
  });

  it("po przedłużeniu zastępuje stare przypomnienie danymi z serwera bez utraty formularza", async () => {
    const fresh = status({ periodVersion: 2, period: { headline: "PAID", paidThrough: "2026-12-31", paidValid: true } });
    const next: ServiceStatusDto = fresh;
    vi.stubGlobal("fetch", sessionOk((url) => url.includes("service-period") ? new Response(JSON.stringify(next), { status: 200 }) : null));
    mount(status({ reminders: [{ id: "r", offsetDays: 1, effectiveEndsAt: "x", source: "TRIAL", deliveredAt: "x", message: "Trial kończy się jutro." }] }));
    expect(screen.getByText("Trial kończy się jutro.")).toBeInTheDocument();
    const input = screen.getByRole("textbox", { name: "Nazwa pojazdu" });
    await act(async () => { input.focus(); window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.queryByText("Trial kończy się jutro.")).toBeNull());
    expect(screen.getByTestId("service-status")).toHaveTextContent("Opłacone do 31.12.2026 włącznie");
    expect(screen.getByTestId("service-status")).toHaveTextContent("Opłacony");
    expect(screen.getByRole("textbox", { name: "Nazwa pojazdu" })).toBe(input);
  });

  it("błąd odświeżenia usuwa przypomnienie i nie blokuje panelu", async () => {
    vi.stubGlobal("fetch", sessionOk((url) => url.includes("service-period") ? new Response("{}", { status: 500 }) : null));
    mount(status({ reminders: [{ id: "r", offsetDays: 7, effectiveEndsAt: "x", source: "TRIAL", deliveredAt: "x", message: "Trial kończy się za 7 dni." }] }));
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(screen.getByText("Nie udało się odświeżyć statusu usługi")).toBeInTheDocument());
    expect(screen.queryByText("Trial kończy się za 7 dni.")).toBeNull();
    expect(screen.getByRole("textbox", { name: "Nazwa pojazdu" })).toBeEnabled();
  });
});
