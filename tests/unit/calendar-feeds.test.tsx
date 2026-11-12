// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarFeeds } from "../../src/components/calendar-feed/calendar-feeds";
import { adminFeedContext, platformFeedContext } from "../../src/components/calendar-feed/feed-api";
import {
  daysLeft, expiresSoon, findUnseenCreated, findUnseenRotated, keepKnown, labelError, metaLine, revokedOnList, scopeText,
  vehicleIdsErrorText, vehiclesText, vehicleSelectionError, type FeedItem, type FeedList,
} from "../../src/components/calendar-feed/feed-model";

configure({ asyncUtilTimeout: 10_000 });
const SLOW = 30_000;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const now = new Date("2026-11-10T12:00:00.000Z");
const day = 86_400_000;
const item = (id: string, over: Partial<FeedItem> = {}): FeedItem => ({ id, label: `Adres ${id}`, status: "ACTIVE",
  createdAt: "2026-01-05T10:00:00.000Z", expiresAt: new Date(now.getTime() + 200 * day).toISOString(), lastUsedAt: null,
  revokedAt: null, revokedReason: null, ...over });
const listOf = (items: FeedItem[]): FeedList => ({ items, activeCount: items.filter((i) => i.status === "ACTIVE").length,
  activeLimit: 5, validityDays: 365 });
const secret = "S".repeat(43);
const feedUrl = `https://panel.example.test/api/calendar/feed/${secret}.ics`;

