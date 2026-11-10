import { expect, type Page } from "@playwright/test";
import { monthLabel, shiftMonth } from "../../src/modules/public-offer/presentation";

/** D-44: the range of PUB-03 is chosen only in the calendar. Shows the month of `date`, then clicks that day. */
export async function pickDay(page: Page, date: string): Promise<void> {
  const target = date.slice(0, 7);
  const earlier = new Set(Array.from({ length: 14 }, (_, at) => monthLabel(shiftMonth(target, -(at + 1)))));
  const title = page.locator("#calendar-title");
  for (let step = 0; step < 14; step += 1) {
    const shown = ((await title.textContent()) ?? "").trim();
    if (shown === monthLabel(target)) break;
    const next = earlier.has(shown);
    await page.getByRole("link", { name: next ? "Następny miesiąc" : "Poprzedni miesiąc" }).click();
    await expect(title).not.toHaveText(shown);
  }
  await page.locator("#kalendarz table button", { hasText: new RegExp(`^${Number(date.slice(8))}$`) }).click();
}

/** Picks start and end (the same date twice is a one-day range). */
export async function pickRange(page: Page, from: string, to: string): Promise<void> {
  await pickDay(page, from);
  await pickDay(page, to);
}
