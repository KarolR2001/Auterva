import { expect, type Page } from "@playwright/test";

/** #296: on desktop every vehicle row keeps its actions on one line and all cells of a row share one bottom border. */
export async function expectDesktopRowLayout(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const layout = await rows.evaluateAll((trs) => trs.map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) => td.getBoundingClientRect().bottom);
    const actions = [...tr.querySelectorAll("td:last-child a, td:last-child button")].map((el) => el.getBoundingClientRect().top);
    return { cells, actions };
  }));
  for (const row of layout) {
    expect(new Set(row.cells.map(Math.round)).size).toBe(1);
    expect(new Set(row.actions.map(Math.round)).size).toBe(1);
  }
}
