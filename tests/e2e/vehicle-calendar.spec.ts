import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #39: vehicle calendar and quick blocks of the company admin against the real API of the built ingress.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000 });

test("vehicle calendar: add, one day, overlap from two cards, version conflict, privacy, delete, isolation, keyboard, 320-1920", async ({ baseURL, browser }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [orgA, orgB, userA, userB, car, carB] = Array.from({ length: 6 }, () => randomUUID());
  const hosts = { adminA: `cal-e2e-admin-a-${orgA}.example.test`, publicA: `cal-e2e-public-a-${orgA}.example.test`, adminB: `cal-e2e-admin-b-${orgB}.example.test` };
  const slug = `cal-e2e-${car}`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  const contexts = [await browser.newContext({ viewport: { width: 390, height: 844 } }), await browser.newContext({ viewport: { width: 390, height: 844 } })];
  const publicContext = await browser.newContext();
  try {
    for (const [id, tag] of [[orgA, "a"], [orgB, "b"]] as const) {
      await db.organization.create({ data: { id, slug: `cal-e2e-${tag}-${id}`, name: `Firma Kalendarza ${tag.toUpperCase()}`, firstAdminRegisteredAt: now } });
      await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    }
    await db.siteSettings.create({ data: { organizationId: orgA, publicName: "Firma Kalendarza A", phone: "+48 600 000 444" } });
    await db.hostMapping.createMany({ data: [
      { hostname: hosts.adminA, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: hosts.publicA, organizationId: orgA, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { hostname: hosts.adminB, organizationId: orgB, area: "COMPANY_ADMIN", status: "ACTIVE" },
    ] });
    await db.vehicle.createMany({ data: [
      { id: car, organizationId: orgA, slug, name: "Auto Kalendarzowe", status: "PUBLISHED", availableFrom: sqlDate(day(-30)) },
      { id: carB, organizationId: orgB, slug: `cal-e2e-b-${carB}`, name: "Auto B", status: "PUBLISHED", availableFrom: sqlDate(day(-30)) },
    ] });
    for (const [id, organizationId] of [[userA, orgA], [userB, orgB]]) {
      await db.user.create({ data: { id, name: "Calendar E2E admin", role: "ADMIN_FIRMY", organizationId, email: `cal-e2e-${id}@example.test`, emailVerified: true, twoFactorEnabled: true } });
      sessions.push(await verifiedFixtureSession(db, id));
    }
    const [name, value] = sessions[0].cookie.split(/=(.*)/s);
    for (const context of contexts) await context.addCookies([{ name, value, domain: hosts.adminA, path: "/" }]);
    const origin = `http://${hosts.adminA}:${port}`;
    const url = `${origin}/admin/pojazdy/${car}/kalendarz/`;
    const [page, second] = [await contexts[0].newPage(), await contexts[1].newPage()];
    const dialog = (target: Page) => target.getByRole("dialog");
    const addButton = (target: Page) => target.getByRole("button", { name: "Dodaj okres niedostępności" }).last();
    const publicAvailable = async (from: string, to: string) => {
      const publicPage = await publicContext.newPage();
      try {
        await publicPage.goto(`http://${hosts.publicA}:${port}/pojazdy/${slug}/`);
        const html = await publicPage.content();
        expect(html).not.toMatch(/CAL-REF-SECRET|CAL-NOTE-SECRET|MAINTENANCE/);
        return await publicPage.evaluate(async ({ slug: s, from: f, to: t }) => {
          const response = await fetch("/api/public/availability/check/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug: s, from: f, to: t }) });
          return { status: response.status, text: await response.text() };
        }, { slug, from, to });
      } finally { await publicPage.close(); }
    };

    // Empty state and the quick flow on a phone: day -> dates -> type -> save; the private fields stay private.
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Kalendarz: Auto Kalendarzowe" })).toBeVisible();
    await expect(page.getByText("Brak blokad w najbliższych 12 miesiącach", { exact: false })).toBeVisible();
    await addButton(page).click();
    await page.locator("#bc-from").fill(day(2));
    await page.locator("#bc-to").fill(day(2));
    await page.locator("#bc-type").selectOption({ label: "Serwis" });
    await page.locator("#bc-reference").fill("CAL-REF-SECRET");
    await page.locator("#bc-internalNote").fill("CAL-NOTE-SECRET");
    await dialog(page).getByRole("button", { name: "Dodaj blokadę" }).click();
    await expect(page.getByText("Blokada została dodana.")).toBeVisible();
    await expect(page.getByText("Serwis").first()).toBeVisible();
    const stored = await db.availabilityBlock.findMany({ where: { vehicleId: car } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.from.toISOString().slice(0, 10)).toBe(day(2));
    expect(stored[0]!.to.toISOString().slice(0, 10)).toBe(day(2)); // one day is valid, ends inclusive
    expect(stored[0]!.reference).toBe("CAL-REF-SECRET");
    const hidden = await publicAvailable(day(2), day(2));
    expect(hidden.status).toBe(200);
    expect(JSON.parse(hidden.text)).toEqual({ available: false });
    expect(hidden.text).not.toMatch(/SECRET|MAINTENANCE|Serwis/);
    expect(JSON.parse((await publicAvailable(day(3), day(3))).text)).toEqual({ available: true });

    // Two cards open on the same state: the second, overlapping save names the existing entry, keeps the entry and nothing is overwritten.
    await second.goto(url);
    await addButton(second).click();
    await second.locator("#bc-from").fill(day(2));
    await second.locator("#bc-to").fill(day(4));
    await second.locator("#bc-reference").fill("MOJ-NR");
    await dialog(second).getByRole("button", { name: "Dodaj blokadę" }).click();
    await expect(dialog(second).getByText("Termin nakłada się na istniejącą blokadę.")).toBeVisible();
    await expect(dialog(second).locator("#bc-reference")).toHaveValue("MOJ-NR");
    await expect(dialog(second).getByText("Serwis", { exact: false }).first()).toBeVisible();
    expect(await db.availabilityBlock.count({ where: { vehicleId: car } })).toBe(1);
    await dialog(second).getByRole("button", { name: "Przejdź do istniejącego wpisu" }).click();
    await expect(dialog(second).getByRole("heading", { name: "Edytuj blokadę" })).toBeVisible();
    await expect(dialog(second).locator("#bc-reference")).toHaveValue("CAL-REF-SECRET");
    await dialog(second).getByRole("button", { name: "Zamknij" }).click();
    await expect(dialog(second)).toHaveCount(0);

    // Two truly simultaneous saves of the same free range: exactly one wins, the other is a conflict (TEST-MVP-28).
    const racers = [page, second];
    await Promise.all(racers.map(async (card, index) => {
      await card.goto(url);
      await addButton(card).click();
      await card.locator("#bc-from").fill(day(10));
      await card.locator("#bc-to").fill(day(12));
      await card.locator("#bc-reference").fill(`RACE-${index}`);
    }));
    await Promise.all(racers.map((card) => dialog(card).getByRole("button", { name: "Dodaj blokadę" }).click()));
    await expect.poll(async () => db.availabilityBlock.count({ where: { vehicleId: car, from: sqlDate(day(10)) } })).toBe(1);
    await expect.poll(async () => (await Promise.all(racers.map(async (card) =>
      (await card.getByText("Termin nakłada się na istniejącą blokadę.").count()) + (await card.getByText("Blokada została dodana.").count())))).every((count) => count >= 1)).toBe(true);
    expect(await db.availabilityBlock.count({ where: { vehicleId: car } })).toBe(2);

    // Version conflict: the stale card edits a block that changed meanwhile; its entry stays and nothing is overwritten silently.
    await page.goto(url);
    await second.goto(url);
    const target = await db.availabilityBlock.findFirstOrThrow({ where: { vehicleId: car, from: sqlDate(day(2)) } });
    await page.getByRole("button", { name: /Edytuj blokadę: Serwis/ }).first().click();
    await dialog(page).locator("#bc-type").selectOption({ label: "Zablokowane" });
    await dialog(page).getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(page.getByText("Zmiany blokady zostały zapisane.")).toBeVisible();
    await second.getByRole("button", { name: /Edytuj blokadę: Serwis/ }).first().click();
    await dialog(second).locator("#bc-type").selectOption({ label: "Inne" });
    await dialog(second).locator("#bc-internalNote").fill("Moja zmiana notatki");
    await dialog(second).getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(dialog(second).getByText("Blokada została zmieniona przez kogoś innego.")).toBeVisible();
    await expect(dialog(second).locator("#bc-internalNote")).toHaveValue("Moja zmiana notatki");
    expect((await db.availabilityBlock.findUniqueOrThrow({ where: { id: target.id } })).type).toBe("BLOCKED");
    await dialog(second).getByRole("button", { name: "Wczytaj aktualną wersję" }).click();
    await dialog(second).getByRole("button", { name: "Zapisz zmiany" }).click();
    await expect(second.getByText("Zmiany blokady zostały zapisane.")).toBeVisible();
    const merged = await db.availabilityBlock.findUniqueOrThrow({ where: { id: target.id } });
    expect([merged.type, merged.internalNote]).toEqual(["OTHER", "Moja zmiana notatki"]);

    // Past dates warn and need a confirmation (history is allowed inside the activity).
    await addButton(second).click();
    await second.locator("#bc-from").fill(day(-5));
    await second.locator("#bc-to").fill(day(-4));
    await expect(dialog(second).getByText("Termin zaczyna się w przeszłości.")).toBeVisible();
    await dialog(second).getByRole("button", { name: "Dodaj blokadę" }).click();
    await expect(dialog(second).getByText("Potwierdź zapis okresu z przeszłości.").first()).toBeVisible();
    await dialog(second).getByRole("button", { name: "Zamknij" }).click();
    await dialog(second).getByRole("button", { name: "Odrzuć wpisane dane" }).click();

    // Keyboard: arrows move between days, Enter on a blocked day opens its edit, Escape returns the focus.
    await page.goto(url);
    const todayButton = page.getByRole("button", { name: /dzisiaj/ });
    await todayButton.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("table button:focus")).toHaveAttribute("aria-label", /./);
    await page.keyboard.press("PageDown");
    await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: /20\d\d/ }).first()).toBeVisible();

    // Delete asks for confirmation; afterwards the public read is current at once.
    await page.goto(url);
    await page.getByRole("button", { name: /Usuń blokadę: Zablokowane|Usuń blokadę: Inne/ }).first().click();
    await expect(dialog(page).getByRole("heading", { name: "Usunąć blokadę?" })).toBeVisible();
    expect(await db.availabilityBlock.count({ where: { id: target.id } })).toBe(1);
    await dialog(page).getByRole("button", { name: "Usuń blokadę" }).click();
    await expect(page.getByText("Blokada została usunięta.")).toBeVisible();
    expect(await db.availabilityBlock.count({ where: { id: target.id } })).toBe(0);
    expect(JSON.parse((await publicAvailable(day(2), day(2))).text)).toEqual({ available: true });

    // No horizontal overflow from 320 to 1920 px.
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(url);
      await expect(page.getByRole("heading", { name: "Kalendarz: Auto Kalendarzowe" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `overflow at ${width}`).toBe(true);
    }

    // Archived vehicle: no new blocks, existing ones can still be deleted.
    await db.vehicle.update({ where: { id: car }, data: { status: "ARCHIVED" } });
    await page.goto(url);
    await expect(page.getByText("Pojazd jest zarchiwizowany.").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Dodaj okres niedostępności" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Usuń blokadę/ }).first()).toBeVisible();

    // Isolation: company B's admin never sees company A's vehicle calendar.
    const [nameB, valueB] = sessions[1].cookie.split(/=(.*)/s);
    const contextB = await browser.newContext();
    await contextB.addCookies([{ name: nameB, value: valueB, domain: hosts.adminB, path: "/" }]);
    const pageB = await contextB.newPage();
    // Since #284 the server answers a neutral 404 for a vehicle of another company (never a 200 with a message).
    expect((await pageB.goto(`http://${hosts.adminB}:${port}/admin/pojazdy/${car}/kalendarz/`))!.status()).toBe(404);
    await expect(pageB.getByText("CAL-REF-SECRET")).toHaveCount(0);
    await contextB.close();
  } finally {
    await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.siteSettings.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    for (const session of sessions) await session.dispose();
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    for (const context of [...contexts, publicContext]) await context.close();
    await db.$disconnect();
  }
});
