// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CalendarBlock } from "../../src/components/admin/calendar-api";
import { VehicleCalendar } from "../../src/components/admin/vehicle-calendar";
import {
  changedFields, countDays, createFields, dayLabel, dayView, emptyValues, createCandidates, warsawDate, settleDelete, settleEdit, startsInPast, surroundingRange, validateValues,
} from "../../src/components/admin/vehicle-calendar-model";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const VEHICLE = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-09";
const block = (over: Partial<CalendarBlock> = {}): CalendarBlock => ({ id: "b1", from: "2026-11-12", to: "2026-11-14", type: "MAINTENANCE", typeLabel: "Serwis",
  source: "MANUAL", reference: "FV-1", internalNote: "wymiana opon", version: 3, ...over });

describe("#39 model: daty, walidacja, stany dni", () => {
  it("jeden dzień i granice włącznie są poprawne, odwrócony zakres nie", () => {
    expect(validateValues({ ...emptyValues("2026-11-10") }).errors).toEqual({});
    expect(countDays("2026-11-10", "2026-11-10")).toBe(1);
    expect(countDays("2026-11-10", "2026-11-12")).toBe(3);
    expect(countDays("2028-02-28", "2028-03-01")).toBe(3);
    expect(validateValues({ ...emptyValues("2026-11-10"), to: "2026-11-09" }).errors.to).toMatch(/nie może być wcześniejsza/);
    expect(validateValues({ ...emptyValues("2026-13-45"), to: "2026-11-09" }).errors.from).toMatch(/RRRR-MM-DD/);
    expect(validateValues({ ...emptyValues(), type: "OTHER" }).errors.from).toBeDefined();
  });
  it("przekroczenie limitów i znaki sterujące są błędami pól", () => {
    expect(validateValues({ ...emptyValues("2026-11-10"), reference: "x".repeat(121) }).errors.reference).toBeDefined();
    expect(validateValues({ ...emptyValues("2026-11-10"), reference: "a\nb" }).errors.reference).toBeDefined();
    expect(validateValues({ ...emptyValues("2026-11-10"), internalNote: "x".repeat(2001) }).errors.internalNote).toBeDefined();
    expect(validateValues({ ...emptyValues("2026-11-10"), internalNote: "linia 1\nlinia 2" }).errors).toEqual({});
  });
  it("przeszłość tylko ostrzega: porównuje z dzisiaj z Warszawy, dzisiaj nie jest przeszłością", () => {
    expect(startsInPast(emptyValues("2026-11-08"), TODAY)).toBe(true);
    expect(startsInPast(emptyValues(TODAY), TODAY)).toBe(false);
    expect(startsInPast(emptyValues("nie-data"), TODAY)).toBe(false);
  });
  it("wysyła przy edycji tylko zmienione pola, a puste teksty jako null", () => {
    const base = { from: "2026-11-12", to: "2026-11-14", type: "MAINTENANCE" as const, reference: "FV-1", internalNote: "notatka" };
    expect(changedFields(base, { ...base, type: "BLOCKED" })).toEqual({ type: "BLOCKED" });
    expect(changedFields(base, { ...base, reference: "  ", internalNote: "notatka " })).toEqual({ reference: null });
    expect(createFields({ ...base, reference: "", internalNote: "" })).toEqual({ from: "2026-11-12", to: "2026-11-14", type: "MAINTENANCE" });
  });
  it("bez odczytu dzień jest nieznany, nigdy wolny; serwis ma etykietę Serwis", () => {
    expect(dayView("2026-11-10", null).kind).toBe("unknown");
    const read = { vehicleId: VEHICLE, availableFrom: "2026-01-01", availableTo: null, blocks: [block()],
      days: [{ date: "2026-11-10", available: true }, { date: "2026-11-12", available: false }, { date: "2026-12-30", available: false }] };
    expect(dayView("2026-11-10", read).kind).toBe("free");
    expect(dayView("2026-11-13", read).kind).toBe("blocked");
    expect(dayView("2026-12-30", read).kind).toBe("inactive");
    expect(dayView("2026-12-31", read).kind).toBe("unknown");
    expect(dayLabel("2026-11-12", dayView("2026-11-12", read), TODAY, (d) => d)).toContain("Serwis");
    expect(dayLabel("2026-11-08", dayView("2026-11-10", read), TODAY, (d) => d)).toContain("minął");
  });
  it("po utraconej odpowiedzi odczyt rozstrzyga, czy zapis się udał", () => {
    const values = { from: "2026-11-12", to: "2026-11-14", type: "MAINTENANCE" as const, reference: "", internalNote: "" };
    expect(createCandidates([block({ reference: null })], values, new Set())).toHaveLength(1);
    expect(createCandidates([block({ reference: null })], values, new Set(["b1"]))).toHaveLength(0); // known before the request: not ours
    expect(createCandidates([], values, new Set())).toHaveLength(0);
    expect(createCandidates([block({ to: "2026-11-15" })], values, new Set())).toHaveLength(0);
    expect(settleEdit([block()], "b1", 3, values)).toBe("not-saved");
    expect(settleEdit([block({ version: 4, reference: null, internalNote: null })], "b1", 3, values)).toBe("saved");
    expect(settleEdit([block({ version: 4, to: "2026-11-20" })], "b1", 3, values)).toBe("changed-elsewhere");
    expect(settleEdit([], "b1", 3, values)).toBe("changed-elsewhere");
    expect(settleDelete([], "b1")).toBe("saved");
    expect(settleDelete([block()], "b1")).toBe("not-saved");
    expect(surroundingRange({ from: "2026-01-01", to: "2027-06-01" })).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });
});

