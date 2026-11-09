import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { createMediaStorage } from "../../src/modules/media/storage";
import { processMediaClaim } from "../../src/modules/media/worker";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// #31: superadmin edits company settings per section (ADM-11..14), company admin only reads them (D-01).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("settings UI: superadmin saves a section, keeps data on conflict and validation errors; admin gets a read-only view", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const tag = randomUUID().slice(0, 8);
  const org = randomUUID();
  const adminId = randomUUID();
  const adminHost = `settings-ui-admin-${tag}.example.test`;
  const platformHost = `settings-ui-platform-${tag}.example.test`;
  const origin = (name: string) => `http://${name}:${port}`;
  const secrets = Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
    .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  const storage = createMediaStorage({ ...process.env, ...secrets });
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  let ownedSuperadmin: string | null = null;
  const asCookie = (value: string, host: string) => { const [name, ...rest] = value.split("="); return { name, value: rest.join("="), url: origin(host) }; };
  try {
    await db.organization.create({ data: { id: org, slug: `settings-ui-${tag}`, name: `Firma UI ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" }] });
    await db.user.create({ data: { id: adminId, name: "Admin UI", email: `settings-ui-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: org, emailVerified: true, twoFactorEnabled: true } });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Settings UI operator", role: "SUPERADMIN_AUTERVA",
        email: `settings-ui-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    sessions.push(await verifiedFixtureSession(db, superId), await verifiedFixtureSession(db, adminId));

    // Superadmin: contact section, invalid input keeps the form, valid input saves.
    await context.addCookies([asCookie(sessions[0].cookie, platformHost)]);
    await page.goto(`${origin(platformHost)}/firmy/${org}/ustawienia/?sekcja=kontakt`);
    await expect(page.getByText("Brak kanału kontaktowego")).toBeVisible();
    await page.getByLabel("E-mail kontaktowy").fill("nie-email");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByRole("heading", { name: "Popraw zaznaczone pola" })).toBeVisible();
    await expect(page.getByLabel("E-mail kontaktowy")).toHaveValue("nie-email");
    await page.getByLabel("E-mail kontaktowy").fill("biuro@example.test");
    await page.getByLabel("Telefon").fill("+48 600 700 800");
    await page.getByLabel("Kanał domyślny").selectOption("PHONE");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Zapisano zmiany")).toBeVisible();
    const saved = await db.siteSettings.findUniqueOrThrow({ where: { organizationId: org } });
    expect([saved.phone, saved.email, saved.contactChannel, saved.version]).toEqual(["+48 600 700 800", "biuro@example.test", "PHONE", 1]);

    // A concurrent change (other tab or superadmin): conflict, nothing overwritten, values stay in the form.
    await page.getByLabel("Telefon").fill("+48 111 222 333");
    await db.siteSettings.update({ where: { organizationId: org }, data: { seoTitle: "Zmiana obca", version: { increment: 1 } } });
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByRole("heading", { name: "Dane zmienił ktoś inny" })).toBeVisible();
    await expect(page.getByLabel("Telefon")).toHaveValue("+48 111 222 333");
    expect((await db.siteSettings.findUniqueOrThrow({ where: { organizationId: org } })).phone).toBe("+48 600 700 800");
    await page.getByRole("button", { name: "Zachowaj moje wartości" }).click();
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Zapisano zmiany")).toBeVisible();
    const merged = await db.siteSettings.findUniqueOrThrow({ where: { organizationId: org } });
    expect([merged.phone, merged.seoTitle]).toEqual(["+48 111 222 333", "Zmiana obca"]);

    // Unsaved changes are guarded when leaving through the shell navigation.
    await page.getByLabel("Telefon").fill("+48 999 000 111");
    await page.getByRole("link", { name: "Prezentacja i SEO" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Zostań" }).click();
    await expect(page.getByLabel("Telefon")).toHaveValue("+48 999 000 111");

    // Public appearance: hero text saves, a logo upload is processed by the media worker and listed.
    await page.getByLabel("Telefon").fill("+48 111 222 333");
    await page.goto(`${origin(platformHost)}/firmy/${org}/ustawienia/?sekcja=wyglad`);
    await page.getByLabel(/Tekst hero/).fill("Wynajem busów");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Zapisano zmiany")).toBeVisible();
    await expect(page.getByLabel(/kolor|font|motyw/i)).toHaveCount(0);
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#224466" } }).png().toBuffer();
    await page.getByLabel("Wybierz plik: Logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Zdjęcie jest przetwarzane")).toBeVisible();
    const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
    expect(claim).not.toBeNull();
    expect(await processMediaClaim(db, storage, claim!)).toBe(true);
    await page.getByRole("button", { name: "Odśwież listę" }).click();
    await expect(page.getByRole("heading", { name: "Logo (1 z 1)" })).toBeVisible();

    // Uncertain upload: the server takes the file but the answer is lost; retrying the same file never duplicates it.
    const heroPath = test.info().outputPath("hero.png");
    writeFileSync(heroPath, await sharp({ create: { width: 640, height: 400, channels: 3, background: "#446622" } }).png().toBuffer());
    let dropped = false;
    await page.route("**/public-media/hero/", async (route) => {
      if (dropped) return route.continue();
      dropped = true;
      // Node does not know the fixture host mapping of the browser, so the real request goes to loopback with the original Host.
      const request = route.request();
      await route.fetch({ url: `http://127.0.0.1:${port}${new URL(request.url()).pathname}`, headers: { ...request.headers(), host: `${platformHost}:${port}` } });
      await route.abort("failed");
    });
    await page.getByLabel("Wybierz plik: Zdjęcia hero").setInputFiles(heroPath);
    await expect(page.getByText("Wynik wysyłania jest nieznany")).toBeVisible();
    await page.getByLabel("Wybierz plik: Zdjęcia hero").setInputFiles(heroPath);
    await expect.poll(() => db.imageUpload.count({ where: { organizationId: org } })).toBe(2);
    for (let claimed = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS"); claimed;
      claimed = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS")) await processMediaClaim(db, storage, claimed);
    await page.getByRole("button", { name: "Odśwież listę" }).click();
    await expect(page.getByRole("heading", { name: "Zdjęcia hero (1 z 5)" })).toBeVisible();
    expect(await db.publicMedia.count({ where: { organizationId: org, kind: "HERO" } })).toBe(1);

    // Saving one photo keeps the other photo's draft; "Zapisz i wyjdź" saves every edited photo before leaving.
    await page.getByLabel("Opis alternatywny (Logo 0)").fill("Logo robocze");
    await page.getByLabel("Opis alternatywny (Zdjęcia hero 0)").fill("Hero robocze");
    await page.getByRole("button", { name: "Zapisz opis i kolejność" }).nth(1).click();
    await expect(page.getByText("Zapisano zdjęcie")).toBeVisible();
    await expect(page.getByLabel("Opis alternatywny (Logo 0)")).toHaveValue("Logo robocze");
    expect(await db.publicMedia.findFirstOrThrow({ where: { organizationId: org, kind: "HERO" } }).then((row) => row.alt)).toBe("Hero robocze");
    await page.getByRole("link", { name: "Prezentacja i SEO" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await page.getByRole("button", { name: "Zapisz i wyjdź" }).click();
    await expect(page).toHaveURL(/sekcja=prezentacja/);
    expect(await db.publicMedia.findFirstOrThrow({ where: { organizationId: org, kind: "LOGO" } }).then((row) => row.alt)).toBe("Logo robocze");

    // Company admin: read-only values, no save control, logo change goes through chat.
    await context.clearCookies();
    await context.addCookies([asCookie(sessions[1].cookie, adminHost)]);
    await page.goto(`${origin(adminHost)}/admin/ustawienia/?sekcja=kontakt`);
    await expect(page.getByText("+48 111 222 333")).toBeVisible();
    await expect(page.getByRole("button", { name: "Zapisz zmiany" })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await page.goto(`${origin(adminHost)}/admin/ustawienia/`);
    await expect(page.getByRole("link", { name: "Poproś o zmianę logo na czacie" })).toHaveAttribute("href", "/admin/czat");
    await page.goto(`${origin(adminHost)}/admin/ustawienia/?sekcja=wyglad`);
    await expect(page.getByText("Wynajem busów").first()).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
  } finally {
    for (const session of sessions) await session.dispose();
    storage.client.destroy();
    await db.publicMedia.deleteMany({ where: { organizationId: org } });
    await db.imageUpload.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.job.deleteMany({ where: { organizationId: org } });
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: { in: [adminId, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [adminHost, platformHost] } } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
