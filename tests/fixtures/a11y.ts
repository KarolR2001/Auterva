import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

// Shared accessibility helpers for the e2e suites of #341 (company panel) and #342 (platform, public, marketing), part of #61.
// One rule for every screen: WCAG 2.0/2.1/2.2 A and AA plus axe best practices, no rule switched off. Serious and critical
// findings fail first (clear message); moderate and minor ones fail too, so they cannot creep in. A documented, deliberate
// exception goes into `allow` with the reason at the call site. Soft assertions: one run lists every broken screen.
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

export async function axeScan(page: Page, label: string, options: { allow?: string[]; exclude?: string[] } = {}) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  for (const selector of options.exclude ?? []) builder = builder.exclude(selector);
  const results = await builder.analyze();
  const found = results.violations.filter((violation) => !options.allow?.includes(violation.id));
  const describe = (violation: (typeof found)[number]) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes.slice(0, 4).map((node) => `${node.target.join(" ")} :: ${node.html.slice(0, 220)} :: ${(node.any[0]?.message ?? node.failureSummary ?? "").slice(0, 200)}`).join("\n  ")}`;
  expect.soft(found.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map(describe), `axe ${label}`).toEqual([]);
  expect.soft(found.filter((violation) => violation.impact !== "serious" && violation.impact !== "critical").map(describe), `axe (moderate/minor) ${label}`).toEqual([]);
}

/** One h1, one main landmark, document language, a skip link that is the first tab stop and moves focus to the content. */
export async function structureAudit(page: Page, label: string, options: { skipLink?: boolean } = {}) {
  expect.soft(await page.locator("h1").count(), `${label}: exactly one h1`).toBe(1);
  expect.soft(await page.getByRole("main").count(), `${label}: exactly one main`).toBe(1);
  expect.soft(await page.locator("html").getAttribute("lang"), `${label}: lang`).toBe("pl");
  expect.soft((await page.title()).trim().length, `${label}: document title`).toBeGreaterThan(0);
  if (options.skipLink === false) return;
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Przejdź do treści" });
  await expect.soft(skip, `${label}: skip link is the first tab stop`).toBeFocused();
  const box = await skip.boundingBox();
  expect.soft(box && box.y >= 0 && box.x >= 0 && box.width > 0, `${label}: skip link visible on focus`).toBe(true);
  await page.keyboard.press("Enter");
  expect.soft(await page.evaluate(() => document.activeElement?.closest("main, #main-content") !== null || location.hash === "#main-content"),
    `${label}: skip link lands in the content`).toBe(true);
}

/** Walks the tab order (capped): every stop must show a focus indicator and must not be covered by other content. */
export async function focusAudit(page: Page, label: string, limit = 60) {
  await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0); });
  const problems: string[] = [];
  const seen = new Set<string>();
  for (let step = 0; step < limit; step += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
      const shadow = style.boxShadow !== "none";
      // A focus ring may also be drawn on the parent label/wrapper (:has / :focus-within); accept it.
      const parent = el.parentElement ? getComputedStyle(el.parentElement) : null;
      const wrapper = !!parent && ((parent.outlineStyle !== "none" && parseFloat(parent.outlineWidth) > 0) || parent.boxShadow !== "none");
      const cx = Math.min(Math.max(rect.left + rect.width / 2, 0), innerWidth - 1);
      const cy = Math.min(Math.max(rect.top + rect.height / 2, 0), innerHeight - 1);
      const top = document.elementFromPoint(cx, cy);
      const covered = !!top && top !== el && !el.contains(top) && !top.contains(el);
      const cover = covered && top ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 40)} [rect ${Math.round(rect.top)}-${Math.round(rect.bottom)} of ${innerHeight}, scroll-padding-bottom ${getComputedStyle(document.documentElement).scrollPaddingBottom}, bar ${Math.round(top.getBoundingClientRect().top)}]` : "";
      const id = `${el.tagName.toLowerCase()}|${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30) ?? ""}|${Math.round(rect.top + scrollY)}|${Math.round(rect.left)}`;
      return { id, cover, outline, shadow, wrapper, covered, inView: rect.bottom > 0 && rect.top < innerHeight, name: id };
    });
    if (!info) break;
    if (seen.has(info.id)) break;
    seen.add(info.id);
    if (!info.outline && !info.shadow && !info.wrapper) problems.push(`no focus indicator: ${info.name}`);
    if (info.covered) problems.push(`focus obscured by ${info.cover}: ${info.name}`);
    if (!info.inView) problems.push(`focus outside viewport: ${info.name}`);
  }
  expect.soft(problems, `${label}: focus order`).toEqual([]);
}

/** WCAG 1.4.10 reflow: at 320 CSS px (equal to 400% zoom of 1280) and at 640 px (200% of 1280) the page does not scroll sideways. */
export async function reflowAudit(page: Page, label: string) {
  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 700 });
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label}: horizontal scroll at ${width}px`)
      .toBeLessThanOrEqual(0);
  }
}

/** prefers-reduced-motion: nothing keeps animating once the page is at rest. */
export async function reducedMotionAudit(page: Page, label: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(400);
  const running = await page.evaluate(() => document.getAnimations()
    .filter((animation) => animation.playState === "running" && (animation.effect?.getComputedTiming().iterations ?? 1) === Infinity)
    .map((animation) => animation.id || (animation.effect as KeyframeEffect | null)?.target?.tagName || "animation"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect.soft(running, `${label}: infinite animations under reduced motion`).toEqual([]);
}

/** Full audit of one screen at the two reference widths plus reflow, structure, focus order and reduced motion. */
export async function auditScreen(page: Page, label: string, options: { allow?: string[]; exclude?: string[]; skipLink?: boolean; focusLimit?: number } = {}) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await structureAudit(page, label, { skipLink: options.skipLink });
  await axeScan(page, `${label} 1440`, options);
  await page.setViewportSize({ width: 390, height: 844 });
  await axeScan(page, `${label} 390`, options);
  await focusAudit(page, `${label} 390`, options.focusLimit);
  await reducedMotionAudit(page, label);
  await reflowAudit(page, label);
  await page.setViewportSize({ width: 320, height: 700 });
  await axeScan(page, `${label} 320`, options);
}
