import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledFixtureAccess, verifiedFixtureSession } from "../fixtures/verified-session";

// Reset, account, password change and logout against the built app behind the local ingress.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

type Db = ReturnType<typeof createPrismaClient>;

async function clearLocalIpEvents(db: Db) {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: ["127.0.0.1", "::1"].map((address) =>
    createHmac("sha256", secret).update(`auth:ip:${address}`).digest("hex")) } } });
}

/** URL match tolerant of the trailingSlash redirect (path with or without "/"). */
function urlAt(origin: string, path: string, query = "") {
  const esc = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${esc(origin)}${esc(path)}/?${esc(query)}$`);
}

/** The page must not scroll sideways at any supported width; the original viewport is restored. */
async function noHorizontalOverflow(page: Page) {
  const original = page.viewportSize();
  try {
    for (const width of [320, 390, 768, 1024, 1920]) {
      await page.setViewportSize({ width, height: original?.height ?? 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        `horizontal overflow at ${width}px`,
      ).toBe(true);
    }
  } finally {
    if (original) await page.setViewportSize(original);
  }
}

/** Optional reference renders for the Penpot comparison (ACCOUNT_UI_SCREENSHOTS=<dir>) at 390 and 1440 px. */
async function snap(page: Page, name: string) {
  const dir = process.env.ACCOUNT_UI_SCREENSHOTS;
  if (!dir) return;
  const viewport = page.viewportSize();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.screenshot({ path: `${dir}/${name}-${width}.png`, fullPage: true, animations: "disabled" });
  }
  if (viewport) await page.setViewportSize(viewport);
}

async function signInUi(page: Page, origin: string, email: string, password: string) {
  await page.goto(`${origin}/admin/login`);
  await page.getByRole("textbox", { name: "E-mail" }).fill(email);
  await page.getByLabel("Hasło", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Zaloguj się" }).click();
}

async function seedResetToken(db: Db, input: { email: string; userId: string; host: string; company: string }) {
  const token = randomBytes(32).toString("base64url");
  const verificationId = randomUUID();
  const now = new Date();
  await db.verification.create({ data: { id: verificationId, identifier: `password-reset:${input.email}`,
    value: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(now.getTime() + 30 * 60_000), createdAt: now } });
  await db.passwordResetRequest.create({ data: { id: randomUUID(), requestKeyHash: randomBytes(32).toString("hex"),
    inputHash: randomBytes(32).toString("hex"), userId: input.userId, verificationId, hostname: input.host,
    area: "COMPANY_ADMIN", organizationId: input.company, createdAt: now, expiresAt: new Date(now.getTime() + 24 * 3600_000) } });
  return token;
}

test("company admin: reset, account, password change, logout and expired service", async ({ page, baseURL }) => {
  test.setTimeout(240_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  await page.setViewportSize({ width: 390, height: 844 });
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  await clearLocalIpEvents(db);
  const port = new URL(baseURL).port;
  const company = randomUUID();
  const adminHost = `account-ui-${company}.example.test`;
  const origin = `http://${adminHost}:${port}`;
  const email = `account-ui-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  const resetPassword = "Reset fixture 5521 pass!";
  const finalPassword = "Changed fixture 7710 pass!";
  await db.organization.create({ data: { id: company, slug: `account-ui-${company}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  // The paid period ended long ago: the public page is off, the panel account keeps working.
  await db.serviceAccess.create({ data: { organizationId: company, paidThrough: new Date("2020-01-31") } });
  try {
    const registered = await createAuth(db, true, baseURL).api.signUpEmail({ body: { name: "Fixture Account", email, password } });
    await db.user.update({ where: { id: registered.user.id }, data: { organizationId: company, role: "ADMIN_FIRMY", emailVerified: true } });

    // Reset request: an unknown and a known address get the same message.
    const neutral = "Jeśli konto z tym adresem istnieje, wyślemy instrukcję resetu hasła.";
    await page.goto(`${origin}/admin/login`);
    await page.getByRole("link", { name: "Nie pamiętasz hasła?" }).click();
    await expect(page).toHaveURL(urlAt(origin, "/admin/reset-hasla"));
    for (const address of [`nobody-${randomUUID()}@example.test`, email]) {
      await page.goto(`${origin}/admin/reset-hasla`);
      await page.getByRole("textbox", { name: /Adres e-mail/ }).fill(address);
      const answered = page.waitForResponse((r) => r.url().includes("/api/auth/password/request-reset"));
      await page.getByRole("button", { name: "Wyślij instrukcję" }).click();
      const answer = await answered;
      expect(answer.status(), `request-reset answered ${await answer.text()}`).toBe(200);
      await expect(page.getByRole("status").filter({ hasText: neutral })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("link", { name: "Wróć do logowania" })).toHaveAttribute("href", /^\/admin\/login\/?$/);
    }
    await noHorizontalOverflow(page);
    await snap(page, "reset-sent");
    await clearLocalIpEvents(db);

    // Set new password: policy errors stay on the form, a single-use link works once.
    const token = await seedResetToken(db, { email, userId: registered.user.id, host: adminHost, company });
    await page.goto(`${origin}/admin/reset-hasla/${token}`);
    await expect(page.getByRole("heading", { name: "Ustaw nowe hasło" })).toBeVisible();
    await page.getByLabel("Nowe hasło", { exact: true }).fill("krotkie");
    await expect(page.getByText("Siła hasła: Słabe")).toBeVisible();
    await page.getByLabel("Potwierdź nowe hasło").fill("inne");
    await page.getByRole("button", { name: "Zapisz nowe hasło" }).click();
    await expect(page.getByText("Hasło musi mieć od 12 do 256 znaków")).toBeVisible();
    await expect(page.getByText("Hasła muszą być identyczne")).toBeVisible();
    await snap(page, "reset-invalid");
    await page.getByLabel("Nowe hasło", { exact: true }).fill(resetPassword);
    await page.getByLabel("Potwierdź nowe hasło").fill(resetPassword);
    await page.getByRole("button", { name: "Zapisz nowe hasło" }).click();
    await expect(page.getByRole("heading", { name: "Hasło zostało zmienione" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Przejdź do logowania" })).toHaveAttribute("href", /^\/admin\/login\/?$/);
    await snap(page, "reset-success");
    await page.goto(`${origin}/admin/reset-hasla/${token}`);
    await page.getByLabel("Nowe hasło", { exact: true }).fill(finalPassword);
    await page.getByLabel("Potwierdź nowe hasło").fill(finalPassword);
    await page.getByRole("button", { name: "Zapisz nowe hasło" }).click();
    await expect(page.getByRole("heading", { name: "Link nie działa" })).toBeVisible();
    await expect(page.getByLabel("Nowe hasło", { exact: true })).toHaveCount(0);
    await snap(page, "reset-used");

    // Enroll MFA with the reset password, then open the account with an expired service period.
    await clearLocalIpEvents(db);
    await signInUi(page, origin, email, resetPassword);
    await page.getByLabel("Potwierdź hasło").fill(resetPassword);
    await page.getByRole("button", { name: "Rozpocznij konfigurację" }).click();
    const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(secret), digits: 6, period: 30, algorithm: "SHA1" });
    await page.getByRole("textbox", { name: "Kod MFA" }).fill(totp.generate());
    await page.getByRole("button", { name: "Włącz MFA i pokaż kody" }).click();
    await page.getByRole("button", { name: "Zapisałem kody" }).click();
    await expect(page).toHaveURL(urlAt(origin, "/admin"));

    await page.goto(`${origin}/admin/konto`);
    await expect(page.getByRole("heading", { level: 1, name: "Konto", exact: true })).toBeVisible();
    // ADM-15: inside the panel shell (Konto active in the sidebar), tabs for the two account routes, two columns on desktop.
    await expect(page.getByRole("navigation", { name: "Nawigacja panelu" }).getByRole("link", { name: "Konto" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "Nawigacja mobilna" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sekcje konta" }).getByRole("link", { name: "Profil i hasło" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("Administrator firmy")).toBeVisible();
    await expect(page.getByRole("button", { name: /wyłącz/i })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await snap(page, "account");

    // Name: server-confirmed, persisted; email and role are read-only.
    await page.getByRole("textbox", { name: /Nazwa/ }).fill("Nowa Nazwa");
    await page.getByRole("button", { name: "Zapisz nazwę" }).click();
    await expect(page.getByText("Zapisano nazwę: Nowa Nazwa")).toBeVisible();
    expect((await db.user.findUniqueOrThrow({ where: { id: registered.user.id } })).name).toBe("Nowa Nazwa");

    // Offline: no pretend success for the password change; fields stay.
    await page.getByLabel("Aktualne hasło").fill(resetPassword);
    await page.getByLabel("Nowe hasło", { exact: true }).fill(finalPassword);
    // DS-AUT-004 in the account form: the level is text, the checklist is textual too.
    await expect(page.getByText(/^Siła hasła: (Średnie|Mocne)$/)).toBeVisible();
    await expect(page.getByText(/Co najmniej 12 znaków/)).toContainText("spełnione");
    await page.getByLabel("Potwierdź nowe hasło").fill(finalPassword);
    await page.context().setOffline(true);
    await page.getByRole("button", { name: "Zmień hasło" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Nie wiemy, czy hasło zostało zmienione");
    await page.context().setOffline(false);
    await expect(page.getByLabel("Nowe hasło", { exact: true })).toHaveValue(finalPassword);
    expect(await db.session.count({ where: { userId: registered.user.id } })).toBeGreaterThan(0);

    // Wrong current password: a field error with aria-invalid and focus on the field, session kept.
    await page.getByLabel("Aktualne hasło").fill("Wrong current password 1!");
    await page.getByRole("button", { name: "Zmień hasło" }).click();
    await expect(page.getByLabel("Aktualne hasło")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("main").getByText("Aktualne hasło jest nieprawidłowe.")).toBeVisible();
    await expect(page.getByLabel("Aktualne hasło")).toBeFocused();
    await expect(page).toHaveURL(urlAt(origin, "/admin/konto"));
    await snap(page, "account-password-error");

    // Correct change: all sessions revoked, back to login with the notice.
    await page.getByLabel("Aktualne hasło").fill(resetPassword);
    await page.getByRole("button", { name: "Zmień hasło" }).click();
    await expect(page).toHaveURL(urlAt(origin, "/admin/login", "?password=changed"));
    await expect(page.getByText("Hasło zostało zmienione.")).toBeVisible();
    expect(await db.session.count({ where: { userId: registered.user.id } })).toBe(0);
    await page.goto(`${origin}/admin/konto`);
    await expect(page).toHaveURL(/\/admin\/login\/?\?returnTo=%2Fadmin%2Fkonto$/);

    // Logout waits for the server; Back does not restore private data.
    await clearLocalIpEvents(db);
    await signInUi(page, origin, email, finalPassword);
    await page.getByRole("textbox", { name: "Kod MFA" }).fill(totp.generate());
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(urlAt(origin, "/admin"));
    await page.goto(`${origin}/admin/konto`);
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("button", { name: "Wyloguj" }).click();
    await expect(page).toHaveURL(urlAt(origin, "/admin/login"));
    expect(await db.session.count({ where: { userId: registered.user.id } })).toBe(0);
    await page.goBack();
    await expect(page.getByText(email)).toHaveCount(0);
    // Back lands on /admin/; without a session the shell sends the browser to login and shows no private data.
    await page.reload();
    await expect(page).toHaveURL(/\/admin\/login/);
    await expect(page.getByText(email)).toHaveCount(0);
  } finally {
    await clearLocalIpEvents(db);
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (user) {
      await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: ["read", "write"].map((operation) =>
        createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(`api:${operation}:${user.id}:${company}`).digest("hex")) } } });
      await db.verification.deleteMany({ where: { OR: [{ value: { contains: `"userId":"${user.id}"` } }, { identifier: `password-reset:${email}` }] } });
      await db.passwordResetRequest.deleteMany({ where: { userId: user.id } });
    }
    await db.auditLog.deleteMany({ where: { organizationId: company } });
    await db.job.deleteMany({ where: { organizationId: company } });
    await db.user.deleteMany({ where: { email } });
    await db.serviceAccess.deleteMany({ where: { organizationId: company } });
    await db.hostMapping.deleteMany({ where: { hostname: adminHost } });
    await db.organization.delete({ where: { id: company } });
    await db.$disconnect();
  }
});

test("superadmin: account on the platform host only, name saved, MFA actions without disable", async ({ page, baseURL }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  await page.setViewportSize({ width: 1440, height: 1024 });
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  await clearLocalIpEvents(db);
  const platformHost = `account-ui-platform-${randomUUID()}.example.test`;
  const origin = `http://${platformHost}:${new URL(baseURL).port}`;
  const started = new Date();
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  let superadminId = "";
  let originalName = "";
  try {
    const superadmin = await ensureControlledFixtureAccess(db);
    superadminId = superadmin.id;
    originalName = (await db.user.findUniqueOrThrow({ where: { id: superadmin.id } })).name;
    const access = JSON.parse(readFileSync(".local/fixture-9/access.json", "utf8")) as Record<string, { email: string; password: string; totpURI: string }>;
    const account = access[superadmin.id];
    const totp = OTPAuth.URI.parse(account.totpURI);
    if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing fixture TOTP");

    // Not signed in: the account redirects to the platform login, and the company route does not exist here.
    await page.goto(`${origin}/konto`);
    await expect(page).toHaveURL(/\/login\/?\?returnTo=%2Fkonto$/);
    expect((await page.request.get(`http://127.0.0.1:${new URL(origin).port}/admin/konto`, { headers: { host: new URL(origin).host } })).status()).toBe(404);
    await page.getByRole("textbox", { name: "Adres e-mail" }).fill(account.email);
    await page.getByLabel("Hasło", { exact: true }).fill(account.password);
    await page.getByRole("button", { name: "Zaloguj się" }).click();
    await page.getByRole("textbox", { name: "Kod MFA" }).fill(totp.generate());
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(urlAt(origin, "/konto"));
    await expect(page.getByRole("heading", { level: 1, name: "Konto superadmina" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Nawigacja panelu" }).getByRole("link", { name: "Firmy" })).toBeVisible();
    await expect(page.getByText("Superadmin", { exact: true })).toBeVisible();
    await expect(page.getByText(account.email)).toBeVisible();
    await expect(page.getByRole("button", { name: /wyłącz/i })).toHaveCount(0);
    await noHorizontalOverflow(page);
    await snap(page, "platform-account");
    await page.getByRole("textbox", { name: /Nazwa/ }).fill("Superadmin Fixture UI");
    await page.getByRole("button", { name: "Zapisz nazwę" }).click();
    await expect(page.getByText("Zapisano nazwę: Superadmin Fixture UI")).toBeVisible();
    await expect(page.getByRole("link", { name: "Wydaj nowe kody" })).toHaveAttribute("href", /^\/mfa\/?\?returnTo=%2Fkonto&recoverCodes=1$/);
    await page.getByRole("button", { name: "Nie mam obu czynników" }).click();
    await expect(page.getByText(/ręcznej procedury właściciela/)).toBeVisible();
    // #73: another session of the same account appears; ending it needs a fresh MFA proof and is confirmed by the server.
    const other = await verifiedFixtureSession(db, superadminId);
    await page.getByRole("link", { name: "Aktywne sesje" }).click();
    await expect(page).toHaveURL(urlAt(origin, "/konto/sesje"));
    await expect(page.getByText("Ta sesja", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Zakończ sesję:/ })).toHaveCount(1);
    expect(await page.content()).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/); // no IP address
    const before = await db.session.count({ where: { userId: superadminId } });
    await page.getByRole("button", { name: /Zakończ sesję:/ }).click();
    await expect(page.getByRole("heading", { name: /Zakończyć sesję/ })).toBeVisible();
    await page.getByLabel("Kod z aplikacji").fill("000000");
    await page.getByRole("button", { name: "Zakończ tę sesję" }).click();
    await expect(page.getByText(/Kod jest nieprawidłowy/)).toBeVisible();
    expect(await db.session.count({ where: { userId: superadminId } })).toBe(before); // a wrong code ends nothing
    await page.getByLabel("Kod z aplikacji").fill(totp.generate({ timestamp: Date.now() + 30_000 }));
    await page.getByRole("button", { name: "Zakończ tę sesję" }).click();
    await expect(page.getByText("Zakończono 1 sesję.")).toBeVisible();
    // The opener and the confirmation are gone: focus must land on the notice, not on <body>.
    await expect(page.locator('[role="status"][tabindex="-1"]')).toBeFocused();
    await expect(page.getByRole("button", { name: /Zakończ sesję:/ })).toHaveCount(0);
    expect(await db.session.count({ where: { userId: superadminId } })).toBe(before - 1);
    await other.dispose();
    await page.getByRole("link", { name: "Wróć do konta" }).click();
    await page.getByRole("button", { name: "Wyloguj" }).click();
    await expect(page).toHaveURL(urlAt(origin, "/login"));
  } finally {
    await clearLocalIpEvents(db);
    if (superadminId) {
      if (originalName) await db.user.update({ where: { id: superadminId }, data: { name: originalName } });
      await db.session.deleteMany({ where: { userId: superadminId, createdAt: { gte: started } } });
    }
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    await db.$disconnect();
  }
});
