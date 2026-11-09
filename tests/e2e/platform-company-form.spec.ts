import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// #25: PLT-04 in a real browser: validation, save, the separate invitation step, UNCERTAIN-free happy path, revoke.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("superadmin dodaje firmę, widzi zapis osobno od zaproszenia i cofa zaproszenie", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const marker = randomUUID();
  const slug = `plt04-${marker.slice(0, 8)}`;
  const email = `plt04-${marker}@example.test`;
  const platformHost = `platform-plt04-${marker}.example.test`;
  const origin = `http://${platformHost}:${new URL(baseURL).port}`;
  let organizationId: string | null = null;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  try {
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    if (!existing) throw new Error("Fixture superadmin required");
    await ensureControlledSuperadminMfa(db, existing.id);
    session = await verifiedFixtureSession(db, existing.id);
    const [cookieName, ...cookieValue] = session.cookie.split("=");
    await context.addCookies([{ name: cookieName, value: cookieValue.join("="), url: origin }]);

    const seen: string[] = [];
    page.on("dialog", (dialog) => { seen.push(`dialog:${dialog.type()}`); void dialog.dismiss(); });
    page.on("console", (message) => { if (message.type() === "error") seen.push(`console:${message.text().slice(0, 200)}`); });
    page.on("pageerror", (error) => seen.push(`pageerror:${error.message.slice(0, 200)}`));
    page.on("response", (response) => { if (response.request().method() !== "GET") seen.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`); });
    await page.goto(`${origin}/firmy/nowa/`);
    await expect(page.getByRole("heading", { name: "Dodaj firmę" }).first()).toBeVisible();
    // Empty submit: precise errors, focus on the first field, nothing saved.
    await page.getByRole("button", { name: "Zapisz firmę" }).click();
    await expect(page.getByText("Wpisz nazwę firmy.")).toBeVisible();
    await expect(page.getByLabel(/Nazwa firmy/)).toBeFocused();

    await page.getByLabel(/Nazwa firmy/).fill("Plt04 Wypożyczalnia Łódź");
    // The slug suggestion follows the name until edited.
    await expect(page.getByLabel(/Slug panelu/)).toHaveValue("plt04-wypozyczalnia-lodz");
    await page.getByLabel(/Slug panelu/).fill(slug);
    await page.getByLabel(/E-mail administratora/).fill(email);
    await page.getByLabel(/^Trial/).check();

    // Leaving the dirty form goes through the shell guard; Stay keeps the values.
    await page.getByRole("link", { name: "Anuluj" }).click();
    await expect(page.getByRole("alertdialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await page.getByRole("button", { name: "Zostań" }).click();
    await expect(page.getByLabel(/Nazwa firmy/)).toHaveValue("Plt04 Wypożyczalnia Łódź");

    await page.getByRole("button", { name: "Zapisz firmę" }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/[0-9a-f-]{36}/\\?zapisano=1`)).catch((error: Error) => {
      throw new Error(`${error.message}\nSEEN: ${JSON.stringify(seen)}`);
    });
    organizationId = new URL(page.url()).pathname.split("/")[2];
    await expect(page.getByText(/Zapisano firmę\./)).toBeVisible();
    await expect(page.getByText(/Strona nie jest opublikowana/)).toBeVisible();
    await expect(page.getByText("Zaproszenie nie zostało wydane")).toBeVisible();
    expect(await db.invitation.count({ where: { organizationId } })).toBe(0);

    await page.getByRole("button", { name: "Wyślij zaproszenie" }).click();
    await expect(page.getByText(/Zaproszenie wydane i zapisane w kolejce/)).toBeVisible();
    expect(await db.invitation.count({ where: { organizationId } })).toBe(1);
    await expect(page.getByRole("button", { name: "Cofnij zaproszenie" })).toBeVisible();
    await page.getByRole("button", { name: "Cofnij zaproszenie" }).click();
    await expect(page.getByText("Zaproszenie cofnięte", { exact: true })).toBeVisible();
    expect((await db.invitation.findMany({ where: { organizationId } })).every((row) => row.revokedAt !== null)).toBe(true);

    // The same slug cannot be taken twice: the error points at the fields and keeps the entries.
    await page.goto(`${origin}/firmy/nowa/`);
    await page.getByLabel(/Nazwa firmy/).fill("Drugi");
    await page.getByLabel(/Slug panelu/).fill(slug);
    await page.getByLabel(/E-mail administratora/).fill(`other-${email}`);
    await page.getByLabel(/^Trial/).check();
    await page.getByRole("button", { name: "Zapisz firmę" }).click();
    await expect(page.getByText(/zajęty/).first()).toBeVisible();
    await expect(page.getByLabel(/Nazwa firmy/)).toHaveValue("Drugi");
  } finally {
    if (organizationId) {
      await db.job.deleteMany({ where: { organizationId } });
      await db.invitation.deleteMany({ where: { organizationId } });
      await db.auditLog.deleteMany({ where: { organizationId } });
      await db.operationReceipt.deleteMany({ where: { organizationId } });
      await db.reminderIntent.deleteMany({ where: { organizationId } });
      await db.reminderPlan.deleteMany({ where: { organizationId } });
      await db.serviceAccess.deleteMany({ where: { organizationId } });
      await db.user.deleteMany({ where: { organizationId } });
      await db.hostMapping.deleteMany({ where: { organizationId } });
      await db.organization.delete({ where: { id: organizationId } });
    }
    if (session) await session.dispose();
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    await db.$disconnect();
  }
});
