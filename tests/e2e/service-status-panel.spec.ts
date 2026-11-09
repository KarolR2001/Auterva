import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

test("built company panel: trial date is not a payment, expiry keeps the panel working and links to chat", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const organizationId = randomUUID();
  const userId = randomUUID();
  const hostname = `service-${randomUUID()}.localhost`;
  const origin = new URL(baseURL);
  origin.hostname = hostname;
  const day = 86_400_000;
  const trialStart = new Date(Date.now() - 2 * day);
  await db.organization.create({ data: { id: organizationId, slug: `service-${organizationId}`, name: "Firma Status",
    firstAdminRegisteredAt: trialStart } });
  await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: userId, name: "Administrator Status", email: `service-${userId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  await db.serviceAccess.create({ data: { organizationId, trialGranted: true, trialStartedAt: trialStart,
    trialEndsAt: new Date(trialStart.getTime() + 336 * 3_600_000) } });
  const session = await verifiedFixtureSession(db, userId);
  try {
    await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin.origin }]);
    await page.goto(`${origin.origin}/admin/usluga/`);
    const card = page.getByTestId("service-status");
    await expect(card).toContainText("Okres próbny do");
    await expect(card).toContainText("to nie jest opłata");
    await expect(card).not.toContainText(/opłacone do/i);
    await expect(page.getByText("Usługa wygasła")).toHaveCount(0);

    // The trial ends: the server answer changes the notice; nothing blocks the panel or the session.
    const earlier = new Date(Date.now() - 20 * day);
    await db.organization.update({ where: { id: organizationId }, data: { firstAdminRegisteredAt: earlier } });
    await db.serviceAccess.update({ where: { organizationId }, data: { trialStartedAt: earlier,
      trialEndsAt: new Date(earlier.getTime() + 336 * 3_600_000) } });
    await page.goto(`${origin.origin}/admin/usluga/`);
    await expect(page.getByText("Usługa wygasła")).toBeVisible();
    await expect(page.getByText(/Publiczna oferta jest obecnie wyłączona/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Przejdź do czatu z Autervą" })).toHaveAttribute("href", "/admin/czat");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Nawigacja panelu" })).toBeVisible();
    await page.goto(`${origin.origin}/admin/`);
    await expect(page.getByText("Panel jest w przygotowaniu.")).toBeVisible();
  } finally {
    await session.dispose();
    await db.serviceAccess.deleteMany({ where: { organizationId } });
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
