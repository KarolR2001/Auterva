import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const DAY = 86_400_000;
const TRIAL = 336 * 3_600_000;

test("built company panel: trial date is not a payment, expiry keeps the panel working and links to chat", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const seeded: { organizationId: string; userId: string; hostname: string; origin: string; dispose: () => Promise<unknown> }[] = [];
  // The first administrator registration is immutable, so each trial phase gets its own company.
  async function seed(trialStart: Date) {
    const organizationId = randomUUID();
    const userId = randomUUID();
    const hostname = `service-${randomUUID()}.localhost`;
    const origin = new URL(baseURL as string);
    origin.hostname = hostname;
    await db.organization.create({ data: { id: organizationId, slug: `service-${organizationId}`, name: "Firma Status", firstAdminRegisteredAt: trialStart } });
    await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
    await db.user.create({ data: { id: userId, name: "Administrator Status", email: `service-${userId}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
    await db.serviceAccess.create({ data: { organizationId, trialGranted: true, trialStartedAt: trialStart, trialEndsAt: new Date(trialStart.getTime() + TRIAL) } });
    const session = await verifiedFixtureSession(db, userId);
    seeded.push({ organizationId, userId, hostname, origin: origin.origin, dispose: session.dispose });
    await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin.origin }]);
    return origin.origin;
  }
  try {
    const active = await seed(new Date(Date.now() - 2 * DAY));
    await page.goto(`${active}/admin/usluga/`);
    const card = page.getByTestId("service-status");
    await expect(card).toContainText("Okres próbny do");
    await expect(card).toContainText("to nie jest opłata");
    await expect(card).not.toContainText(/opłacone do/i);
    await expect(page.getByText("Usługa wygasła")).toHaveCount(0);

    // The trial has ended: the panel keeps working, shows the exact notice and a way to the chat.
    const expired = await seed(new Date(Date.now() - 20 * DAY));
    await page.goto(`${expired}/admin/usluga/`);
    await expect(page.getByText("Usługa wygasła")).toBeVisible();
    await expect(page.getByText(/Publiczna oferta jest obecnie wyłączona/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Przejdź do czatu z Autervą" })).toHaveAttribute("href", "/admin/czat");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Nawigacja panelu" })).toBeVisible();
    await page.goto(`${expired}/admin/`);
    await expect(page.getByText("Panel jest w przygotowaniu.")).toBeVisible();
  } finally {
    for (const item of seeded) {
      await item.dispose();
      await db.serviceAccess.deleteMany({ where: { organizationId: item.organizationId } });
      await db.hostMapping.deleteMany({ where: { hostname: item.hostname } });
      await db.user.deleteMany({ where: { id: item.userId } });
      await db.organization.delete({ where: { id: item.organizationId } });
    }
    await db.$disconnect();
  }
});
