import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { createMediaStorage, removeObject } from "../../src/modules/media/storage";
import { processMediaClaim } from "../../src/modules/media/worker";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #36: photo management of the vehicle form against the real API, private storage and media worker of the built ingress.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

const secrets = Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));

test("vehicle photos: mixed upload with a cut connection, cover, keyboard order, alt, protected delete, layout", async ({ baseURL, browser }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const storage = createMediaStorage({ ...process.env, ...secrets });
  const [org, user, vehicleId, otherVehicle] = Array.from({ length: 4 }, () => randomUUID());
  const host = `photos-e2e-${org}.example.test`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const worker = new AbortController();
  // The media worker of the test: claims MEDIA_PROCESS jobs of this company while the UI waits for processing.
  const loop = (async () => {
    while (!worker.signal.aborted) {
      const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS").catch(() => null);
      if (claim) await processMediaClaim(db, storage, claim).catch(() => undefined);
      else await new Promise((resolve) => setTimeout(resolve, 300));
    }
  })();
  try {
    await db.organization.create({ data: { id: org, slug: `photos-e2e-${org}`, name: "Firma Zdjęć E2E", firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: user, name: "Photos admin", role: "ADMIN_FIRMY", organizationId: org,
      email: `photos-e2e-${user}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: new Date(Date.now() + 30 * 86_400_000) } });
    await db.vehicle.create({ data: { id: vehicleId, organizationId: org, name: "Auto zdjęć", slug: "auto-zdjec", status: "DRAFT" } });
    await db.vehicle.create({ data: { id: otherVehicle, organizationId: org, name: "Drugie auto", slug: "drugie-auto", status: "DRAFT" } });
    session = await verifiedFixtureSession(db, user);
    const [name, value] = session.cookie.split(/=(.*)/s);
    await context.addCookies([{ name, value, domain: host, path: "/" }]);
    const page = await context.newPage();
    const base = `http://${host}:${port}`;
    const edit = `${base}/admin/pojazdy/${vehicleId}/`;
    const openPhotos = async (p: Page) => {
      const toggle = p.locator("h3 button[aria-expanded]").filter({ hasText: "Zdjęcia" });
      if ((await toggle.getAttribute("aria-expanded")) === "false") await toggle.click();
    };
    const png = (color: string, width: number) => sharp({ create: { width, height: 200, channels: 3, background: color } }).png().toBuffer();
    const files = {
      a: { name: "a.png", mimeType: "image/png", buffer: await png("#336699", 300) },
      b: { name: "b.png", mimeType: "image/png", buffer: await png("#993366", 340) },
      c: { name: "c.png", mimeType: "image/png", buffer: await png("#669933", 380) },
      broken: { name: "uszkodzone.png", mimeType: "image/png", buffer: Buffer.from("to nie jest obraz".repeat(20)) },
      pdf: { name: "dokument.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4") },
    };

    await page.goto(edit);
    await openPhotos(page);
    await expect(page.getByText(/JPEG, PNG lub WebP, do 10 MB każdy, najwyżej 30 zdjęć/)).toBeVisible();

    // Cut the connection once for c.png (by the size of its body): the outcome is unknown, the retry reuses the key.
    const seenKeys: string[] = [];
    let cut = false;
    await page.route("**/images/", async (route) => {
      const request = route.request();
      if (request.method() !== "POST") return route.continue();
      const length = request.postDataBuffer()?.length ?? 0;
      if (length === files.c.buffer.length) {
        seenKeys.push(request.headers()["idempotency-key"] ?? "");
        if (!cut) { cut = true; return route.abort("connectionreset"); }
      }
      return route.continue();
    });
    await page.getByTestId("vehicle-photo-input").setInputFiles([files.a, files.pdf, files.broken, files.b, files.c]);
    await expect(page.getByText("Nieobsługiwany format. Wybierz plik JPEG, PNG lub WebP.")).toBeVisible();
    await expect(page.getByText("To nie jest poprawne zdjęcie JPEG, PNG lub WebP.")).toBeVisible();
    await expect(page.getByText(/Wynik wysyłania jest nieznany/)).toBeVisible();
    // The successful files are stored in spite of the failures, the form stays usable.
    await expect(page.getByRole("heading", { name: "Zdjęcia pojazdu (2 z 30)" })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: /Spróbuj ponownie: c\.png/ }).click();
    await expect(page.getByRole("heading", { name: "Zdjęcia pojazdu (3 z 30)" })).toBeVisible({ timeout: 60_000 });
    expect(seenKeys).toHaveLength(2);
    expect(seenKeys[1]).toBe(seenKeys[0]);
    // The retry created no duplicate; the other files' rows stay until dismissed.
    expect(await db.vehicleImage.count({ where: { vehicleId, status: "READY" } })).toBe(3);
    expect(await page.getByRole("button", { name: /Spróbuj ponownie/ }).count()).toBe(0);
    await page.getByRole("button", { name: /Usuń z kolejki: uszkodzone\.png/ }).click();
    await page.getByRole("button", { name: /Usuń z kolejki: dokument\.pdf/ }).click();
    await expect(page.getByRole("list", { name: "Kolejka wysyłania zdjęć" })).toHaveCount(0);

    // Exactly one cover, assigned by the server to the first processed photo.
    const stored = await db.vehicleImage.findMany({ where: { vehicleId, status: "READY" }, orderBy: { position: "asc" } });
    expect(stored.filter((image) => image.isCover)).toHaveLength(1);
    const titles = page.getByRole("list", { name: "Gotowe zdjęcia pojazdu" }).getByRole("listitem");
    await expect(titles).toHaveCount(3);

    // Order by keyboard only: focus the button, press Enter; the server order survives a reload.
    const first = stored[0]!; const last = stored[2]!;
    const down = page.locator(`#vp-down-${first.id}`);
    await down.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Zdjęcie przesunięto na pozycję 2 z 3.")).toBeVisible();
    await expect(page.locator(`#vp-down-${first.id}`)).toBeFocused();
    expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: first.id } })).position).toBe(1);

    // Cover and alt, both kept after a reload.
    await page.locator(`#vp-cover-${last.id}`).click();
    await expect(page.getByText("Zmieniono zdjęcie główne.")).toBeVisible();
    const alt = page.locator(`#vp-alt-${last.id}`);
    await alt.fill("Czerwony bus z przodu");
    await page.getByRole("button", { name: /Zapisz opis/ }).click();
    await expect(page.getByText("Zapisano opis zdjęcia.")).toBeVisible();
    await page.reload();
    await openPhotos(page);
    await expect(page.locator(`#vp-alt-${last.id}`)).toHaveValue("Czerwony bus z przodu");
    const afterReload = await db.vehicleImage.findMany({ where: { vehicleId }, orderBy: { position: "asc" } });
    expect(afterReload.find((image) => image.isCover)?.id).toBe(last.id);
    await expect(page.getByRole("list", { name: "Gotowe zdjęcia pojazdu" }).getByRole("listitem").nth(0)).toContainText("Zdjęcie 1 z 3");
    const coverItem = page.getByRole("listitem").filter({ has: page.locator(`#vp-alt-${last.id}`) });
    await expect(coverItem.getByText("Główne")).toBeVisible();

    // The unsaved alt is guarded by the shell.
    await page.locator(`#vp-alt-${first.id}`).fill("Niezapisany");
    await page.getByRole("link", { name: "Wróć do listy pojazdów" }).click();
    await expect(page.getByRole("alertdialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(`#vp-alt-${first.id}`)).toHaveValue("Niezapisany");
    await page.locator(`#vp-alt-${first.id}`).fill(await page.locator(`#vp-alt-${first.id}`).inputValue());
    await page.reload();
    await openPhotos(page);

    // Parallel change: another editor bumps the version of a photo, the delete reports a conflict and removes nothing.
    const victim = afterReload.find((image) => !image.isCover)!;
    await db.vehicleImage.update({ where: { id: victim.id }, data: { version: { increment: 1 } } });
    await page.getByRole("button", { name: new RegExp(`^Usuń, zdjęcie ${afterReload.findIndex((image) => image.id === victim.id) + 1}$`) }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Usuń zdjęcie" }).click();
    await expect(page.getByText(/Zdjęcia zostały zmienione w międzyczasie/)).toBeVisible();
    expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: victim.id } })).status).toBe("READY");

    // Published vehicle: its cover cannot be dropped without a replacement; the only photo cannot be deleted at all.
    await db.vehicle.update({ where: { id: vehicleId }, data: { status: "PUBLISHED" } });
    await page.reload();
    await openPhotos(page);
    const coverIndex = (await db.vehicleImage.findMany({ where: { vehicleId, status: "READY" }, orderBy: { position: "asc" } })).findIndex((image) => image.isCover);
    await page.getByRole("button", { name: new RegExp(`^Usuń, zdjęcie ${coverIndex + 1}$`) }).click();
    await expect(page.getByLabel("Nowe zdjęcie główne")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Anuluj" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await db.vehicleImage.count({ where: { vehicleId, status: "READY" } })).toBe(3);

    // Delete the cover with a chosen replacement; the cover comes from the server answer.
    await page.getByRole("button", { name: new RegExp(`^Usuń, zdjęcie ${coverIndex + 1}$`) }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Usuń zdjęcie" }).click();
    await expect(page.getByText("Usunięto zdjęcie.")).toBeVisible();
    const left = await db.vehicleImage.findMany({ where: { vehicleId, status: "READY" } });
    expect(left).toHaveLength(2);
    expect(left.filter((image) => image.isCover)).toHaveLength(1);
    await expect(page.getByRole("heading", { name: "Zdjęcia pojazdu (2 z 30)" })).toBeVisible();

    // Draft with one photo; a parallel publication makes it the only cover of a published vehicle: the server refuses.
    await db.vehicle.update({ where: { id: vehicleId }, data: { status: "DRAFT" } });
    for (const image of left.filter((entry) => !entry.isCover)) await db.vehicleImage.update({ where: { id: image.id }, data: { status: "DELETED" } });
    await page.reload();
    await openPhotos(page);
    await page.getByRole("button", { name: /^Usuń, zdjęcie 1$/ }).click();
    await db.vehicle.update({ where: { id: vehicleId }, data: { status: "PUBLISHED" } });
    await page.getByRole("dialog").getByRole("button", { name: "Usuń zdjęcie" }).click();
    await expect(page.getByRole("dialog").getByText(/Najpierw cofnij publikację/)).toBeVisible();
    expect(await db.vehicleImage.count({ where: { vehicleId, status: "READY", isCover: true } })).toBe(1);
    await page.getByRole("dialog").getByRole("button", { name: "Anuluj" }).click();

    // Company isolation: photos of another vehicle are not reachable through this vehicle's URLs.
    const foreign = await db.vehicleImage.findFirst({ where: { vehicleId } });
    const crossStatus = await page.evaluate(async ({ url, body }) => (await fetch(url, { method: "PUT", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).status,
    { url: `/api/admin/vehicles/${otherVehicle}/images/order/`, body: { items: [{ id: foreign!.id, expectedVersion: foreign!.version }] } });
    expect([404, 409]).toContain(crossStatus);

    // Layout at the required widths: no horizontal overflow with the photo section open.
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await openPhotos(page);
      await expect(page.getByRole("heading", { name: /^Zdjęcia pojazdu \(/ })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(0);
    }
  } finally {
    worker.abort();
    await loop;
    await context.close();
    await session?.dispose();
    const uploads = await db.imageUpload.findMany({ where: { organizationId: org } });
    for (const record of uploads) for (const key of [record.stagingKey, record.rawKey, `${record.rawKey}/large.webp`, `${record.rawKey}/thumb.webp`]) await removeObject(storage, key).catch(() => {});
    await db.job.deleteMany({ where: { organizationId: org } });
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.vehicleImage.deleteMany({ where: { organizationId: org } });
    await db.imageUpload.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: user } });
    await db.organization.deleteMany({ where: { id: org } });
    storage.client.destroy();
    await db.$disconnect();
  }
});
