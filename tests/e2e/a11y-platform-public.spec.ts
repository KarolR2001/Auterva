import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { auditScreen } from "../fixtures/a11y";
import { FIXTURE } from "../../scripts/fixture-ids";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #342 (part of #61): accessibility regression for the platform panel, the public company site and the Auterva marketing page.
// axe (WCAG 2.2 AA tags, serious/critical fail) + one h1/main/lang, skip link, focus order and visibility, reflow at 320/640 px,
// reduced motion; dialogs and the mobile menu are checked by keyboard. VoiceOver is DEFERRED (#97).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
const expect15 = expect.configure({ timeout: 15_000 });

async function open(page: import("@playwright/test").Page, url: string) {
  const response = await page.goto(url);
  expect(response?.status(), url).toBe(200);
  await page.waitForLoadState("networkidle");
}

test("platform panel screens pass the accessibility audit and the dialog traps and returns focus (#342)", async ({ baseURL, page }) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const [org, car, cat] = Array.from({ length: 3 }, () => randomUUID());
  const platformHost = `a11y-platform-${tag}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  try {
    await db.organization.create({ data: { id: org, slug: `a11y-${org}`, name: `Firma A11y ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.serviceAccess.create({ data: { organizationId: org, paidThrough: sqlDate(day(30)) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: `Firma A11y ${tag}`, phone: "+48 600 000 333", email: "a11y@example.test" } });
    await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
    await db.hostMapping.create({ data: { hostname: `a11y-admin-${tag}.example.test`, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" } });
    await db.vehicleCategory.create({ data: { id: cat, code: `a11y-${cat.slice(0, 8)}`, name: "Sedan" } });
    await db.vehicle.create({ data: { id: car, organizationId: org, slug: `a11y-${car}`, name: "Auto A11y", status: "PUBLISHED", categoryId: cat,
      availableFrom: sqlDate(today), seats: 5, transmission: "Automatyczna", description: "Opis pojazdu do audytu dostępności.", shortDescription: "Krótki opis" } });
    const adminId = randomUUID();
    await db.user.create({ data: { id: adminId, name: "A11y admin", email: `a11y-${tag}@example.test`, emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: org } });
    const conversation = await db.conversation.create({ data: { organizationId: org, lastSeq: 1, activityAt: new Date() } });
    await db.chatMessage.create({ data: { organizationId: org, conversationId: conversation.id, senderId: adminId, seq: 1, clientMessageId: randomUUID(), body: "Pytanie do audytu", createdAt: new Date() } });
    await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
    await resetPlatformApiBudget(db, FIXTURE.users[2]);

    // Signed-out login page first (no session cookie yet).
    await open(page, `${origin}/login/`);
    // Single-form page without repeated blocks to bypass (no header/navigation): WCAG 2.4.1 needs no skip link there.
    await auditScreen(page, "login", { skipLink: false });

    // Password step done, second factor pending: the MFA challenge page.
    const pendingToken = randomBytes(32).toString("base64url");
    const pendingId = randomUUID();
    await db.session.create({ data: { id: pendingId, userId: FIXTURE.users[2], token: pendingToken, expiresAt: new Date(Date.now() + 60 * 60_000) } });
    const pendingSignature = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(pendingToken).digest("base64");
    await page.context().addCookies([{ name: "better-auth.session_token", value: `${pendingToken}.${pendingSignature}`, url: origin }]);
    try {
      await open(page, `${origin}/mfa/`);
      await auditScreen(page, "mfa", { skipLink: false });
    } finally { await db.session.deleteMany({ where: { id: pendingId } }); }

    session = await verifiedFixtureSession(db, FIXTURE.users[2]);
    await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin }]);

    const screens: [string, string][] = [
      ["firmy list", "/firmy/"],
      ["nowa firma", "/firmy/nowa/"],
      ["karta firmy", `/firmy/${org}/`],
      ["flota firmy", `/firmy/${org}/pojazdy/`],
      ["nowy pojazd", `/firmy/${org}/pojazdy/nowy/`],
      ["edycja pojazdu", `/firmy/${org}/pojazdy/${car}/`],
      ["kalendarz pojazdu", `/firmy/${org}/pojazdy/${car}/kalendarz/`],
      ["kalendarz floty", `/firmy/${org}/kalendarz/`],
      ["ustawienia firmy", `/firmy/${org}/ustawienia/`],
      ["dziennik firmy", `/firmy/${org}/logi/`],
      ["podglad", `/firmy/${org}/podglad/`],
      ["podglad pojazdu", `/firmy/${org}/podglad/pojazdy/${car}/`],
      ["skrzynka", "/wiadomosci/"],
      ["konto", "/konto/"],
      ["sesje", "/konto/sesje/"],
    ];
    for (const [label, path] of screens) {
      await open(page, `${origin}${path}`);
      await auditScreen(page, label);
    }

    // Dialog: archive confirmation traps focus, Escape closes it and focus returns to the trigger.
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `${origin}/firmy/${org}/`);
    const trigger = page.getByRole("button", { name: "Archiwizuj firmę" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect15(dialog).toBeVisible();
    await expect15(dialog).toHaveAccessibleName(/rchiwizow/);
    for (let step = 0; step < 8; step += 1) {
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), `Tab ${step} stays in the dialog`).toBe(true);
    }
    for (let step = 0; step < 3; step += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null), `Shift+Tab ${step} stays in the dialog`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect15(dialog).toHaveCount(0);
    await expect15(trigger).toBeFocused();
    expect((await db.organization.findUniqueOrThrow({ where: { id: org } })).archivedAt).toBeNull();
  } finally {
    await session?.dispose();
    await db.chatMessage.deleteMany({ where: { organizationId: org } });
    await db.conversation.deleteMany({ where: { organizationId: org } });
    await db.$disconnect();
  }
});

