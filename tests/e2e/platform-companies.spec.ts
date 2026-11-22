import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// Superadmin list, card, period edit (version conflict) and archive in a real browser behind the local ingress.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("superadmin: search, card, period save, version conflict and archive keep one clear company context (#27)", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = new URL(baseURL).port;
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const org = randomUUID();
  const marker = `Plt27 ${org.slice(0, 8)}`;
  const platformHost = `plt27-platform-${org}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const registered = new Date(Date.now() - 86_400_000);
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const session = await (async () => {
    await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
    await resetPlatformApiBudget(db, FIXTURE.users[2]);
    return verifiedFixtureSession(db, FIXTURE.users[2]);
  })();
  try {
    await db.organization.create({ data: { id: org, slug: `plt27-${org}`, name: marker, firstAdminRegisteredAt: registered } });
    await db.hostMapping.createMany({ data: [
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
      { hostname: `plt27-a-${org}-long-host.example.test`, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
      { hostname: `plt27-p-${org}-long-host.example.test`, area: "COMPANY_PUBLIC", organizationId: org, status: "ACTIVE" },
    ] });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: new Date(`${day(30)}T00:00:00.000Z`) } });
    await db.user.create({ data: { id: randomUUID(), name: "Plt27 admin", email: `plt27-${org}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: org } });
    await page.context().addCookies([{ name: "better-auth.session_token",
      value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin }]);

    page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
    page.on("response", (response) => {
      if (response.status() >= 400) console.log(`[http ${response.status()}] ${response.url()}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.log(`[console] ${message.text().slice(0, 300)}`);
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/firmy/`);
    await page.getByRole("searchbox").fill(marker);
    const card = page.getByRole("row").filter({ hasText: marker });
    await expect(card).toBeVisible();
    await expect(card.getByText(/Opłacona do/)).toBeVisible();
    // #293: table or cards, the list never scrolls the page sideways (table only when its container fits 5 columns).
    for (const width of [390, 768, 900, 1023, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `viewport ${width}`).toBeLessThanOrEqual(0);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await card.getByRole("link", { name: /Otwórz firmę/ }).click();
    await expect(page.getByRole("heading", { name: "Status firmy" })).toBeVisible();
    await expect(page.getByText("Działasz jako superadmin w kontekście firmy")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("card-390.png"), fullPage: true });

    // Extend through the UI.
    const field = page.getByLabel("Opłacono do dnia włącznie");
    await field.fill(day(60));
    await expect(page.getByText(/Niezapisana zmiana/)).toBeVisible();
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Okres usługi został zapisany.")).toBeVisible();
    expect((await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: org } })).paidThrough?.toISOString().slice(0, 10)).toBe(day(60));
    // The success notice appears before the card reloads; the status row shows the new date only after the reload has
    // delivered the saved periodVersion. Without waiting, the other session's write could land first and the page would
    // then load (and save with) its version, so no conflict would exist (#313).
    const [savedYear, savedMonth, savedDay] = day(60).split("-");
    await expect(page.getByText(`Do ${savedDay}.${savedMonth}.${savedYear} włącznie`, { exact: true })).toBeVisible();

    // Another session changes the period: this save must conflict, not overwrite silently.
    await db.serviceAccess.update({ where: { organizationId: org }, data: { paidThrough: new Date(`${day(90)}T00:00:00.000Z`), periodVersion: { increment: 1 } } });
    await field.fill(day(70));
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "zmieniony przez inną sesję" })).toBeVisible();
    await expect(field).toHaveValue(day(70));
    expect((await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: org } })).paidThrough?.toISOString().slice(0, 10)).toBe(day(90));

    // Archive from the card; the company stays on the list behind the archive filter.
    await page.setViewportSize({ width: 1440, height: 900 });
    // Cancel leaves the company untouched; the dialog names the company and what is kept.
    await page.getByRole("button", { name: "Archiwizuj firmę" }).click();
    await expect(page.getByRole("dialog")).toContainText("Dane firmy zostaną trwale usunięte 12 miesięcy po archiwizacji");
    await page.getByRole("button", { name: "Anuluj" }).click();
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).archivedAt).toBeNull();
    await page.getByRole("button", { name: "Archiwizuj firmę" }).click();
    await page.getByRole("button", { name: "Archiwizuj", exact: true }).click();
    await expect(page.getByText("Firma została zarchiwizowana.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Przywróć firmę" })).toBeVisible();
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).archivedAt).not.toBeNull();
    // Restore returns the account only: the page stays locked until a separate, confirmed unlock.
    await page.getByRole("button", { name: "Przywróć firmę" }).click();
    await page.getByRole("button", { name: "Przywróć", exact: true }).click();
    await expect(page.getByText("Firma została przywrócona.")).toBeVisible();
    await expect(page.getByText("Przywrócenie nie publikuje strony.")).toBeVisible();
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).publicUnlockRequired).toBe(true);
    await page.getByRole("button", { name: "Odblokuj stronę publiczną" }).click();
    await expect(page.getByRole("dialog")).toContainText("Odblokować stronę publiczną firmy");
    await page.getByRole("button", { name: "Odblokuj stronę", exact: true }).click();
    await expect(page.getByText("Strona publiczna została odblokowana.")).toBeVisible();
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).publicUnlockRequired).toBe(false);
    await page.getByRole("button", { name: "Archiwizuj firmę" }).click();
    await page.getByRole("button", { name: "Archiwizuj", exact: true }).click();
    await expect(page.getByRole("button", { name: "Przywróć firmę" })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("card-1440.png"), fullPage: true });
    await page.goto(`${origin}/firmy/`);
    await page.getByRole("searchbox").fill(marker);
    await expect(page.getByText("Brak firm dla wybranych kryteriów.")).toBeVisible();
    await page.getByRole("checkbox", { name: "Pokaż zarchiwizowane" }).check();
    await expect(page.getByRole("row").filter({ hasText: marker }).getByText(/Zarchiwizowana \d{2}\.\d{2}\.\d{4}/)).toBeVisible();

    // Same host policy as `/` and `/firmy/{id}/` (#14/#15): without a session the list goes to the platform login, never private HTML.
    await page.context().clearCookies();
    await page.goto(`${origin}/firmy/`);
    await expect(page).toHaveURL(new RegExp(`^${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/login/?$`));
    await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId: org } });
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
