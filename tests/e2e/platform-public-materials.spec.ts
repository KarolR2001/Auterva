import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect as baseExpect, test } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { createMediaStorage } from "../../src/modules/media/storage";
import { processMediaClaim } from "../../src/modules/media/worker";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #37: the superadmin reaches the public materials of one company from its card, sees the stored state (not the chosen file),
// keeps entries on a file error or a version conflict and is guarded when leaving; another company stays untouched.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
const expect = baseExpect.configure({ timeout: 15_000 });

test("public materials: card entry, file error keeps data, preview follows the stored logo, conflict, guard, company isolation", async ({ page, context, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const tag = randomUUID().slice(0, 8);
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const platformHost = `materials-platform-${tag}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const secrets = Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
    .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
  const storage = createMediaStorage({ ...process.env, ...secrets });
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  let ownedSuperadmin: string | null = null;
  try {
    await db.organization.create({ data: { id: orgA, slug: `materials-a-${tag}`, name: `Firma A ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.organization.create({ data: { id: orgB, slug: `materials-b-${tag}`, name: `Firma B ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Materials operator", role: "SUPERADMIN_AUTERVA",
        email: `materials-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    await resetPlatformApiBudget(db, superId);
    session = await verifiedFixtureSession(db, superId);
    const [name, ...rest] = session.cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: origin }]);
    const bBefore = await db.publicMedia.count({ where: { organizationId: orgB } });

    // Entry from the company card and the way back.
    await page.goto(`${origin}/firmy/${orgA}/`);
    await page.getByRole("link", { name: "Edytuj logo i materiały publiczne" }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/${orgA}/ustawienia/\\?sekcja=wyglad`));
    await expect(page.getByRole("heading", { name: "Logo (0 z 1)" })).toBeVisible();
    await expect(page.getByLabel("Podgląd wyglądu publicznego")).toContainText("Brak logo");

    // A wrong file type is refused with the file name; typed hero text stays.
    await page.getByLabel(/Tekst hero/).fill("Wynajem busów dla firm");
    await page.getByLabel("Wybierz plik: Logo").setInputFiles({ name: "logo.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") });
    await expect(page.getByText(/logo\.pdf: wybierz plik JPEG, PNG lub WebP\./)).toBeVisible();
    await expect(page.getByLabel(/Tekst hero/)).toHaveValue("Wynajem busów dla firm");
    await expect(page.getByText("Są niezapisane zmiany.")).toBeVisible();

    // A broken PNG is refused by the server with the file name; the form and the list are intact.
    await page.getByLabel("Wybierz plik: Logo").setInputFiles({ name: "uszkodzone.png", mimeType: "image/png", buffer: Buffer.from("to nie jest obraz".repeat(20)) });
    await expect(page.getByText(/uszkodzone\.png: To nie jest poprawne zdjęcie/)).toBeVisible();
    await expect(page.getByLabel(/Tekst hero/)).toHaveValue("Wynajem busów dla firm");

    // The preview shows the stored logo only after the server stored it, not after choosing the file.
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#224466" } }).png().toBuffer();
    await page.getByLabel("Wybierz plik: Logo").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
    await expect(page.getByText("Zdjęcie jest przetwarzane")).toBeVisible();
    await expect(page.getByLabel("Podgląd wyglądu publicznego")).toContainText("Brak logo");
    const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
    expect(claim).not.toBeNull();
    expect(await processMediaClaim(db, storage, claim!)).toBe(true);
    await page.getByRole("button", { name: "Odśwież listę" }).click();
    const logo = await db.publicMedia.findFirstOrThrow({ where: { organizationId: orgA, kind: "LOGO" } });
    await expect(page.getByLabel("Podgląd wyglądu publicznego").locator("img").first()).toHaveAttribute("src", new RegExp(logo.id));
    await expect(page.getByTestId(`media-state-${logo.id}`)).toContainText("Zapisane");

    // A version conflict (another editor) is explicit; the typed description stays and is marked unsaved.
    await db.publicMedia.update({ where: { id: logo.id }, data: { version: { increment: 1 } } });
    await page.getByLabel("Opis alternatywny (Logo 0)").fill("Logo firmy A");
    await expect(page.getByTestId(`media-state-${logo.id}`)).toContainText("Niezapisane zmiany");
    await page.getByRole("button", { name: "Zapisz opis i kolejność" }).click();
    await expect(page.getByText("Zdjęcie zostało zmienione w międzyczasie")).toBeVisible();
    await expect(page.getByLabel("Opis alternatywny (Logo 0)")).toHaveValue("Logo firmy A");
    await page.getByRole("button", { name: "Odśwież listę" }).click();
    await page.getByRole("button", { name: "Zapisz opis i kolejność" }).click();
    await expect(page.getByText("Zapisano zdjęcie")).toBeVisible();
    expect((await db.publicMedia.findUniqueOrThrow({ where: { id: logo.id } })).alt).toBe("Logo firmy A");

    // Leaving with unsaved hero text asks first; staying keeps the entry; saving keeps it stored.
    await page.getByRole("link", { name: "Wróć do karty firmy" }).click();
    await expect(page.getByRole("alertdialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await page.getByRole("button", { name: "Zostań" }).click();
    await expect(page.getByLabel(/Tekst hero/)).toHaveValue("Wynajem busów dla firm");
    await page.getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Zapisano zmiany")).toBeVisible();
    await page.getByRole("link", { name: "Wróć do karty firmy" }).click();
    await expect(page).toHaveURL(new RegExp(`/firmy/${orgA}/$`));
    expect(await db.siteSettings.findUniqueOrThrow({ where: { organizationId: orgA } }).then((row) => row.heroText)).toBe("Wynajem busów dla firm");

    // Isolation: company B has no new material and no settings changes.
    expect(await db.publicMedia.count({ where: { organizationId: orgB } })).toBe(bBefore);
    expect(await db.siteSettings.findUnique({ where: { organizationId: orgB } })).toBeNull();

    // Layout without horizontal overflow.
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/firmy/${orgA}/ustawienia/?sekcja=wyglad`);
      await expect(page.getByRole("heading", { name: "Logo (1 z 1)" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBeLessThanOrEqual(0);
    }
  } finally {
    await session?.dispose();
    storage.client.destroy();
    await db.publicMedia.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.imageUpload.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.siteSettings.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.job.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    if (ownedSuperadmin) await db.user.deleteMany({ where: { id: ownedSuperadmin } });
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  }
});