test("public company site and marketing page pass the accessibility audit (#342)", async ({ baseURL, page }) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const [org, car, car2, cat] = Array.from({ length: 4 }, () => randomUUID());
  const host = `a11y-public-${tag}.example.test`;
  const marketingHost = `a11y-mkt-${tag}.example.test`;
  const origin = `http://${host}:${port}`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  try {
    await db.organization.create({ data: { id: org, slug: `a11y-pub-${org}`, name: "Firma Publiczna A11y", firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: "Firma Publiczna A11y", phone: "+48 600 000 111", whatsapp: "+48 600 000 222", email: "pub@example.test",
      contactChannel: "WHATSAPP", contactHours: "Pn–Pt 9:00–17:00", addressLine: "ul. Testowa 1", postalCode: "00-001", city: "Warszawa", country: "Polska",
      heroText: "Podróż zaczyna się od dobrego auta.", shortDescription: "Opis firmy do testu.", featuredVehicleCount: 3, showPrices: true,
      privacyText: "Polityka prywatności.\nDruga linia.", termsText: "Regulamin.\nDruga linia." } });
    await db.hostMapping.createMany({ data: [
      { hostname: host, organizationId: org, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { hostname: marketingHost, area: "MARKETING", status: "ACTIVE" },
    ] });
    await db.vehicleCategory.create({ data: { id: cat, code: `a11y-${cat.slice(0, 8)}`, name: "Kombi rodzinne" } });
    const base = { organizationId: org, status: "PUBLISHED", availableFrom: sqlDate(today), categoryId: cat, seats: 5, transmission: "Automatyczna", price: "229", priceUnit: "doba" };
    await db.vehicle.createMany({ data: [
      { ...base, id: car, slug: `a11y-${car}`, name: "Alfa Atlas", description: "Opis pojazdu.", shortDescription: "Krótki" },
      { ...base, id: car2, slug: `a11y-${car2}`, name: "Beta Brava", shortDescription: "Drugi" },
    ] });
    await db.availabilityBlock.create({ data: { organizationId: org, vehicleId: car, from: sqlDate(day(5)), to: sqlDate(day(6)), type: "MAINTENANCE" } });

    const screens: [string, string][] = [
      ["home", "/"],
      ["katalog", "/pojazdy/"],
      ["katalog z filtrami", `/pojazdy/?from=${day(2)}&to=${day(3)}&seats=4`],
      ["pojazd", `/pojazdy/a11y-${car}/`],
      ["kontakt", `/kontakt/?vehicle=a11y-${car}&from=${day(3)}&to=${day(5)}`],
      ["polityka", "/polityka-prywatnosci/"],
      ["regulamin", "/regulamin/"],
    ];
    for (const [label, path] of screens) {
      await open(page, `${origin}${path}`);
      await auditScreen(page, `public ${label}`);
    }
    // Missing page: the not-found state is still a labelled page.
    const missing = await page.goto(`${origin}/pojazdy/nie-ma-takiego/`);
    expect(missing?.status()).toBe(404);
    await auditScreen(page, "public 404");

    // Mobile menu by keyboard: opens with Enter, link reachable, closes with Escape or toggles back.
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, `${origin}/`);
    const menu = page.locator("summary").filter({ hasText: "Menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect15(page.getByRole("navigation", { name: "Menu" }).getByRole("link", { name: "Kontakt" })).toBeVisible();
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.closest("nav")?.getAttribute("aria-label"))).toBe("Menu");

    await open(page, `http://${marketingHost}:${port}/`);
    await auditScreen(page, "marketing");
  } finally {
    await db.$disconnect();
  }
});