type Server = { blocks: CalendarBlock[]; calls: { method: string; url: string; body: unknown }[]; fail?: (call: { method: string; url: string; body: unknown }) => Response | Promise<Response | null> | null };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function install(server: Server, vehicle: Partial<{ status: string }> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const call = { method, url, body };
    server.calls.push(call);
    const forced = await server.fail?.(call);
    if (forced) return forced;
    if (/\/vehicles\/[^/]+\/availability\//.test(url)) {
      const params = new URL(url, "http://x").searchParams;
      const from = params.get("from")!; const to = params.get("to")!;
      const days: { date: string; available: boolean }[] = [];
      for (let cursor = Date.parse(`${from}T00:00:00Z`); cursor <= Date.parse(`${to}T00:00:00Z`); cursor += 86_400_000) {
        const date = new Date(cursor).toISOString().slice(0, 10);
        days.push({ date, available: !server.blocks.some((entry) => entry.from <= date && entry.to >= date) });
      }
      return reply(200, { vehicleId: VEHICLE, availableFrom: "2026-01-01", availableTo: null, days,
        blocks: server.blocks.filter((entry) => entry.from <= to && entry.to >= from) });
    }
    if (/\/vehicles\/[^/]+\/blocks\/$/.test(url) && method === "POST") {
      const fields = (body as { fields: Partial<CalendarBlock> }).fields;
      const created = block({ id: `n${server.blocks.length + 1}`, version: 0, reference: fields.reference ?? null, internalNote: fields.internalNote ?? null,
        from: fields.from!, to: fields.to!, type: fields.type!, typeLabel: fields.type === "MAINTENANCE" ? "Serwis" : "Zablokowane" });
      server.blocks.push(created);
      return reply(201, created);
    }
    if (/\/blocks\/[^/]+\/$/.test(url) && method === "DELETE") {
      const id = url.split("/blocks/")[1]!.replace("/", "");
      server.blocks = server.blocks.filter((entry) => entry.id !== id);
      return reply(200, { id, deleted: true });
    }
    if (/\/vehicles\/[^/]+\/$/.test(url)) return reply(200, { id: VEHICLE, name: "Bus Alfa", status: vehicle.status ?? "PUBLISHED", version: 1, availableFrom: "2026-01-01", availableTo: null });
    return reply(404, { code: "NOT_FOUND" });
  }));
}
const mount = () => render(<VehicleCalendar vehicleId={VEHICLE} today={TODAY} title="Kalendarz" />);
const day = (text: RegExp | string) => screen.findByRole("button", { name: text });

