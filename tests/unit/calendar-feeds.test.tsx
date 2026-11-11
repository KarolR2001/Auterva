// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CalendarFeeds } from "../../src/components/calendar-feed/calendar-feeds";
import { adminFeedContext, platformFeedContext } from "../../src/components/calendar-feed/feed-api";
import {
  daysLeft, expiresSoon, findUnseenCreated, findUnseenRotated, labelError, metaLine, revokedOnList, type FeedItem, type FeedList,
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
    expect(screen.getByText(/tylko daty zajętości i nazwy pojazdów opublikowanych/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nowy adres kalendarza" })).toBeEnabled();
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
    await user.click(await screen.findByRole("button", { name: "Nowy adres kalendarza" }));
    await waitFor(() => expect(screen.getByLabelText(/Etykieta/)).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Utwórz adres" }));
    expect(screen.getByText(/Podaj etykietę/)).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: "Nowy adres kalendarza" }));
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
    await user.click(await screen.findByRole("button", { name: "Nowy adres kalendarza" }));
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
    await user.click(await screen.findByRole("button", { name: "Nowy adres kalendarza" }));
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
