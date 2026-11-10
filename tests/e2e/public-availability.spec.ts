import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { formatRangeShort } from "../../src/modules/public-offer/presentation";
import { pickDay, pickRange } from "./public-calendar-helpers";

// #43: interactive availability on the public vehicle page (calendar picking, stale answers, errors, alternatives).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("availability panel: calendar range, late answer dropped, error clears result, alternatives, contact context", async ({ baseURL, page, browser }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, car, free, busy] = Array.from({ length: 4 }, () => randomUUID());
  const host = `avail-e2e-${org}.example.test`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const slug = `a-${car}`;
  const freeSlug = `wolny-${free}`;
  const busySlug = `zajety-${busy}`;
  try {
    await db.organization.create({ data: { id: org, slug: `avail-e2e-${org}`, name: "Firma Dostepnosci E2E", firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: "Firma Dostepnosci E2E", phone: "+48 600 000 333" } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    const base = { organizationId: org, status: "PUBLISHED", availableFrom: sqlDate(today) };
    await db.vehicle.createMany({ data: [
      { ...base, id: car, slug, name: "Auto Glowne" },
      { ...base, id: free, slug: freeSlug, name: "Auto Wolne" },
      { ...base, id: busy, slug: busySlug, name: "Auto Zajete" },
    ] });
    // Main car: blocked day+5..day+6; the busy alternative is blocked the whole time.
    await db.availabilityBlock.createMany({ data: [
      { organizationId: org, vehicleId: car, from: sqlDate(day(5)), to: sqlDate(day(6)), type: "MAINTENANCE", reference: "AV-REF-SECRET", internalNote: "AV-NOTE-SECRET" },
      { organizationId: org, vehicleId: busy, from: sqlDate(day(3)), to: sqlDate(day(9)), type: "MAINTENANCE" },
    ] });
    const origin = `http://${host}:${port}`;
    await page.goto(`${origin}/pojazdy/${slug}/`);
    const result = page.getByTestId("availability-result");

    // D-44: the range is chosen only in the calendar (no Od/Do fields, no "Sprawdź" button); the day buttons name their state in text.
    await expect(page.getByLabel("Od", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Do", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Sprawdź", exact: true })).toHaveCount(0);
    await pickDay(page, day(1));
    await expect(page.getByText("Wybrano początek")).toBeVisible();
    await pickDay(page, day(2));
    await expect(result.getByText("Pojazd jest dostępny")).toBeVisible();
    await expect(page.getByTestId("calendar-range")).toHaveText(`Wybrany zakres: ${formatRangeShort(day(1), day(2))} · 2 dni`);
    expect(new URL(page.url()).searchParams.get("from")).toBe(day(1));
    expect(new URL(page.url()).searchParams.get("to")).toBe(day(2));
    await expect(page.getByRole("link", { name: "Skontaktuj się", exact: true }).last())
      .toHaveAttribute("href", `/kontakt/?vehicle=${slug}&from=${day(1)}&to=${day(2)}`);

    // Boundary touching a block is unavailable (inclusive ends); the reason never appears; alternatives are only free cars.
    await pickDay(page, day(4));
    await expect(result.getByText("Pojazd jest dostępny")).toHaveCount(0); // choosing a new start withdraws the earlier result
    await pickDay(page, day(5));
    await expect(result.getByText("Pojazd jest niedostępny w tym terminie")).toBeVisible();
    const alternatives = page.getByTestId("alternatives");
    await expect(alternatives.getByRole("link", { name: "Auto Wolne" })).toHaveAttribute("href", `/pojazdy/${freeSlug}/?from=${day(4)}&to=${day(5)}`);
    await expect(alternatives.getByRole("link", { name: "Auto Zajete" })).toHaveCount(0);
    const html = await page.content();
    for (const secret of ["AV-REF-SECRET", "AV-NOTE-SECRET", "MAINTENANCE"]) expect(html).not.toContain(secret);
    await expect(page.getByRole("link", { name: "Skontaktuj się", exact: true }).last())
      .toHaveAttribute("href", `/kontakt/?vehicle=${slug}&from=${day(4)}&to=${day(5)}`);

    // Out-of-order answers: the first (slow) request answers after the second; the newest wins.
    let hold: (() => void) | null = null;
    let first = true;
    await page.route("**/api/public/availability/check", async (route) => {
      if (first) {
        first = false;
        await new Promise<void>((resolve) => { hold = resolve; });
      }
      await route.continue();
    });
    await pickRange(page, day(1), day(2)); // slow, would say available
    await expect(result.getByText("Sprawdzamy dostępność")).toBeVisible();
    await pickRange(page, day(5), day(6)); // fast, unavailable
    await expect(result.getByText("Pojazd jest niedostępny w tym terminie")).toBeVisible();
    expect(hold).not.toBeNull();
    hold!();
    await page.waitForTimeout(300);
    await expect(result.getByText("Pojazd jest niedostępny w tym terminie")).toBeVisible();
    await expect(result.getByText("Pojazd jest dostępny")).toHaveCount(0);
    await page.unroute("**/api/public/availability/check");

    // A failed check removes the positive result and offers a retry; the retry restores it.
    await pickRange(page, day(1), day(2));
    await expect(result.getByText("Pojazd jest dostępny")).toBeVisible();
    await page.route("**/api/public/availability/check", (route) => route.fulfill({ status: 500, body: "{}" }));
    await pickRange(page, day(1), day(2));
    await expect(page.getByRole("alert").filter({ hasText: "Nie udało się sprawdzić terminu" })).toBeVisible();
    await expect(result.getByText("Pojazd jest dostępny")).toHaveCount(0);
    await page.unroute("**/api/public/availability/check");
    await page.getByRole("button", { name: "Spróbuj ponownie" }).click();
    await expect(result.getByText("Pojazd jest dostępny")).toBeVisible();

    // An end before the start starts a new range instead of an invalid one; past days cannot be chosen at all.
    await pickDay(page, day(3));
    await pickDay(page, day(2));
    await expect(page.getByText("Wybrano początek")).toBeVisible();
    await expect(result.getByText("Pojazd jest dostępny")).toHaveCount(0);
    await page.getByRole("button", { name: "Wyczyść termin" }).click();
    await expect(page.getByText("Wybrano początek")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Wyczyść termin" })).toHaveCount(0);

    // A calendar failure clears the day states instead of showing old ones.
    await page.route("**/api/public/vehicles/*/calendar*", (route) => route.fulfill({ status: 500, body: "{}" }));
    await page.getByRole("link", { name: "Następny miesiąc" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Nie udało się wczytać kalendarza" })).toBeVisible();
    await expect(page.locator("#kalendarz button[aria-label*=', dostępny']")).toHaveCount(0);

    // Without script a range from the URL still has a server-rendered result.
    await page.unroute("**/api/public/vehicles/*/calendar*");
    const plain = await (await browser.newContext({ javaScriptEnabled: false })).newPage();
    await plain.goto(`${origin}/pojazdy/${slug}/?from=${day(5)}&to=${day(6)}`);
    await expect(plain.getByText("Pojazd jest niedostępny w tym terminie")).toBeVisible();
    await plain.close();
    // A past start from the URL is explained.
    await page.goto(`${origin}/pojazdy/${slug}/?from=${day(-3)}&to=${day(2)}`);
    await expect(page.getByRole("alert").filter({ hasText: "przeszłości" })).toBeVisible();
    // #251: a reversed or unreadable range from the URL gets its own message, not "Podaj obie daty".
    await page.goto(`${origin}/pojazdy/${slug}/?from=${day(6)}&to=${day(4)}`);
    await expect(page.getByRole("alert").filter({ hasText: "nie może być wcześniejsza" })).toBeVisible();
    await expect(page.getByText("Podaj obie daty")).toHaveCount(0);
    await page.goto(`${origin}/pojazdy/${slug}/?from=2026-13-45&to=${day(4)}`);
    await expect(page.getByRole("alert").filter({ hasText: "Nie rozpoznaliśmy daty" })).toBeVisible();
    // #251: past and unavailable days differ by more than the strike-through: past is plain grey text,
    // unavailable keeps the strike-through and gets a cross icon.
    await page.goto(`${origin}/pojazdy/${slug}/`);
    if (day(5).slice(0, 7) !== today.slice(0, 7)) await page.getByRole("link", { name: "Następny miesiąc" }).click();
    const unavailable = page.locator("#kalendarz button[aria-label*=', niedostępny']").first();
    await expect(unavailable).toBeVisible();
    await expect(unavailable.locator("svg")).toHaveCount(1);
    expect(await unavailable.locator("xpath=..").evaluate((node) => getComputedStyle(node).textDecorationLine)).toContain("line-through");
    await page.goto(`${origin}/pojazdy/${slug}/`);
    // D-44: past days stay unselectable (aria-disabled, "miniony" in the name) without a legend entry of their own.
    await expect(page.getByLabel("Legenda kalendarza")).not.toContainText(/Minął/i);
    const past = page.locator("#kalendarz button[aria-disabled='true']").first();
    if (await past.count()) {
      await expect(past).toHaveAttribute("aria-label", /, miniony$/);
      expect(await past.locator("xpath=..").evaluate((node) => getComputedStyle(node).textDecorationLine)).not.toContain("line-through");
      await past.click({ force: true });
      await expect(page.getByText("Wybrano początek")).toHaveCount(0);
    }
  } finally {
    await db.availabilityBlock.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});

test("availability calendar: one Tab stop, arrows move by day and week across months, readable names", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, car] = Array.from({ length: 2 }, () => randomUUID());
  const host = `avail-kbd-${org}.example.test`;
  const today = availabilityToday();
  const now = new Date();
  const slug = `k-${car}`;
  try {
    await db.organization.create({ data: { id: org, slug: `avail-kbd-${org}`, name: "Firma Klawiatury E2E", firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: "Firma Klawiatury E2E", phone: "+48 600 000 334" } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.vehicle.create({ data: { id: car, organizationId: org, status: "PUBLISHED", availableFrom: sqlDate(today), slug, name: "Auto Klawiatury" } });
    await page.goto(`http://${host}:${port}/pojazdy/${slug}/`);
    const buttons = page.locator("#kalendarz table button");
    // Roving tabindex: exactly one day is a Tab stop.
    await expect(buttons.and(page.locator("[tabindex='0']"))).toHaveCount(1);
    const stop = page.locator("#kalendarz table button[tabindex='0']");
    // The name is a full readable date, not a bare number.
    await expect(stop).toHaveAttribute("aria-label", /^\p{L}+, \d{1,2} \p{L}+ \d{4}, (dostępny|niedostępny|stan nieznany)/u);
    await stop.focus();
    const label = async () => (await page.locator("#kalendarz table button:focus").getAttribute("aria-label")) ?? "";
    const first = await label();
    await page.keyboard.press("ArrowRight");
    expect(await label()).not.toBe(first);
    await page.keyboard.press("ArrowLeft");
    expect(await label()).toBe(first);
    await expect(buttons.and(page.locator("[tabindex='0']"))).toHaveCount(1);
    // Down moves a week; going far enough crosses into the next month and keeps focus on a day button.
    const month = await page.locator("#calendar-title").textContent();
    for (let step = 0; step < 6; step += 1) await page.keyboard.press("ArrowDown");
    await expect(page.locator("#calendar-title")).not.toHaveText(month ?? "");
    await expect(page.locator("#kalendarz table button:focus")).toHaveCount(1);
    // Enter picks the start; the status names it in words, not ISO.
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Wybrano początek: \p{L}+, \d{1,2} \p{L}+ \d{4}\./u)).toBeVisible();
    await expect(page.getByText(/Wybrano początek: \d{4}-\d{2}-\d{2}/)).toHaveCount(0);
  } finally {
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});

test("availability alternatives: a fleet larger than one catalog page still finds a free car", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const org = randomUUID();
  const host = `avail-fleet-${org}.example.test`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const ids = Array.from({ length: 15 }, () => randomUUID());
  try {
    await db.organization.create({ data: { id: org, slug: `avail-fleet-${org}`, name: "Firma Floty E2E", firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: "Firma Floty E2E", phone: "+48 600 000 335" } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.vehicle.createMany({ data: ids.map((id, index) => ({ id, organizationId: org, status: "PUBLISHED", availableFrom: sqlDate(today),
      slug: `f${index}-${id}`, name: `Auto ${index}`, sortOrder: index })) });
    // Every car but the last (outside the first catalog page of 12) is blocked for the whole range.
    await db.availabilityBlock.createMany({ data: ids.slice(0, 14).map((id) => ({ organizationId: org, vehicleId: id, from: sqlDate(day(2)), to: sqlDate(day(4)), type: "MAINTENANCE" })) });
    await page.goto(`http://${host}:${port}/pojazdy/f0-${ids[0]}/?from=${day(2)}&to=${day(4)}`);
    await expect(page.getByText("Pojazd jest niedostępny w tym terminie")).toBeVisible();
    const alternatives = page.getByTestId("alternatives");
    await expect(alternatives.getByRole("link", { name: "Auto 14" })).toBeVisible();
    await expect(alternatives.getByText("Żadne inne auto")).toHaveCount(0);
  } finally {
    await db.availabilityBlock.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});

test("availability: range by keyboard only (no date fields), one day, URL range survives reload, no past legend entry", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, car] = Array.from({ length: 2 }, () => randomUUID());
  const host = `avail-d44-${org}.example.test`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const slug = `d-${car}`;
  try {
    await db.organization.create({ data: { id: org, slug: `avail-d44-${org}`, name: "Firma D44 E2E", firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: "Firma D44 E2E", phone: "+48 600 000 336" } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.vehicle.create({ data: { id: car, organizationId: org, status: "PUBLISHED", availableFrom: sqlDate(today), slug, name: "Auto D44" } });
    const origin = `http://${host}:${port}`;
    await page.goto(`${origin}/pojazdy/${slug}/`);
    const result = page.getByTestId("availability-result");
    await expect(page.getByLabel("Od", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Do", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Legenda kalendarza")).not.toContainText(/Minął/i);
    for (const entry of ["Dostępny", "Niedostępny", "Dzisiaj", "Wybrany zakres"]) await expect(page.getByLabel("Legenda kalendarza")).toContainText(entry);

    // Keyboard: Tab stop is today (or the first selectable day); arrows move; Enter picks the start, Space the end.
    const stop = page.locator("#kalendarz table button[tabindex='0']");
    await stop.focus();
    await expect(stop).toHaveAttribute("aria-label", new RegExp(", dzisiaj"));
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#kalendarz table button:focus")).toHaveCount(1);
    await page.keyboard.press("Enter");
    await expect(page.getByText(/Wybrano początek/)).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#kalendarz table button:focus")).toHaveCount(1);
    await page.keyboard.press("Space");
    await expect(result.getByText("Pojazd jest dostępny")).toBeVisible();
    await expect(page.getByTestId("calendar-range")).toHaveText(`Wybrany zakres: ${formatRangeShort(day(1), day(3))} · 3 dni`);
    await expect(page.getByRole("link", { name: "Skontaktuj się", exact: true }).last())
      .toHaveAttribute("href", `/kontakt/?vehicle=${slug}&from=${day(1)}&to=${day(3)}`);

    // One day: the same day twice, and the explicit action.
    await pickDay(page, day(2));
    await pickDay(page, day(2));
    await expect(page.getByTestId("calendar-range")).toHaveText(`Wybrany zakres: ${formatRangeShort(day(2), day(2))} · 1 dzień`);
    await pickDay(page, day(4));
    await page.getByRole("button", { name: "Tylko ten dzień" }).click();
    await expect(page.getByTestId("calendar-range")).toHaveText(`Wybrany zakres: ${formatRangeShort(day(4), day(4))} · 1 dzień`);

    // The range lives in the URL: reload and the link from the catalog restore it, with the result.
    await page.reload();
    await expect(page.getByTestId("calendar-range")).toHaveText(`Wybrany zakres: ${formatRangeShort(day(4), day(4))} · 1 dzień`);
    await page.goto(`${origin}/pojazdy/${slug}/?from=${day(2)}&to=${day(3)}`);
    await expect(result.getByText("Pojazd jest dostępny")).toBeVisible();
    await expect(page.getByTestId("calendar-range")).toHaveText(`Wybrany zakres: ${formatRangeShort(day(2), day(3))} · 2 dni`);
    await expect(page.getByLabel("Od", { exact: true })).toHaveCount(0);
  } finally {
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
