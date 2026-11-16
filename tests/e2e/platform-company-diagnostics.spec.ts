import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { FIXTURE } from "../../scripts/fixture-ids";
import { axeScan } from "../fixtures/a11y";
import { ensureControlledSuperadminMfa, resetPlatformApiBudget, verifiedFixtureSession } from "../fixtures/verified-session";

// #78 (D-52, D-63): domain and mail diagnostics on the company card, as the superadmin in a real browser on the real API
// of #77 + #417. States come from database rows; only the lost answer (503) is injected, because the API cannot be made
// to fail on demand.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
const WIDTHS = [320, 390, 768, 1024, 1440, 1920];

/** Status of one API call made outside the browser: another host, another (or no) session. */
function apiStatus(port: string, host: string, method: string, path: string, cookie = ""): Promise<number> {
  const data = method === "POST" ? JSON.stringify({ eventKey: randomUUID() }) : undefined;
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: { Host: host, Origin: `http://${host}`,
      ...(cookie ? { Cookie: cookie } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) } },
    (response) => { response.resume(); response.on("end", () => resolve(response.statusCode ?? 0)); });
    request.on("error", reject);
    request.end(data);
  });
}

async function noOverflow(page: Page, label: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole("region", { name: "Diagnostyka" })).toBeVisible();
    // Names the elements that stick out, so a failure points at the culprit.
    const wide = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth ? []
      : [...document.querySelectorAll("body *")].filter((el) => el.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5)
        .filter((el, _i, all) => !all.some((other) => other !== el && el.contains(other)))
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} "${(el.textContent ?? "").trim().slice(0, 40)}"`).slice(0, 6));
    expect(wide, `${label}, viewport ${width}`).toEqual([]);
  }
}

async function shots(page: Page, state: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("region", { name: "Diagnostyka" }).screenshot({ path: test.info().outputPath(`${state}-${width}.png`) });
  }
}

async function company(db: ReturnType<typeof createPrismaClient>, org: string, registered: boolean) {
  await db.organization.create({ data: { id: org, slug: `plt78-${org}`, name: `Plt78 ${org.slice(0, 8)}`,
    firstAdminRegisteredAt: registered ? new Date(Date.now() - 86_400_000) : null } });
  await db.hostMapping.createMany({ data: [
    { hostname: `plt78-a-${org}.example.test`, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
    { hostname: `plt78-p-${org}.example.test`, area: "COMPANY_PUBLIC", organizationId: org, status: "ACTIVE" },
  ] });
  await db.serviceAccess.create({ data: { organizationId: org, paidThrough: new Date(Date.now() + 30 * 86_400_000) } });
}

async function cleanup(db: ReturnType<typeof createPrismaClient>, org: string, platformHost: string) {
  await db.auditLog.deleteMany({ where: { organizationId: org } });
  await db.customDomain.deleteMany({ where: { organizationId: org } });
  await db.reminderIntent.deleteMany({ where: { organizationId: org } });
  await db.reminderPlan.deleteMany({ where: { organizationId: org } });
  await db.job.deleteMany({ where: { organizationId: org } });
  await db.invitation.deleteMany({ where: { organizationId: org } });
  await db.serviceAccess.deleteMany({ where: { organizationId: org } });
  await db.session.deleteMany({ where: { user: { organizationId: org } } });
  await db.user.deleteMany({ where: { organizationId: org } });
  await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: org }, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: org } });
}

async function superadmin(db: ReturnType<typeof createPrismaClient>, page: Page, platformHost: string, origin: string) {
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  await ensureControlledSuperadminMfa(db, FIXTURE.users[2]);
  await resetPlatformApiBudget(db, FIXTURE.users[2]);
  const session = await verifiedFixtureSession(db, FIXTURE.users[2]);
  await page.context().addCookies([{ name: "better-auth.session_token", value: session.cookie.slice(session.cookie.indexOf("=") + 1), url: origin }]);
  return session;
}

test("superadmin: certificate warning and accepted mail, a failing active domain (D-64), then DNS and mail errors after a re-read; a lost answer stays uncertain (#78)", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = new URL(baseURL).port;
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const org = randomUUID();
  const platformHost = `plt78-platform-${org}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const custom = `www.plt78-${org.slice(0, 8)}.klient.example.test`;
  const token = `plt78-token-${org}`;
  const now = Date.now();
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  try {
    await company(db, org, false);
    const mapping = await db.hostMapping.create({ data: { hostname: custom, area: "COMPANY_PUBLIC", kind: "CUSTOM", organizationId: org, status: "ACTIVE" } });
    const verified = new Date(now - 3_600_000);
    await db.customDomain.create({ data: { organizationId: org, hostMappingId: mapping.id, verificationToken: token, status: "ACTIVE",
      activatedAt: verified, ownershipVerifiedAt: verified, routingVerifiedAt: verified, tlsVerifiedAt: verified,
      tlsNotAfter: new Date(now + 8 * 86_400_000), checkedAt: verified } });
    const invitation = await db.invitation.create({ data: { organizationId: org, recipientEmail: `plt78-${org.slice(0, 8)}@example.test`,
      issuedHost: `plt78-a-${org}.example.test`, tokenHash: randomUUID(), issueKey: randomUUID(), issuedAt: new Date(now), expiresAt: new Date(now + 7 * 86_400_000) } });
    const job = await db.job.create({ data: { organizationId: org, kind: "MAIL_INVITATION", dedupeKey: `MAIL_INVITATION:${invitation.id}`,
      payload: {}, runAt: verified, status: "SENT", attempts: 1, firstSendAt: verified, completedAt: verified } });
    session = await superadmin(db, page, platformHost, origin);

    // diag-warning (domain) + diag-ok (mail): the certificate date and the last mail come from #417.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/firmy/${org}/`);
    const region = page.getByRole("region", { name: "Diagnostyka" });
    const domain = region.getByRole("region", { name: "Domena" });
    const mail = region.getByRole("region", { name: "Poczta" });
    await expect(domain.getByText("Certyfikat wygasa wkrótce")).toBeVisible();
    await expect(domain.getByText(custom)).toBeVisible();
    await expect(domain.getByText(/Strona działa\. Certyfikat jest ważny do \d{2}\.\d{2}\.\d{4} i odnawia się automatycznie/)).toBeVisible();
    await expect(domain.getByText(/^Ostatnie sprawdzenie: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)).toBeVisible();
    await expect(mail.getByText("Ostatnia wysyłka przyjęta")).toBeVisible();
    await expect(mail.getByText(/^Zaproszenie administratora · \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)).toBeVisible();
    const retry = region.getByRole("button", { name: "Sprawdź ponownie" });
    await expect(retry).toHaveCount(2);
    for (const button of await retry.all()) expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(48);
    await shots(page, "diag-warning-domain_ok-mail");

    // D-64: a failed re-check of the ACTIVE domain keeps it active. The card says the page may be down and what to do,
    // and never that the Autervy address still works (it redirects to this domain).
    await db.customDomain.update({ where: { organizationId: org }, data: { lastFailureCode: "TLS_UNREACHABLE", checkedAt: new Date() } });
    await page.setViewportSize({ width: 390, height: 844 });
    await retry.last().click();
    await expect(domain.getByText("Błąd: certyfikat domeny")).toBeVisible();
    await expect(domain.getByText(/strona firmy może być niedostępna: adres Autervy przekierowuje na tę domenę\. Sprawdź z firmą wpisy DNS i certyfikat domeny własnej, a potem użyj „Sprawdź ponownie”/)).toBeVisible();
    await expect(domain).not.toContainText("Adres Autervy działa nadal");
    await expect(retry.first()).toBeEnabled();
    await shots(page, "diag-error-active-domain");

    // The stored state changes (failed check of a pending domain, rejected invitation, a newer password-reset mail).
    // Mail has no active check: its button re-reads the diagnostics, and both blocks show the new stored result.
    await db.hostMapping.update({ where: { id: mapping.id }, data: { status: "PENDING" } });
    await db.customDomain.update({ where: { organizationId: org }, data: { status: "PENDING_ROUTING", activatedAt: null,
      routingVerifiedAt: null, tlsVerifiedAt: null, tlsNotAfter: null, lastFailureCode: "CNAME_MISMATCH", checkedAt: new Date() } });
    await db.job.update({ where: { id: job.id }, data: { status: "FAILED", attempts: 5, errorCode: "MAIL_PERMANENT", completedAt: new Date() } });
    await db.job.create({ data: { organizationId: org, kind: "MAIL_PASSWORD_RESET", dedupeKey: `MAIL_PASSWORD_RESET:${randomUUID()}`,
      payload: {}, runAt: new Date(), status: "SENT", completedAt: new Date(Date.now() + 60_000) } });
    await page.setViewportSize({ width: 390, height: 844 });
    await retry.last().click();
    await expect(mail.getByText("Błąd: wysyłka nieudana")).toBeVisible();
    await expect(mail.getByRole("status")).toHaveText("Sprawdzanie zakończone.");
    await expect(mail.getByText(/Serwer poczty odrzucił wiadomość\. Sprawdź adres e-mail administratora i wydaj nowe zaproszenie/)).toBeVisible();
    await expect(domain.getByText("Błąd: DNS domeny")).toBeVisible();
    await expect(domain.getByText(/Adres Autervy działa nadal\. Poproś firmę o poprawienie wpisu DNS/)).toBeVisible();
    // No token, code or DNS value in the card, and nothing about the password-reset mail (D-63).
    for (const secret of [token, "MAIL_PERMANENT", "CNAME_MISMATCH", "MAIL_PASSWORD_RESET"]) await expect(region).not.toContainText(secret);
    await expect(region).not.toContainText(/reset|hasł/i);
    await shots(page, "diag-error");
    await axeScan(page, "karta firmy z diagnostyką (błędy)");

    // Keyboard: Enter on the focused button; a lost answer (injected 503) is neither success nor error.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route(`**/api/platform/companies/${org}/launch-diagnostics/recheck/`, (route) => route.fulfill({ status: 503, body: "{}", contentType: "application/json" }));
    await retry.first().focus();
    await page.keyboard.press("Enter");
    await expect(domain.getByText("Wynik niepewny", { exact: true })).toBeVisible();
    await expect(domain.getByText(/^Ostatni potwierdzony wynik: Błąd: DNS domeny, \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)).toBeVisible();
    await expect(retry.first()).toBeFocused();
    await expect(domain.getByText("Aktywna", { exact: true })).toHaveCount(0);
    await expect(mail.getByText("Błąd: wysyłka nieudana")).toBeVisible();
    await shots(page, "diag-uncertain-domain");
    await page.unroute(`**/api/platform/companies/${org}/launch-diagnostics/recheck/`);

    // Offline: nothing is sent and the shown result stays.
    await page.context().setOffline(true);
    await retry.last().click();
    await expect(mail.getByRole("status")).toContainText("Brak połączenia z siecią. Sprawdzenie nie zostało wysłane.");
    await expect(mail.getByText("Błąd: wysyłka nieudana")).toBeVisible();
    await page.context().setOffline(false);

    await noOverflow(page, "błędy");
  } finally {
    await session?.dispose();
    await cleanup(db, org, platformHost);
    await db.$disconnect();
  }
});

