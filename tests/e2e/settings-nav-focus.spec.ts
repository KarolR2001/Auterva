import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #351: the focused tab of "Sekcje ustawień" is always fully visible inside the scrolling bar (WCAG 2.4.11).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, reducedMotion: "reduce" });

test("settings nav: Tab brings every section tab fully into view at 320 and 390 px", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const org = randomUUID();
  const platformHost = `settings-nav-${tag}.example.test`;
  const origin = `http://${platformHost}:${new URL(baseURL).port}`;
  let ownedSuperadmin: string | null = null;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
  try {
    await db.organization.create({ data: { id: org, slug: `settings-nav-${tag}`, name: `Firma nav ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Settings nav operator", role: "SUPERADMIN_AUTERVA",
        email: `settings-nav-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    await resetPlatformApiBudget(db, superId);
    session = await verifiedFixtureSession(db, superId);
    const [name, ...rest] = session.cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: origin }]);

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${origin}/firmy/${org}/ustawienia/`);
      const nav = page.getByRole("navigation", { name: "Sekcje ustawień" });
      const links = nav.getByRole("link");
      const count = await links.count();
      expect(count).toBeGreaterThan(1);
      // #372: pełna nazwa w nazwie dostępnej, krótka etykieta „Kalendarz” widoczna na wąskim ekranie.
      const calendar = nav.getByRole("link", { name: "Kalendarz zewnętrzny" });
      await expect(calendar).toBeVisible();
      await expect(calendar.getByText("Kalendarz", { exact: true })).toBeVisible();
      expect((await calendar.locator("span").nth(1).boundingBox())?.width ?? 0).toBeLessThanOrEqual(1);
      await links.first().focus();
      for (let index = 0; index < count; index += 1) {
        if (index > 0) await page.keyboard.press("Tab");
        await expect(links.nth(index)).toBeFocused();
        // Let any scroll triggered by focus settle before measuring.
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const box = await page.evaluate((i) => {
          const bar = document.querySelector('nav[aria-label="Sekcje ustawień"]') as HTMLElement;
          const tab = bar.querySelectorAll("a")[i] as HTMLElement;
          const barRect = bar.getBoundingClientRect(); const tabRect = tab.getBoundingClientRect();
          // Focus ring = 2 px outline + 2 px offset: must stay inside the scrollport on every side.
          const ring = 4;
          return { left: tabRect.left - barRect.left, right: barRect.right - tabRect.right,
            ringLeft: tabRect.left - ring - barRect.left, ringRight: barRect.right - tabRect.right - ring,
            ringTop: tabRect.top - ring - barRect.top, ringBottom: barRect.bottom - tabRect.bottom - ring,
            behavior: getComputedStyle(bar).scrollBehavior };
        }, index);
        expect(box.left, `zakładka ${index} przy ${width}px: lewa krawędź`).toBeGreaterThanOrEqual(0);
        expect(box.right, `zakładka ${index} przy ${width}px: prawa krawędź`).toBeGreaterThanOrEqual(0);
        expect(box.behavior).toBe("auto");
        expect(box.ringTop, `zakładka ${index} przy ${width}px: obrys u góry`).toBeGreaterThanOrEqual(0);
        expect(box.ringBottom, `zakładka ${index} przy ${width}px: obrys u dołu`).toBeGreaterThanOrEqual(0);
        expect(box.ringLeft, `zakładka ${index} przy ${width}px: obrys z lewej`).toBeGreaterThanOrEqual(0);
        expect(box.ringRight, `zakładka ${index} przy ${width}px: obrys z prawej`).toBeGreaterThanOrEqual(0);
      }

      // #358: opening a section from the far end of the bar brings its active tab into view without moving the page.
      const lastHref = await links.nth(count - 1).getAttribute("href");
      await page.goto(`${origin}${lastHref}`);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const active = await page.evaluate(() => {
        const bar = document.querySelector('nav[aria-label="Sekcje ustawień"]') as HTMLElement;
        const tab = bar.querySelector('[aria-current="page"]') as HTMLElement;
        const barRect = bar.getBoundingClientRect(); const tabRect = tab.getBoundingClientRect();
        return { left: tabRect.left - barRect.left, right: barRect.right - tabRect.right, scrollY: window.scrollY,
          scrollLeft: bar.scrollLeft, overflows: bar.scrollWidth > bar.clientWidth };
      });
      expect(active.left, `aktywna zakładka przy ${width}px: lewa krawędź`).toBeGreaterThanOrEqual(0);
      expect(active.right, `aktywna zakładka przy ${width}px: prawa krawędź`).toBeGreaterThanOrEqual(0);
      expect(active.scrollY).toBe(0);
      if (active.overflows) expect(active.scrollLeft).toBeGreaterThan(0);
    }
  } finally {
    await session?.dispose();
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    if (ownedSuperadmin) await db.user.deleteMany({ where: { id: ownedSuperadmin } });
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