describe("model ekranu kalendarza zewnętrznego (ADM-22)", () => {
  it("ostrzega 30 dni przed wygaśnięciem tylko aktywny adres", () => {
    const soon = item("a", { expiresAt: new Date(now.getTime() + 11 * day).toISOString() });
    expect(daysLeft(soon, now)).toBe(11);
    expect(expiresSoon(soon, now)).toBe(true);
    expect(expiresSoon(item("b"), now)).toBe(false);
    expect(expiresSoon({ ...soon, status: "EXPIRED" }, now)).toBe(false);
    expect(metaLine(soon, now)).toMatch(/Wygasa \d\d\.\d\d\.2026 \(za 11 dni\)/);
    expect(metaLine(item("c", { status: "REVOKED", revokedAt: "2026-09-15T10:00:00.000Z", revokedReason: "ROTATED" }), now))
      .toContain("Odwołano 15.09.2026 (zastąpiony nowym adresem)");
    expect(metaLine(item("d", { lastUsedAt: "2026-11-09T22:30:00.000Z" }), now)).toContain("Ostatnie użycie 09.11.2026");
  });
  it("waliduje etykietę jak serwer: 1–60 znaków bez znaków sterujących", () => {
    expect(labelError("  ")).toMatch(/Podaj etykietę/);
    expect(labelError("x".repeat(61))).toMatch(/60/);
    expect(labelError("a\u0007b")).toMatch(/niedozwolone/);
    expect(labelError("Kalendarz zespołu")).toBeNull();
  });
  it("rozstrzyga niepewny wynik wyłącznie odczytem listy", () => {
    const before = [item("a")];
    expect(findUnseenCreated(before, [item("n", { label: "Nowy" }), ...before], " Nowy ")?.id).toBe("n");
    expect(findUnseenCreated(before, before, "Nowy")).toBeNull();
    const old = item("a");
    expect(findUnseenRotated(before, before, old)).toBe("not-rotated");
    const rotated = [item("n", { label: old.label }), { ...old, status: "REVOKED" as const, revokedReason: "ROTATED" }];
    expect(findUnseenRotated(before, rotated, old)).toMatchObject({ id: "n" });
    expect(findUnseenRotated(before, [{ ...old, status: "REVOKED", revokedReason: "MANUAL" }], old)).toBeNull();
    expect(revokedOnList([{ ...old, status: "REVOKED" }], "a")).toBe(true);
    expect(platformFeedContext("org-1")).toEqual({ apiBase: "/api/platform/companies/org-1/calendar-feeds", canManage: false });
  });
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(lists: FeedList[], handlers: { post?: Handler; del?: Handler } = {}) {
  let read = 0;
  const calls: { method: string; url: string; body?: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
    if (method === "POST") return handlers.post!(url, init);
    if (method === "DELETE") return handlers.del!(url, init);
    const value = lists[Math.min(read, lists.length - 1)];
    read += 1;
    return Response.json(value);
  });
  return calls;
}

describe("ekran kalendarza zewnętrznego", () => {
  it("lista bez adresów: stan pusty, objaśnienie i przycisk tworzenia", async () => {
    mockApi([listOf([])]);
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    expect(await screen.findByText("Nie ma jeszcze adresów kalendarza.")).toBeInTheDocument();
    expect(screen.getByText("Aktywne adresy: 0 z 5")).toBeInTheDocument();
    expect(screen.getByText(/Kalendarz Google odświeża subskrypcję co kilka godzin, Apple co 5–60 minut/)).toBeInTheDocument();
    expect(screen.getByText(/Feed pokazuje tylko „Niedostępny” dla opublikowanych pojazdów/)).toBeInTheDocument();
    expect(screen.getByText("Tylko pojazdy opublikowane")).toBeInTheDocument();
    expect(screen.getByText("Adres działa 365 dni")).toBeInTheDocument();
    expect(screen.getByText("Do 5 aktywnych adresów")).toBeInTheDocument();
    expect(screen.queryByText("Feed nie zawiera typu blokady, numeru odniesienia ani notatek.")).toBeNull();
    expect(screen.getByRole("button", { name: "Utwórz pierwszy adres" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Nowy adres kalendarza" })).toBeNull();
  });

  it("lista: status tekstem i ikoną, akcje tylko dla aktywnych, ostrzeżenie o wygasaniu, limit 5", async () => {
    const items = [
      item("1", { label: "Kalendarz zespołu", expiresAt: new Date(now.getTime() + 11 * day).toISOString() }),
      item("2"), item("3"), item("4"), item("5"),
      item("6", { label: "Stary", status: "EXPIRED", expiresAt: "2026-11-05T10:00:00.000Z" }),
      item("7", { label: "Test", status: "REVOKED", revokedAt: "2026-09-15T10:00:00.000Z", revokedReason: "MANUAL" }),
    ];
    mockApi([listOf(items)]);
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    const list = await screen.findByRole("list");
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(7);
    expect(within(rows[0]).getByText("Aktywny").querySelector("svg")).not.toBeNull();
    expect(within(rows[5]).getByText("Wygasły")).toBeInTheDocument();
    expect(within(rows[5]).queryByRole("button")).toBeNull();
    expect(within(rows[6]).getByText("Odwołany")).toBeInTheDocument();
    expect(within(rows[6]).getByText(/Odwołano 15\.09\.2026 \(odwołany ręcznie\)/)).toBeInTheDocument();
    expect(within(rows[0]).getByRole("button", { name: "Obróć adres Kalendarz zespołu" })).toBeInTheDocument();
    expect(screen.getByText("Adres „Kalendarz zespołu” wygasa za 11 dni")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: "Nowy adres (limit 5)" });
    expect(create).toBeDisabled();
    expect(create).toHaveAccessibleDescription(/5 z 5 aktywnych adresów/);
    expect(screen.getByText("Osiągnięto limit 5 aktywnych adresów")).toBeInTheDocument();
    expect(screen.getByText(/Wygasłe i odwołane adresy nie wliczają się do limitu/)).toBeInTheDocument();
    expect(screen.getByText("Feed nie zawiera typu blokady, numeru odniesienia ani notatek.")).toBeInTheDocument();
    // The list answer never carries an address; nothing secret is rendered.
    expect(document.body.innerHTML).not.toContain("/api/calendar/feed/");
  });

  it("tworzenie pokazuje adres raz, kopiuje go i po „Gotowe” znika on z ekranu", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const created = { ...item("n", { label: "Kalendarz zespołu" }), token: secret, path: `/api/calendar/feed/${secret}.ics`, url: feedUrl };
    const calls = mockApi([listOf([]), listOf([item("n", { label: "Kalendarz zespołu" })])],
      { post: () => Response.json(created, { status: 201 }) });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: /Nowy adres kalendarza|Utwórz pierwszy adres/ }));
    await waitFor(() => expect(screen.getByLabelText(/Etykieta/)).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    expect(screen.getByText(/Podaj etykietę/, { selector: "#feed-label-error" })).toBeInTheDocument();
    expect(screen.getByText("Do poprawy: 1")).toBeInTheDocument();
    expect(screen.getByLabelText(/Etykieta/)).toHaveFocus();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await user.type(screen.getByLabelText(/Etykieta/), "Kalendarz zespołu");
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    const issuedHeading = await screen.findByRole("heading", { name: "Adres kalendarza" });
    await waitFor(() => expect(issuedHeading).toHaveFocus());
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/admin/calendar-feeds/", body: '{"label":"Kalendarz zespołu"}' });
    expect(screen.getByLabelText("Adres kalendarza (iCal)")).toHaveValue(feedUrl);
    expect(screen.getByText("Adres pokazujemy tylko raz.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Kopiuj adres" }));
    expect(writeText).toHaveBeenCalledWith(feedUrl);
    expect(await screen.findByText("Skopiowano do schowka")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Gotowe" }));
    expect(await screen.findByText("Aktywne adresy: 1 z 5")).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(secret);
    expect(window.location.href).not.toContain(secret);
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it("5xx przy tworzeniu: brak sukcesu i adresu, lista odświeżona, propozycja rotacji nowego adresu", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const orphan = item("n", { label: "Telefon" });
    const calls = mockApi([listOf([]), listOf([orphan])], { post: () => Response.json({ code: "INTERNAL_ERROR" }, { status: 500 }) });
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: /Nowy adres kalendarza|Utwórz pierwszy adres/ }));
    await user.type(screen.getByLabelText(/Etykieta/), "Telefon");
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    expect(await screen.findByText("Adres „Telefon” powstał, ale nie dotarł do przeglądarki.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Adres kalendarza (iCal)")).toBeNull();
    expect(screen.queryByText(/został utworzony/)).toBeNull();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Obróć adres" }));
    expect(await screen.findByRole("dialog", { name: "Obrócić adres „Telefon”?" })).toBeInTheDocument();
  });

  it("brak połączenia przy tworzeniu i brak nowego adresu na liście: wynik niepewny bez sukcesu", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    mockApi([listOf([])], { post: () => { throw new TypeError("Failed to fetch"); } });
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: /Nowy adres kalendarza|Utwórz pierwszy adres/ }));
    await user.type(screen.getByLabelText(/Etykieta/), "Biuro");
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    expect(await screen.findByText("Nie wiemy, czy adres został utworzony.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odśwież listę" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Adres kalendarza (iCal)")).toBeNull();
  });

  it("limit z serwera (409) odświeża listę bez pokazania adresu", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const full = listOf([item("1"), item("2"), item("3"), item("4"), item("5")]);
    mockApi([listOf([item("1")]), full], { post: () => Response.json({ code: "FEED_LIMIT_REACHED" }, { status: 409 }) });
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: /Nowy adres kalendarza|Utwórz pierwszy adres/ }));
    await user.type(screen.getByLabelText(/Etykieta/), "Szósty");
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    expect(await screen.findByText("Osiągnięto limit aktywnych adresów.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nowy adres (limit 5)" })).toBeDisabled();
  });

  it("rotacja po potwierdzeniu pokazuje nowy adres raz; anulowanie wraca fokus", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const old = item("a", { label: "Zespół" });
    const calls = mockApi([listOf([old])], {
      post: () => Response.json({ ...item("b", { label: "Zespół" }), token: secret, path: "/x", url: feedUrl }) });
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    const rotate = await screen.findByRole("button", { name: "Obróć adres Zespół" });
    await user.click(rotate);
    expect(screen.getByRole("dialog", { name: "Obrócić adres „Zespół”?" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Anuluj" }));
    await waitFor(() => expect(rotate).toHaveFocus());
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await user.click(rotate);
    await user.click(screen.getByRole("button", { name: "Obróć adres" }));
    expect(await screen.findByText("Adres „Zespół” został obrócony")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "POST")?.url).toBe("/api/admin/calendar-feeds/a/rotate/");
    expect(screen.getByLabelText("Adres kalendarza (iCal)")).toHaveValue(feedUrl);
    expect(screen.getByRole("button", { name: "Zamknij" })).toBeInTheDocument();
  });

  it("odwołanie: dialog domyślnie na „Anuluj”; 5xx potwierdza lista, a brak potwierdzenia daje bezpieczne ponowienie", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const active = item("a", { label: "Zespół" });
    let attempt = 0;
    const calls = mockApi([listOf([active]), listOf([active]), listOf([{ ...active, status: "REVOKED", revokedAt: now.toISOString(), revokedReason: "MANUAL" }])], {
      del: () => { attempt += 1; return attempt === 1 ? new Response(null, { status: 502 }) : Response.json({ ...active, status: "REVOKED" }); } });
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: "Odwołaj adres Zespół" }));
    expect(screen.getByRole("button", { name: "Anuluj" })).toHaveFocus();
    expect(screen.getByText("Tej operacji nie można cofnąć")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Odwołaj adres" }));
    expect(await screen.findByText("Nie wiemy, czy adres został odwołany.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ponów odwołanie" }));
    expect(await screen.findByText("Odwołano adres „Zespół”.")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["/api/admin/calendar-feeds/a/", "/api/admin/calendar-feeds/a/"]);
    expect(screen.getByText("Odwołany")).toBeInTheDocument();
  });

  it("superadmin w kontekście firmy: tylko lista i odwołanie, bez tworzenia i rotacji", async () => {
    mockApi([listOf([item("a", { label: "Zespół" })])]);
    render(<CalendarFeeds context={platformFeedContext("11111111-1111-4111-8111-111111111111")} companyName="Alfa Rent" now={now} />);
    expect(await screen.findByText("Jesteś w kontekście firmy Alfa Rent jako superadmin")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Odwołaj adres Zespół" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Obróć/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Nowy adres/ })).toBeNull();
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe("/api/platform/companies/11111111-1111-4111-8111-111111111111/calendar-feeds/");
  });

  it("błąd odczytu listy: komunikat i ponowienie", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    let first = true;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      if (first) { first = false; return new Response(null, { status: 503 }); }
      return Response.json(listOf([]));
    });
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    expect(await screen.findByText("Nie udało się wczytać adresów kalendarza.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Spróbuj ponownie" }));
    expect(await screen.findByText("Nie ma jeszcze adresów kalendarza.")).toBeInTheDocument();
  });
});

