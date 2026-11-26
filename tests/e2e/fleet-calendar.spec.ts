import { randomUUID } from "node:crypto";
import { expect as baseExpect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #66 (ADM-10): fleet calendar of the company admin and of the superadmin in one company, on the real aggregate API (#65).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test("fleet calendar: company and superadmin reach the vehicle and the block, isolation, privacy, mobile, keyboard, 320-1920", async ({ baseURL, browser }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [orgA, orgB, userA, carAlfa, carBeta, carArchive, carForeign, blockMaint, blockOne] = Array.from({ length: 9 }, () => randomUUID());
  const tag = orgA.slice(0, 8);
  const hosts = { adminA: `fleetcal-admin-${tag}.example.test`, platform: `fleetcal-platform-${tag}.example.test` };
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  let ownedSuperadmin: string | null = null;
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const superContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anonymous = await browser.newContext();
  try {
    for (const [id, name] of [[orgA, "A"], [orgB, "B"]] as const) {
      await db.organization.create({ data: { id, slug: `fleetcal-${name.toLowerCase()}-${id}`, name: `Firma Kalendarza Floty ${name} ${tag}`, firstAdminRegisteredAt: now } });
      await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    }
    await db.hostMapping.createMany({ data: [
      { hostname: hosts.adminA, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: hosts.platform, area: "PLATFORM", status: "ACTIVE" },
    ] });
    const since = sqlDate(day(-30));
    await db.vehicle.createMany({ data: [
      { id: carAlfa, organizationId: orgA, slug: `fc-alfa-${carAlfa}`, name: "Auto Alfa", status: "PUBLISHED", availableFrom: since, sortOrder: 1 },
      { id: carBeta, organizationId: orgA, slug: `fc-beta-${carBeta}`, name: "Auto Beta", status: "PUBLISHED", availableFrom: since, sortOrder: 2 },
      { id: carArchive, organizationId: orgA, slug: `fc-arch-${carArchive}`, name: "Auto Archiwalne", status: "ARCHIVED", availableFrom: since, sortOrder: 3 },
      { id: carForeign, organizationId: orgB, slug: `fc-foreign-${carForeign}`, name: "Obce Auto", status: "PUBLISHED", availableFrom: since },
    ] });
    await db.availabilityBlock.createMany({ data: [
      { id: blockMaint, organizationId: orgA, vehicleId: carAlfa, from: sqlDate(day(1)), to: sqlDate(day(3)), type: "MAINTENANCE", reference: "FLEETCAL-REF-SECRET", internalNote: "FLEETCAL-NOTE-SECRET" },
      { id: blockOne, organizationId: orgA, vehicleId: carAlfa, from: sqlDate(day(8)), to: sqlDate(day(8)), type: "BLOCKED" },
      { organizationId: orgB, vehicleId: carForeign, from: sqlDate(day(1)), to: sqlDate(day(2)), type: "OTHER" },
    ] });
    await db.user.create({ data: { id: userA, name: "Fleet calendar admin", role: "ADMIN_FIRMY", organizationId: orgA, email: `fleetcal-${userA}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, userA));
    const [adminName, adminValue] = sessions[0].cookie.split(/=(.*)/s);
    await adminContext.addCookies([{ name: adminName, value: adminValue, domain: hosts.adminA, path: "/" }]);

    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Fleet calendar operator", role: "SUPERADMIN_AUTERVA", email: `fleetcal-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    await resetPlatformApiBudget(db, superId);
    const superSession = await verifiedFixtureSession(db, superId);
    sessions.push(superSession);
    const [superName, ...superRest] = superSession.cookie.split("=");
    await superContext.addCookies([{ name: superName, value: superRest.join("="), url: `http://${hosts.platform}:${port}` }]);

    const adminOrigin = `http://${hosts.adminA}:${port}`;
    const platformOrigin = `http://${hosts.platform}:${port}`;
    const page = await adminContext.newPage();
    const noOverflow = async (target: typeof page, label: string) => {
      expect(await target.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow: ${label}`).toBeLessThanOrEqual(0);
    };

    // Company admin, desktop: only own fleet, archived car hidden, privacy, block link opens that block in the vehicle calendar.
    await page.goto(`${adminOrigin}/admin/kalendarz/`);
    await expect(page.getByRole("heading", { name: "Kalendarz floty", level: 2 })).toBeVisible();
    const region = page.getByRole("region", { name: /Kalendarz floty, przewijany poziomo/ });
    await expect(region).toBeVisible();
    await expect(region.getByRole("link", { name: "Auto Alfa", exact: true })).toBeVisible();
    await expect(region.getByRole("link", { name: "Auto Beta", exact: true })).toBeVisible();
    await expect(page.getByText("Obce Auto")).toHaveCount(0);
    await expect(page.getByText("Auto Archiwalne")).toHaveCount(0);
    await expect(page.getByText("2 pojazdy · horyzont 14 dni · czas polski")).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/FLEETCAL-REF-SECRET|FLEETCAL-NOTE-SECRET/);
    await noOverflow(page, "admin desktop 1440");
    await region.getByRole("link", { name: /Auto Alfa: Serwis/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/pojazdy/${carAlfa}/kalendarz/\\?blok=${blockMaint}`));
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("#bc-from")).toHaveValue(day(1));
    await expect(page.locator("#bc-to")).toHaveValue(day(3));

    // Keyboard: the controls are buttons, Enter moves the range, the archive filter shows only the archived car.
    await page.goto(`${adminOrigin}/admin/kalendarz/`);
    const before = await page.getByTestId("fleet-range").textContent();
    await page.getByRole("button", { name: "Następne 14 dni" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("fleet-range")).not.toHaveText(before ?? "");
    await expect(page.getByText("Brak blokad w wybranym zakresie").first()).toBeVisible();
    await page.getByRole("button", { name: "Dzisiaj" }).click();
    // ADM-10: the status filter sits behind "Filtry • N".
    await page.getByRole("button", { name: /^Filtry • 0/ }).click();
    await page.getByLabel("Status pojazdu").selectOption("ARCHIVED");
    await expect(page.getByRole("link", { name: "Auto Archiwalne", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Auto Alfa", exact: true })).toHaveCount(0);
    await page.getByLabel("Status pojazdu").selectOption("");
    await page.getByRole("button", { name: "Miesiąc", exact: true }).click();
    await expect(page.getByRole("button", { name: "Miesiąc", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(region.getByRole("link", { name: "Auto Alfa", exact: true })).toBeVisible();

    // Quick block goes to the vehicle calendar with the create form (existing flow of #39).
    await page.getByRole("button", { name: "Szybka blokada" }).click();
    await page.getByRole("dialog").getByLabel("Pojazd").selectOption({ label: "Auto Beta" });
    await page.getByRole("dialog").getByRole("button", { name: "Dalej" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/pojazdy/${carBeta}/kalendarz/\\?dodaj=1`));
    await expect(page.locator("#bc-from")).toBeVisible();

    // Mobile 390: vehicle cards, block link opens the block, no sideways scroll at any width.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${adminOrigin}/admin/kalendarz/`);
    await expect(page.getByRole("heading", { name: "Auto Alfa", level: 3 })).toBeVisible();
    await expect(page.getByRole("region", { name: /przewijany poziomo/ })).toBeHidden();
    await noOverflow(page, "admin mobile 390");
    await page.getByRole("link", { name: /Auto Alfa: Serwis.*Otwórz blokadę$/ }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    for (const width of [320, 768, 1024, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${adminOrigin}/admin/kalendarz/`);
      await expect(page.getByRole("heading", { name: "Kalendarz floty", level: 2 })).toBeVisible();
      await noOverflow(page, `admin ${width}px`);
      await page.getByRole("button", { name: "Miesiąc", exact: true }).click();
      await expect(page.getByRole("button", { name: "Miesiąc", exact: true })).toHaveAttribute("aria-pressed", "true");
      await noOverflow(page, `admin month ${width}px`);
    }

    // Superadmin in company A: own actor, only company A's fleet, links under /firmy/{id}; company B shows only its own car.
    const sPage = await superContext.newPage();
    await sPage.goto(`${platformOrigin}/firmy/${orgA}/kalendarz/`);
    await expect(sPage.getByRole("heading", { name: "Kalendarz floty", level: 2 })).toBeVisible();
    const sRegion = sPage.getByRole("region", { name: /przewijany poziomo/ });
    await expect(sRegion.getByRole("link", { name: "Auto Alfa", exact: true })).toBeVisible();
    await expect(sPage.getByText("Obce Auto")).toHaveCount(0);
    await expect(sPage.getByText(`Zarządzasz firmą: Firma Kalendarza Floty A ${tag}`)).toBeVisible();
    expect(await sPage.content()).not.toMatch(/FLEETCAL-REF-SECRET|FLEETCAL-NOTE-SECRET/);
    await sRegion.getByRole("link", { name: /Auto Alfa: Serwis/ }).click();
    await expect(sPage).toHaveURL(new RegExp(`/firmy/${orgA}/pojazdy/${carAlfa}/kalendarz/\\?blok=${blockMaint}`));
    await expect(sPage.getByRole("dialog")).toBeVisible();
    await sPage.goto(`${platformOrigin}/firmy/${orgB}/kalendarz/`);
    await expect(sPage.getByRole("region", { name: /przewijany poziomo/ }).getByRole("link", { name: "Obce Auto", exact: true })).toBeVisible();
    await expect(sPage.getByText("Auto Alfa")).toHaveCount(0);
    await sPage.goto(`${platformOrigin}/firmy/${randomUUID()}/kalendarz/`);
    await expect(sPage.getByRole("heading", { name: "Kalendarz floty", level: 2 })).toHaveCount(0);

    // Anonymous visitor never sees the calendar.
    const anon = await anonymous.newPage();
    await anon.goto(`${adminOrigin}/admin/kalendarz/`);
    await expect(anon.getByRole("heading", { name: "Kalendarz floty", level: 2 })).toHaveCount(0);
    await expect(anon.getByText("Auto Alfa")).toHaveCount(0);
  } finally {
    await adminContext.close();
    await superContext.close();
    await anonymous.close();
    for (const session of sessions) await session.dispose();
    const orgs = { in: [orgA, orgB] };
    await db.auditLog.deleteMany({ where: { organizationId: orgs } });
    await db.availabilityBlock.deleteMany({ where: { organizationId: orgs } });
    await db.vehicle.deleteMany({ where: { organizationId: orgs } });
    await db.serviceAccess.deleteMany({ where: { organizationId: orgs } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [hosts.adminA, hosts.platform] } } });
    await db.user.deleteMany({ where: { id: { in: [userA, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.organization.deleteMany({ where: { id: orgs } });
    await db.$disconnect();
  }
});
