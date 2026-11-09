import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #14: panel 404 (ADM-20) for an authorized session, neutral 404 for anyone else, and the way out of a limited
// (password-only, MFA not enrolled) session. Fixture hosts resolve to loopback.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

test("nieznana ścieżka panelu: shell z powrotem do startu dla autoryzowanej sesji, neutralne 404 dla pozostałych; sesja bez TOTP idzie do MFA", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const tag = randomUUID().slice(0, 8);
  const org = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
  const user = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
  const host = { a: `panel-a-${tag}.example.test`, b: `panel-b-${tag}.example.test`, c: `panel-c-${tag}.example.test` };
  const origin = (name: string) => `http://${name}:${port}`;
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  const limitedIds: string[] = [];
  try {
    for (const key of ["a", "b", "c"] as const) {
      await db.organization.create({ data: { id: org[key], slug: `panel-${key}-${tag}`, name: `Firma ${key.toUpperCase()} ${tag}`, firstAdminRegisteredAt: new Date() } });
      await db.user.create({ data: { id: user[key], name: `Panel ${key}`, email: `panel-${key}-${tag}@example.test`, role: "ADMIN_FIRMY",
        organizationId: org[key], emailVerified: true, twoFactorEnabled: key !== "c" } });
      await db.hostMapping.create({ data: { hostname: host[key], area: "COMPANY_ADMIN", organizationId: org[key], status: "ACTIVE" } });
    }
    sessions.push(await verifiedFixtureSession(db, user.a), await verifiedFixtureSession(db, user.b));
    const token = randomBytes(32).toString("base64url");
    const row = await db.session.create({ data: { id: randomUUID(), userId: user.c, token, expiresAt: new Date(Date.now() + 3_600_000) } });
    limitedIds.push(row.id);
    const limited = `${token}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(token).digest("base64")}`;
    const asCookie = (value: string) => { const [name, ...rest] = value.split("="); return { name, value: rest.join("="), url: origin(host.a) }; };

    // Authorized session: the panel 404 inside the shell, a real 404 status, a link back to the start.
    await context.addCookies([{ ...asCookie(sessions[0].cookie), url: origin(host.a) }]);
    const response = await page.goto(`${origin(host.a)}/admin/nieznana-sciezka`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("navigation", { name: "Nawigacja panelu" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nie znaleziono strony" })).toBeVisible();
    await page.getByRole("link", { name: "Przejdź do panelu" }).click();
    await expect(page).toHaveURL(`${origin(host.a)}/admin/`);
    await expect(page.getByRole("navigation", { name: "Nawigacja panelu" })).toBeVisible();

    // The same path for a foreign company's session and with no session: no panel content, no company data.
    for (const [label, cookies] of [["foreign session", [{ ...asCookie(sessions[1].cookie), url: origin(host.a) }]], ["anonymous", []]] as const) {
      await context.clearCookies();
      if (cookies.length) await context.addCookies([...cookies]);
      const denied = await page.goto(`${origin(host.a)}/admin/nieznana-sciezka`);
      expect(denied?.status(), label).toBe(404);
      const html = await page.content();
      expect(html, label).not.toContain("Nawigacja panelu");
      expect(html, label).not.toContain(`Firma A ${tag}`);
      expect(html, label).not.toContain(`Firma B ${tag}`);
    }

    // A limited session of the right host goes on to MFA enrolment instead of a dead 404.
    await context.clearCookies();
    await context.addCookies([{ ...asCookie(`better-auth.session_token=${limited}`), url: origin(host.c) }]);
    await page.goto(`${origin(host.c)}/admin/`);
    await expect(page).toHaveURL(new RegExp(`^${origin(host.c)}/admin/mfa/?\\?returnTo=%2Fadmin`));
    await expect(page.getByRole("navigation", { name: "Nawigacja panelu" })).toHaveCount(0);
    // The same limited session on another company's host stays a neutral 404.
    await context.clearCookies();
    await context.addCookies([{ ...asCookie(`better-auth.session_token=${limited}`), url: origin(host.a) }]);
    expect((await page.goto(`${origin(host.a)}/admin/`))?.status()).toBe(404);
  } finally {
    for (const session of sessions) await session.dispose();
    await db.session.deleteMany({ where: { id: { in: limitedIds } } });
    await db.user.deleteMany({ where: { id: { in: Object.values(user) } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: Object.values(org) } } });
    await db.organization.deleteMany({ where: { id: { in: Object.values(org) } } });
    await db.$disconnect();
  }
});

// 320 px with a very long company name: the topbar truncates the title (ellipsis) and the page does not scroll sideways.
test("panel firmy 320 i 390 px: długa nazwa firmy bez poziomego przewijania i bez nakładania okruszka", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const userId = randomUUID();
  const hostname = `panel-320-${tag}.example.test`;
  const origin = `http://${hostname}:${new URL(baseURL).port}`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
  try {
    await db.organization.create({ data: { id: orgId, slug: `panel-320-${tag}`, firstAdminRegisteredAt: new Date(),
      name: `Wypożyczalnia Samochodów Kempingowych i Przyczep Rekreacyjnych Bardzo Długa Nazwa ${tag}` } });
    await db.user.create({ data: { id: userId, name: "Panel 320", email: `panel-320-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: orgId, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId: orgId, status: "ACTIVE" } });
    session = await verifiedFixtureSession(db, userId);
    const [name, ...value] = session.cookie.split("=");
    await context.addCookies([{ name, value: value.join("="), url: origin }]);
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/admin/", "/admin/pojazdy/"]) {
        const at = `${width}px ${path}`;
        await page.goto(`${origin}${path}`);
        await expect(page.getByRole("button", { name: "Menu użytkownika" })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth), at).toBeLessThanOrEqual(width);
        // On mobile the "Panel" breadcrumb root is hidden, so it cannot overlap the truncated title.
        const root = page.locator("nav[aria-label='Okruszki'] li").first();
        await expect(root, at).toBeHidden();
        const title = await page.locator("nav[aria-label='Okruszki'] h1").boundingBox();
        const trigger = await page.getByRole("button", { name: "Menu użytkownika" }).boundingBox();
        expect(title!.x + title!.width, at).toBeLessThanOrEqual(trigger!.x);
        expect(trigger!.x + trigger!.width, at).toBeLessThanOrEqual(width);
      }
    }
  } finally {
    if (session) await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.hostMapping.deleteMany({ where: { organizationId: orgId } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.$disconnect();
  }
});

// #234: the panel's dialogs (user menu, "Więcej") must not trip the nonce CSP: no inline <style> without a nonce.
test("panel firmy: otwarte menu użytkownika i Więcej nie powodują naruszeń CSP", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const orgId = randomUUID();
  const userId = randomUUID();
  const hostname = `panel-csp-${tag}.example.test`;
  const origin = `http://${hostname}:${new URL(baseURL).port}`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
  try {
    await db.organization.create({ data: { id: orgId, slug: `panel-csp-${tag}`, name: `Firma CSP ${tag}`, firstAdminRegisteredAt: new Date() } });
    await db.user.create({ data: { id: userId, name: "Panel CSP", email: `panel-csp-${tag}@example.test`, role: "ADMIN_FIRMY",
      organizationId: orgId, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId: orgId, status: "ACTIVE" } });
    session = await verifiedFixtureSession(db, userId);
    const [name, ...value] = session.cookie.split("=");
    await context.addCookies([{ name, value: value.join("="), url: origin }]);
    const violations: string[] = [];
    await page.addInitScript(() => {
      (window as unknown as { __csp: string[] }).__csp = [];
      document.addEventListener("securitypolicyviolation", (event) => {
        (window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });
    page.on("console", (message) => { if (/content security policy/i.test(message.text())) violations.push(message.text().slice(0, 200)); });

    for (const [width, trigger] of [[1440, "Menu użytkownika"], [390, "Więcej"]] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/admin/`);
      await page.getByRole("button", { name: trigger }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const inPage = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
      expect(inPage, `${trigger} securitypolicyviolation`).toEqual([]);
    }

    // A server refresh renders the root layout again with a NEW request nonce (Proxy makes one per request). The
    // scroll-lock style of a dialog opened afterwards must still carry the nonce of the document's CSP.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${origin}/admin/`);
    const documentNonce = await page.evaluate(() => document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "");
    expect(documentNonce).not.toBe("");
    const refreshed = page.waitForResponse((response) => response.url().includes("_rsc=") && response.status() === 200);
    await page.evaluate(() => (window as unknown as { next: { router: { refresh: () => void } } }).next.router.refresh());
    const rsc = await refreshed;
    expect(rsc.headers()["content-security-policy"] ?? "", "the refresh response carries another nonce").not.toContain(`'nonce-${documentNonce}'`);
    await page.getByRole("button", { name: "Menu użytkownika" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
    expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp), "after router.refresh()").toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(violations).toEqual([]);
  } finally {
    if (session) await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.hostMapping.deleteMany({ where: { organizationId: orgId } });
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.$disconnect();
  }
});