// #367 (ADM-22 create, E11, D-47): scope "Cała flota" / "Wybrane pojazdy (opublikowane)" and the scope on the list.
describe("zakres adresu kalendarza: model", () => {
  it("odmienia liczbę pojazdów i opisuje zakres", () => {
    expect([1, 2, 4, 5, 12, 13, 22, 25, 50].map(vehiclesText)).toEqual(
      ["1 pojazd", "2 pojazdy", "4 pojazdy", "5 pojazdów", "12 pojazdów", "13 pojazdów", "22 pojazdy", "25 pojazdów", "50 pojazdów"]);
    expect(scopeText({ scope: "FLEET" })).toBe("Cała flota");
    expect(scopeText({})).toBe("Cała flota");
    expect(scopeText({ scope: "VEHICLES", vehicles: [{ id: "a", name: "A" }, { id: "b", name: null }, { id: "c", name: "C" }] })).toBe("3 pojazdy");
  });
  it("waliduje wybór jak serwer: co najmniej 1, najwyżej 50, tylko dla wybranych pojazdów", () => {
    expect(vehicleSelectionError("FLEET", [])).toBeNull();
    expect(vehicleSelectionError("VEHICLES", [])).toMatch(/co najmniej jeden pojazd/);
    expect(vehicleSelectionError("VEHICLES", Array.from({ length: 51 }, (_, i) => String(i)))).toMatch(/najwyżej 50/);
    expect(vehicleSelectionError("VEHICLES", ["a"])).toBeNull();
  });
  it("tłumaczy kody fieldErrors.vehicleIds na zrozumiałe komunikaty", () => {
    expect(vehicleIdsErrorText("VEHICLE_NOT_PUBLISHED")).toMatch(/nie jest już opublikowany/);
    expect(vehicleIdsErrorText("VEHICLE_NOT_FOUND")).toMatch(/nie istnieje już we flocie/);
    expect(vehicleIdsErrorText("OUT_OF_RANGE")).toMatch(/od 1 do 50/);
    expect(vehicleIdsErrorText("DUPLICATE")).toMatch(/dwa razy/);
    expect(vehicleIdsErrorText("INVALID_TYPE")).toMatch(/nie przyjął wyboru/);
    expect(keepKnown(["a", "b", "c"], [{ id: "c" }, { id: "a" }])).toEqual(["a", "c"]);
  });
});

