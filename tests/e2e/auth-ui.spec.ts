import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import jsQR from "jsqr";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledFixtureAccess } from "../fixtures/verified-session";

// Real browser against the built app behind the local ingress. Fixture hosts resolve to loopback.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

type Db = ReturnType<typeof createPrismaClient>;

async function clearLocalIpEvents(db: Db) {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: ["127.0.0.1", "::1"].map((address) =>
    createHmac("sha256", secret).update(`auth:ip:${address}`).digest("hex")) } } });
}

/** Decodes the QR exactly as Chromium renders the SVG, with computed token colors. */
async function decodeRenderedQr(page: Page) {
  const qr = page.getByRole("img", { name: "Kod QR do konfiguracji MFA" });
  await expect(qr).toBeVisible();
  const raster = await qr.evaluate(async (svg) => {
    const fills = ["rect", "path"].map((tag) => getComputedStyle(svg.querySelector(tag)!).fill);
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelector("rect")!.setAttribute("fill", fills[0]);
    clone.querySelector("path")!.setAttribute("fill", fills[1]);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const size = 384;
    const image = new Image(size, size);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clone.outerHTML)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, size, size);
    return { fills, size, data: Array.from(context.getImageData(0, 0, size, size).data) };
  });
  expect(raster.fills).toEqual(["rgb(242, 242, 242)", "rgb(21, 21, 21)"]);
  const decoded = jsQR(new Uint8ClampedArray(raster.data), raster.size, raster.size, { inversionAttempts: "dontInvert" });
  if (!decoded) throw new Error("Rendered QR is not decodable");
  const totp = OTPAuth.URI.parse(decoded.data);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Rendered QR is not a TOTP URI");
  await expect(page.locator("code").first()).toHaveText(totp.secret.base32.replace(/(.{4})(?=.)/g, "$1 "));
  return totp;
}

/** Same-origin request from the page, so the browser's host mapping and cookies apply. */
function statusOf(page: Page, path: string) {
  return page.evaluate(async (target) => (await fetch(target, { cache: "no-store", redirect: "manual" })).status, path);
}

