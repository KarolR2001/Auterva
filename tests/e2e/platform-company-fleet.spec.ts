import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect as baseExpect, test } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { createMediaStorage, removeObject } from "../../src/modules/media/storage";
import { processMediaClaim } from "../../src/modules/media/worker";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #47: the superadmin manages one company's fleet, photos, calendar and protected preview from its card (mobile width),
// every write is theirs and the chosen company's; another company, the archive (D-23), an expired period and an anonymous visitor.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test("company fleet by the superadmin: card -> fleet -> form -> photos -> calendar -> preview -> back, isolation, archive, noindex", async ({ baseURL, browser }) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const secrets = Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
    .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  const storage = createMediaStorage({ ...process.env, ...secrets });
  const tag = randomUUID().slice(0, 8);
  const [orgA, orgB, carA, carB] = Array.from({ length: 4 }, () => randomUUID());
  const platformHost = `fleet-platform-${tag}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  let ownedSuperadmin: string | null = null;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    // Company A has an EXPIRED service period: the panel and the preview still work, the public page does not.
    await db.organization.create({ data: { id: orgA, slug: `fleet-a-${tag}`, name: `Firma Floty A ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.organization.create({ data: { id: orgB, slug: `fleet-b-${tag}`, name: `Firma Floty B ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.serviceAccess.create({ data: { organizationId: orgA, paidThrough: sqlDate(day(-3)) } });
    await db.serviceAccess.create({ data: { organizationId: orgB, paidThrough: sqlDate(day(30)) } });
    await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
    await db.vehicle.createMany({ data: [
      { id: carA, organizationId: orgA, slug: `fleet-a-${carA}`, name: "Auto Alfa", status: "DRAFT", availableFrom: sqlDate(day(-30)) },
      { id: carB, organizationId: orgB, slug: `fleet-b-${carB}`, name: "Auto Beta", status: "DRAFT" },
    ] });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Fleet operator", role: "SUPERADMIN_AUTERVA", email: `fleet-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    await resetPlatformApiBudget(db, superId);
    session = await verifiedFixtureSession(db, superId);
    const [name, ...rest] = session.cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: origin }]);
    const page = await context.newPage();
    const openSection = async (title: string) => {
      const toggle = page.locator("h3 button[aria-expanded]").filter({ hasText: title });
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    };
    const noOverflow = async (label: string) => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `overflow: ${label}`).toBeLessThanOrEqual(0);
    };

    // Card -> fleet of THIS company only.
    await page.goto(`${origin}/firmy/${orgA}/`);
    await page.getByRole("link", { name: "Zarządzaj flotą" }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/${orgA}/pojazdy/?$`));
    await expect(page.getByText("Auto Alfa").first()).toBeVisible();
    await expect(page.getByText("Auto Beta")).toHaveCount(0);
    await expect(page.getByText(`Firma: Firma Floty A ${tag}`)).toBeVisible();
    await noOverflow("fleet list");

    // Form: a save is the superadmin's own and belongs to company A.
    await page.getByRole("link", { name: /Edytuj\s*Auto Alfa/ }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/${orgA}/pojazdy/${carA}/?$`));
    await page.getByLabel("Nazwa pojazdu").fill("Auto Alfa po zmianie");
    await page.getByRole("button", { name: "Zapisz szkic" }).click();
    await expect(page.getByText("Zapisano zmiany.")).toBeVisible();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: carA } })).name).toBe("Auto Alfa po zmianie");
    const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, entityId: carA, action: "VEHICLE_UPDATED" } });
    expect(audit).toMatchObject({ actorId: superId, actorRole: "SUPERADMIN_AUTERVA" });

    // Photos through the nested API; the media worker finishes the upload.
    await openSection("Zdjęcia");
    const png = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#335577" } }).png().toBuffer();
    await page.getByTestId("vehicle-photo-input").setInputFiles({ name: "alfa.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Przetwarzanie zdjęcia…")).toBeVisible();
    const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
    expect(claim).not.toBeNull();
    expect(await processMediaClaim(db, storage, claim!)).toBe(true);
    await expect(page.getByRole("heading", { name: "Zdjęcia pojazdu (1 z 30)" })).toBeVisible({ timeout: 30_000 });
    expect(await db.vehicleImage.count({ where: { vehicleId: carA, organizationId: orgA, status: "READY", isCover: true } })).toBe(1);
    await noOverflow("vehicle form with photos");

    // Calendar: a block is added for company A's vehicle.
    await page.getByRole("link", { name: "Kalendarz pojazdu" }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/${orgA}/pojazdy/${carA}/kalendarz/?$`));
    await page.getByRole("button", { name: "Dodaj okres niedostępności" }).last().click();
    await page.locator("#bc-from").fill(day(2));
    await page.locator("#bc-to").fill(day(2));
    await page.locator("#bc-type").selectOption({ label: "Serwis" });
    await page.locator("#bc-internalNote").fill("NOTATKA-BLOKADY-SEKRET");
    await page.getByRole("dialog").getByRole("button", { name: "Dodaj blokadę" }).click();
    await expect(page.getByText("Blokada została dodana.")).toBeVisible();
    expect(await db.availabilityBlock.count({ where: { vehicleId: carA, organizationId: orgA } })).toBe(1);
    expect((await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "BLOCK_CREATED" } })).actorId).toBe(superId);
    await noOverflow("calendar");

    // Protected preview of a DRAFT after the service period ended; not indexable, not cacheable, no private data.
    const response = await page.goto(`${origin}/firmy/${orgA}/podglad/pojazdy/${carA}/`);
    expect(response?.headers()["x-robots-tag"]).toContain("noindex");
    expect(response?.headers()["cache-control"] ?? "").toMatch(/no-store|private|no-cache/);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await expect(page.getByText("Podgląd chroniony — to nie jest publiczny adres")).toBeVisible();
    await expect(page.getByText("Strona publiczna tej firmy jest teraz wyłączona")).toBeVisible();
    await expect(page.getByText("Szkic", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Auto Alfa po zmianie" })).toBeVisible();
    const html = await page.content();
    expect(html).not.toMatch(/NOTATKA-BLOKADY-SEKRET|MAINTENANCE/);
    await expect(page.locator("a[href^='http']")).toHaveCount(0);
    await noOverflow("vehicle preview");
    await page.goto(`${origin}/firmy/${orgA}/podglad/`);
    await expect(page.getByText("Podgląd chroniony — to nie jest publiczny adres")).toBeVisible();
    await noOverflow("home preview");
    await page.getByRole("link", { name: /^Wróć do karty firmy/ }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/${orgA}/?$`));

    // Dirty guard: leaving the form for the preview asks first and the entry stays.
    await page.goto(`${origin}/firmy/${orgA}/pojazdy/${carA}/`);
    await page.getByLabel("Nazwa pojazdu").fill("Niezapisana nazwa");
    await page.getByRole("link", { name: /Podgląd pojazdu/ }).click();
    await expect(page.getByRole("alertdialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await page.getByRole("button", { name: "Zostań" }).click();
    await expect(page.getByLabel("Nazwa pojazdu")).toHaveValue("Niezapisana nazwa");
    await page.getByLabel("Nazwa pojazdu").fill("Auto Alfa po zmianie");

    // Company B: its own fleet only, nothing of A (the vehicle id of A is not reachable under B).
    await page.goto(`${origin}/firmy/${orgB}/pojazdy/`);
    await expect(page.getByText("Auto Beta").first()).toBeVisible();
    await expect(page.getByText(/Auto Alfa/)).toHaveCount(0);
    await page.goto(`${origin}/firmy/${orgB}/pojazdy/${carA}/`);
    await expect(page.getByText("Pojazd nie istnieje w tej firmie.")).toBeVisible();
    await expect(page.getByLabel("Nazwa pojazdu")).toHaveCount(0);
    const foreignPreview = await page.goto(`${origin}/firmy/${orgB}/podglad/pojazdy/${carA}/`);
    expect(foreignPreview?.status()).toBe(404);
    expect(await page.content()).not.toContain("Auto Alfa");

    // Anonymous visitor: the same preview pages and the API give no company data.
    const anon = await anonymous.newPage();
    const denied = await anon.goto(`${origin}/firmy/${orgA}/podglad/pojazdy/${carA}/`);
    expect(await anon.content()).not.toMatch(/Auto Alfa|Firma Floty A/);
    expect(denied?.status() === 200 ? await anon.getByText("Podgląd chroniony").count() : 0).toBe(0);
    const apiStatus = await anon.evaluate(async (url) => (await fetch(url)).status, `/api/platform/companies/${orgA}/preview/vehicles/${carA}/`);
    expect([401, 403, 404]).toContain(apiStatus);

    // Archive (D-23): the superadmin still manages the fleet and sees the preview; the page says why.
    await db.organization.update({ where: { id: orgA }, data: { archivedAt: new Date() } });
    await page.goto(`${origin}/firmy/${orgA}/pojazdy/${carA}/`);
    await expect(page.getByText("Firma jest zarchiwizowana")).toBeVisible();
    await page.getByLabel("Nazwa pojazdu").fill("Auto Alfa w archiwum");
    await page.getByRole("button", { name: "Zapisz szkic" }).click();
    await expect(page.getByText("Zapisano zmiany.")).toBeVisible();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: carA } })).name).toBe("Auto Alfa w archiwum");
    await page.goto(`${origin}/firmy/${orgA}/podglad/pojazdy/${carA}/`);
    await expect(page.getByRole("heading", { name: "Auto Alfa w archiwum" })).toBeVisible();

    // Wide layout too: the budget of the shared superadmin was reset at the start of the spec.
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ["pojazdy/", `pojazdy/${carA}/`, `pojazdy/${carA}/kalendarz/`, "podglad/"]) {
        await page.goto(`${origin}/firmy/${orgA}/${path}`);
        await expect(page.locator("main")).toBeVisible();
        await noOverflow(`${path} at ${width}px`);
      }
    }
  } finally {
    await context.close();
    await anonymous.close();
    await session?.dispose();
    const uploads = await db.imageUpload.findMany({ where: { organizationId: { in: [orgA, orgB] } } });
    for (const record of uploads) for (const key of [record.stagingKey, record.rawKey, `${record.rawKey}/large.webp`, `${record.rawKey}/thumb.webp`]) await removeObject(storage, key).catch(() => {});
    storage.client.destroy();
    const orgs = { in: [orgA, orgB] };
    await db.job.deleteMany({ where: { organizationId: orgs } });
    await db.auditLog.deleteMany({ where: { organizationId: orgs } });
    await db.availabilityBlock.deleteMany({ where: { organizationId: orgs } });
    await db.vehicleImage.deleteMany({ where: { organizationId: orgs } });
    await db.imageUpload.deleteMany({ where: { organizationId: orgs } });
    await db.slugRedirect.deleteMany({ where: { organizationId: orgs } });
    await db.vehicle.deleteMany({ where: { organizationId: orgs } });
    await db.serviceAccess.deleteMany({ where: { organizationId: orgs } });
    if (ownedSuperadmin) await db.user.deleteMany({ where: { id: ownedSuperadmin } });
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    await db.organization.deleteMany({ where: { id: orgs } });
    await db.$disconnect();
  }
});
