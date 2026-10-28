import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

// #41: the public company site as a visitor sees it. The browser resolves *.example.test to the trusted ingress
// (the same host-registry path as production) and nothing in this file reads a session.
// PUB_SHOTS=<dir> saves full-page screenshots at 390 and 1440 px for the comparison with Penpot (not an assertion).
async function shoot(page: import("@playwright/test").Page, name: string) {
  const dir = process.env.PUB_SHOTS;
  if (!dir) return;
  for (const [label, width, height] of [["m", 390, 844], ["d", 1440, 1024]] as const) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: `${dir}/${name}-${label}.png`, fullPage: true });
  }
}

test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

function rawGet(port: number, host: string, path: string): Promise<{ status: number; body: string; csp: string | undefined }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, headers: { Host: host } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body, csp: response.headers["content-security-policy"] as string | undefined }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("public home and catalog: empty offer, results, filters in the URL, Back, no results, disabled site", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, other, car1, car2, car3, hidden, cat1, cat2] = Array.from({ length: 8 }, () => randomUUID());
  const host = `site-e2e-${org}.example.test`;
  const hostOther = `site-e2e-b-${other}.example.test`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const categories = [{ id: cat1, code: `e2e-a-${cat1.slice(0, 8)}`, name: "Miejski hatchback" }, { id: cat2, code: `e2e-b-${cat2.slice(0, 8)}`, name: "Kombi rodzinne" }];
  const errors: string[] = [];
  page.on("console", (message) => { if (/content security policy/i.test(message.text())) errors.push(message.text()); });
  try {
    for (const [id, name] of [[org, "Firma Strony E2E"], [other, "Firma Inna E2E"]]) {
      await db.organization.create({ data: { id, slug: `site-e2e-${id}`, name, firstAdminRegisteredAt: now } });
      await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
      await db.siteSettings.create({ data: { organizationId: id, publicName: name, phone: "+48 600 000 111", email: "e2e@example.test",
        heroText: "Podróż zaczyna się od dobrego auta.", shortDescription: "Opis firmy do testu.", featuredVehicleCount: 3, showPrices: id === org } });
    }
    await db.hostMapping.createMany({ data: [
      { hostname: host, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { hostname: hostOther, organizationId: other, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    ] });
    await db.vehicleCategory.createMany({ data: categories });
    const base = { organizationId: org, availableFrom: sqlDate(today), shortDescription: "Krótki opis" };
    const origin = `http://${host}:${port}`;

    // 1. Active company, nothing published: the "coming soon" state, in the home and the catalog; no invented cars.
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Nasza oferta pojawi się wkrótce" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Kontakt" }).first()).toBeVisible();
    await expect(page.getByText("0 zł")).toHaveCount(0);
    await page.goto(`${origin}/pojazdy/`);
    await expect(page.getByRole("heading", { name: "Nasza oferta pojawi się wkrótce" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Filtry pojazdów" })).toHaveCount(0);
    await shoot(page, "pub-01-02-empty");

    // 2. The first published vehicle (and a draft that must stay invisible) turns it into a catalog.
    await db.vehicle.createMany({ data: [
      { ...base, id: car1, slug: `hatch-${car1}`, name: "Alfa Horizon", status: "PUBLISHED", seats: 5, transmission: "Manualna", sortOrder: 1,
        categoryId: cat1, price: "149", priceUnit: "doba", featured: true },
      { ...base, id: car2, slug: `kombi-${car2}`, name: "Alfa Nomad", status: "PUBLISHED", seats: 7, transmission: "Automatyczna", sortOrder: 2,
        categoryId: cat2, price: "0", featured: true },
      { ...base, id: car3, slug: `suv-${car3}`, name: "Alfa Terra", status: "PUBLISHED", seats: 5, transmission: "Automatyczna", sortOrder: 3 },
      { ...base, id: hidden, slug: `draft-${hidden}`, name: "Szkic Ukryty", status: "DRAFT" },
    ] });
    await db.availabilityBlock.create({ data: { organizationId: org, vehicleId: car1, from: sqlDate(day(3)), to: sqlDate(day(4)),
      type: "MAINTENANCE", reference: "E2E-REF-SECRET", internalNote: "E2E-NOTE-SECRET" } });
    await page.goto(`${origin}/`);
    await expect(page.getByRole("heading", { level: 1, name: "Podróż zaczyna się od dobrego auta." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pojazdy gotowe na Twoją trasę" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alfa Horizon" })).toBeVisible();
    await expect(page.getByText("od 149 zł / doba")).toBeVisible();
    // A price of 0 is "no price", never "0 zł".
    await expect(page.getByText("Cena na zapytanie").first()).toBeVisible();
    await expect(page.getByText("0 zł")).toHaveCount(0);
    await shoot(page, "pub-01-home");
    const html = (await rawGet(port, host, "/")).body;
    for (const secret of ["E2E-REF-SECRET", "E2E-NOTE-SECRET", "MAINTENANCE", "Szkic Ukryty", "Firma Inna E2E"]) expect(html).not.toContain(secret);

    // 3. Catalog: filters live in the URL; the date checker of the home carries the range to the cards.
    await page.getByLabel("Od", { exact: true }).fill(day(3));
    await page.getByLabel("Do", { exact: true }).fill(day(4));
    await page.getByRole("button", { name: "Sprawdź" }).click();
    await expect(page).toHaveURL(new RegExp(`/pojazdy/\\?from=${day(3)}&to=${day(4)}$`));
    await expect(page.getByRole("heading", { name: "Znajdź pojazd na swoją trasę" })).toBeVisible();
    // The vehicle under maintenance in that range is not offered; the others are marked available with text.
    await expect(page.getByRole("heading", { name: "Alfa Horizon" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Alfa Nomad" })).toBeVisible();
    await expect(page.getByText("Dostępny", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Zobacz pojazd Alfa Nomad/ })).toHaveAttribute("href", `/pojazdy/kombi-${car2}/?from=${day(3)}&to=${day(4)}`);
    await expect(page.getByRole("link", { name: "Kontakt" }).first()).toHaveAttribute("href", `/kontakt/?from=${day(3)}&to=${day(4)}`);
    await shoot(page, "pub-02-list");

    // 4. Combine a filter and a sort: the empty form fields never reach the URL and Back replays each step.
    await page.getByLabel("Kategoria").selectOption({ label: "Kombi rodzinne" });
    await page.getByLabel("Sortowanie").selectOption("name");
    await page.getByRole("button", { name: "Zastosuj" }).click();
    await expect(page).toHaveURL(new RegExp(`/pojazdy/\\?category=${categories[1].code}&from=${day(3)}&to=${day(4)}&sort=name$`));
    await expect(page.getByRole("heading", { name: "Alfa Nomad" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alfa Terra" })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/pojazdy/\\?from=${day(3)}&to=${day(4)}$`));
    await expect(page.getByRole("heading", { name: "Alfa Terra" })).toBeVisible();
    await page.goForward();
    await expect(page.getByLabel("Kategoria")).toHaveValue(categories[1].code);

    // 5. No results offers the three ways out and keeps the dates.
    await page.goto(`${origin}/pojazdy/?seats=7&transmission=Manualna&from=${day(3)}&to=${day(4)}`);
    await expect(page.getByRole("heading", { name: "Brak pojazdów dla tych filtrów" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Zmień termin" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Skontaktuj się po alternatywę" })).toHaveAttribute("href", `/kontakt/?from=${day(3)}&to=${day(4)}`);
    await page.getByRole("link", { name: "Wyczyść filtry" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/pojazdy/\\?from=${day(3)}&to=${day(4)}$`));

    // 6. A bad query is explained and never shown as an empty result.
    await page.goto(`${origin}/pojazdy/?from=2020-01-01&to=2020-01-02`);
    await expect(page.getByText("Termin nie może zaczynać się w przeszłości")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alfa Horizon" })).toBeVisible();

    // 7. Prices follow the company switch: another company has none and cannot sort by price.
    await page.goto(`http://${hostOther}:${port}/pojazdy/?sort=price_asc`);
    await expect(page.getByText("Nie rozpoznaliśmy części filtrów")).toBeVisible();

    // 8. Nonce CSP: no violation on any page above; focus is visible on the first control.
    await page.goto(`${origin}/`);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Przejdź do treści" })).toBeFocused();
    expect(errors).toEqual([]);
    expect((await rawGet(port, host, "/")).csp).toMatch(/script-src 'self' 'nonce-/);

    // 9. Unknown path on an active company: PUB-07 with the company shell, status 404.
    const missing = await rawGet(port, host, "/regulamin/x/");
    expect(missing.status).toBe(404);
    await page.goto(`${origin}/pojazdy/nie-ma/`);
    await expect(page.getByRole("heading", { name: "Nie znaleziono tej strony" })).toBeVisible();
    await shoot(page, "pub-07-not-found");

    // 10. Disabling the period cuts the whole site cold, with one neutral page and no company data.
    await db.organization.update({ where: { id: org }, data: { publicRequiresPaid: true } });
    await db.serviceAccess.update({ where: { organizationId: org }, data: { paidThrough: sqlDate(day(-1)) } });
    for (const path of ["/", "/pojazdy/", `/pojazdy/hatch-${car1}/`]) {
      const closed = await rawGet(port, host, path);
      expect(closed.status).toBe(404);
      expect(closed.body).toContain("Ta strona jest obecnie niedostępna");
      for (const leak of ["Firma Strony E2E", "Alfa Horizon", "+48 600 000 111", "okres", "trial"]) expect(closed.body).not.toContain(leak);
    }
    // A second company is unaffected.
    expect((await rawGet(port, hostOther, "/")).status).toBe(200);
  } finally {
    await db.availabilityBlock.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.vehicleCategory.deleteMany({ where: { id: { in: [cat1, cat2] } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: [org, other] } } });
    await db.siteSettings.deleteMany({ where: { organizationId: { in: [org, other] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [org, other] } } });
    await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
    await db.$disconnect();
  }
});

test("an address that leads to no company site is a bare 404", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const unknown = await rawGet(port, `unknown-${randomUUID()}.example.test`, "/");
  expect(unknown.status).toBe(404);
});