describe("#39 kalendarz pojazdu", () => {
  it("pokazuje Serwis, jeden dzień i granice włącznie z odpowiedzi serwera, bez pól prywatnych w komórkach", async () => {
    const server: Server = { blocks: [block({ from: "2026-11-12", to: "2026-11-14" })], calls: [] };
    install(server); mount();
    expect(await day(/12 listopada 2026, zajęty, Serwis/)).toBeInTheDocument();
    expect(await day(/14 listopada 2026, zajęty, Serwis/)).toBeInTheDocument();
    expect(await day(/15 listopada 2026, wolny/)).toBeInTheDocument();
    expect(await day(/11 listopada 2026, wolny/)).toBeInTheDocument();
    expect(screen.getAllByText("Serwis").length).toBeGreaterThan(0);
  });

  it("dodaje blokadę na jeden dzień z kalendarza i odczytuje stan ponownie", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [], calls: [] };
    install(server); mount();
    await user.click(await day(/20 listopada 2026, wolny/));
    await user.click(screen.getByRole("button", { name: "Dodaj blokadę na ten dzień" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^Od/)).toHaveValue("2026-11-20");
    expect(within(dialog).getByLabelText(/^Do/)).toHaveValue("2026-11-20");
    await user.selectOptions(within(dialog).getByLabelText(/^Typ/), "MAINTENANCE");
    await user.click(within(dialog).getByRole("button", { name: "Dodaj blokadę" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = server.calls.find((call) => call.method === "POST")!;
    expect(post.body).toEqual({ fields: { from: "2026-11-20", to: "2026-11-20", type: "MAINTENANCE" } });
    expect(await day(/20 listopada 2026, zajęty, Serwis/)).toBeInTheDocument();
    expect(screen.getByText("Blokada została dodana.")).toBeInTheDocument();
  });

  it("wybór dwóch dni z klawiatury ustawia zakres, a pola dat są alternatywą", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [], calls: [] };
    install(server); mount();
    const start = await day(/10 listopada 2026, wolny/);
    start.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowRight}{ArrowRight}{Enter}");
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/^Od/)).toHaveValue("2026-11-10");
    expect(within(dialog).getByLabelText(/^Do/)).toHaveValue("2026-11-12");
    expect(within(dialog).getByText(/3 dni/)).toBeInTheDocument();
  });

  it("konflikt overlap: nic nie jest zapisane, wpisy zostają, można przejść do istniejącego wpisu i wrócić", async () => {
    const user = userEvent.setup();
    const existing = block({ id: "ex", from: "2026-11-12", to: "2026-11-14", version: 7 });
    const server: Server = { blocks: [existing], calls: [],
      fail: (call) => (call.method === "POST" ? reply(409, { code: "BLOCK_OVERLAP", conflict: { id: "ex", from: existing.from, to: existing.to, type: "MAINTENANCE", version: 7 } }) : null) };
    install(server); mount();
    await user.click(await day(/11 listopada 2026, wolny/));
    await user.click(screen.getAllByRole("button", { name: "Dodaj okres niedostępności" })[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText(/^Do/));
    await user.type(within(dialog).getByLabelText(/^Do/), "2026-11-13");
    await user.type(within(dialog).getByLabelText(/Numer odniesienia/), "MOJ-NR");
    await user.click(within(dialog).getByRole("button", { name: "Dodaj blokadę" }));
    expect(await within(dialog).findByText("Termin nakłada się na istniejącą blokadę.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Numer odniesienia/)).toHaveValue("MOJ-NR");
    expect(within(dialog).getByLabelText(/^Do/)).toHaveValue("2026-11-13");
    await user.click(within(dialog).getByRole("button", { name: "Przejdź do istniejącego wpisu" }));
    expect(await within(dialog).findByRole("heading", { name: "Edytuj blokadę" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Numer odniesienia/)).toHaveValue("FV-1");
    await user.click(within(dialog).getByRole("button", { name: "Wróć do niezapisanego wpisu" }));
    expect(within(dialog).getByLabelText(/Numer odniesienia/)).toHaveValue("MOJ-NR");
  });

  it("konflikt wersji przy edycji zachowuje wpisy i pokazuje aktualny stan, a zapis idzie z nową wersją", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [block({ version: 3 })], calls: [] };
    let patches = 0;
    server.fail = (call) => {
      if (call.method !== "PATCH") return null;
      patches += 1;
      if (patches === 1) { server.blocks = [block({ version: 4, to: "2026-11-16" })]; return reply(409, { code: "BLOCK_VERSION_CONFLICT" }); }
      return reply(200, block({ version: 5, type: "BLOCKED", typeLabel: "Zablokowane", to: "2026-11-16" }));
    };
    install(server); mount();
    await user.click(await day(/12 listopada 2026, zajęty, Serwis/));
    const dialog = await screen.findByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/^Typ/), "BLOCKED");
    await user.click(within(dialog).getByRole("button", { name: "Zapisz zmiany" }));
    expect(await within(dialog).findByText(/Blokada została zmieniona przez kogoś innego/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Typ/)).toHaveValue("BLOCKED");
    expect(await within(dialog).findByText(/Aktualnie na serwerze: Serwis, 12–16 listopada 2026/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Wczytaj aktualną wersję" }));
    await user.click(within(dialog).getByRole("button", { name: "Zapisz zmiany" }));
    await waitFor(() => expect(server.calls.filter((call) => call.method === "PATCH")).toHaveLength(2));
    const second = server.calls.filter((call) => call.method === "PATCH")[1]!;
    // The other editor's new end date (16th) is not reverted by the stale 14th that was in the form.
    expect(second.body).toEqual({ expectedVersion: 4, fields: { type: "BLOCKED" } });
  });

  it("data z przeszłości wymaga potwierdzenia, zanim zostanie wysłana", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [], calls: [] };
    install(server); mount();
    await user.click((await screen.findAllByRole("button", { name: "Dodaj okres niedostępności" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Od/), "2026-11-01");
    await user.type(within(dialog).getByLabelText(/^Do/), "2026-11-03");
    expect(await within(dialog).findByText("Termin zaczyna się w przeszłości.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Dodaj blokadę" }));
    expect(await within(dialog).findByText("Potwierdź zapis okresu z przeszłości.")).toBeInTheDocument();
    expect(server.calls.some((call) => call.method === "POST")).toBe(false);
    await user.click(within(dialog).getByLabelText("Rozumiem, zapisz okres z przeszłości"));
    await user.click(within(dialog).getByRole("button", { name: "Dodaj blokadę" }));
    await waitFor(() => expect(server.calls.some((call) => call.method === "POST")).toBe(true));
  });

  it("utracona odpowiedź: nie ponawia na ślepo, odczytuje stan i nie zapisuje drugi raz", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [], calls: [] };
    let lose = true;
    server.fail = (call) => {
      if (call.method === "POST" && lose) {
        lose = false;
        // The server commits but the answer is lost.
        server.blocks.push(block({ id: "late", from: "2026-11-20", to: "2026-11-21", type: "BLOCKED", typeLabel: "Zablokowane", reference: null, internalNote: null }));
        throw new TypeError("network");
      }
      return null;
    };
    install(server); mount();
    await user.click((await screen.findAllByRole("button", { name: "Dodaj okres niedostępności" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Od/), "2026-11-20");
    await user.type(within(dialog).getByLabelText(/^Do/), "2026-11-21");
    await user.click(within(dialog).getByRole("button", { name: "Dodaj blokadę" }));
    expect(await within(dialog).findByText("Nie wiemy, czy zmiana została zapisana.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Sprawdź stan" }));
    // A block of the same range is only a candidate: the user confirms it, nothing is claimed automatically.
    expect(await within(dialog).findByText("Na serwerze jest wpis z tym zakresem.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Od/)).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "To mój wpis" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.calls.filter((call) => call.method === "POST")).toHaveLength(1);
    expect(screen.getByText("Blokada została dodana.")).toBeInTheDocument();
  });

  it("utracona odpowiedź, a zapisu nie było: brak kandydatów, wpisy zostają i można zapisać ponownie", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [], calls: [] };
    let lose = true;
    server.fail = (call) => { if (call.method === "POST" && lose) { lose = false; throw new TypeError("network"); } return null; };
    install(server); mount();
    await user.click((await screen.findAllByRole("button", { name: "Dodaj okres niedostępności" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Od/), "2026-11-20");
    await user.type(within(dialog).getByLabelText(/^Do/), "2026-11-21");
    await user.click(within(dialog).getByRole("button", { name: "Dodaj blokadę" }));
    await user.click(await within(dialog).findByRole("button", { name: "Sprawdź stan" }));
    expect(await within(dialog).findByText(/Zmiana nie została zapisana/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Od/)).toHaveValue("2026-11-20");
    await user.click(within(dialog).getByRole("button", { name: "Dodaj blokadę" }));
    await waitFor(() => expect(server.calls.filter((call) => call.method === "POST")).toHaveLength(2));
  });

  it("po północy w Warszawie karta odświeża dzień: oznaczenie dzisiaj i zakres listy", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      vi.setSystemTime(new Date("2026-11-09T22:59:00Z")); // 23:59 in Warsaw
      expect(warsawDate()).toBe("2026-11-09");
      const server: Server = { blocks: [], calls: [] };
      install(server); mount();
      await screen.findByRole("button", { name: /9 listopada 2026, wolny, dzisiaj/ });
      vi.setSystemTime(new Date("2026-11-09T23:01:00Z")); // 00:01 on the 10th in Warsaw
      expect(warsawDate()).toBe("2026-11-10");
      await vi.advanceTimersByTimeAsync(31_000);
      await screen.findByRole("button", { name: /10 listopada 2026, wolny, dzisiaj/ });
      expect(screen.getByRole("button", { name: /9 listopada 2026, wolny, minął/ })).toBeInTheDocument();
      const lists = server.calls.filter((call) => /from=2026-11-10&to=2027-11-09/.test(call.url));
      expect(lists.length).toBeGreaterThan(0);
    } finally { vi.useRealTimers(); }
  });

  it("Enter po utraconej odpowiedzi czyta stan zamiast wysyłać drugi POST, a pola są zablokowane", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [], calls: [] };
    server.fail = (call) => { if (call.method === "POST") throw new TypeError("network"); return null; };
    install(server); mount();
    await user.click((await screen.findAllByRole("button", { name: "Dodaj okres niedostępności" }))[0]!);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText(/^Od/), "2026-11-20");
    await user.type(within(dialog).getByLabelText(/^Do/), "2026-11-21");
    await user.type(within(dialog).getByLabelText(/Numer odniesienia/), "X");
    await user.keyboard("{Enter}");
    expect(await within(dialog).findByText("Nie wiemy, czy zmiana została zapisana.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Od/)).toBeDisabled();
    const reads = () => server.calls.filter((call) => call.method === "GET").length;
    const before = reads();
    within(dialog).getByLabelText(/Numer odniesienia/).focus();
    (dialog.querySelector("form") as HTMLFormElement).requestSubmit();
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    expect(server.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  });

  it("Tab zaraz po PageDown: po wczytaniu miesiąca fokus nie wraca do siatki", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [], calls: [] };
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    server.fail = async (call) => {
      if (/from=2026-12-01/.test(call.url)) await gate; // the next month answers late
      return null;
    };
    install(server); mount();
    const day = await screen.findByRole("button", { name: /10 listopada 2026, wolny/ });
    day.focus();
    await user.keyboard("{PageDown}");
    await user.tab();
    const away = document.activeElement;
    expect(away?.closest("table")).toBeNull();
    release!();
    await screen.findByRole("button", { name: /, 1 grudnia 2026/ });
    await waitFor(() => expect(document.activeElement).toBe(away));
    expect(document.activeElement?.closest("table")).toBeNull();
  });

  it("usuwanie wymaga potwierdzenia i wysyła wersję", async () => {
    const user = userEvent.setup();
    const server: Server = { blocks: [block({ version: 3 })], calls: [] };
    install(server); mount();
    await user.click(await screen.findByRole("button", { name: /Usuń blokadę: Serwis, 12–14 listopada 2026/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Usunąć blokadę?" })).toBeInTheDocument();
    expect(server.calls.some((call) => call.method === "DELETE")).toBe(false);
    await user.click(within(dialog).getByRole("button", { name: "Usuń blokadę" }));
    await waitFor(() => expect(server.calls.find((call) => call.method === "DELETE")?.body).toEqual({ expectedVersion: 3 }));
    expect(await day(/13 listopada 2026, wolny/)).toBeInTheDocument();
  });

  it("błąd odczytu kalendarza nie pokazuje dni jako wolnych", async () => {
    const server: Server = { blocks: [], calls: [], fail: (call) => (/availability\//.test(call.url) ? reply(500, { code: "INTERNAL_ERROR" }) : null) };
    install(server); mount();
    expect(await screen.findAllByText("Nie udało się wczytać kalendarza.")).not.toHaveLength(0);
    expect(await day(/15 listopada 2026, stan nieznany/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /wolny/ })).toBeNull();
  });

  it("zarchiwizowany pojazd nie przyjmuje nowych blokad, ale pozwala usuwać", async () => {
    const server: Server = { blocks: [block()], calls: [] };
    install(server, { status: "ARCHIVED" }); mount();
    expect(await screen.findByText("Pojazd jest zarchiwizowany.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Dodaj okres niedostępności" })).toBeNull();
    expect(screen.getByRole("button", { name: /Usuń blokadę/ })).toBeInTheDocument();
  });
});
