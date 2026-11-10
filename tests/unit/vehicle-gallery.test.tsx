// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

import { AvailabilityPanel } from "../../src/components/public/availability-panel";
import { VehicleGallery } from "../../src/components/public/vehicle-gallery";

afterEach(cleanup);

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
