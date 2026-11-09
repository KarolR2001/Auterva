import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #34: fleet list and dashboard of the company admin against the real API of the built ingress.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("fleet list and dashboard: empty states, filters, keyboard order, hide and archive, today statistics and nearest blocks", async ({ baseURL, browser }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, user, cat, a, b, c, block] = Array.from({ length: 7 }, () => randomUUID());
  const host = `admin-fleet-${org}.example.test`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  const context = await browser.newContext();
  try {
    await db.organization.create({ data: { id: org, slug: `admin-fleet-${org}`, name: "Firma Floty E2E", firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: user, name: "Fleet list admin", role: "ADMIN_FIRMY", organizationId: org,
      email: `admin-fleet-${user}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: sqlDate(day(30)) } });
    await db.vehicleCategory.create({ data: { id: cat, code: `af-${cat.slice(0, 8)}`, name: "Osobowe" } });
    session = await verifiedFixtureSession(db, user);
    const [name, value] = session.cookie.split(/=(.*)/s);
    await context.addCookies([{ name, value, domain: host, path: "/" }]);
    const page = await context.newPage();
    const base = `http://${host}:${port}`;

    await page.goto(`${base}/admin/pojazdy/`);
    await expect(page.getByRole("heading", { name: "Flota jest pusta" })).toBeVisible();
    // The vehicle form exists since #35; the calendar (#38) does not, so no calendar link yet.
    await expect(page.getByRole("link", { name: "Dodaj pierwszy pojazd" })).toHaveAttribute("href", "/admin/pojazdy/nowy/");
    await page.goto(`${base}/admin/`);
    await expect(page.getByRole("heading", { name: "Zacznij od pierwszego pojazdu" })).toBeVisible();

    const common = { organizationId: org, categoryId: cat, availableFrom: sqlDate(today), version: 0 };
    await db.vehicle.createMany({ data: [
      { ...common, id: a, name: "Alfa Pierwsza", slug: `alfa-${a}`, status: "PUBLISHED", sortOrder: 1 },
      { ...common, id: b, name: "Beta Szkic", slug: `beta-${b}`, status: "DRAFT", sortOrder: 2 },
      { ...common, id: c, name: "Alfa Trzecia", slug: `alfa-${c}`, status: "PUBLISHED", sortOrder: 3 },
    ] });
    await db.availabilityBlock.create({ data: { id: block, organizationId: org, vehicleId: c, from: sqlDate(day(0)), to: sqlDate(day(2)), type: "MAINTENANCE" } });

    // Dashboard: today statistics of the published fleet and the nearest block with a link to that vehicle calendar.
    await page.goto(`${base}/admin/`);
    const stats = page.getByRole("list", { name: "Statystyki floty na dziś" });
    await expect(stats.getByRole("listitem").filter({ hasText: "Opublikowane" })).toContainText("2");
    await expect(stats.getByRole("listitem").filter({ hasText: "Niedostępne dziś" })).toContainText("1");
    await expect(stats.getByRole("listitem").filter({ hasText: "Dostępne dziś" }).first()).toContainText("1");
    await expect(stats.getByRole("listitem").filter({ hasText: "Blokady w 7 dni" })).toContainText("1");
    await expect(stats.getByRole("listitem").filter({ hasText: "Aktywne pojazdy" })).toContainText("z 3 w ewidencji");
    // The vehicle calendar is not shipped yet (#38): the block names the vehicle without a dead link.
    await expect(page.getByText("Alfa Trzecia")).toBeVisible();
    await expect(page.getByRole("link", { name: "Alfa Trzecia" })).toHaveCount(0);
    await expect(page.getByText("Niedostępny", { exact: true })).toBeVisible();
    await expect(page.getByText("Opłacono do")).toBeVisible();

    // List: rows in public order, statuses with text, availability today as text.
    await page.goto(`${base}/admin/pojazdy/`);
    const table = page.getByRole("table", { name: "Pojazdy" });
    await expect(table.getByRole("columnheader")).toHaveText(["Pojazd", "Kategoria", "Publikacja", "Dziś", "Ostatnia zmiana", "Akcje"]);
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Alfa Pierwsza", "Beta Szkic", "Alfa Trzecia"]);
    await expect(rows.nth(2)).toContainText("Niedostępny dziś");
    await expect(rows.nth(1)).toContainText("Szkic");
    await expect(rows.nth(1)).toContainText("— Niepubliczny");

    // Filters: search, no results and reset.
    await page.getByLabel("Szukaj").fill("alfa");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Alfa Pierwsza", "Alfa Trzecia"]);
    await expect(page.getByRole("button", { name: /Przesuń/ })).toHaveCount(0);
    await page.getByLabel("Szukaj").fill("brak-takiego-pojazdu");
    await expect(page.getByRole("heading", { name: "Brak wyników" })).toBeVisible();
    await page.getByRole("button", { name: "Wyczyść filtry" }).click();
    await expect(page.getByRole("heading", { level: 3 })).toHaveCount(3);
    await page.getByLabel("Dostępność dziś").selectOption("false");
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Alfa Trzecia"]);
    await page.getByLabel("Dostępność dziś").selectOption("");

    // Keyboard order: focus the button, press Enter; the order is the server one after a reload.
    const down = page.getByRole("button", { name: "Przesuń „Alfa Pierwsza” w dół" });
    await down.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Zapisano kolejność")).toBeVisible();
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Beta Szkic", "Alfa Pierwsza", "Alfa Trzecia"]);
    // Focus stays on the control of the moved vehicle (not on BODY) after the refreshed list is shown.
    await expect(page.getByRole("button", { name: "Przesuń „Alfa Pierwsza” w dół" })).toBeFocused();
    await page.reload();
    await expect(page.getByRole("heading", { level: 3 })).toHaveText(["Beta Szkic", "Alfa Pierwsza", "Alfa Trzecia"]);
    expect((await db.vehicle.findMany({ where: { organizationId: org }, orderBy: { sortOrder: "asc" }, select: { id: true } })).map((row) => row.id)).toEqual([b, a, c]);

    // Hide: the dialog names this vehicle, Cancel changes nothing, confirm shows the server result and keeps the row.
    await page.getByRole("button", { name: "Więcej akcji dla „Alfa Pierwsza”" }).click();
    await page.getByRole("button", { name: /^Ukryj/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Ukryć pojazd „Alfa Pierwsza”?");
    await dialog.getByRole("button", { name: "Anuluj" }).click();
    await expect(page.getByRole("button", { name: "Więcej akcji dla „Alfa Pierwsza”" })).toBeFocused();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: a } })).status).toBe("PUBLISHED");
    await page.getByRole("button", { name: "Więcej akcji dla „Alfa Pierwsza”" }).click();
    await page.getByRole("button", { name: /^Ukryj/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ukryj" }).click();
    await expect(page.getByText("Ukryto pojazd „Alfa Pierwsza”.")).toBeVisible();
    await expect(rows.nth(1)).toContainText("Ukryty");
    await expect(page.getByRole("button", { name: "Więcej akcji dla „Alfa Pierwsza”" })).toBeFocused();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: a } })).status).toBe("UNPUBLISHED");

    // Archive: history stays, archived has no menu; a stale version is refused with the dialog kept.
    await db.vehicle.update({ where: { id: b }, data: { version: { increment: 1 } } });
    await page.getByRole("button", { name: "Więcej akcji dla „Beta Szkic”" }).click();
    await page.getByRole("button", { name: /^Archiwizuj/ }).click();
    expect(await db.vehicle.count({ where: { id: b } })).toBe(1);
    await page.getByRole("dialog").getByRole("button", { name: "Archiwizuj" }).click();
    await expect(page.getByRole("dialog")).toContainText("Pojazd został zmieniony");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: b } })).status).toBe("DRAFT");
    // The list was re-read after the conflict, so the next confirmation carries the current version.
    await expect(async () => {
      await page.getByRole("dialog").getByRole("button", { name: "Archiwizuj" }).click();
      await expect(page.getByText("Zarchiwizowano pojazd „Beta Szkic”.")).toBeVisible({ timeout: 1500 });
    }).toPass();
    await expect(page.getByText("Zarchiwizowano pojazd „Beta Szkic”.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Więcej akcji dla „Beta Szkic”" })).toHaveCount(0);
    // The archived row has no menu any more: focus moves to its row, never to BODY.
    await expect(page.locator(`[data-focus="row:${b}"]`)).toBeFocused();
    expect(await db.vehicle.count({ where: { organizationId: org } })).toBe(3);
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: b } })).status).toBe("ARCHIVED");
  } finally {
    await context.close();
    await session?.dispose();
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.availabilityBlock.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.vehicleCategory.deleteMany({ where: { id: cat } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: user } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});

