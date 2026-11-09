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
  await db.organization.create({ data: { id: organizationId, slug: `service-${organizationId}`, name: "Firma Status",
    firstAdminRegisteredAt: new Date(Date.now() - 2 * day) } });
  await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: userId, name: "Administrator Status", email: `service-${userId}@example.test`,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  await db.serviceAccess.create({ data: { organizationId, trialGranted: true, trialStartedAt: new Date(Date.now() - 2 * day),
    trialEndsAt: new Date(Date.now() + 5 * day) } });
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
    await db.serviceAccess.update({ where: { organizationId }, data: { trialEndsAt: new Date(Date.now() - day) } });
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
