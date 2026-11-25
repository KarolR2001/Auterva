// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { AvailabilityPanel } from "../../src/components/public/availability-panel";

// #218 (D-32): nearest free term after an "unavailable" result on PUB-03.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const days = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, "0")}`, true]));
const props = { slug: "atlas", vehicleName: "Atlas", today: "2026-11-10", minMonth: "2026-11", maxMonth: "2027-11", others: [], othersComplete: true,
  initial: { from: null, to: null, invalid: null, available: null, month: "2026-11", days } } satisfies React.ComponentProps<typeof AvailabilityPanel>;
const dayButton = (day: number) => screen.getByRole("button", { name: new RegExp(`, ${day} listopada 2026`) });
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

type Handler = (url: string, body: { from?: string; to?: string }) => Promise<Response>;
function stub(handler: Handler) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => handler(String(url), init?.body ? JSON.parse(String(init.body)) : {}));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
async function pick(user: ReturnType<typeof userEvent.setup>, from: number, to: number) {
  await user.click(dayButton(from));
  await user.click(dayButton(to));
}

test("unavailable result shows the nearest term and applies it to the calendar, URL and check", async () => {
  const user = userEvent.setup();
  const fetchMock = stub((url, body) => {
    if (url.endsWith("/check")) return json({ available: body.from === "2026-11-24" });
    if (url.endsWith("/next")) return json({ found: true, from: "2026-11-24", to: "2026-11-26" });
    return json({ days: [] });
  });
  render(<AvailabilityPanel {...props} />);
  await pick(user, 20, 22);
  const section = await screen.findByTestId("nearest");
  expect(section.textContent).toContain("Najbliższy wolny termin: 24–26.11.2026");
  expect(section.textContent).toContain("3 dni · koniec wliczony. To informacja, nie rezerwacja.");
  expect(section.textContent).not.toMatch(/blokad|serwis|MAINTENANCE/i);
  const nextCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/next"));
  expect(JSON.parse(String(nextCall?.[1]?.body))).toEqual({ slug: "atlas", from: "2026-11-20", to: "2026-11-22" });
  await user.click(screen.getByRole("button", { name: "Ustaw ten termin w kalendarzu" }));
  await waitFor(() => expect(screen.getByText("Pojazd jest dostępny w wybranym terminie")).toBeTruthy());
  expect(screen.queryByTestId("nearest")).toBeNull();
  expect(screen.getByTestId("calendar-range").textContent).toBe("Wybrano 24–26.11 · 3 dni włącznie");
  expect(new URL(window.location.href).searchParams.get("from")).toBe("2026-11-24");
  expect(new URL(window.location.href).searchParams.get("to")).toBe("2026-11-26");
});

test("available result never asks for the nearest term", async () => {
  const user = userEvent.setup();
  const fetchMock = stub((url) => (url.endsWith("/check") ? json({ available: true }) : json({ days: [] })));
  render(<AvailabilityPanel {...props} />);
  await pick(user, 20, 22);
  await screen.findByText("Pojazd jest dostępny w wybranym terminie");
  expect(screen.queryByTestId("nearest")).toBeNull();
  expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/next"))).toBe(false);
});

test("no term within the horizon shows the 180 days message and no apply button", async () => {
  const user = userEvent.setup();
  stub((url) => (url.endsWith("/check") ? json({ available: false }) : url.endsWith("/next") ? json({ found: false }) : json({ days: [] })));
  render(<AvailabilityPanel {...props} />);
  await pick(user, 20, 22);
  expect((await screen.findByTestId("nearest")).textContent).toContain("Brak wolnego terminu w ciągu 180 dni");
  expect(screen.queryByRole("button", { name: "Ustaw ten termin w kalendarzu" })).toBeNull();
  expect(screen.getByText("Pojazd nie jest dostępny w całym wybranym terminie")).toBeTruthy();
});

test.each([[500], [429], [404]])("API status %i omits the section without a false term", async (status) => {
  const user = userEvent.setup();
  stub((url) => (url.endsWith("/check") ? json({ available: false }) : url.endsWith("/next") ? json({ code: "X" }, status) : json({ days: [] })));
  render(<AvailabilityPanel {...props} />);
  await pick(user, 20, 22);
  await screen.findByText("Pojazd nie jest dostępny w całym wybranym terminie");
  await waitFor(() => expect(screen.queryByTestId("nearest")).toBeNull());
  expect(screen.queryByText(/Najbliższy wolny termin/)).toBeNull();
});

test("a network failure or a malformed term omits the section", async () => {
  const user = userEvent.setup();
  stub((url) => (url.endsWith("/check") ? json({ available: false }) : url.endsWith("/next") ? Promise.reject(new Error("offline")) : json({ days: [] })));
  render(<AvailabilityPanel {...props} />);
  await pick(user, 20, 22);
  await screen.findByText("Pojazd nie jest dostępny w całym wybranym terminie");
  await waitFor(() => expect(screen.queryByTestId("nearest")).toBeNull());
  cleanup();
  stub((url) => (url.endsWith("/check") ? json({ available: false }) : url.endsWith("/next") ? json({ found: true, from: "2026-11-05", to: "2026-11-06" }) : json({ days: [] })));
  render(<AvailabilityPanel {...props} />);
  await pick(user, 20, 22);
  await screen.findByText("Pojazd nie jest dostępny w całym wybranym terminie");
  await waitFor(() => expect(screen.queryByTestId("nearest")).toBeNull());
});

test("loading shows no old term, and changing the range cancels a late answer", async () => {
  const user = userEvent.setup();
  const gate: { release: () => void } = { release: () => {} };
  stub((url, body) => {
    if (url.endsWith("/check")) return json({ available: body.from === "2026-11-24" ? true : false });
    if (url.endsWith("/next")) return new Promise((resolve) => { gate.release = () => resolve(new Response(JSON.stringify({ found: true, from: "2026-11-24", to: "2026-11-26" }), { status: 200 })); });
    return json({ days: [] });
  });
  render(<AvailabilityPanel {...props} />);
  await pick(user, 20, 22);
  expect((await screen.findByTestId("nearest")).textContent).toContain("Szukamy najbliższego wolnego terminu");
  expect(screen.queryByText(/Najbliższy wolny termin:/)).toBeNull();
  await user.click(dayButton(12)); // new start withdraws the result
  expect(screen.queryByTestId("nearest")).toBeNull();
  gate.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(screen.queryByTestId("nearest")).toBeNull();
  expect(screen.queryByText(/Najbliższy wolny termin:/)).toBeNull();
});

test("a server-rendered unavailable result (shared link) loads the nearest term too", async () => {
  stub((url) => (url.endsWith("/next") ? json({ found: true, from: "2026-11-24", to: "2026-11-26" }) : json({ days: [] })));
  render(<AvailabilityPanel {...props} initial={{ ...props.initial, from: "2026-11-20", to: "2026-11-22", available: false }} />);
  expect((await screen.findByTestId("nearest")).textContent).toContain("Najbliższy wolny termin: 24–26.11.2026");
});