/** Optional reference renders for the Penpot comparison (AUTH_UI_SCREENSHOTS=<dir>), at 390 and 1440 px. */
async function snap(page: Page, name: string) {
  const dir = process.env.AUTH_UI_SCREENSHOTS;
  if (!dir) return;
  const viewport = page.viewportSize();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true, animations: "disabled" });
  }
  if (viewport) await page.setViewportSize(viewport);
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function signIn(page: Page, origin: string, email: string, password: string, emailLabel: string) {
  await page.goto(`${origin}/admin/login`);
  await page.getByRole("textbox", { name: emailLabel }).fill(email);
  await page.getByLabel("Hasło", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
}

test("company admin: login, enrollment with rendered QR, challenge, lost response, recovery code and archive", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  await page.setViewportSize({ width: 390, height: 844 });
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  await clearLocalIpEvents(db);
  const port = new URL(baseURL).port;
  const company = randomUUID();
  const adminHost = `auth-ui-${company}.example.test`;
  const origin = `http://${adminHost}:${port}`;
  const email = `auth-ui-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  await db.organization.create({ data: { id: company, slug: `auth-ui-${company}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  try {
    const registered = await createAuth(db, true, baseURL).api.signUpEmail({ body: { name: "Fixture UI", email, password } });
    await db.user.update({ where: { id: registered.user.id }, data: { organizationId: company, role: "ADMIN_FIRMY", emailVerified: true } });

    // Without a session or pending challenge the MFA screen is not reachable.
    await page.goto(`${origin}/admin/mfa?returnTo=%2Fadmin`);
    await expect(page).toHaveURL(/\/admin\/login\/?\?returnTo=%2Fadmin&session=expired$/);
    await expect(page.getByRole("status").filter({ hasText: "Twoja sesja wygasła. Zaloguj się ponownie." })).toBeVisible();
    await expect(page.getByRole("link", { name: /rejestr/i })).toHaveCount(0);
    await snap(page, "company-login-expired");

    // Keyboard-only sign-in with a wrong password: neutral error, form kept.
    await page.getByRole("textbox", { name: "E-mail" }).focus();
    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Hasło", { exact: true })).toBeFocused();
    await page.keyboard.type("Wrong fixture password 1!");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/Nie udało się zalogować\. Sprawdź dane i spróbuj ponownie\./);
    await expect(page.getByRole("textbox", { name: "E-mail" })).toHaveValue(email);
    await noHorizontalOverflow(page);

    // First sign-in has only a limited session: password → QR → TOTP → one-time codes → panel.
    await page.getByLabel("Hasło", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(page.getByRole("heading", { name: "Włącz dodatkową ochronę" })).toBeVisible();
    expect(await statusOf(page, "/admin/")).toBe(404);
    await page.getByLabel("Potwierdź hasło").fill(password);
    await page.getByRole("button", { name: "Rozpocznij konfigurację" }).click();
    const totp = await decodeRenderedQr(page);
    await noHorizontalOverflow(page);
    await snap(page, "company-setup");
    await page.getByRole("textbox", { name: "Kod MFA" }).fill(totp.generate());
    await page.getByRole("button", { name: "Włącz MFA i pokaż kody" }).click();
    await expect(page.getByRole("heading", { name: "Zapisz kody odzyskania" })).toBeFocused();
    await snap(page, "company-codes");
    const codes = await page.getByRole("listitem").allTextContents();
    expect(codes.length).toBeGreaterThanOrEqual(8);
    await page.getByRole("button", { name: "Zapisałem kody" }).click();
    await expect(page).toHaveURL(`${origin}/admin/`);

    // Challenge: a wrong code keeps the form; a lost response after commit is reconciled by reading the session.
    await page.context().clearCookies();
    await signIn(page, origin, email, password, "E-mail");
    await expect(page.getByRole("heading", { name: "Potwierdź logowanie" })).toBeVisible();
    const code = page.getByRole("textbox", { name: "Kod MFA" });
    await code.fill(String((Number(totp.generate()) + 1) % 1_000_000).padStart(6, "0"));
    await code.press("Enter");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/Kod jest nieprawidłowy lub wygasł/);
    await snap(page, "company-challenge-error");
    // The server commits the challenge and sets the session cookie, but the page never sees the response.
    await page.evaluate(() => {
      const original = window.fetch;
      const counter = window as unknown as { verifyCalls: number };
      counter.verifyCalls = 0;
      window.fetch = async (input, init) => {
        const response = await original(input, init);
        if (String(input).includes("/two-factor/verify-totp/")) {
          counter.verifyCalls += 1;
          throw new TypeError("response lost");
        }
        return response;
      };
    });
    await code.fill(totp.generate());
    await page.getByRole("button", { name: "Potwierdź kod" }).click();
    await expect(page.getByRole("heading", { name: "Sprawdź stan MFA" })).toBeFocused();
    await expect(page.getByText("Nie wiadomo, czy operacja została zakończona.", { exact: false })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Kod MFA" })).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { verifyCalls: number }).verifyCalls)).toBe(1);
    await snap(page, "company-uncertain");
    await page.getByRole("button", { name: "Sprawdź stan" }).click();
    await expect(page).toHaveURL(`${origin}/admin/`);

    // Recovery code: one-time code → password → new TOTP → new list → panel.
    await clearLocalIpEvents(db);
    await page.context().clearCookies();
    await signIn(page, origin, email, password, "E-mail");
    await page.getByRole("button", { name: "Nie mam dostępu do aplikacji" }).click();
    await expect(page.getByRole("heading", { name: "Użyj kodu odzyskania" })).toBeFocused();
    await snap(page, "company-recovery");
    await page.getByRole("textbox", { name: "Kod odzyskania" }).fill(codes[0]);
    await page.getByRole("button", { name: "Potwierdź kod" }).click();
    await expect(page.getByRole("heading", { name: "Potwierdź hasło" })).toBeFocused();
    await snap(page, "company-recovery-password");
    expect(await statusOf(page, "/admin/")).toBe(404);
    await page.getByLabel("Hasło", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Potwierdź hasło" }).click();
    const renewed = await decodeRenderedQr(page);
    expect(renewed.secret.base32).not.toBe(totp.secret.base32);
    await page.getByRole("textbox", { name: "Kod MFA" }).fill(renewed.generate());
    await page.getByRole("button", { name: "Włącz MFA i pokaż kody" }).click();
    const renewedCodes = await page.getByRole("listitem").allTextContents();
    expect(renewedCodes).not.toContain(codes[0]);
    await page.getByRole("button", { name: "Zapisałem kody" }).click();
    await expect(page).toHaveURL(`${origin}/admin/`);

    // The used recovery code is rejected neutrally and the field keeps its value.
    await page.context().clearCookies();
    await signIn(page, origin, email, password, "E-mail");
    await page.getByRole("button", { name: "Nie mam dostępu do aplikacji" }).click();
    await page.getByRole("textbox", { name: "Kod odzyskania" }).fill(codes[1]);
    await page.getByRole("button", { name: "Potwierdź kod" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/Kod jest nieprawidłowy lub został użyty\. Wpisz inny kod\./);
    await expect(page.getByRole("textbox", { name: "Kod odzyskania" })).toHaveValue(codes[1]);
    await snap(page, "company-recovery-error");
    await page.getByRole("button", { name: "Nie mam aplikacji ani kodów" }).click();
    await expect(page.getByRole("heading", { name: "Nie masz dostępu do kodów?" })).toBeFocused();
    await snap(page, "company-manual");

    // Archive blocks sign-in with the same neutral answer; no MFA step is offered.
    await clearLocalIpEvents(db);
    await db.organization.update({ where: { id: company }, data: { archivedAt: new Date() } });
    await page.context().clearCookies();
    await signIn(page, origin, email, password, "E-mail");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(/Nie udało się zalogować\. Sprawdź dane i spróbuj ponownie\./);
    await expect(page).toHaveURL(/\/admin\/login/);
  } finally {
    await clearLocalIpEvents(db);
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: ["read", "write"].map((operation) =>
        createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(`api:${operation}:${user.id}:${company}`).digest("hex")) } } });
      await db.verification.deleteMany({ where: { value: { contains: `"userId":"${user.id}"` } } });
    }
    await db.auditLog.deleteMany({ where: { organizationId: company } });
    await db.user.deleteMany({ where: { email } });
    await db.hostMapping.deleteMany({ where: { hostname: adminHost } });
    await db.organization.delete({ where: { id: company } });
    await db.$disconnect();
  }
});

