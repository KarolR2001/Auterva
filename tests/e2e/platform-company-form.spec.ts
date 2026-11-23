import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #25: PLT-04 in a real browser: validation, save, the separate invitation step, UNCERTAIN-free happy path, revoke.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });


// #295: PLT-03/PLT-04 keep one column on small screens and never scroll the page sideways at any reference width.
const widths = [320, 768, 1024, 1440, 1920];
async function expectNoHorizontalScroll(page: import("@playwright/test").Page) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `poziome przewijanie przy ${width} px`).toBeLessThanOrEqual(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

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
    await resetPlatformApiBudget(db, existing.id);
    session = await verifiedFixtureSession(db, existing.id);
    const [cookieName, ...cookieValue] = session.cookie.split("=");
    await context.addCookies([{ name: cookieName, value: cookieValue.join("="), url: origin }]);

    await page.goto(`${origin}/firmy/nowa/`);
    await expect(page.getByRole("heading", { name: "Dodaj firmę" }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Przed wysłaniem zaproszenia" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    // Empty submit: precise errors, focus on the first field, nothing saved.
    await page.getByRole("button", { name: "Zapisz firmę" }).click();
    await expect(page.getByText("Wpisz nazwę firmy.")).toBeVisible();
    await expect(page.getByLabel(/Nazwa firmy/)).toBeFocused();

    await page.getByLabel(/Nazwa firmy/).fill("Plt04 Wypożyczalnia Łódź");
    // The slug suggestion follows the name until edited.
    await expect(page.getByLabel(/Nazwa w adresie panelu/)).toHaveValue("plt04-wypozyczalnia-lodz");
    await page.getByLabel(/Nazwa w adresie panelu/).fill(slug);
    await page.getByLabel(/^E-mail administratora/).fill(email);
    await page.getByLabel(/^Okres próbny/).check();

    // D-41: the optional contact section validates like company settings and keeps the entries.
    await expect(page.getByRole("group", { name: "Adres (opcjonalnie)" })).toBeVisible();
    await page.getByLabel(/^Telefon kontaktowy/).fill("12");
    await page.getByRole("button", { name: "Zapisz firmę" }).click();
    await expect(page.getByText(/Podaj poprawny numer telefonu/).first()).toBeVisible();
    await expect(page.getByLabel(/^Telefon kontaktowy/)).toBeFocused();
    await expectNoHorizontalScroll(page);
    await page.getByLabel(/^Telefon kontaktowy/).fill("+48 600 100 200");
    await page.getByLabel(/^Publiczny e-mail kontaktowy/).fill(`kontakt-${marker.slice(0, 8)}@example.test`);
    await page.getByLabel("Ulica i numer").fill("ul. Przykładowa 12");
    await page.getByLabel("Kod pocztowy").fill("30-001");
    await page.getByLabel("Miejscowość").fill("Kraków");
    await page.getByLabel("Kraj").fill("Polska");

    // Leaving the dirty form goes through the shell guard; Stay keeps the values.
    await page.getByRole("link", { name: "Anuluj" }).click();
    await expect(page.getByRole("alertdialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await page.getByRole("button", { name: "Zostań" }).click();
    await expect(page.getByLabel(/Nazwa firmy/)).toHaveValue("Plt04 Wypożyczalnia Łódź");

    await page.getByRole("button", { name: "Zapisz firmę" }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/[0-9a-f-]{36}/\\?zapisano=1`));
    organizationId = new URL(page.url()).pathname.split("/")[2];
    const settings = await db.siteSettings.findUniqueOrThrow({ where: { organizationId } });
    expect(settings).toMatchObject({ phone: "+48 600 100 200", email: `kontakt-${marker.slice(0, 8)}@example.test`,
      addressLine: "ul. Przykładowa 12", postalCode: "30-001", city: "Kraków", country: "Polska" });
    await page.goto(`${origin}/firmy/${organizationId}/ustawienia/?sekcja=kontakt`);
    await expect(page.getByText("+48 600 100 200").first()).toBeVisible();
    await page.goto(`${origin}/firmy/${organizationId}/?zapisano=1`);
    await expect(page.getByText(/Zapisano firmę\./)).toBeVisible();
    await expect(page.getByText(/Strona nie jest opublikowana/)).toBeVisible();
    await expect(page.getByText("Zaproszenie nie zostało wydane")).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Plt04 Wypożyczalnia Łódź" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Status firmy" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await db.invitation.count({ where: { organizationId } })).toBe(0);

    await page.getByRole("button", { name: "Wyślij zaproszenie" }).click();
    await expect(page.getByText(/Zaproszenie wydane i zapisane w kolejce/)).toBeVisible();
    expect(await db.invitation.count({ where: { organizationId } })).toBe(1);
    await expect(page.getByRole("button", { name: "Cofnij zaproszenie" })).toBeVisible();
    await page.getByRole("button", { name: "Cofnij zaproszenie" }).click();
    await expect(page.getByText("Zaproszenie cofnięte", { exact: true })).toBeVisible();
    expect((await db.invitation.findMany({ where: { organizationId } })).every((row) => row.revokedAt !== null)).toBe(true);

    // Own domain (#23 API): added after the save, waits for proof, never claims publication.
    const customHost = `kamper-${marker.slice(0, 8)}.example.org`;
    await expect(page.getByRole("heading", { name: "Domena własna" })).toBeVisible();
    await page.getByLabel(/Nazwa domeny/).fill("https://zly host");
    await page.getByRole("button", { name: "Dodaj domenę" }).click();
    await expect(page.getByText("Niepoprawna nazwa domeny.").first()).toBeVisible();
    await page.getByLabel(/Nazwa domeny/).fill(customHost);
    await page.getByRole("button", { name: "Dodaj domenę" }).click();
    await expect(page.getByText(`${customHost} — Oczekuje na potwierdzenie własności`)).toBeVisible();
    await expect(page.getByText(/nie jest jeszcze adresem strony/).first()).toBeVisible();
    await expect(page.getByText(/_auterva-challenge\./)).toBeVisible();
    expect(await db.customDomain.count({ where: { organizationId } })).toBe(1);
    expect((await db.hostMapping.findFirstOrThrow({ where: { hostname: customHost } })).status).toBe("PENDING");
    await page.getByRole("button", { name: "Usuń domenę" }).click();
    await expect(page.getByLabel(/Nazwa domeny/)).toBeVisible();
    expect(await db.customDomain.count({ where: { organizationId } })).toBe(0);

    // The same slug cannot be taken twice: the error points at the fields and keeps the entries.
    await page.goto(`${origin}/firmy/nowa/`);
    await page.getByLabel(/Nazwa firmy/).fill("Drugi");
    await page.getByLabel(/Nazwa w adresie panelu/).fill(slug);
    await page.getByLabel(/^E-mail administratora/).fill(`other-${email}`);
    await page.getByLabel(/^Okres próbny/).check();
    await page.getByRole("button", { name: "Zapisz firmę" }).click();
    await expect(page.getByText(/zajęt[ya]/).first()).toBeVisible();
    await expect(page.getByLabel(/Nazwa firmy/)).toHaveValue("Drugi");
  } finally {
    if (organizationId) {
      await db.customDomain.deleteMany({ where: { organizationId } });
      await db.job.deleteMany({ where: { organizationId } });
      await db.siteSettings.deleteMany({ where: { organizationId } });
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
