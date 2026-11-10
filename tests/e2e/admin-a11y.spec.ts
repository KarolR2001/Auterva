import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { verifiedFixtureSession } from "../fixtures/verified-session";

// #341 (part of #61): accessibility regression of the company panel. Every screen gets an axe scan (WCAG 2.0/2.1/2.2 A and AA
// plus axe best practices, no rule switched off) at the 1440 and 320 px references; serious and critical findings fail the test.
// Structure (one h1, one main, named navigation, no sideways scroll) is asserted separately because axe cannot judge it.
// Real screen reader checks are DEFERRED (#97).
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

async function scan(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const blocking = result.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect.soft(blocking.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")) })), `axe ${label}`).toEqual([]);
  // Moderate and minor findings do not fail the run but must not creep in either.
  expect.soft(result.violations.map((violation) => `${violation.id}:${violation.nodes.length}`), `axe (all impacts) ${label}`).toEqual([]);
}

async function structure(page: Page, label: string, options: { shell: boolean }) {
  await expect.soft(page.locator("h1:visible"), `${label}: exactly one visible h1`).toHaveCount(1);
  await expect.soft(page.locator("main:visible"), `${label}: exactly one main`).toHaveCount(1);
  if (options.shell) await expect.soft(page.getByRole("navigation", { name: /^Nawigacja (panelu|mobilna)$/ }).first(), `${label}: panel navigation`).toBeAttached();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect.soft(overflow, `${label}: no horizontal scroll`).toBeLessThanOrEqual(0);
}

test("panel firmy: skan axe, nagłówek h1, landmarki i reflow 320 px na każdym ekranie", async ({ browser, baseURL }) => {
  test.setTimeout(600_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const [org, admin, limitedAdmin, orgLimited, car, draft, block] = Array.from({ length: 7 }, () => randomUUID());
  const host = `a11y-${tag}.example.test`;
  const limitedHost = `a11y-lim-${tag}.example.test`;
  const origin = `http://${host}:${port}`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const activationOrg = randomUUID();
  const activationHost = `a11y-act-${tag}.example.test`;
  const activationEmail = `a11y-act-${tag}@example.test`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
  try {
    await db.organization.create({ data: { id: org, slug: `a11y-${tag}`, name: `Firma Dostępności ${tag}`, firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.siteSettings.create({ data: { organizationId: org, publicName: "Firma Dostępności", phone: "+48 600 000 111" } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.user.create({ data: { id: admin, name: "A11y admin", role: "ADMIN_FIRMY", organizationId: org, email: `a11y-${admin}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.vehicle.createMany({ data: [
      { id: car, organizationId: org, slug: `a11y-${car}`, name: "Auto Dostępne", brand: "Škoda", model: "Octavia", status: "PUBLISHED", availableFrom: sqlDate(day(-30)) },
      { id: draft, organizationId: org, slug: `a11y-${draft}`, name: "Auto Szkic", status: "DRAFT" },
    ] });
    await db.vehicleImage.createMany({ data: [0, 1].map((index) => ({ organizationId: org, vehicleId: car, storageKey: `fleet/a11y/${car}/${index}.webp`, mime: "image/webp", width: 600, height: 400, bytes: 1000,
      status: "READY", position: index, isCover: index === 0, alt: index === 0 ? "Auto z przodu" : null })) });
    await db.availabilityBlock.create({ data: { id: block, organizationId: org, vehicleId: car, from: sqlDate(day(2)), to: sqlDate(day(4)), type: "MAINTENANCE", reference: "A11Y-REF", internalNote: "A11Y-NOTE", createdById: admin } });
    await db.auditLog.createMany({ data: Array.from({ length: 3 }, (_, index) => ({ eventKey: randomUUID(), organizationId: org, actorId: admin, actorRole: "ADMIN_FIRMY",
      action: "VEHICLE_UPDATED", entityType: "Vehicle", entityId: car, requestId: randomUUID(), createdAt: new Date(now.getTime() - index * 3_600_000) })) });
    session = await verifiedFixtureSession(db, admin);

    // Limited session (password only, MFA not enrolled) of another company for the MFA enrolment screen.
    await db.organization.create({ data: { id: orgLimited, slug: `a11y-l-${tag}`, name: `Firma MFA ${tag}`, firstAdminRegisteredAt: now } });
    await db.hostMapping.create({ data: { hostname: limitedHost, organizationId: orgLimited, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.user.create({ data: { id: limitedAdmin, name: "A11y MFA", role: "ADMIN_FIRMY", organizationId: orgLimited, email: `a11y-mfa-${limitedAdmin}@example.test`, emailVerified: true, twoFactorEnabled: false } });
    const limitedToken = randomBytes(32).toString("base64url");
    await db.session.create({ data: { id: randomUUID(), userId: limitedAdmin, token: limitedToken, expiresAt: new Date(now.getTime() + 3_600_000) } });
    const limitedCookie = `${limitedToken}.${createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(limitedToken).digest("base64")}`;

    // Activation: a pending administrator with a live invitation.
    await db.organization.create({ data: { id: activationOrg, slug: `a11y-a-${tag}`, name: "Alfa Rent A11y" } });
    await db.user.create({ data: { id: randomUUID(), email: activationEmail, name: "Pending", role: "ADMIN_FIRMY", organizationId: activationOrg, emailVerified: false, twoFactorEnabled: false } });
    await db.hostMapping.create({ data: { hostname: activationHost, area: "COMPANY_ADMIN", organizationId: activationOrg, status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId: activationOrg, trialGranted: true } });
    await db.invitation.create({ data: { organizationId: activationOrg, recipientEmail: activationEmail, issuedHost: activationHost,
      tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(), issuedAt: now, expiresAt: new Date(now.getTime() + 168 * 3_600_000) } });

    const [name, value] = session.cookie.split(/=(.*)/s);
    const signedIn = [
      ["dashboard", "/admin/"], ["pojazdy", "/admin/pojazdy/"], ["nowy pojazd", "/admin/pojazdy/nowy/"], ["formularz pojazdu", `/admin/pojazdy/${car}/`],
      ["kalendarz pojazdu", `/admin/pojazdy/${car}/kalendarz/`], ["kalendarz floty", "/admin/kalendarz/"], ["dziennik zmian", "/admin/logi/"], ["czat", "/admin/czat/"],
      ["ustawienia", "/admin/ustawienia/"], ["konto", "/admin/konto/"], ["sesje", "/admin/konto/sesje/"], ["status usługi", "/admin/usluga/"],
      ["404 w shellu", "/admin/nieznana-sciezka/"], ["pojazd nieistniejący", `/admin/pojazdy/${randomUUID()}/`],
    ] as const;
    for (const width of [1440, 320]) {
      const context = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 900 } });
      contexts.push(context);
      await context.addCookies([{ name, value, domain: host, path: "/" }]);
      const page = await context.newPage();
      for (const [label, path] of signedIn) {
        await page.goto(`${origin}${path}`, { waitUntil: "load" });
        await expect(page.locator("main")).toBeVisible();
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await structure(page, `${label} ${width}px`, { shell: true });
        await scan(page, `${label} ${width}px`);
      }
      // Signed out and pre-login screens (their own context without the session).
      const anonymous = await browser.newContext({ viewport: { width, height: width === 320 ? 640 : 900 } });
      contexts.push(anonymous);
      const anon = await anonymous.newPage();
      for (const [label, path, base] of [
        ["logowanie", "/admin/login/", origin], ["reset hasła (formularz)", "/admin/reset-hasla/", origin], ["reset hasła (nieważny link)", "/admin/reset-hasla/nieznany-token/", origin],
        ["aktywacja", `/admin/zaproszenie/${token}/`, `http://${activationHost}:${port}`], ["aktywacja (nieważny link)", "/admin/zaproszenie/nieznany-token/", `http://${activationHost}:${port}`],
      ] as const) {
        await anon.goto(`${base}${path}`, { waitUntil: "load" });
        await anon.waitForLoadState("networkidle").catch(() => undefined);
        await structure(anon, `${label} ${width}px`, { shell: false });
        await scan(anon, `${label} ${width}px`);
      }
      await anon.goto(`${origin}/admin/offline.html`);
      await structure(anon, `offline ${width}px`, { shell: false });
      await scan(anon, `offline ${width}px`);
      // MFA enrolment under a limited session.
      await anonymous.addCookies([{ name: "better-auth.session_token", value: limitedCookie, domain: limitedHost, path: "/" }]);
      await anon.goto(`http://${limitedHost}:${port}/admin/mfa/`, { waitUntil: "load" });
      await anon.waitForLoadState("networkidle").catch(() => undefined);
      await structure(anon, `mfa ${width}px`, { shell: false });
      await scan(anon, `mfa ${width}px`);
    }
  } finally {
    for (const context of contexts) await context.close();
    await session?.dispose();
    await db.session.deleteMany({ where: { userId: limitedAdmin } });
    await db.invitation.deleteMany({ where: { organizationId: activationOrg } });
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.availabilityBlock.deleteMany({ where: { organizationId: org } });
    await db.vehicleImage.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.siteSettings.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [org, activationOrg] } } });
    await db.user.deleteMany({ where: { organizationId: { in: [org, orgLimited, activationOrg] } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: [org, orgLimited, activationOrg] } } });
    await db.organization.deleteMany({ where: { id: { in: [org, orgLimited, activationOrg] } } });
    await db.$disconnect();
  }
});

// Behaviour the scanner cannot judge: focus order and visibility, dialogs (trap and return), the mobile menu, field errors,
// reduced motion and live regions. One company, 390 px like the mobile reference.
test("panel firmy: fokus, dialogi, menu Więcej, błędy pól, reduced motion i live regions", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const tag = randomUUID().slice(0, 8);
  const [org, admin, car, car2] = Array.from({ length: 4 }, () => randomUUID());
  const host = `a11y-kb-${tag}.example.test`;
  const origin = `http://${host}:${port}`;
  const now = new Date();
  const day = (offset: number) => new Date(sqlDate(availabilityToday()).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const anonymous = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    await db.organization.create({ data: { id: org, slug: `a11y-kb-${tag}`, name: `Firma Klawiatury ${tag}`, firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: org, trialGranted: true, trialStartedAt: now, trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    await db.hostMapping.create({ data: { hostname: host, organizationId: org, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.user.create({ data: { id: admin, name: "A11y kb", role: "ADMIN_FIRMY", organizationId: org, email: `a11y-kb-${admin}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.vehicle.createMany({ data: [
      { id: car, organizationId: org, slug: `kb-${car}`, name: "Auto Pierwsze", status: "PUBLISHED", availableFrom: sqlDate(day(-30)), sortOrder: 0 },
      { id: car2, organizationId: org, slug: `kb-${car2}`, name: "Auto Drugie", status: "DRAFT", sortOrder: 1 },
    ] });
    session = await verifiedFixtureSession(db, admin);
    const [name, value] = session.cookie.split(/=(.*)/s);
    await context.addCookies([{ name, value, domain: host, path: "/" }]);
    const page = await context.newPage();
    const inside = (selector: string) => page.evaluate((query) => Boolean(document.activeElement?.closest(query)), selector);

    // 1. Menu "Więcej": opens from the keyboard, traps Tab inside, Escape returns focus to the trigger.
    await page.goto(`${origin}/admin/`);
    const more = page.getByRole("button", { name: "Więcej" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: /Więcej/ })).toBeVisible();
    for (let step = 0; step < 10; step += 1) { await page.keyboard.press("Tab"); expect(await inside('[role="dialog"]'), `menu Tab ${step}`).toBe(true); }
    await page.keyboard.press("Shift+Tab");
    expect(await inside('[role="dialog"]')).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(more).toBeFocused();

    // 2. Calendar dialog: trap, Escape, focus back on the button that opened it.
    await page.goto(`${origin}/admin/pojazdy/${car}/kalendarz/`);
    const add = page.getByRole("button", { name: "Dodaj okres niedostępności" }).last();
    await add.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await inside('[role="dialog"]'), "focus moved into the dialog").toBe(true);
    for (let step = 0; step < 14; step += 1) { await page.keyboard.press("Tab"); expect(await inside('[role="dialog"]'), `dialog Tab ${step}`).toBe(true); }
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(add).toBeFocused();

    // 3. Unsaved form: leaving through a link asks first, "Zostań" returns focus to the link that was activated.
    await page.goto(`${origin}/admin/pojazdy/${car}/`);
    await page.getByLabel(/^Nazwa/).first().fill("Auto Pierwsze zmienione");
    const dashboard = page.getByRole("navigation", { name: "Nawigacja mobilna" }).getByRole("link", { name: "Start" });
    await dashboard.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alertdialog")).toBeVisible();
    expect(await inside('[role="alertdialog"]')).toBe(true);
    for (let step = 0; step < 8; step += 1) { await page.keyboard.press("Tab"); expect(await inside('[role="alertdialog"]'), `leave dialog Tab ${step}`).toBe(true); }
    await page.getByRole("button", { name: /Zostań/ }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(dashboard).toBeFocused();

    // 4. Focus is visible and not hidden behind fixed bars on every stop of the main screens.
    for (const path of ["/admin/", "/admin/pojazdy/", "/admin/kalendarz/", "/admin/czat/", "/admin/ustawienia/", "/admin/konto/", "/admin/logi/", "/admin/usluga/"]) {
      await page.goto(`${origin}${path}`);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const problems: string[] = [];
      for (let step = 0; step < 45; step += 1) {
        await page.keyboard.press("Tab");
        const state = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null;
          if (!element || element === document.body) return null;
          const style = getComputedStyle(element);
          const ring = (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
          const box = element.getBoundingClientRect();
          const hit = document.elementFromPoint(Math.min(Math.max(box.left + box.width / 2, 0), innerWidth - 1), Math.min(Math.max(box.top + box.height / 2, 0), innerHeight - 1));
          const covered = Boolean(hit) && !element.contains(hit) && !hit!.contains(element);
          return { label: `${element.tagName.toLowerCase()} ${(element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 30)}`, ring, covered, hit: hit?.tagName ?? "" };
        });
        if (!state) break;
        if (!state.ring) problems.push(`no focus ring: ${state.label}`);
        if (state.covered) problems.push(`covered by ${state.hit}: ${state.label}`);
      }
      expect.soft(problems, `focus ${path}`).toEqual([]);
    }

    // 5. Field errors: the login form announces them through aria-describedby, the summary takes focus, nothing is announced on load.
    const anon = await anonymous.newPage();
    await anon.goto(`${origin}/admin/login/`);
    await expect(anon.locator('[role="alert"]:not(:empty), [aria-live="assertive"]:not(:empty)')).toHaveCount(0);
    await anon.getByRole("button", { name: /Zaloguj/ }).click();
    const invalid = anon.locator('input[aria-invalid="true"]');
    await expect(invalid.first()).toBeVisible();
    for (const input of await invalid.all()) {
      const described = await input.evaluate((element) => (element.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent?.trim() ?? "").filter(Boolean));
      expect(described.length, "invalid field has a described error").toBeGreaterThan(0);
      expect(await input.evaluate((element) => document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() ?? "")).not.toBe("");
    }
    expect(await anon.evaluate(() => Boolean(document.activeElement?.closest("form")))).toBe(true);

    // 6. Reduced motion: nothing keeps animating and no transition runs on controls.
    const calm = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    try {
      await calm.addCookies([{ name, value, domain: host, path: "/" }]);
      const calmPage = await calm.newPage();
      for (const path of ["/admin/", "/admin/pojazdy/", `/admin/pojazdy/${car}/`, "/admin/czat/"]) {
        await calmPage.goto(`${origin}${path}`);
        await calmPage.waitForLoadState("networkidle").catch(() => undefined);
        const moving = await calmPage.evaluate(() => {
          const running = document.getAnimations().filter((animation) => animation.playState === "running").map((animation) => animation.id || (animation as CSSAnimation).animationName || "animation");
          const transitions = [...document.querySelectorAll("a, button, input, select, textarea")].filter((element) => {
            const duration = getComputedStyle(element).transitionDuration.split(",").map((part) => parseFloat(part) * (part.trim().endsWith("ms") ? 0.001 : 1));
            return duration.some((seconds) => seconds > 0);
          }).map((element) => element.tagName.toLowerCase()).slice(0, 5);
          return { running, transitions, smooth: getComputedStyle(document.documentElement).scrollBehavior };
        });
        expect.soft(moving, `reduced motion ${path}`).toEqual({ running: [], transitions: [], smooth: "auto" });
      }
    } finally { await calm.close(); }

    // 7. Text spacing (WCAG 1.4.12, DS-N21): the larger spacing must not push content out sideways or hide it at 320 px.
    const narrow = await browser.newContext({ viewport: { width: 320, height: 640 } });
    try {
      await narrow.addCookies([{ name, value, domain: host, path: "/" }]);
      const narrowPage = await narrow.newPage();
      for (const path of ["/admin/", "/admin/pojazdy/", `/admin/pojazdy/${car}/`, `/admin/pojazdy/${car}/kalendarz/`, "/admin/kalendarz/", "/admin/czat/", "/admin/ustawienia/", "/admin/konto/", "/admin/logi/", "/admin/usluga/"]) {
        await narrowPage.goto(`${origin}${path}`);
        await narrowPage.waitForLoadState("networkidle").catch(() => undefined);
        // The page CSP forbids inline <style>: the spacing is applied through the CSSOM instead.
        await narrowPage.evaluate(() => {
          const sheet = new CSSStyleSheet();
          sheet.replaceSync("* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }");
          document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
        });
        const clipped = await narrowPage.evaluate(() => ({
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          // Text that is cut off inside its own box (hidden overflow with a smaller client box) for controls and headings.
          cut: [...document.querySelectorAll("button, a, h1, h2, h3, label, th")].filter((element) => {
            if (element.matches('a[href^="#"]')) return false; // the skip link is visually hidden until it gets focus
            const style = getComputedStyle(element);
            return style.overflow === "hidden" && style.textOverflow !== "ellipsis" && element.scrollHeight > element.clientHeight + 1 && element.clientHeight > 4; // boxes of 1 px are visually hidden text
          }).map((element) => `${element.tagName.toLowerCase()} ${element.textContent?.trim().slice(0, 30)}`).slice(0, 5),
        }));
        expect.soft(clipped, `text spacing ${path}`).toEqual({ sideways: 0, cut: [] });
      }
    } finally { await narrow.close(); }
  } finally {
    await anonymous.close();
    await context.close().catch(() => undefined);
    await session?.dispose();
    await db.vehicle.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.user.deleteMany({ where: { organizationId: org } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
