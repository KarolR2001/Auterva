import { expect, type Page } from "@playwright/test";

/** #296: on desktop every vehicle row keeps its actions on one line and all cells of a row share one bottom border. */
export async function expectDesktopRowLayout(page: Page, singleLine = true) {
  // Actions never push the table past its container: no sideways page scroll at any desktop width.
  for (const width of [1400, 1420, 1500, 1920, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator("tbody tr").first()).toBeVisible();
    const fit = await page.evaluate(() => {
      const table = document.querySelector("table")!;
      const box = table.getBoundingClientRect();
      const container = table.parentElement!.getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth - document.documentElement.clientWidth, over: box.right - container.right };
    });
    expect(fit.scroll, `page scroll at ${width}`).toBeLessThanOrEqual(0);
    expect(fit.over, `table overflow at ${width}`).toBeLessThanOrEqual(0.5);
  }
  const rows = page.locator("tbody tr");
  await expect(rows.first()).toBeVisible();
  const layout = await rows.evaluateAll((trs) => trs.map((tr) => {
    const cells = [...tr.querySelectorAll("td")].map((td) => td.getBoundingClientRect().bottom);
    const actions = [...tr.querySelectorAll("td:last-child a, td:last-child button")].map((el) => {
      const box = el.getBoundingClientRect();
      return box.top + box.height / 2;
    });
    return { cells, actions };
  }));
  for (const row of layout) {
    expect(Math.max(...row.cells) - Math.min(...row.cells), JSON.stringify(row)).toBeLessThanOrEqual(1);
    if (singleLine) expect(Math.max(...row.actions) - Math.min(...row.actions), JSON.stringify({ ...row, width: page.viewportSize() })).toBeLessThanOrEqual(2);
  }
}
