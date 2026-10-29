import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

// #42: public vehicle detail as a visitor sees it (gallery, availability check, calendar, optional data).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

function rawGet(port: number, host: string, path: string): Promise<{ status: number; body: string; location: string | undefined }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, headers: { Host: host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body, location: response.headers.location }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("vehicle detail: gallery by mouse and keyboard, availability result, calendar, optional data, old slug, hidden vehicle", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, car, bare, cat, img1, img2, img3] = Array.from({ length: 7 }, () => randomUUID());
  const host = `detail-e2e-${org}.example.test`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const slug = `atlas-${car}`;
  const bareSlug = `prosty-${bare}`;
  const csp: string[] = [];
  page.on("console", (message) => { if (/content security policy/i.test(message.text())) csp.push(message.text()); });
  const largeRequests: string[] = [];
  page.on("request", (request) => { if (/\/large\//.test(request.url())) largeRequests.push(request.url()); });
  try {
    await db.organization.create({ data: { id: org, slug: `detail-e2e-${org}`, name: "Firma Detalu E2E", firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: "Firma Detalu E2E", phone: "+48 600 000 222", showPrices: true } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.vehicleCategory.create({ data: { id: cat, code: `det-${cat.slice(0, 8)}`, name: "Sedan" } });
    const base = { organizationId: org, status: "PUBLISHED", availableFrom: sqlDate(today) };
    await db.vehicle.createMany({ data: [
      { ...base, id: car, slug, name: "Alfa Atlas", categoryId: cat, seats: 5, transmission: "Automatyczna", price: "229", priceUnit: "doba",
        description: "Pierwsza linia\n<script>window.__xss = 1</script><b>pogrubienie</b>", shortDescription: "Krótki" },
      { ...base, id: bare, slug: bareSlug, name: "Alfa Prosty", price: "0" },
    ] });
    await db.vehicleFeature.createMany({ data: [
      { organizationId: org, vehicleId: car, code: "Klimatyzacja", value: "" }, { organizationId: org, vehicleId: car, code: "Kuchnia", value: "2 palniki" } ] });
    await db.vehicleImage.createMany({ data: [img1, img2, img3].map((id, index) => ({ id, organizationId: org, vehicleId: car, storageKey: `e2e/${id}`,
      mime: "image/avif", width: 1200, height: 800, bytes: 10, status: "READY", position: index, isCover: index === 0, alt: index === 1 ? "Wnętrze z kuchnią" : null,
      variants: { large: `e2e/${id}-l`, thumb: `e2e/${id}-t` } })) });
    await db.availabilityBlock.create({ data: { organizationId: org, vehicleId: car, from: sqlDate(day(5)), to: sqlDate(day(6)), type: "MAINTENANCE",
      reference: "DET-REF-SECRET", internalNote: "DET-NOTE-SECRET" } });
    const origin = `http://${host}:${port}`;

    // Gallery: first image only at full size, thumbnails lazy, keyboard and buttons change the image.
    await page.goto(`${origin}/pojazdy/${slug}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Alfa Atlas" })).toBeVisible();
    await expect(page.getByText("od 229 zł / doba")).toBeVisible();
    await expect(page.getByText("Zdjęcie 1 z 3", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Pokaż zdjęcie/ })).toHaveCount(3);
    expect(new Set(largeRequests).size).toBeLessThanOrEqual(1);
    await page.getByRole("button", { name: "Następne zdjęcie" }).click();
    await expect(page.getByRole("img", { name: "Wnętrze z kuchnią" })).toBeVisible();
    await page.getByLabel(/Strzałki w lewo i w prawo/).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("img", { name: "Alfa Atlas, zdjęcie 3" })).toBeVisible();
    await page.getByRole("button", { name: "Pokaż zdjęcie 1 z 3" }).click();
    await expect(page.getByRole("button", { name: "Pokaż zdjęcie 1 z 3" })).toHaveAttribute("aria-current", "true");
    const opener = page.getByRole("button", { name: "Otwórz galerię pełnoekranową" });
    await opener.click();
    const lightbox = page.getByRole("dialog", { name: /Galeria: Alfa Atlas/ });
    await expect(lightbox).toBeVisible();
    await lightbox.getByRole("button", { name: "Następne zdjęcie" }).click();
    await expect(lightbox.getByRole("img", { name: "Wnętrze z kuchnią" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(opener).toBeFocused();

    // Untrusted description is text, never markup; optional sections that have data are shown.
    await expect(page.getByText("<b>pogrubienie</b>", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(page.getByRole("heading", { name: "Wyposażenie" })).toBeVisible();
    await expect(page.getByText("Kuchnia: 2 palniki")).toBeVisible();

    // Availability: a free range, then a blocked one; the reason of the block never appears.
    await page.getByLabel("Od", { exact: true }).fill(day(1));
    await page.getByLabel("Do", { exact: true }).fill(day(2));
    await page.getByRole("button", { name: "Sprawdź" }).click();
    await expect(page.getByText("Pojazd jest dostępny")).toBeVisible();
    await expect(page.getByRole("status").getByRole("link", { name: "Skontaktuj się", exact: true }))
      .toHaveAttribute("href", `/kontakt/?vehicle=${slug}&from=${day(1)}&to=${day(2)}`);
    await page.getByLabel("Od", { exact: true }).fill(day(4));
    await page.getByLabel("Do", { exact: true }).fill(day(6));
    await page.getByRole("button", { name: "Sprawdź" }).click();
    await expect(page.getByText("Pojazd jest niedostępny w tym terminie")).toBeVisible();
    await expect(page.getByRole("link", { name: "Skontaktuj się po alternatywę" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zmień termin" })).toBeVisible();
    if (process.env.PUB_SHOTS) {
      for (const [label, width, height] of [["m", 390, 844], ["d", 1440, 1024]] as const) {
        await page.setViewportSize({ width, height });
        await page.screenshot({ path: `${process.env.PUB_SHOTS}/pub-03-detail-${label}.png`, fullPage: true });
      }
    }
    // The blocked days are named as unavailable in text (not only by shape).
    await expect(page.locator("td", { hasText: "niedostępny" }).first()).toBeVisible();
    const html = (await rawGet(port, host, `/pojazdy/${slug}/?from=${day(4)}&to=${day(6)}`)).body;
    for (const secret of ["DET-REF-SECRET", "DET-NOTE-SECRET", "MAINTENANCE"]) expect(html).not.toContain(secret);
    // A past start is explained, not silently accepted.
    await page.goto(`${origin}/pojazdy/${slug}/?from=2020-01-01&to=2020-01-02`);
    await expect(page.getByRole("alert").filter({ hasText: "przeszłości" })).toBeVisible();

    // Optional data missing: no empty section, no price placeholder.
    await page.goto(`${origin}/pojazdy/${bareSlug}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Alfa Prosty" })).toBeVisible();
    await expect(page.getByText("Cena na zapytanie")).toBeVisible();
    await expect(page.getByText("0 zł")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Opis pojazdu" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Wyposażenie" })).toHaveCount(0);
    await expect(page.getByRole("region", { name: /Zdjęcia/ })).toHaveCount(0);
    expect(csp).toEqual([]);

    // Old slug: 308 to the new page with the query kept.
    await db.slugRedirect.create({ data: { organizationId: org, vehicleId: car, oldSlug: "stary-atlas" } });
    const moved = await rawGet(port, host, `/pojazdy/stary-atlas/?from=${day(1)}&to=${day(2)}`);
    expect(moved.status).toBe(308);
    expect(moved.location).toBe(`/pojazdy/${slug}/?from=${day(1)}&to=${day(2)}`);

    // Unpublished: the very next request is the neutral 404; so is an unknown slug.
    await db.vehicle.update({ where: { id: car }, data: { status: "UNPUBLISHED" } });
    for (const path of [`/pojazdy/${slug}/`, "/pojazdy/nie-ma/", "/pojazdy/stary-atlas/"]) {
      const gone = await rawGet(port, host, path);
      expect(gone.status, path).toBe(404);
      expect(gone.body, path).not.toContain("Alfa Atlas");
    }

    // Disabled company: the whole site, vehicle page included, is one neutral page.
    await db.organization.update({ where: { id: org }, data: { publicRequiresPaid: true } });
    await db.serviceAccess.update({ where: { organizationId: org }, data: { paidThrough: sqlDate(day(-1)) } });
    const closed = await rawGet(port, host, `/pojazdy/${bareSlug}/`);
    expect(closed.status).toBe(404);
    expect(closed.body).toContain("Ta strona jest obecnie niedostępna");
    expect(closed.body).not.toContain("Alfa Prosty");
  } finally {
    await db.slugRedirect.deleteMany({ where: { organizationId: org } });
    await db.availabilityBlock.deleteMany({ where: { organizationId: org } });
    await db.vehicleImage.deleteMany({ where: { organizationId: org } });
    await db.vehicleFeature.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.vehicleCategory.deleteMany({ where: { id: cat } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
