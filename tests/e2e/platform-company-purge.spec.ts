import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { axeScan, focusAudit } from "../fixtures/a11y";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #445 (D-58, PLT-03): the company card and list show the planned permanent deletion date, the "in progress" and the
// "Usunięta" states. The UI is built from existing components (owner decision 22.11.2026): there is no PLT-03 mock state.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });

const WIDTHS = [320, 390, 768, 1024, 1440, 1920];
const DAY = 86_400_000;

test("platform: planned, running and finished purge states on the list and the card (#445)", async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = new URL(baseURL).port;
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const [planned, running, gone] = [randomUUID(), randomUUID(), randomUUID()];
  const names = { planned: `Plt445 plan ${tag}`, running: `Plt445 run ${tag}` };
  const platformHost = `plt445-platform-${tag}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const archivedPlanned = new Date(Date.now() - 100 * DAY);
  const archivedLate = new Date(Date.now() - 400 * DAY);
  const startedAt = new Date(Date.now() - 2 * 3_600_000);
  const purgedAt = new Date(Date.now() - 3_600_000);
  await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
  await resetPlatformApiBudget(db, FIXTURE.users[2]);
  const session = await verifiedFixtureSession(db, FIXTURE.users[2]);
  const warsaw = (date: Date) => new Intl.DateTimeFormat("pl-PL", { timeZone: "Europe/Warsaw", day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  const dueOf = (archived: Date) => { const due = new Date(archived); due.setUTCMonth(due.getUTCMonth() + 12); return due; };
  try {
    await db.organization.createMany({ data: [
      { id: planned, slug: `plt445-plan-${tag}`, name: names.planned, firstAdminRegisteredAt: archivedLate, archivedAt: archivedPlanned },
      { id: running, slug: `plt445-run-${tag}`, name: names.running, firstAdminRegisteredAt: archivedLate, archivedAt: archivedLate, purgeStartedAt: startedAt },
      { id: gone, slug: `purged-${gone}`, name: null, firstAdminRegisteredAt: archivedLate, archivedAt: archivedLate, purgeStartedAt: startedAt, purgedAt },
    ] });
    await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
    await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin }]);

    // List: the planned date for the archived company, the in-progress badge, and the skeleton without name, slug or e-mail.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/firmy/`);
    await page.getByRole("checkbox", { name: "Pokaż zarchiwizowane" }).check();
    const searchbox = page.getByRole("searchbox");
    await searchbox.fill("Plt445");
    const plannedRow = page.getByRole("row").filter({ hasText: names.planned });
    await expect(plannedRow).toContainText(`Trwałe usunięcie danych: najwcześniej ${warsaw(dueOf(archivedPlanned))}`);
    const runningRow = page.getByRole("row").filter({ hasText: names.running });
    await expect(runningRow.getByText("Trwa usuwanie danych")).toBeVisible();
    await expect(runningRow.getByRole("link", { name: /Czat/ })).toHaveCount(0);
    await searchbox.fill(`purged-${gone}`);
    const goneRow = page.locator('tr[data-purge-state="done"]');
    await expect(goneRow).toHaveCount(1);
    await expect(goneRow).toContainText("Firma usunięta");
    await expect(goneRow).toContainText(`Usunięta ${warsaw(purgedAt)}`);
    await expect(goneRow.getByRole("link", { name: /Czat/ })).toHaveCount(0);
    // The list never shows the technical slug of the skeleton.
    await expect(page.locator("main")).not.toContainText(`purged-${gone}`);
    await searchbox.fill("");
    await searchbox.fill("Plt445");

    // Planned card: date, irreversibility, restore still available.
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/firmy/${planned}/`);
      const region = page.getByRole("region", { name: "Trwałe usunięcie danych" });
      await expect(region).toContainText("Zaplanowane usunięcie danych");
      await expect(region).toContainText(`Najwcześniej ${warsaw(dueOf(archivedPlanned))}`);
      await expect(region).toContainText("Po starcie jest to nieodwracalne");
      await expect(page.getByRole("button", { name: "Przywróć firmę" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `planned card ${width}`).toBeLessThanOrEqual(0);
    }
    await axeScan(page, "planned purge card");
    await focusAudit(page, "planned purge card");

    // Running card: irreversible, no restore, no chat/fleet entries.
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/firmy/${running}/`);
      const region = page.getByRole("region", { name: "Trwałe usunięcie danych" });
      await expect(region).toContainText("Trwa trwałe usunięcie danych");
      await expect(page.getByRole("button", { name: /Przywróć firmę|Odblokuj/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Zarządzaj flotą" })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `running card ${width}`).toBeLessThanOrEqual(0);
    }
    await axeScan(page, "running purge card");

    // Finished card: only the "Usunięta" state; nothing technical and no actions.
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/firmy/${gone}/`);
      await expect(page.getByRole("heading", { level: 2, name: "Firma usunięta" })).toBeVisible();
      const region = page.getByRole("region", { name: "Trwałe usunięcie danych" });
      await expect(region).toContainText("Usunięta");
      await expect(region).toContainText(warsaw(purgedAt));
      await expect(page.locator("main")).not.toContainText(`purged-${gone}`);
      await expect(page.getByRole("button", { name: /Przywróć|Archiwizuj|Odblokuj|Zapisz/ })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `purged card ${width}`).toBeLessThanOrEqual(0);
    }
    await axeScan(page, "purged card");
    await focusAudit(page, "purged card");
    // Restore of a purged company is refused by the API; the card offers no way to try.
    const restore = await page.evaluate(async ([id, key]) => {
      const response = await fetch(`/api/platform/companies/${id}/restore/`, { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedOrganizationVersion: 0, eventKey: key }) });
      return { status: response.status };
    }, [gone, randomUUID()]);
    expect(restore.status).toBeGreaterThanOrEqual(400);

    // Keyboard: the purged row's only action is reachable and opens the card.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/firmy/`);
    await page.getByRole("checkbox", { name: "Pokaż zarchiwizowane" }).check();
    await page.getByRole("searchbox").fill(`purged-${gone}`);
    const open = page.locator('tr[data-purge-state="done"]').getByRole("link", { name: /Otwórz kartę usuniętej firmy/ });
    await open.focus();
    await expect(open).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: "Firma usunięta" })).toBeVisible();
  } finally {
    const ids = [planned, running, gone];
    await db.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
    await session.dispose();
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    await db.organization.deleteMany({ where: { id: { in: ids } } });
    await db.$disconnect();
  }
});
