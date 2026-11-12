import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { addLocalDays, availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #355 (ADM-22, D-40/D-47/D-49): the company admin creates, copies, rotates and revokes private iCal addresses; the
// address is shown once and only in the answer; an uncertain answer shows no success; the superadmin lists and revokes.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

const feedStatus = (page: Page, url: string) => page.evaluate(async (target) => (await fetch(target, { cache: "no-store" })).status, url);

test("calendar feeds UI: one-time address, copy, rotate, revoke, uncertain create, limit and superadmin context", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const tag = randomUUID().slice(0, 8);
  const org = randomUUID();
  const adminId = randomUUID();
  const adminHost = `feed-ui-admin-${tag}.example.test`;
  const platformHost = `feed-ui-platform-${tag}.example.test`;
  const origin = (name: string) => `http://${name}:${port}`;
  const screenUrl = `${origin(adminHost)}/admin/ustawienia/kalendarz-zewnetrzny/`;
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  let ownedSuperadmin: string | null = null;
  const asCookie = (value: string, host: string) => { const [name, ...rest] = value.split("="); return { name, value: rest.join("="), url: origin(host) }; };
  const address = page.getByLabel("Adres kalendarza (iCal)");
  try {
    await db.organization.create({ data: { id: org, slug: `feed-ui-${tag}`, name: `Firma Feed ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" }] });
    await db.user.create({ data: { id: adminId, name: "Admin Feed", email: `feed-ui-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: org, emailVerified: true, twoFactorEnabled: true } });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Feed UI operator", role: "SUPERADMIN_AUTERVA",
        email: `feed-ui-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    await resetPlatformApiBudget(db, superId);
    sessions.push(await verifiedFixtureSession(db, superId), await verifiedFixtureSession(db, adminId));
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: origin(adminHost) });
    await context.addCookies([asCookie(sessions[1].cookie, adminHost)]);

    // Settings navigation leads to the screen; empty state explains what the feed shows and how often it refreshes.
    await page.goto(`${origin(adminHost)}/admin/ustawienia/`);
    await page.getByRole("link", { name: "Kalendarz zewnętrzny" }).click();
    await expect(page).toHaveURL(screenUrl);
    await expect(page.getByRole("link", { name: "Kalendarz zewnętrzny" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Nie ma jeszcze adresów kalendarza.")).toBeVisible();
    await expect(page.getByText(/Kalendarz Google odświeża subskrypcję co kilka godzin, Apple co 5–60 minut/)).toBeVisible();

    await expect(page.getByText("Adres działa 365 dni")).toBeVisible();
    // Create with the keyboard: the address appears once, copies and disappears after "Gotowe".
    await page.getByRole("button", { name: "Utwórz pierwszy adres" }).click();
    await expect(page.getByLabel(/Etykieta/)).toBeFocused();
    await page.keyboard.type("Kalendarz zespołu");
    await page.keyboard.press("Enter");
    await expect(page.getByText("Adres „Kalendarz zespołu” został utworzony")).toBeVisible();
    const first = await address.inputValue();
    expect(first).toMatch(new RegExp(`^http://${adminHost}:${port}/api/calendar/feed/[A-Za-z0-9_-]{43}\\.ics$`));
    expect(await feedStatus(page, first)).toBe(200);
    await page.getByRole("button", { name: "Kopiuj adres" }).click();
    await expect(page.getByText("Skopiowano do schowka")).toBeVisible();
    // The fixture host is plain http (no secure context): the copy goes through the selection fallback there.
    if (await page.evaluate(() => window.isSecureContext)) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(first);
    await page.getByRole("button", { name: "Gotowe" }).click();
    await expect(page.getByText("Aktywne adresy: 1 z 5")).toBeVisible();
    const token = first.split("/").pop()!.replace(".ics", "");
    expect(await page.content()).not.toContain(token);
    expect(page.url()).not.toContain(token);
    expect(await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }))).not.toContain(token);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Kalendarz zespołu" })).toBeVisible();
    expect(await page.content()).not.toContain(token);

    // Rotation: confirm, the new address replaces the old one at once.
    await page.getByRole("button", { name: "Obróć adres Kalendarz zespołu" }).click();
    await expect(page.getByRole("dialog", { name: "Obrócić adres „Kalendarz zespołu”?" })).toBeVisible();
    await page.getByRole("button", { name: "Obróć adres" }).click();
    await expect(page.getByText("Adres „Kalendarz zespołu” został obrócony")).toBeVisible();
    const second = await address.inputValue();
    expect(second).not.toBe(first);
    expect(await feedStatus(page, first)).toBe(404);
    expect(await feedStatus(page, second)).toBe(200);
    await page.getByRole("button", { name: "Zamknij" }).click();
    await expect(page.getByText("Odwołano").first()).toBeVisible();
    await expect(page.getByText(/zastąpiony nowym adresem/)).toBeVisible();

    // Uncertain create: the server commits, the answer is lost; no success, no address, rotation offered.
    let dropped = false;
    await page.route("**/api/admin/calendar-feeds/", async (route) => {
      const request = route.request();
      if (request.method() !== "POST" || dropped) return route.continue();
      dropped = true;
      await route.fetch({ url: `http://127.0.0.1:${port}${new URL(request.url()).pathname}`, headers: { ...request.headers(), host: `${adminHost}:${port}` } });
      await route.abort("failed");
    });
    await page.getByRole("button", { name: "Nowy adres kalendarza" }).click();
    await page.getByLabel(/Etykieta/).fill("Telefon Anny");
    await page.getByRole("button", { name: "Utwórz adres" }).click();
    await expect(page.getByText("Adres „Telefon Anny” powstał, ale nie dotarł do przeglądarki.")).toBeVisible();
    await expect(address).toHaveCount(0);
    await expect(page.getByText(/został utworzony/)).toHaveCount(0);
    expect(await db.calendarFeedToken.count({ where: { organizationId: org, label: "Telefon Anny" } })).toBe(1);
    await page.getByRole("button", { name: "Obróć adres", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Obróć adres" }).click();
    await expect(page.getByText("Adres „Telefon Anny” został obrócony")).toBeVisible();
    const recovered = await address.inputValue();
    expect(await feedStatus(page, recovered)).toBe(200);
    await page.getByRole("button", { name: "Zamknij" }).click();

    // Revoke: the dialog starts on "Anuluj"; after confirming the address stops working.
    await page.getByRole("button", { name: "Odwołaj adres Telefon Anny" }).click();
    await expect(page.getByRole("button", { name: "Anuluj" })).toBeFocused();
    await page.getByRole("button", { name: "Odwołaj adres", exact: true }).click();
    await expect(page.getByText("Odwołano adres „Telefon Anny”.")).toBeVisible();
    expect(await feedStatus(page, recovered)).toBe(404);

    // Limit: five active addresses disable creation with a visible reason.
    const now = new Date();
    await db.calendarFeedToken.createMany({ data: [1, 2, 3, 4].map((n) => ({ organizationId: org, createdByUserId: adminId,
      label: `Zapas ${n}`, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), createdAt: now,
      expiresAt: new Date(now.getTime() + (n === 1 ? 11 : 365) * 86_400_000) })) });
    await page.reload();
    await expect(page.getByText("Aktywne adresy: 5 z 5")).toBeVisible();
    await expect(page.getByRole("button", { name: "Nowy adres (limit 5)" })).toBeDisabled();
    await expect(page.getByText("Adres „Zapas 1” wygasa za 11 dni")).toBeVisible();
    await expect(page.getByText(/Wygasłe i odwołane adresy nie wliczają się do limitu/)).toBeVisible();

    // No horizontal scroll from 320 to 1920 px.
    for (const width of [320, 390, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.reload();
      await expect(page.getByText("Aktywne adresy: 5 z 5")).toBeVisible();
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      expect(overflow.scroll, `szerokość ${width}px`).toBeLessThanOrEqual(overflow.view);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // Superadmin in the company context: list and revoke only.
    await context.clearCookies();
    await context.addCookies([asCookie(sessions[0].cookie, platformHost)]);
    await page.goto(`${origin(platformHost)}/firmy/${org}/ustawienia/kalendarz-zewnetrzny/`);
    await expect(page.getByText(`Jesteś w kontekście firmy Firma Feed ${tag} jako superadmin`)).toBeVisible();
    await expect(page.getByRole("button", { name: /Nowy adres/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Obróć/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Odwołaj adres Zapas 2" }).click();
    await page.getByRole("button", { name: "Odwołaj adres", exact: true }).click();
    await expect(page.getByText("Odwołano adres „Zapas 2”.")).toBeVisible();
    await expect(page.getByText("Aktywne adresy: 4 z 5")).toBeVisible();
  } finally {
    for (const session of sessions) await session.dispose();
    await db.calendarFeedToken.deleteMany({ where: { organizationId: org } });
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: { in: [adminId, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [adminHost, platformHost] } } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});

// #367 (ADM-22 create, E11, D-47): "Wybrane pojazdy (opublikowane)" — keyboard choice, only published vehicles offered,
// a vehicle unpublished meanwhile is refused with a message at the field, the feed covers only the selection, and the
// list (and a rotation) keeps the scope.
test("calendar feeds UI: scope of selected published vehicles", async ({ page, context, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const tag = randomUUID().slice(0, 8);
  const org = randomUUID();
  const adminId = randomUUID();
  const adminHost = `feed-scope-${tag}.example.test`;
  const origin = `http://${adminHost}:${port}`;
  const ids = { alfa: randomUUID(), beta: randomUUID(), gamma: randomUUID(), draft: randomUUID() };
  const names = { alfa: `Alfa ${tag}`, beta: `Beta ${tag}`, gamma: `Gamma ${tag}`, draft: `Szkic ${tag}` };
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  const today = availabilityToday(new Date());
  const address = page.getByLabel("Adres kalendarza (iCal)");
  try {
    await db.organization.create({ data: { id: org, slug: `feed-scope-${tag}`, name: `Firma Zakres ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" } });
    await db.user.create({ data: { id: adminId, name: "Admin Zakres", email: `feed-scope-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: org, emailVerified: true, twoFactorEnabled: true } });
    const keys = ["alfa", "beta", "gamma", "draft"] as const;
    await db.vehicle.createMany({ data: keys.map((key, index) => ({ id: ids[key], organizationId: org, slug: `${key}-${tag}`,
      name: names[key], status: key === "draft" ? "DRAFT" : "PUBLISHED", sortOrder: index + 1,
      availableFrom: sqlDate(addLocalDays(today, -5)), availableTo: sqlDate(addLocalDays(today, 30)) })) });
    await db.availabilityBlock.createMany({ data: keys.map((key, index) => ({ organizationId: org, vehicleId: ids[key],
      from: sqlDate(addLocalDays(today, index + 2)), to: sqlDate(addLocalDays(today, index + 2)), type: "BLOCKED" as const })) });
    sessions.push(await verifiedFixtureSession(db, adminId));
    const [name, ...rest] = sessions[0].cookie.split("=");
    await context.addCookies([{ name, value: rest.join("="), url: origin }]);

    await page.goto(`${origin}/admin/ustawienia/kalendarz-zewnetrzny/`);
    await page.getByRole("button", { name: "Utwórz pierwszy adres" }).click();
    await expect(page.getByLabel(/Etykieta/)).toBeFocused();
    await page.keyboard.type("Wybrane auta");
    // Keyboard: the scope is a radio group; the arrow key moves from the default "Cała flota" to the selection.
    const fleet = page.getByRole("radio", { name: /Cała flota/ });
    await expect(fleet).toBeChecked();
    await page.keyboard.press("Tab");
    await expect(fleet).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("radio", { name: /Wybrane pojazdy \(opublikowane\)/ })).toBeChecked();
    const vehicles = page.getByRole("group", { name: "Pojazdy opublikowane" });
    await expect(vehicles.getByRole("checkbox", { name: names.alfa })).toBeVisible();
    await expect(vehicles.getByRole("checkbox")).toHaveCount(3);
    await expect(vehicles.getByRole("checkbox", { name: names.draft })).toHaveCount(0);

    // Nothing selected: the message is at the field and in the summary, the focus goes to the selection, nothing is sent.
    await page.getByRole("button", { name: "Utwórz adres" }).click();
    await expect(page.getByText("Do poprawy: 1")).toBeVisible();
    await expect(vehicles).toBeFocused();
    expect(await db.calendarFeedToken.count({ where: { organizationId: org } })).toBe(0);

    // Gamma is unpublished after it was offered: the server refuses it, the list is read again without it.
    await page.keyboard.press("Tab");
    await expect(vehicles.getByRole("checkbox", { name: names.alfa })).toBeFocused();
    await page.keyboard.press("Space");
    await vehicles.getByRole("checkbox", { name: names.gamma }).check();
    await db.vehicle.update({ where: { organizationId_id: { organizationId: org, id: ids.gamma } }, data: { status: "UNPUBLISHED" } });
    await page.getByRole("button", { name: "Utwórz adres" }).click();
    await expect(page.locator("#feed-vehicles-error")).toContainText("nie jest już opublikowany");
    await expect(vehicles).toBeFocused();
    await expect(vehicles.getByRole("checkbox", { name: names.gamma })).toHaveCount(0);
    await expect(vehicles.getByRole("checkbox", { name: names.alfa })).toBeChecked();
    await expect(address).toHaveCount(0);
    expect(await db.calendarFeedToken.count({ where: { organizationId: org } })).toBe(0);

    // No horizontal scroll with the selection open.
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
      expect(overflow.scroll, `szerokość ${width}px`).toBeLessThanOrEqual(overflow.view);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.getByRole("button", { name: "Utwórz adres" }).click();
    await expect(page.getByText("Adres „Wybrane auta” został utworzony")).toBeVisible();
    const url = await address.inputValue();
    const body = await page.evaluate(async (target) => (await fetch(target, { cache: "no-store" })).text(), url);
    expect(body).toContain(`Niedostępny: ${names.alfa}`);
    for (const other of [names.beta, names.gamma, names.draft]) expect(body).not.toContain(other);
    await page.getByRole("button", { name: "Zamknij" }).click();

    // The list shows the scope with the names behind a disclosure; a rotation keeps it.
    await expect(page.getByText("Zakres: 1 pojazd")).toBeVisible();
    await page.getByText("Pojazdy w zakresie (1 pojazd)").click();
    await expect(page.getByRole("listitem").filter({ hasText: names.alfa }).last()).toBeVisible();
    await page.getByRole("button", { name: "Obróć adres Wybrane auta" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Obróć adres" }).click();
    const rotated = await address.inputValue();
    const rotatedBody = await page.evaluate(async (target) => (await fetch(target, { cache: "no-store" })).text(), rotated);
    expect(rotatedBody).toContain(`Niedostępny: ${names.alfa}`);
    expect(rotatedBody).not.toContain(names.beta);
    await page.getByRole("button", { name: "Zamknij" }).click();
    await expect(page.getByText("Zakres: 1 pojazd")).toHaveCount(2);
  } finally {
    for (const session of sessions) await session.dispose();
    await db.calendarFeedToken.deleteMany({ where: { organizationId: org } });
    await db.availabilityBlock.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { id: adminId } });
    await db.hostMapping.deleteMany({ where: { hostname: adminHost } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