test("fleet order over several pages and an unknown outcome of hiding", async ({ baseURL, browser }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [org, user, cat] = Array.from({ length: 3 }, () => randomUUID());
  const host = `admin-fleet-pages-${org}.example.test`;
  const today = availabilityToday();
  const ids = Array.from({ length: 22 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  const context = await browser.newContext();
  try {
    await db.organization.create({ data: { id: org, slug: `admin-fleet-pages-${org}`, name: "Firma Stron E2E", firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: user, name: "Fleet pages admin", role: "ADMIN_FIRMY", organizationId: org,
      email: `admin-fleet-pages-${user}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: sqlDate(today) } });
    await db.vehicleCategory.create({ data: { id: cat, code: `afp-${cat.slice(0, 8)}`, name: "Osobowe" } });
    session = await verifiedFixtureSession(db, user);
    const [name, value] = session.cookie.split(/=(.*)/s);
    await context.addCookies([{ name, value, domain: host, path: "/" }]);
    // 22 vehicles, more than one page of 20, all with the default sortOrder 0 (ties are ordered by id).
    await db.vehicle.createMany({ data: ids.map((id, n) => ({ id, organizationId: org, categoryId: cat, availableFrom: sqlDate(today), version: 0,
      name: `V${String(n).padStart(2, "0")}`, slug: `v${n}`, status: "PUBLISHED", sortOrder: 0 })) });
    const page = await context.newPage();
    const base = `http://${host}:${port}`;
    await page.goto(`${base}/admin/pojazdy/`);
    await expect(page.locator("tbody tr")).toHaveCount(20);
    // No horizontal page scroll next to the 240 px sidebar at 320 px, 768 px and 1024 px.
    for (const width of [320, 768, 1024, 1200, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), { message: `viewport ${width}` }).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    const down = page.getByRole("button", { name: "Przesuń „V03” w dół" });
    await down.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Zapisano kolejność")).toBeVisible();
    // Only V03 and V04 swapped; vehicles from page 2 did not jump into page 1 and every value is distinct.
    const stored = await db.vehicle.findMany({ where: { organizationId: org }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, sortOrder: true } });
    expect(stored.map((row) => row.name)).toEqual(ids.map((_, n) => `V${String(n).padStart(2, "0")}`).map((label) => label === "V03" ? "V04" : label === "V04" ? "V03" : label));
    expect(new Set(stored.map((row) => row.sortOrder)).size).toBe(22);
    await expect(page.getByRole("button", { name: "Przesuń „V03” w dół" })).toBeFocused();
    await page.getByRole("button", { name: "Następna" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);

    // Across the page boundary: the last vehicle of page 1 moves down onto page 2 and back up again; focus follows it.
    const order = async () => (await db.vehicle.findMany({ where: { organizationId: org }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { name: true } })).map((row) => row.name);
    await page.getByRole("button", { name: "Poprzednia" }).click();
    await expect(page.locator("tbody tr")).toHaveCount(20);
    await page.getByRole("button", { name: "Przesuń „V19” w dół" }).click();
    await expect(page.getByText("Strona 2 z 2")).toBeVisible();
    await expect(page.getByText("(strona 2)")).toBeVisible();
    // Focus stays on the same control (down) of the moved vehicle, now on page 2.
    await expect(page.getByRole("button", { name: "Przesuń „V19” w dół" })).toBeFocused();
    expect((await order()).slice(18, 22)).toEqual(["V18", "V20", "V19", "V21"]);
    await page.getByRole("button", { name: "Przesuń „V19” w górę" }).click();
    await expect(page.getByText("Strona 1 z 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Przesuń „V19” w górę" })).toBeFocused();
    expect((await order()).slice(18, 22)).toEqual(["V18", "V19", "V20", "V21"]);
    // The ends of the whole fleet stay closed, not the ends of a page.
    await expect(page.getByRole("button", { name: "Przesuń „V00” w górę" })).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByRole("button", { name: "Przesuń „V19” w dół" })).not.toHaveAttribute("aria-disabled", "true");

    // An unknown outcome (502 after the commit may have happened): said plainly, the list is read again.
    await page.goto(`${base}/admin/pojazdy/`);
    await page.route("**/api/admin/vehicles/*/unpublish/", (route) => route.fulfill({ status: 502, contentType: "application/json", body: "{}" }));
    await page.getByRole("button", { name: "Więcej akcji dla „V00”" }).click();
    await page.getByRole("button", { name: /^Ukryj/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Ukryj" }).click();
    await expect(page.getByText("Nie wiadomo, czy zmiana została zapisana.")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Więcej akcji dla „V00”" })).toBeFocused();
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("PUBLISHED");
  } finally {
    await context.close();
    await session?.dispose();
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.vehicleCategory.deleteMany({ where: { id: cat } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: user } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