const vehicle = (n: number) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, name: `Auto ${n}`, status: "PUBLISHED" });
function mockScopeApi(fleets: ReturnType<typeof vehicle>[][], lists: FeedList[], post: Handler) {
  let read = 0;
  let fleetRead = 0;
  const calls: { method: string; url: string; body?: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.startsWith("/api/admin/vehicles/")) {
      const items = fleets[Math.min(fleetRead, fleets.length - 1)];
      fleetRead += 1;
      return Response.json({ items, total: items.length, page: 1, pageSize: 100 });
    }
    if (method === "POST") return post(url, init);
    const value = lists[Math.min(read, lists.length - 1)];
    read += 1;
    return Response.json(value);
  });
  return calls;
}

describe("zakres adresu kalendarza: tworzenie i lista", () => {
  it("domyślnie cała flota; wybrane pojazdy: lista opublikowanych, min. 1 z komunikatem i podsumowaniem, wysyłka vehicleIds", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const fleet = [vehicle(1), vehicle(2), vehicle(3)];
    const created = { ...item("n", { label: "Dwa auta", scope: "VEHICLES", vehicles: [fleet[0], fleet[2]] }), token: secret, path: "/x", url: feedUrl };
    const calls = mockScopeApi([fleet], [listOf([])], () => Response.json(created, { status: 201 }));
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: "Utwórz pierwszy adres" }));
    const group = screen.getByRole("group", { name: "Zakres" });
    expect(within(group).getByRole("radio", { name: /Cała flota/ })).toBeChecked();
    expect(within(group).getByRole("radio", { name: /Cała flota/ })).toHaveAccessibleDescription("Wszystkie pojazdy opublikowane.");
    // Nothing is read for the whole fleet; the list is read once the selection is chosen (arrow keys: E2E).
    expect(calls.some((c) => c.url.startsWith("/api/admin/vehicles/"))).toBe(false);
    await user.click(within(group).getByRole("radio", { name: /Wybrane pojazdy/ }));
    expect(within(group).getByRole("radio", { name: /Wybrane pojazdy \(opublikowane\)/ })).toBeChecked();
    expect(await screen.findByRole("checkbox", { name: "Auto 1" })).toBeInTheDocument();
    expect(calls.find((c) => c.url.startsWith("/api/admin/vehicles/"))?.url).toContain("status=PUBLISHED");
    expect(screen.queryByRole("searchbox", { name: "Szukaj pojazdu" })).toBeNull();
    await user.type(screen.getByLabelText(/Etykieta/), "Dwa auta");
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    const vehiclesGroup = screen.getByRole("group", { name: "Pojazdy opublikowane" });
    await waitFor(() => expect(vehiclesGroup).toHaveFocus());
    expect(vehiclesGroup).toHaveAccessibleDescription(/Wybierz co najmniej jeden pojazd/);
    expect(screen.getByText("Do poprawy: 1")).toBeInTheDocument();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    await user.click(screen.getByRole("checkbox", { name: "Auto 1" }));
    await user.click(screen.getByRole("checkbox", { name: "Auto 3" }));
    expect(screen.queryByText("Do poprawy: 1")).toBeNull();
    expect(screen.getByText(/Wybrano 2 z 3/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    expect(await screen.findByText("Adres „Dwa auta” został utworzony")).toBeInTheDocument();
    expect(JSON.parse(calls.find((c) => c.method === "POST")!.body!)).toEqual({ label: "Dwa auta", vehicleIds: [fleet[0].id, fleet[2].id] });
  });

  it("wyszukiwanie przy ponad 8 pojazdach i limit 50 zaznaczeń", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const fleet = Array.from({ length: 52 }, (_, i) => vehicle(i + 1));
    mockScopeApi([fleet], [listOf([])], () => Response.json({}, { status: 500 }));
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: "Utwórz pierwszy adres" }));
    await user.click(screen.getByRole("radio", { name: /Wybrane pojazdy/ }));
    const search = await screen.findByRole("searchbox", { name: "Szukaj pojazdu" });
    await user.type(search, "Auto 52");
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    await user.clear(search);
    const boxes = screen.getAllByRole("checkbox");
    for (const box of boxes.slice(0, 50)) fireEvent.click(box);
    expect(screen.getByText(/Wybrano 50 z 52/)).toBeInTheDocument();
    expect(boxes[50]).toBeDisabled();
    expect(boxes[0]).toBeEnabled();
    expect(screen.getByText(/Wybrano limit 50 pojazdów/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Wyczyść wybór" }));
    expect(screen.getByText(/Wybrano 0 z 52/)).toBeInTheDocument();
  });

  it("400 VEHICLE_NOT_PUBLISHED: komunikat przy polu, odświeżona lista pojazdów, wybór bez nieopublikowanego, bez sukcesu", { timeout: SLOW }, async () => {
    const user = userEvent.setup();
    const fleet = [vehicle(1), vehicle(2)];
    const calls = mockScopeApi([fleet, [fleet[1]]], [listOf([])],
      () => Response.json({ code: "INVALID_INPUT", fieldErrors: { vehicleIds: "VEHICLE_NOT_PUBLISHED" } }, { status: 400 }));
    render(<CalendarFeeds context={adminFeedContext} now={now} />);
    await user.click(await screen.findByRole("button", { name: "Utwórz pierwszy adres" }));
    await user.type(screen.getByLabelText(/Etykieta/), "Biuro");
    await user.click(screen.getByRole("radio", { name: /Wybrane pojazdy/ }));
    await user.click(await screen.findByRole("checkbox", { name: "Auto 1" }));
    await user.click(screen.getByRole("checkbox", { name: "Auto 2" }));
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    expect(await screen.findByText(/nie jest już opublikowany/, { selector: "#feed-vehicles-error" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("group", { name: "Pojazdy opublikowane" })).toHaveFocus());
    expect(screen.queryByRole("checkbox", { name: "Auto 1" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Auto 2" })).toBeChecked();
    expect(screen.getByText(/Wybrano 1 z 1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Etykieta/)).toHaveValue("Biuro");
    expect(screen.queryByLabelText("Adres kalendarza (iCal)")).toBeNull();
    expect(calls.filter((c) => c.url.startsWith("/api/admin/vehicles/"))).toHaveLength(2);
  });

  it("lista pokazuje zakres: cała flota albo liczba pojazdów z nazwami (także superadmin, tylko odczyt)", async () => {
    const scoped = item("a", { label: "Dwa auta", scope: "VEHICLES", vehicles: [{ id: "v1", name: "Fiat Ducato" }, { id: "v2", name: null }] });
    const emptied = item("b", { label: "Pusty", scope: "VEHICLES", vehicles: [] });
    mockApi([listOf([scoped, emptied, item("c", { label: "Flota", scope: "FLEET" })])]);
    render(<CalendarFeeds context={platformFeedContext("11111111-1111-4111-8111-111111111111")} companyName="Alfa Rent" now={now} />);
    const rows = (await screen.findAllByRole("listitem")).filter((row) => row.querySelector("h4"));
    expect(within(rows[0]).getByText("Zakres: 2 pojazdy")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Pojazdy w zakresie (2 pojazdy)")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Fiat Ducato")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Pojazd bez nazwy")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Zakres: 0 pojazdów")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/kalendarz jest pusty/)).toBeInTheDocument();
    expect(within(rows[2]).getByText("Zakres: Cała flota")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Nowy adres/ })).toBeNull();
  });
});