test("superadmin: desktop login and TOTP challenge on the platform host", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  await page.setViewportSize({ width: 1440, height: 1024 });
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  await clearLocalIpEvents(db);
  const platformHost = `auth-ui-platform-${randomUUID()}.example.test`;
  const origin = `http://${platformHost}:${new URL(baseURL).port}`;
  const started = new Date();
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  let superadminId = "";
  try {
    const superadmin = await ensureControlledFixtureAccess(db);
    superadminId = superadmin.id;
    // Local fixture credentials generated by scripts/seed-local-access.ts; never printed.
    const access = JSON.parse(readFileSync(".local/fixture-9/access.json", "utf8")) as Record<string, { email: string; password: string; totpURI: string }>;
    const account = access[superadmin.id];
    const totp = OTPAuth.URI.parse(account.totpURI);
    if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing fixture TOTP");

    await page.goto(`${origin}/login`);
    await expect(page.getByRole("heading", { name: "Zaloguj się" })).toBeVisible();
    await snap(page, "platform-login");
    await page.getByRole("textbox", { name: "Adres e-mail" }).fill(account.email);
    await page.getByLabel("Hasło", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();
    await expect(page.getByRole("heading", { name: "Potwierdź logowanie" })).toBeVisible();
    await noHorizontalOverflow(page);
    await snap(page, "platform-challenge");
    expect(await statusOf(page, "/")).toBe(404);
    await page.getByRole("textbox", { name: "Kod MFA" }).fill(totp.generate());
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${origin}/`);
    await expect(page.getByRole("heading", { name: "Platforma Auterva" })).toBeVisible();
  } finally {
    await clearLocalIpEvents(db);
    if (superadminId) await db.session.deleteMany({ where: { userId: superadminId, createdAt: { gte: started } } });
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    await db.$disconnect();
  }
});
