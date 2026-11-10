import { randomUUID } from "node:crypto";
import { expect as baseExpect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #217 (ADM-10 state=bulk-*, D-32, D-48): bulk block and copy of a block from the fleet calendar on the real API (#215).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test("bulk block: dryRun preview saves nothing, ABORT/SKIP report, copy, unknown outcome retried with the same key, keyboard, 320-1920, superadmin", async ({ baseURL, browser }) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [orgA, userA, carAlfa, carBeta, carGamma, carDelta, blockBeta] = Array.from({ length: 7 }, () => randomUUID());
  const tag = orgA.slice(0, 8);
  const hosts = { adminA: `bulkblk-admin-${tag}.example.test`, platform: `bulkblk-platform-${tag}.example.test` };
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  let ownedSuperadmin: string | null = null;
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const superContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    await db.organization.create({ data: { id: orgA, slug: `bulkblk-${orgA}`, name: `Firma Blokad Zbiorczych ${tag}`, firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: orgA, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.hostMapping.createMany({ data: [
      { hostname: hosts.adminA, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: hosts.platform, area: "PLATFORM", status: "ACTIVE" },
    ] });
    const since = sqlDate(day(-30));
    await db.vehicle.createMany({ data: [
      { id: carAlfa, organizationId: orgA, slug: `bb-alfa-${carAlfa}`, name: "Auto Alfa", status: "PUBLISHED", availableFrom: since, sortOrder: 1 },
      { id: carBeta, organizationId: orgA, slug: `bb-beta-${carBeta}`, name: "Auto Beta", status: "PUBLISHED", availableFrom: since, sortOrder: 2 },
      { id: carGamma, organizationId: orgA, slug: `bb-gamma-${carGamma}`, name: "Auto Gamma", status: "DRAFT", availableFrom: since, availableTo: sqlDate(day(2)), sortOrder: 3 },
      { id: carDelta, organizationId: orgA, slug: `bb-delta-${carDelta}`, name: "Auto Delta", status: "PUBLISHED", availableFrom: since, sortOrder: 4 },
    ] });
    await db.availabilityBlock.create({ data: { id: blockBeta, organizationId: orgA, vehicleId: carBeta, from: sqlDate(day(4)), to: sqlDate(day(6)), type: "MAINTENANCE" } });
    await db.user.create({ data: { id: userA, name: "Bulk block admin", role: "ADMIN_FIRMY", organizationId: orgA, email: `bulkblk-${userA}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    sessions.push(await verifiedFixtureSession(db, userA));
    const [adminName, adminValue] = sessions[0].cookie.split(/=(.*)/s);
    await adminContext.addCookies([{ name: adminName, value: adminValue, domain: hosts.adminA, path: "/" }]);

    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Bulk block operator", role: "SUPERADMIN_AUTERVA", email: `bulkblk-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    await resetPlatformApiBudget(db, superId);
    const superSession = await verifiedFixtureSession(db, superId);
    sessions.push(superSession);
    const [superName, ...superRest] = superSession.cookie.split("=");
    await superContext.addCookies([{ name: superName, value: superRest.join("="), url: `http://${hosts.platform}:${port}` }]);

    const adminOrigin = `http://${hosts.adminA}:${port}`;
    const page = await adminContext.newPage();
    const noOverflow = async (label: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow: ${label}`).toBeLessThanOrEqual(0);
    };
    const blocksOf = (vehicleId: string) => db.availabilityBlock.findMany({ where: { vehicleId }, orderBy: { from: "asc" } });

    // Entry D-48 in the header, opened by keyboard: the bulk view replaces the grid, focus goes to its heading, the
    // breadcrumb returns to the calendar and focus comes back to the button.
    await page.goto(`${adminOrigin}/admin/kalendarz/`);
    const region = page.getByRole("region", { name: /Kalendarz floty, przewijany poziomo/ });
    await expect(region.getByRole("link", { name: "Auto Alfa", exact: true })).toBeVisible();
    const open = page.getByRole("button", { name: "Blokada zbiorcza" });
    await open.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Blokada zbiorcza", level: 2 })).toBeFocused();
    await expect(page).toHaveURL(`${adminOrigin}/admin/kalendarz/?zbiorcza=1`);
    await expect(page.getByRole("checkbox", { name: /Auto Alfa/ })).toBeVisible();
    await page.getByRole("navigation", { name: "Ścieżka" }).getByRole("link", { name: "Kalendarz floty" }).click();
    await expect(open).toBeFocused();
    await expect(page).toHaveURL(`${adminOrigin}/admin/kalendarz/`);

    // One day (inclusive), three vehicles: Beta collides, Gamma's activity ends earlier. Default ABORT preview saves nothing.
    await open.click();
    await page.getByLabel(/^Od/).fill(day(5));
    await page.getByLabel(/^Do/).fill(day(5));
    await page.getByLabel(/^Typ/).selectOption("MAINTENANCE");
    await page.getByLabel(/^Numer odniesienia/).fill("BULK-REF-217");
    await page.getByLabel(/^Notatka wewnętrzna/).fill("BULK-NOTE-217");
    for (const name of ["Auto Alfa", "Auto Beta", "Auto Gamma"]) await page.getByRole("checkbox", { name: new RegExp(name) }).check();
    await expect(page.getByText("Zaznaczono 3 z 4 · limit 50 pojazdów w jednym żądaniu")).toBeVisible();
    await expect(page.getByRole("radio", { name: /Wszystko albo nic \(domyślnie\)/ })).toBeChecked();
    await page.getByRole("button", { name: "Sprawdź konflikty" }).click();
    await expect(page.getByText("Podgląd konfliktów — nic nie zapisano")).toBeVisible();
    const row = (name: string) => page.getByRole("listitem").filter({ has: page.getByRole("checkbox", { name: new RegExp(name) }) });
    await expect(row("Auto Beta")).toContainText(/Konflikt: Serwis/);
    await expect(row("Auto Gamma")).toContainText("Poza okresem aktywności pojazdu");
    await expect(row("Auto Alfa")).toContainText("Wolny w tym terminie");
    await expect(page.getByRole("button", { name: "Zapisz blokadę (wstrzymane)" })).toBeDisabled();
    expect(await blocksOf(carAlfa)).toHaveLength(0);

    // Explicit SKIP: preview "Zapisz 1, pomiń 2", then the save reports saved and rejected; back in the grid the block shows.
    await page.getByRole("radio", { name: /Pomiń konflikty/ }).check();
    await page.getByRole("button", { name: "Sprawdź konflikty" }).click();
    await page.getByRole("button", { name: "Zapisz 1, pomiń 2" }).click();
    await expect(page.getByText("Zapisano 1 z 3 pojazdów")).toBeVisible();
    await expect(row("Auto Alfa")).toContainText("Zapisano");
    await expect(row("Auto Gamma")).toContainText("Poza okresem aktywności pojazdu");
    const alfaBlocks = await blocksOf(carAlfa);
    expect(alfaBlocks).toHaveLength(1);
    expect(alfaBlocks[0]).toMatchObject({ type: "MAINTENANCE", reference: "BULK-REF-217", internalNote: "BULK-NOTE-217" });
    expect(alfaBlocks[0].from.toISOString().slice(0, 10)).toBe(day(5));
    expect(alfaBlocks[0].to.toISOString().slice(0, 10)).toBe(day(5));
    expect(await blocksOf(carGamma)).toHaveLength(0);
    await page.getByRole("button", { name: "Wróć do kalendarza" }).click();
    await expect(region.getByRole("link", { name: /Auto Alfa: Serwis/ })).toBeVisible();
    await expect(open).toBeFocused();
    expect(await page.content()).not.toMatch(/BULK-REF-217|BULK-NOTE-217/);

    // D-48: "Kopiuj na inne auta" in the block's details. The gateway loses the answer after the commit (502): the screen
    // says the outcome is unknown, the retry carries the same key and the server replays the receipt, so one block exists.
    await page.goto(`${adminOrigin}/admin/pojazdy/${carAlfa}/kalendarz/?blok=${alfaBlocks[0].id}&miesiac=${day(5).slice(0, 7)}`);
    await page.getByRole("dialog").getByRole("link", { name: "Kopiuj na inne auta" }).click();
    await expect(page.getByRole("heading", { name: "Kopiuj blokadę", level: 2 })).toBeVisible();
    await expect(page.getByRole("group", { name: "Blokada źródłowa" })).toContainText("Serwis");
    await expect(page.getByRole("group", { name: "Blokada źródłowa" })).toContainText("Auto Alfa · BULK-REF-217");
    await expect(page.getByRole("checkbox", { name: /Auto Alfa/ })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Kopiuj także notatkę wewnętrzną/ })).not.toBeChecked();
    await page.getByRole("checkbox", { name: /Auto Delta/ }).check();
    await page.getByRole("button", { name: "Sprawdź konflikty" }).click();
    await expect(page.getByText("Podgląd konfliktów — nic nie zapisano")).toBeVisible();
    const keys: string[] = [];
    let lose = true;
    await page.route("**/api/admin/blocks/copy/", async (route) => {
      const body = route.request().postDataJSON() as { dryRun: boolean; idempotencyKey?: string };
      if (!body.dryRun && body.idempotencyKey) keys.push(body.idempotencyKey);
      const response = await route.fetch();
      if (!body.dryRun && lose) { lose = false; await route.fulfill({ status: 502, body: "" }); return; }
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Kopiuj blokadę" }).click();
    await expect(page.getByText("Nie wiemy, czy blokady zostały zapisane")).toBeVisible();
    await expect(page.getByText(/^Zapisano/)).toHaveCount(0);
    await expect(row("Auto Delta")).toContainText("Wynik nieznany — nie potwierdzono zapisu");
    expect(await blocksOf(carDelta)).toHaveLength(1);
    await page.getByRole("button", { name: "Ponów wysyłkę (ten sam klucz)" }).click();
    await expect(page.getByText("Zapisano 1 z 1 pojazdu")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    const delta = await blocksOf(carDelta);
    expect(delta).toHaveLength(1);
    expect(delta[0]).toMatchObject({ type: "MAINTENANCE", reference: "BULK-REF-217", internalNote: null });
    expect(delta[0].from.toISOString().slice(0, 10)).toBe(day(5));
    await page.unroute("**/api/admin/blocks/copy/");
    await page.getByRole("button", { name: "Wróć do kalendarza" }).click();
    await expect(page).toHaveURL(`${adminOrigin}/admin/kalendarz/`);
    await expect(region.getByRole("link", { name: /Auto Delta: Serwis/ })).toBeVisible();

    // Mobile and other widths: the bulk view keeps every function and the page never scrolls sideways.
    for (const width of [320, 390, 768, 1024, 1920]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      await page.goto(`${adminOrigin}/admin/kalendarz/?zbiorcza=1`);
      await expect(page.getByRole("checkbox", { name: /Auto Beta/ })).toBeVisible();
      await noOverflow(`bulk ${width}px`);
      if (width === 320) {
        await page.getByLabel(/^Od/).fill(day(10));
        await page.getByRole("checkbox", { name: /Auto Beta/ }).check();
        await page.getByRole("button", { name: "Sprawdź konflikty" }).click();
        await expect(page.getByText("Podgląd konfliktów — nic nie zapisano")).toBeVisible();
        await expect(page.getByRole("button", { name: "Zapisz blokadę" })).toBeEnabled();
        await noOverflow("preview 320px");
      }
    }
    expect(await blocksOf(carBeta)).toHaveLength(1);

    // Superadmin in company A: own actor, platform path, the preview shows the conflict report.
    const sPage = await superContext.newPage();
    await sPage.goto(`http://${hosts.platform}:${port}/firmy/${orgA}/kalendarz/`);
    await sPage.getByRole("button", { name: "Blokada zbiorcza" }).click();
    await sPage.getByLabel(/^Od/).fill(day(5));
    await sPage.getByRole("checkbox", { name: /Auto Beta/ }).check();
    const sRequest = sPage.waitForRequest((request) => request.url().includes(`/api/platform/companies/${orgA}/blocks/bulk/`));
    await sPage.getByRole("button", { name: "Sprawdź konflikty" }).click();
    await sRequest;
    await expect(sPage.getByRole("listitem").filter({ has: sPage.getByRole("checkbox", { name: /Auto Beta/ }) })).toContainText(/Konflikt: Serwis/);
  } finally {
    await adminContext.close();
    await superContext.close();
    for (const session of sessions) await session.dispose();
    await db.operationReceipt.deleteMany({ where: { organizationId: orgA } });
    await db.auditLog.deleteMany({ where: { organizationId: orgA } });
    await db.availabilityBlock.deleteMany({ where: { organizationId: orgA } });
    await db.vehicle.deleteMany({ where: { organizationId: orgA } });
    await db.serviceAccess.deleteMany({ where: { organizationId: orgA } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [hosts.adminA, hosts.platform] } } });
    await db.user.deleteMany({ where: { id: { in: [userA, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.organization.deleteMany({ where: { id: orgA } });
    await db.$disconnect();
  }
});
