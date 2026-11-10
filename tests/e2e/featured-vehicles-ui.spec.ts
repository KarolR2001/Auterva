import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect as baseExpect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #68: the "featured" choice in the vehicle form (company admin and the superadmin as their own actor) is what the
// public home shows: order, only PUBLISHED, the section disappears when nothing is featured (no placeholder, not in HTML).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

function rawGet(port: number, host: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, headers: { Host: host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve(body));
    });
    request.on("error", reject);
    request.end();
  });
}

test("featured vehicles: form choice -> public home order, hidden car disappears, empty section leaves nothing", async ({ baseURL, browser }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const [org, adminUser, cat, carA, carB] = Array.from({ length: 5 }, () => randomUUID());
  const publicHost = `feat-pub-${tag}.example.test`;
  const adminHost = `feat-adm-${tag}.example.test`;
  const platformHost = `feat-plt-${tag}.example.test`;
  const today = availabilityToday();
  const now = new Date();
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const platformContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  let ownedSuperadmin: string | null = null;
  try {
    await db.organization.create({ data: { id: org, slug: `feat-${tag}`, name: `Firma Wyróżnień ${tag}`, firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: new Date(sqlDate(today).getTime() + 30 * 86_400_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: `Firma Wyróżnień ${tag}`, phone: "+48 600 000 222",
      email: "feat@example.test", heroText: "Wyróżnione auta", featuredVehicleCount: 3, showPrices: false } });
    await db.hostMapping.createMany({ data: [
      { hostname: publicHost, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { hostname: adminHost, organizationId: org, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
    ] });
    await db.user.create({ data: { id: adminUser, name: "Feat admin", role: "ADMIN_FIRMY", organizationId: org,
      email: `feat-admin-${adminUser}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.vehicleCategory.create({ data: { id: cat, code: `ft-${cat.slice(0, 8)}`, name: "Kategoria wyróżnień" } });
    const common = { organizationId: org, status: "PUBLISHED" as const, categoryId: cat, availableFrom: sqlDate(today), shortDescription: "Krótki opis", description: "Pełny opis pojazdu." };
    await db.vehicle.createMany({ data: [
      { ...common, id: carA, slug: `feat-a-${carA}`, name: "Wyroznik Alfa", sortOrder: 5 },
      { ...common, id: carB, slug: `feat-b-${carB}`, name: "Wyroznik Beta", sortOrder: 6 },
    ] });
    for (const vehicleId of [carA, carB]) {
      await db.vehicleImage.create({ data: { organizationId: org, vehicleId, status: "READY", isCover: true,
        storageKey: `fleet/e2e/${vehicleId}/cover.webp`, mime: "image/webp", width: 600, height: 400, bytes: 1000 } });
    }

    const adminSession = await verifiedFixtureSession(db, adminUser);
    sessions.push(adminSession);
    const [cookieName, cookieValue] = adminSession.cookie.split(/=(.*)/s);
    await adminContext.addCookies([{ name: cookieName, value: cookieValue, domain: adminHost, path: "/" }]);
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Feat operator", role: "SUPERADMIN_AUTERVA", email: `feat-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    await resetPlatformApiBudget(db, superId);
    const superSession = await verifiedFixtureSession(db, superId);
    sessions.push(superSession);
    const [superName, ...superRest] = superSession.cookie.split("=");
    await platformContext.addCookies([{ name: superName, value: superRest.join("="), url: `http://${platformHost}:${port}` }]);

    const publicOrigin = `http://${publicHost}:${port}`;
    const feature = async (page: import("@playwright/test").Page, url: string, position: string | null, on: boolean) => {
      await page.goto(url);
      const toggle = page.locator("h3 button[aria-expanded]").filter({ hasText: "Publikacja i widoczność" });
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
      const box = page.getByLabel("Wyróżnij na stronie głównej firmy");
      if (on) await box.check(); else await box.uncheck();
      if (position !== null) await page.getByLabel("Pozycja na liście").fill(position);
      await page.getByRole("button", { name: "Zapisz zmiany" }).click();
      await expect(page.getByText("Zapisano zmiany.")).toBeVisible();
    };
    const home = await visitor.newPage();

    // Nothing featured: no section, no placeholder, and the vehicles are not named on the home at all.
    await home.goto(`${publicOrigin}/`);
    await expect(home.getByRole("heading", { level: 1, name: "Wyróżnione auta" })).toBeVisible();
    await expect(home.getByRole("heading", { name: "Pojazdy gotowe na Twoją trasę" })).toHaveCount(0);
    await expect(home.getByText("Wyroznik")).toHaveCount(0);

    // Company admin features Alfa (position 5): the form value is the stored value and the home shows it.
    const adminPage = await adminContext.newPage();
    await feature(adminPage, `http://${adminHost}:${port}/admin/pojazdy/${carA}/`, "5", true);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: carA } })).featured).toBe(true);
    await adminPage.reload();
    await adminPage.locator("h3 button[aria-expanded]").filter({ hasText: "Publikacja i widoczność" }).click();
    await expect(adminPage.getByLabel("Wyróżnij na stronie głównej firmy")).toBeChecked();
    await home.goto(`${publicOrigin}/`);
    await expect(home.getByRole("heading", { name: "Pojazdy gotowe na Twoją trasę" })).toBeVisible();
    await expect(home.locator("article[data-layout='featured']")).toHaveCount(1);
    await expect(home.getByRole("heading", { name: "Wyroznik Alfa" })).toBeVisible();
    await expect(home.getByRole("heading", { name: "Wyroznik Beta" })).toHaveCount(0);

    // The superadmin (own actor, this company's form) features Beta before Alfa: order follows the position.
    const platformPage = await platformContext.newPage();
    await feature(platformPage, `http://${platformHost}:${port}/firmy/${org}/pojazdy/${carB}/`, "1", true);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: carB } })).featured).toBe(true);
    await home.goto(`${publicOrigin}/`);
    await expect(home.locator("article[data-layout='featured'] h3")).toHaveText(["Wyroznik Beta", "Wyroznik Alfa"]);
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: org, entityId: carB, action: "VEHICLE_UPDATED" } });
    expect(audit).toMatchObject({ actorId: superId, actorRole: "SUPERADMIN_AUTERVA" });

    // Hide Beta (as the company would in a second session): it leaves the home at the next read, Alfa stays.
    await db.vehicle.update({ where: { id: carB }, data: { status: "UNPUBLISHED", version: { increment: 1 } } });
    await home.goto(`${publicOrigin}/`);
    await expect(home.locator("article[data-layout='featured'] h3")).toHaveText(["Wyroznik Alfa"]);
    expect(await rawGet(port, publicHost, "/")).not.toContain("Wyroznik Beta");

    // Un-feature Alfa: the section is gone, with no placeholder and no vehicle name or id left in HTML.
    await feature(adminPage, `http://${adminHost}:${port}/admin/pojazdy/${carA}/`, null, false);
    await home.goto(`${publicOrigin}/`);
    await expect(home.getByRole("heading", { name: "Pojazdy gotowe na Twoją trasę" })).toHaveCount(0);
    const html = await rawGet(port, publicHost, "/");
    for (const leak of ["Wyroznik", carA, carB, "Pojazdy gotowe na Twoją trasę"]) expect(html).not.toContain(leak);
  } finally {
    await Promise.all([adminContext.close(), platformContext.close(), visitor.close()]);
    for (const session of sessions) await session.dispose();
    await db.vehicleImage.deleteMany({ where: { organizationId: org } });
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.slugRedirect.deleteMany({ where: { organizationId: org } });
    await db.vehicleFeature.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: org }, { hostname: platformHost }] } });
    await db.user.deleteMany({ where: { id: { in: [adminUser, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.vehicleCategory.deleteMany({ where: { id: cat } });
    await db.$disconnect();
  }
});
