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
    await expect(card.getByRole("link", { name: "Napisz do Autervy" })).toHaveAttribute("href", "/admin/czat");
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

test("built company panel: a very long public host never widens the page", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const organizationId = randomUUID();
  const userId = randomUUID();
  const adminHost = `service-${randomUUID()}.localhost`;
  // Labels stay within the 63-character DNS limit; the totals are 64 and 190 characters.
  const label = (size: number, seed: string) => `${seed}${"a".repeat(size - seed.length)}`;
  const hosts = [`${label(30, "h")}.${label(30, "x")}.pl`, `${label(63, "i")}.${label(63, "j")}.${label(59, "k")}.pl`];
  expect(hosts.map((host) => host.length)).toEqual([64, 190]);
  const now = new Date();
  try {
    await db.organization.create({ data: { id: organizationId, slug: `service-${organizationId}`, name: "Firma Host", firstAdminRegisteredAt: now } });
    await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
    await db.user.create({ data: { id: userId, name: "Administrator Host", email: `service-${userId}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
    await db.serviceAccess.create({ data: { organizationId, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + TRIAL) } });
    const session = await verifiedFixtureSession(db, userId);
    try {
      const origin = new URL(baseURL);
      origin.hostname = adminHost;
      await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin.origin }]);
      for (const host of hosts) {
        await db.hostMapping.deleteMany({ where: { organizationId, area: "COMPANY_PUBLIC" } });
        await db.hostMapping.create({ data: { hostname: host, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" } });
        for (const width of [320, 1920]) {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${origin.origin}/admin/usluga/`);
          await expect(page.getByTestId("service-status")).toBeVisible();
          await expect(page.getByRole("link", { name: host })).toBeVisible();
          const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
          expect(scroll, `${host.length} znaków przy ${width} px`).toBeLessThanOrEqual(width);
        }
      }
    } finally {
      await session.dispose();
    }
  } finally {
    await db.serviceAccess.deleteMany({ where: { organizationId } });
    await db.hostMapping.deleteMany({ where: { organizationId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
