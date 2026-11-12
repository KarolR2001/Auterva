import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #78 / D-52: safe domain and mail diagnostics on the company card, as the superadmin in a real browser.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("superadmin: Diagnostyka shows domain and mail, uncertain on 5xx keeps the last result, fits 320-1920 and works by keyboard (#78)", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = new URL(baseURL).port;
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const org = randomUUID();
  const platformHost = `plt78-platform-${org}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const custom = `www.plt78-${org.slice(0, 8)}.klient.example.test`;
  const session = await (async () => {
    await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
    await resetPlatformApiBudget(db, FIXTURE.users[2]);
    return verifiedFixtureSession(db, FIXTURE.users[2]);
  })();
  try {
    await db.organization.create({ data: { id: org, slug: `plt78-${org}`, name: `Plt78 ${org.slice(0, 8)}`, firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) } });
    await db.hostMapping.createMany({ data: [
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
      { hostname: `plt78-a-${org}.example.test`, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
      { hostname: `plt78-p-${org}.example.test`, area: "COMPANY_PUBLIC", organizationId: org, status: "ACTIVE" },
      { hostname: custom, area: "COMPANY_PUBLIC", kind: "CUSTOM", organizationId: org, status: "PENDING" },
    ] });
    const mapping = await db.hostMapping.findUniqueOrThrow({ where: { hostname: custom } });
    await db.customDomain.create({ data: { organizationId: org, hostMappingId: mapping.id, verificationToken: `plt78-token-${org}`,
      status: "PENDING_ROUTING", ownershipVerifiedAt: new Date(), lastFailureCode: "CNAME_MISMATCH", checkedAt: new Date() } });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: new Date(Date.now() + 30 * 86_400_000) } });
    await db.user.create({ data: { id: randomUUID(), name: "Plt78 admin", email: `plt78-${org}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: org } });
    await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin }]);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/firmy/${org}/`);
    const region = page.getByRole("region", { name: "Diagnostyka" });
    await expect(region.getByRole("heading", { name: "Domena" })).toBeVisible();
    await expect(region.getByRole("heading", { name: "Poczta" })).toBeVisible();
    await expect(region.getByText(/^Błąd: /).first()).toBeVisible();
    await expect(region.getByText(custom)).toBeVisible();
    await expect(region.getByText("Brak wysyłek")).toBeVisible();
    await expect(region).not.toContainText(`plt78-token-${org}`);
    const retry = region.getByRole("button", { name: "Sprawdź ponownie" });
    await expect(retry).toHaveCount(2);
    for (const button of await retry.all()) expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(48);

    // Keyboard: the button is reachable by Tab and operable with Enter; 5xx never becomes a success.
    await page.route(`**/api/platform/companies/${org}/domains/verify/`, (route) => route.fulfill({ status: 503, body: "{}", contentType: "application/json" }));
    await retry.first().focus();
    await expect(retry.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(region.getByText("Wynik niepewny")).toBeVisible();
    await expect(region.getByText(/Ostatni potwierdzony wynik: Błąd/)).toBeVisible();
    await expect(retry.first()).toBeFocused();
    await expect(region.getByText("Aktywna", { exact: true })).toHaveCount(0);

    // Mail: re-read only, no verification request.
    await retry.last().click();
    await expect(region.getByRole("status").last()).toContainText("Sprawdzanie zakończone.");

    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(region).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `viewport ${width}`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: test.info().outputPath("diagnostics-1440.png"), fullPage: true });
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.customDomain.deleteMany({ where: { organizationId: org } });
    await db.reminderIntent.deleteMany({ where: { organizationId: org } });
    await db.reminderPlan.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await session.dispose();
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: org }, { hostname: platformHost }] } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
