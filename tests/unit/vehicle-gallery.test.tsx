// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { AvailabilityPanel } from "../../src/components/public/availability-panel";
import { VehicleGallery } from "../../src/components/public/vehicle-gallery";

afterEach(cleanup);

const dayButton = (day: number) => screen.getByRole("button", { name: new RegExp(`, ${day} listopada 2026`) });
async function pickDays(user: ReturnType<typeof userEvent.setup>, start: number, end: number) {
  await user.click(dayButton(start));
  await user.click(dayButton(end));
}
const base = { slug: "atlas", vehicleName: "Atlas", today: "2026-11-10", minMonth: "2026-11", maxMonth: "2027-11", others: [], othersComplete: true,
  initial: { from: null, to: null, invalid: null, available: null, month: "2026-11", days: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, "0")}`, true])) } } satisfies React.ComponentProps<typeof AvailabilityPanel>;

const images = [1, 2, 3, 4].map((n) => ({ id: `i${n}`, alt: null, width: 1200, height: 800, urls: { large: `/l/${n}`, thumb: `/t/${n}` } }));

test("PUB-03 gallery labels the selected thumbnail in text and opens the full view from the see-all button (#319)", async () => {
  const user = userEvent.setup();
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
  render(<VehicleGallery images={images} name="Atlas" />);
  const thumbs = within(screen.getByRole("list", { name: "Miniatury zdjęć" }));
  expect(thumbs.getAllByRole("button")).toHaveLength(4);
  expect(thumbs.getAllByText("Wybrane")).toHaveLength(1);
  expect(thumbs.getByRole("button", { name: "Pokaż zdjęcie 1 z 4" }).textContent).toContain("Wybrane");
  await user.click(thumbs.getByRole("button", { name: "Pokaż zdjęcie 3 z 4" }));
  expect(thumbs.getByRole("button", { name: "Pokaż zdjęcie 3 z 4" }).textContent).toContain("Wybrane");
  expect(thumbs.getByRole("button", { name: "Pokaż zdjęcie 1 z 4" }).textContent).not.toContain("Wybrane");
  expect(screen.getByText("Zdjęcie 3 z 4")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Zobacz wszystkie zdjęcia" }));
  expect(screen.getByRole("dialog", { name: /Galeria: Atlas/, hidden: true })).toBeTruthy();
});

test("PUB-03 panel renders the header children and the calendar card with the chosen range summary (#319)", () => {
  const days = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`2026-11-${String(i + 1).padStart(2, "0")}`, true]));
  render(
    <AvailabilityPanel slug="atlas" vehicleName="Atlas" today="2026-11-10" minMonth="2026-11" maxMonth="2027-11" others={[]} othersComplete
      initial={{ from: "2026-11-20", to: "2026-11-22", invalid: null, available: true, month: "2026-11", days }}>
      <h1>Atlas</h1>
    </AvailabilityPanel>,
  );
  expect(screen.getByRole("heading", { level: 1, name: "Atlas" })).toBeTruthy();
  expect(screen.getByTestId("calendar-range").textContent).toBe("Wybrany zakres: 20–22.11.2026 · 3 dni");
  expect(screen.getByRole("heading", { name: "Listopad 2026" })).toBeTruthy();
});

test("PUB-03 panel without a chosen range shows no range summary", () => {
  render(<AvailabilityPanel slug="atlas" vehicleName="Atlas" today="2026-11-10" minMonth="2026-11" maxMonth="2027-11" others={[]} othersComplete
    initial={{ from: null, to: null, invalid: null, available: null, month: "2026-11", days: {} }} />);
  expect(screen.queryByTestId("calendar-range")).toBeNull();
});

test("PUB-03 range summary shows only after a verdict, not while loading or after an error (#323)", async () => {
  const user = userEvent.setup();
  const props = { slug: "atlas", vehicleName: "Atlas", today: "2026-11-10", minMonth: "2026-11", maxMonth: "2027-11", others: [], othersComplete: true,
    initial: { from: "2026-11-20", to: "2026-11-22", invalid: null, available: null, month: "2026-11", days: {} } } satisfies React.ComponentProps<typeof AvailabilityPanel>;
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  render(<AvailabilityPanel {...props} />);
  await pickDays(user, 20, 22);
  expect(screen.getByText(/Sprawdzamy dostępność/)).toBeTruthy();
  expect(screen.queryByTestId("calendar-range")).toBeNull();
  cleanup();
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  render(<AvailabilityPanel {...props} />);
  await pickDays(user, 20, 22);
  expect(await screen.findByText(/Nie udało się sprawdzić terminu/)).toBeTruthy();
  expect(screen.queryByTestId("calendar-range")).toBeNull();
  vi.unstubAllGlobals();
});

test("PUB-03 has no Od/Do fields or Sprawdź button and the legend has no past entry (D-44)", () => {
  render(<AvailabilityPanel {...base} />);
  expect(screen.queryByLabelText("Od")).toBeNull();
  expect(screen.queryByLabelText("Do")).toBeNull();
  expect(screen.queryByRole("button", { name: "Sprawdź" })).toBeNull();
  const legend = within(screen.getByRole("list", { name: "Legenda kalendarza" }));
  expect(legend.getAllByRole("listitem").map((item) => item.textContent)).toEqual(
    ["Dostępny", "Niedostępny (przekreślony, z krzyżykiem)", "Dzisiaj", "Wybrany zakres"]);
});

test("PUB-03 past days are aria-disabled, named \"miniony\" and cannot start a range (D-44)", async () => {
  const user = userEvent.setup();
  render(<AvailabilityPanel {...base} />);
  const past = dayButton(9);
  expect(past.getAttribute("aria-disabled")).toBe("true");
  expect(past.getAttribute("aria-label")).toMatch(/, miniony$/);
  await user.click(past);
  expect(screen.queryByText(/Wybrano początek/)).toBeNull();
});

test("PUB-03 range by keyboard: Enter starts, Space ends; the same day twice is one day; clear resets (D-44)", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ available: true }), { status: 200 })));
  render(<AvailabilityPanel {...base} />);
  dayButton(12).focus();
  await user.keyboard("{Enter}");
  expect(screen.getByText(/Wybrano początek/)).toBeTruthy();
  await user.keyboard("{ArrowRight}{ArrowRight}");
  await user.keyboard(" ");
  expect(await screen.findByText("Pojazd jest dostępny")).toBeTruthy();
  expect(screen.getByTestId("calendar-range").textContent).toBe("Wybrany zakres: 12–14.11.2026 · 3 dni");
  await user.click(dayButton(15));
  expect(screen.queryByText("Pojazd jest dostępny")).toBeNull(); // a new start withdraws the old result
  await user.click(dayButton(15));
  expect(await screen.findByText("Pojazd jest dostępny")).toBeTruthy();
  expect(screen.getByTestId("calendar-range").textContent).toMatch(/· 1 dzień$/);
  await user.click(screen.getByRole("button", { name: "Wyczyść termin" }));
  expect(screen.queryByTestId("calendar-range")).toBeNull();
  expect(screen.queryByText("Pojazd jest dostępny")).toBeNull();
  vi.unstubAllGlobals();
});
