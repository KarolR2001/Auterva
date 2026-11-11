import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
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

    // Create with the keyboard: the address appears once, copies and disappears after "Gotowe".
    await page.getByRole("button", { name: "Nowy adres kalendarza" }).click();
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
