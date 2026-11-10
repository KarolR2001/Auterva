// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FleetCalendar } from "../../src/components/admin/fleet-calendar";
import {
  blockHref, blocksCountText, clampAnchor, placeBlock, shiftWindow, todayText, vehiclesText, windowDates, windowOf,
} from "../../src/components/admin/fleet-calendar-model";
import { platformContext, type FleetGrid } from "../../src/components/admin/fleet-api";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const TODAY = "2026-11-10";
const CAR = "11111111-1111-4111-8111-111111111111";
const EMPTY_CAR = "22222222-2222-4222-8222-222222222222";
const days = (from: string, count: number, off: string[] = []) => Array.from({ length: count }, (_, index) => {
  const date = new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10);
  return { date, available: !off.includes(date) };
});
const grid = (over: Partial<FleetGrid> = {}): FleetGrid => ({ from: TODAY, to: "2026-11-23", total: 2, page: 1, pageSize: 20, items: [
  { vehicleId: CAR, name: "Mercedes Klasa V", slug: "mercedes", status: "PUBLISHED", availableFrom: null, availableTo: null,
    days: days(TODAY, 14, ["2026-11-12", "2026-11-13"]), blocks: [{ id: "b1", from: "2026-11-12", to: "2026-11-13", type: "MAINTENANCE", typeLabel: "Serwis", version: 1 }] },
  { vehicleId: EMPTY_CAR, name: "Volkswagen California", slug: "vw", status: "PUBLISHED", availableFrom: null, availableTo: null, days: days(TODAY, 14), blocks: [] },
], ...over });
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("#66 model: okno, miejsce bloku, teksty", () => {
  it("14 dni i miesiąc mają włączne końce; przesunięcie i granice zakresu", () => {
    expect(windowOf("14", TODAY)).toEqual({ from: "2026-11-10", to: "2026-11-23" });
    expect(windowOf("month", TODAY)).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(windowOf("month", "2028-02-10").to).toBe("2028-02-29");
    expect(windowDates("2026-11-10", "2026-11-10")).toEqual(["2026-11-10"]);
    expect(windowDates("2026-11-10", "2026-11-23")).toHaveLength(14);
    expect(shiftWindow("14", TODAY, 1, TODAY)).toBe("2026-11-24");
    expect(shiftWindow("month", TODAY, -1, TODAY)).toBe("2026-10-01");
    expect(clampAnchor("2100-01-01", TODAY) < "2100-01-01").toBe(true);
  });
  it("blok jednodniowy, przycięty z obu stron i spoza okna", () => {
    expect(placeBlock({ from: "2026-11-12", to: "2026-11-12" }, "2026-11-10", "2026-11-23")).toEqual({ start: 3, span: 1 });
    expect(placeBlock({ from: "2026-11-01", to: "2026-12-30" }, "2026-11-10", "2026-11-23")).toEqual({ start: 1, span: 14 });
    expect(placeBlock({ from: "2026-11-23", to: "2026-11-25" }, "2026-11-10", "2026-11-23")).toEqual({ start: 14, span: 1 });
    expect(placeBlock({ from: "2026-11-24", to: "2026-11-25" }, "2026-11-10", "2026-11-23")).toBeNull();
    expect(placeBlock({ from: "2026-11-01", to: "2026-11-09" }, "2026-11-10", "2026-11-23")).toBeNull();
  });
  it("liczebniki, dziś z odpowiedzi serwera i linki do bloku", () => {
    expect([0, 1, 2, 5, 12, 22].map(blocksCountText)).toEqual(["Brak blokad w wybranym zakresie", "1 blokada w zakresie", "2 blokady w zakresie", "5 blokad w zakresie", "12 blokad w zakresie", "22 blokady w zakresie"]);
    expect([1, 3, 6].map(vehiclesText)).toEqual(["1 pojazd", "3 pojazdy", "6 pojazdów"]);
    expect(todayText(days(TODAY, 2, [TODAY]), TODAY)).toBe("dziś niedostępny");
    expect(todayText(days(TODAY, 2), TODAY)).toBe("dziś wolny");
    expect(todayText(days("2026-11-11", 2), TODAY)).toBeNull();
    expect(blockHref("/firmy/o1", CAR, { id: "b1", from: "2026-12-31" })).toBe(`/firmy/o1/pojazdy/${CAR}/kalendarz/?blok=b1&miesiac=2026-12`);
  });
});

