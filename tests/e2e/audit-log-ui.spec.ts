import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #75 (ADM-17): the change log of the company admin (own company) and of the superadmin in a chosen, archived company.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });

test("change log: local time from UTC, filters, cursor, superadmin as themselves, no cross-company events, archived company", async ({ baseURL, browser }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const [orgA, orgB, adminA] = Array.from({ length: 3 }, () => randomUUID());
  const adminHost = `audit-a-${tag}.example.test`;
  const platformHost = `audit-platform-${tag}.example.test`;
  const today = availabilityToday();
  const paid = sqlDate(new Date(sqlDate(today).getTime() + 30 * 86_400_000).toISOString().slice(0, 10));
  let adminSession: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  let superSession: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  let ownedSuperadmin: string | null = null;
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const superContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await db.organization.create({ data: { id: orgA, slug: `audit-a-${tag}`, name: `Firma Audytu A ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.organization.create({ data: { id: orgB, slug: `audit-b-${tag}`, name: `Firma Audytu B ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.serviceAccess.createMany({ data: [{ organizationId: orgA, paidThrough: paid }, { organizationId: orgB, paidThrough: paid }] });
    await db.user.create({ data: { id: adminA, name: "Audit admin", role: "ADMIN_FIRMY", organizationId: orgA, email: `audit-admin-${adminA}@example.test`,
      emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
    ] });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Audit operator", role: "SUPERADMIN_AUTERVA", email: `audit-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    // 32 events of company A (page size 30 => a second page of two), one of company B.
    const recent = Date.now() - 20 * 86_400_000;
    await db.auditLog.createMany({ data: [
      { eventKey: randomUUID(), organizationId: orgA, actorId: adminA, actorRole: "ADMIN_FIRMY", action: "SETTINGS_CHANGED", entityType: "SiteSettings", entityId: orgA,
        requestId: randomUUID(), createdAt: new Date(recent), safeChanges: { changedFields: ["phone", "status"], before: { phone: "+48 600 100 200", status: "DRAFT" }, after: { phone: "+48 600 100 300", status: "PUBLISHED" } } },
      { eventKey: randomUUID(), organizationId: orgA, actorId: superId, actorRole: "SUPERADMIN_AUTERVA", action: "PERIOD_CHANGED", entityType: "ServicePeriod", entityId: orgA,
        requestId: randomUUID(), createdAt: new Date(recent - 60_000) },
      ...Array.from({ length: 29 }, (_, index) => ({ eventKey: randomUUID(), organizationId: orgA, actorId: adminA, actorRole: "ADMIN_FIRMY", action: "VEHICLE_UPDATED",
        entityType: "Vehicle", entityId: randomUUID(), requestId: randomUUID(), createdAt: new Date(recent - (index + 2) * 3_600_000) })),
      { eventKey: randomUUID(), organizationId: orgA, actorId: adminA, actorRole: "ADMIN_FIRMY", action: "AUTH_LOGOUT", entityType: "User", entityId: adminA,
        requestId: randomUUID(), createdAt: new Date(recent - 40 * 86_400_000) },
      { eventKey: randomUUID(), organizationId: orgB, actorId: randomUUID(), actorRole: "ADMIN_FIRMY", action: "BLOCK_DELETED", entityType: "AvailabilityBlock", entityId: randomUUID(),
        requestId: randomUUID(), createdAt: new Date(recent + 1000) },
    ] });
    adminSession = await verifiedFixtureSession(db, adminA);
    const [aName, aValue] = adminSession.cookie.split(/=(.*)/s);
    await adminContext.addCookies([{ name: aName, value: aValue, domain: adminHost, path: "/" }]);

    // Company admin: own company only, superadmin shown as a role, no foreign event, cursor, filters.
    const page = await adminContext.newPage();
    const adminBase = `http://${adminHost}:${port}`;
    await page.goto(`${adminBase}/admin/logi/`);
    await expect(page.getByRole("heading", { name: "Dziennik zmian", level: 2 })).toBeVisible();
    const list = page.getByRole("list", { name: "Wpisy dziennika zmian" });
    await expect(list.getByRole("listitem")).toHaveCount(30);
    await expect(list).not.toContainText("Usunięcie blokady terminu");
    await expect(list).toContainText("Superadmin Autervy");
    // At 1440 px the header and every row are one column table (a container query cannot style its own container).
    const cells = await list.getByRole("listitem").first().locator("> div").evaluate((element) => ({
      columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
      tops: [...element.children].map((child) => Math.round(child.getBoundingClientRect().top)) }));
    expect(cells.columns).toBe(6);
    expect(new Set(cells.tops).size).toBe(1);
    await page.getByRole("button", { name: "Pokaż starsze" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(32);
    await expect(page.getByText("To wszystkie wpisy")).toBeVisible();
    await expect(list).not.toContainText("Usunięcie blokady terminu");

    await page.getByLabel("Akcja").selectOption("AUTH_LOGOUT");
    await page.getByRole("button", { name: "Zastosuj" }).click();
    await page.getByRole("button", { name: /Szczegóły/ }).click();
    await expect(page.locator("body")).not.toContainText(adminA);
    await page.getByRole("button", { name: "Wyczyść", exact: true }).click();
    await page.getByLabel("Akcja").selectOption("PERIOD_CHANGED");
    await page.getByRole("button", { name: "Zastosuj" }).click();
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list).toContainText("Superadmin Autervy");
    await expect(list).toContainText("Zmiana okresu usługi");
    // Detail of one entry: UTC instant next to local time, redacted fields as labels.
    await page.getByRole("button", { name: /Szczegóły/ }).click();
    await expect(page.getByText("Identyfikator żądania", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Wyczyść", exact: true }).click();
    await page.getByLabel("Akcja").selectOption("SETTINGS_CHANGED");
    await page.getByRole("button", { name: "Zastosuj" }).click();
    await page.getByRole("button", { name: /Szczegóły/ }).click();
    await expect(page.getByRole("row", { name: /Status/ })).toContainText("PUBLISHED");
    // Redaction by the server: the phone number never reaches the page, only the changed field's name.
    await expect(page.getByRole("row", { name: /Telefon/ })).not.toContainText("+48");
    await expect(page.locator("body")).not.toContainText("+48 600");
    await page.getByRole("button", { name: "Wyczyść", exact: true }).click();
    // Empty result and inverted range.
    await page.getByLabel("Od dnia").fill("2026-02-10");
    await page.getByLabel("Do dnia (włącznie)").fill("2026-02-09");
    await page.getByRole("button", { name: "Zastosuj" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Data końcowa" })).toBeVisible();
    await page.getByLabel("Do dnia (włącznie)").fill("2026-02-10");
    await page.getByRole("button", { name: "Zastosuj" }).click();
    await expect(page.getByRole("heading", { name: "Brak wyników" })).toBeVisible();
    // Keyboard: the filter form is reachable and operable without a pointer.
    await page.getByLabel("Od dnia").focus();
    await expect(page.getByLabel("Od dnia")).toBeFocused();
    // A foreign company id is never a filter: the API refuses unknown query keys.
    const status = await page.evaluate(async (id) => (await fetch(`/api/admin/audit/?organizationId=${id}`, { credentials: "same-origin" })).status, orgB);
    expect(status).toBe(400);
    // A company admin has no way into the platform route.
    expect((await page.goto(`${adminBase}/firmy/${orgA}/logi/`))?.status()).toBe(404);

    // Superadmin (mobile): the log of an ARCHIVED company, as themselves, only that company.
    await db.organization.update({ where: { id: orgA }, data: { archivedAt: new Date() } });
    await resetPlatformApiBudget(db, superId);
    superSession = await verifiedFixtureSession(db, superId);
    const origin = `http://${platformHost}:${port}`;
    const [sName, ...sRest] = superSession.cookie.split("=");
    await superContext.addCookies([{ name: sName, value: sRest.join("="), url: origin }]);
    const mobile = await superContext.newPage();
    await mobile.goto(`${origin}/firmy/${orgA}/logi/`);
    await expect(mobile.getByText("Firma jest zarchiwizowana", { exact: true })).toBeVisible();
    const mobileList = mobile.getByRole("list", { name: "Wpisy dziennika zmian" });
    await expect(mobileList.getByRole("listitem")).toHaveCount(30);
    await expect(mobileList).toContainText("Superadmin Autervy");
    await expect(mobileList).not.toContainText("Usunięcie blokady terminu");
    // 320 px: no horizontal page scroll, the filter bar is a sheet toggled by a button.
    await mobile.setViewportSize({ width: 320, height: 700 });
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const toggle = mobile.getByRole("button", { name: "Filtruj" });
    await toggle.click();
    await expect(mobile.getByLabel("Administrator")).toBeVisible();
    await mobile.getByLabel("Administrator").selectOption("SUPERADMIN_AUTERVA");
    await mobile.getByRole("button", { name: "Zastosuj" }).click();
    await expect(mobileList.getByRole("listitem")).toHaveCount(1);
    // Another company's log comes from its own path.
    await mobile.goto(`${origin}/firmy/${orgB}/logi/`);
    await expect(mobile.getByRole("list", { name: "Wpisy dziennika zmian" }).getByRole("listitem")).toHaveCount(1);
    await expect(mobile.getByRole("list", { name: "Wpisy dziennika zmian" })).toContainText("Usunięcie blokady terminu");
    // Unknown company: neutral 404.
    expect((await mobile.goto(`${origin}/firmy/${randomUUID()}/logi/`))?.status()).toBe(404);
  } finally {
    await adminContext.close(); await superContext.close();
    await adminSession?.dispose(); await superSession?.dispose();
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [adminHost, platformHost] } } });
    await db.session.deleteMany({ where: { userId: adminA } });
    await db.user.deleteMany({ where: { id: { in: [adminA, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  }
});