test("superadmin: no domain and no mail; the real re-check confirms with a date, the limit refuses without changing the result; other roles and hosts are refused (#78)", async ({ page, baseURL }) => {
  test.setTimeout(180_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = new URL(baseURL).port;
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const org = randomUUID();
  const adminId = randomUUID();
  const platformHost = `plt78-platform-${org}.example.test`;
  const adminHost = `plt78-a-${org}.example.test`;
  const origin = `http://${platformHost}:${port}`;
  const api = `/api/platform/companies/${org}/launch-diagnostics/`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  try {
    await company(db, org, true);
    await db.user.create({ data: { id: adminId, name: "Plt78 admin", email: `plt78-${org}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: org } });
    session = await superadmin(db, page, platformHost, origin);

    // diag-no-data: nothing was checked yet, so there is no date to show.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/firmy/${org}/`);
    const region = page.getByRole("region", { name: "Diagnostyka" });
    const domain = region.getByRole("region", { name: "Domena" });
    const mail = region.getByRole("region", { name: "Poczta" });
    await expect(domain.getByText("Brak domeny własnej")).toBeVisible();
    await expect(mail.getByText("Brak wysyłek")).toBeVisible();
    await expect(region.getByText(/Ostatnie sprawdzenie|stan odczytano/)).toHaveCount(0);
    await shots(page, "diag-no-data");
    await noOverflow(page, "brak danych");

    // The real action answers with the diagnostics. Without a custom domain it only reads the state of the Autervy
    // addresses, so the confirmation is a dated state line, not a claim of a network test.
    await page.setViewportSize({ width: 390, height: 844 });
    const retry = domain.getByRole("button", { name: "Sprawdź ponownie" });
    await retry.click();
    await expect(domain.getByRole("status")).toHaveText("Sprawdzanie zakończone.");
    await expect(domain.getByText(/^Adres Autervy aktywny, stan odczytano: \d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}$/)).toBeVisible();
    await expect(domain.getByText("Brak domeny własnej")).toBeVisible();
    await expect(retry).toBeFocused();

    // Limit of 6 re-checks per hour per company: five more real ones, then the card shows the refusal and keeps the result.
    for (let i = 0; i < 5; i += 1) expect(await apiStatus(port, platformHost, "POST", `${api}recheck/`, session.cookie)).toBe(200);
    await retry.click();
    await expect(domain.getByRole("status")).toContainText(/Limit sprawdzeń został wyczerpany, więc sprawdzenie się nie wykonało\. Spróbuj ponownie za \d+ (min|s)\./);
    await expect(domain.getByText("Brak domeny własnej")).toBeVisible();
    await expect(domain.getByText("Wynik niepewny")).toHaveCount(0);
    await shots(page, "diag-limit");

    // Only the superadmin on the platform host: the company administrator and anonymous callers get no diagnostics.
    const admin = await verifiedFixtureSession(db, adminId);
    for (const [host, cookie] of [[adminHost, admin.cookie], [adminHost, ""], [`plt78-p-${org}.example.test`, ""], [platformHost, ""], [platformHost, admin.cookie]]) {
      expect([401, 403, 404], `GET ${host}`).toContain(await apiStatus(port, host, "GET", api, cookie));
      expect([401, 403, 404], `POST ${host}`).toContain(await apiStatus(port, host, "POST", `${api}recheck/`, cookie));
    }
  } finally {
    await session?.dispose();
    await cleanup(db, org, platformHost);
    await db.$disconnect();
  }
});