describe("#66 ekran: loading, dane, pusty, błąd, kontekst firmy", () => {
  it("#298: pojazd bez blokad rysuje dni tylko gdy któryś jest poza aktywnością", async () => {
    const outside = { vehicleId: "33333333-3333-4333-8333-333333333333", name: "Skoda Kodiaq", slug: "skoda", status: "PUBLISHED" as const, availableFrom: null, availableTo: "2026-11-14", days: days(TODAY, 14, ["2026-11-15", "2026-11-16"]), blocks: [] };
    const base = grid();
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, grid({ items: [base.items[1], outside], total: 2 }))));
    render(<FleetCalendar today={TODAY} title="Kalendarz floty · Firma" />);
    const region = await screen.findByRole("region", { name: /Kalendarz floty, przewijany poziomo/ });
    const trackOf = (name: string) => within(region).getByRole("link", { name }).closest("li")!.lastElementChild as HTMLElement;
    expect(trackOf("Volkswagen California").querySelectorAll("div[aria-hidden]")).toHaveLength(0);
    expect(trackOf("Skoda Kodiaq").querySelectorAll("div[aria-hidden]")).toHaveLength(14);
  });
  it("pokazuje loading, potem pojazdy z blokadami i linkami do auta i bloku (firma)", async () => {
    const fetchMock = vi.fn(async (_url: string) => reply(200, grid()));
    vi.stubGlobal("fetch", fetchMock);
    render(<FleetCalendar today={TODAY} title="Kalendarz floty · Firma" />);
    expect(screen.getByRole("status", { name: "Ładowanie kalendarza floty" })).toBeInTheDocument();
    const region = await screen.findByRole("region", { name: /Kalendarz floty, przewijany poziomo/ });
    const url = new URL(String(fetchMock.mock.calls[0][0]), "http://x");
    expect(url.pathname).toBe("/api/admin/availability/fleet/");
    expect(Object.fromEntries(url.searchParams)).toEqual({ from: TODAY, to: "2026-11-23", page: "1", pageSize: "20" });
    const blockLink = within(region).getByRole("link", { name: /Mercedes Klasa V: Serwis 12–13\.11\.2026/ });
    expect(blockLink).toHaveAttribute("href", `/admin/pojazdy/${CAR}/kalendarz/?blok=b1&miesiac=2026-11`);
    // #298: the empty row says it once, in the vehicle column, and draws no day lines.
    expect(within(region).getAllByText("Brak blokad w wybranym zakresie")).toHaveLength(1);
    expect(screen.getByText("2 pojazdy · horyzont 14 dni · Europe/Warsaw")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Kalendarz Volkswagen California/ })[0]).toHaveAttribute("href", `/admin/pojazdy/${EMPTY_CAR}/kalendarz/`);
  });

  it("kontekst superadmina woła API wybranej firmy i linkuje pod /firmy/{id}", async () => {
    const fetchMock = vi.fn(async (_url: string) => reply(200, grid()));
    vi.stubGlobal("fetch", fetchMock);
    render(<FleetCalendar context={platformContext("33333333-3333-4333-8333-333333333333")} today={TODAY} title="Kalendarz floty · Firma" />);
    const region = await screen.findByRole("region", { name: /przewijany poziomo/ });
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^\/api\/platform\/companies\/33333333-3333-4333-8333-333333333333\/availability\/fleet\/\?/);
    expect(within(region).getByRole("link", { name: /Mercedes Klasa V: Serwis/ }).getAttribute("href")).toMatch(/^\/firmy\/33333333-3333-4333-8333-333333333333\/pojazdy\//);
  });

  it("przełączenie na miesiąc i zakres wstecz/dalej odczytują serwer ponownie, status resetuje stronę", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string) => reply(200, grid()));
    vi.stubGlobal("fetch", fetchMock);
    render(<FleetCalendar today={TODAY} title="t" />);
    await screen.findByRole("region", { name: /przewijany poziomo/ });
    await user.click(screen.getByRole("button", { name: "Miesiąc" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(new URL(String(fetchMock.mock.calls[1][0]), "http://x").searchParams.get("to")).toBe("2026-11-30");
    await user.click(await screen.findByRole("button", { name: "Następny miesiąc" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(new URL(String(fetchMock.mock.calls[2][0]), "http://x").searchParams.get("from")).toBe("2026-12-01");
    await user.selectOptions(await screen.findByLabelText("Status pojazdu"), "ARCHIVED");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(new URL(String(fetchMock.mock.calls[3][0]), "http://x").searchParams.get("status")).toBe("ARCHIVED");
  });

  it("pusta flota to komunikat, a nie siatka", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, grid({ total: 0, items: [] }))));
    render(<FleetCalendar today={TODAY} title="t" />);
    expect(await screen.findByText("Brak pojazdów do pokazania.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /przewijany/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Szybka blokada" })).toBeDisabled();
  });

  it("błąd odczytu nie pokazuje starego wyniku i pozwala ponowić", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (_url: string) => reply(200, grid())).mockResolvedValueOnce(reply(500, { code: "INTERNAL" })).mockResolvedValue(reply(200, grid()));
    vi.stubGlobal("fetch", fetchMock);
    render(<FleetCalendar today={TODAY} title="t" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Nie udało się wczytać kalendarza floty.");
    expect(screen.queryByRole("link", { name: /Mercedes/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByRole("region", { name: /przewijany/ })).toBeInTheDocument();
  });

  it("szybka blokada prowadzi do formularza blokady wybranego pojazdu (#39)", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, grid())));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<FleetCalendar today={TODAY} title="t" />);
    await screen.findByRole("region", { name: /przewijany/ });
    await user.click(screen.getByRole("button", { name: "Szybka blokada" }));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText("Pojazd"), EMPTY_CAR);
    await user.click(within(dialog).getByRole("button", { name: "Dalej" }));
    expect(assign).toHaveBeenCalledWith(`/admin/pojazdy/${EMPTY_CAR}/kalendarz/?dodaj=1`);
  });
});
