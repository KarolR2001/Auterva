import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";

// Real browser against the built app behind the local ingress (#26). Fixture hosts resolve to loopback.
test.use({ launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

type Db = ReturnType<typeof createPrismaClient>;
type Variant = { publicActive: boolean; trialGranted: boolean };

async function company(db: Db, variant: Variant) {
  const organizationId = randomUUID();
  const label = organizationId.slice(0, 8);
  const host = `activation-ui-${label}.sites.example.test`;
  const email = `activation-ui-${organizationId}@example.test`;
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.organization.create({ data: { id: organizationId, slug: `activation-ui-${label}`, name: "Alfa Rent UI" } });
  await db.user.create({ data: { id: randomUUID(), email, name: "Pending admin", role: "ADMIN_FIRMY", organizationId,
    emailVerified: false, twoFactorEnabled: false } });
  await db.hostMapping.createMany({ data: [
    { hostname: host, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: `activation-ui-${label}.public.example.test`, area: "COMPANY_PUBLIC", organizationId,
      status: variant.publicActive ? "ACTIVE" : "PENDING" },
  ] });
  await db.serviceAccess.create({ data: { organizationId, trialGranted: variant.trialGranted } });
  const invitation = await db.invitation.create({ data: { organizationId, recipientEmail: email, issuedHost: host,
    tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(), issuedAt: now,
    expiresAt: new Date(now.getTime() + 168 * 60 * 60_000) } });
  return { organizationId, host, email, token, invitationId: invitation.id };
}

async function cleanup(db: Db, ids: string[]) {
  await db.job.deleteMany({ where: { organizationId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await db.invitation.deleteMany({ where: { organizationId: { in: ids } } });
  await db.session.deleteMany({ where: { user: { organizationId: { in: ids } } } });
  await db.account.deleteMany({ where: { user: { organizationId: { in: ids } } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: ids } } });
  await db.user.deleteMany({ where: { organizationId: { in: ids } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: ids } } });
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: ids } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
}

async function fill(page: Page, password: string, confirm = password) {
  await page.getByLabel("Nowe hasło", { exact: false }).first().fill(password);
  await page.getByLabel("Powtórz hasło").fill(confirm);
}

const password = "Activation UI password 7731!";

test("activation page: open does not activate, validation, double submit, lost response and spent link", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const fixture = await company(db, { publicActive: true, trialGranted: true });
  const origin = `http://${fixture.host}:${new URL(baseURL).port}`;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${origin}/admin/zaproszenie/${fixture.token}`);
    await expect(page.getByRole("heading", { name: "Aktywuj konto" })).toBeVisible();
    await expect(page.getByText("Alfa Rent UI", { exact: false })).toBeVisible();
    await expect(page.getByText(fixture.email, { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // Opening (and reloading) the link never activates.
    await page.reload();
    await expect(page.getByRole("button", { name: "Aktywuj konto" })).toBeVisible();
    expect((await db.invitation.findUniqueOrThrow({ where: { id: fixture.invitationId } })).usedAt).toBeNull();
    expect((await db.organization.findUniqueOrThrow({ where: { id: fixture.organizationId } })).firstAdminRegisteredAt).toBeNull();

    let posts = 0;
    page.on("request", (request) => { if (request.method() === "POST" && request.url().includes("/api/auth/invitation/")) posts += 1; });
    await fill(page, "short", "short");
    await page.getByRole("button", { name: "Aktywuj konto" }).click();
    await expect(page.getByText("Hasło musi mieć co najmniej 12 znaków")).toBeVisible();
    await fill(page, password, `${password}x`);
    await page.getByRole("button", { name: "Aktywuj konto" }).click();
    await expect(page.getByText("Hasła muszą być identyczne")).toBeVisible();
    expect(posts).toBe(0);

    // Lost response after a successful write: the retry returns the stored result, no second account or trial.
    let dropped = false;
    await page.route("**/api/auth/invitation/**", async (route) => {
      if (route.request().method() !== "POST" || dropped) return route.continue();
      dropped = true;
      // route.fetch resolves DNS in Node, not Chromium: send the real POST to loopback with the fixture Host.
      const target = new URL(route.request().url());
      target.hostname = "127.0.0.1";
      await route.fetch({ url: target.toString(), headers: { ...route.request().headers(), host: fixture.host + ":" + target.port } });
      await route.abort("failed");
    });
    await fill(page, password);
    await page.getByRole("button", { name: "Aktywuj konto" }).dblclick();
    await expect(page.getByText("Nie udało się połączyć.")).toBeVisible();
    expect(posts).toBe(1);
    // Unconfirmed result: the passwords are frozen so the retry carries the same one.
    await expect(page.getByLabel("Nowe hasło")).toHaveJSProperty("readOnly", true);
    await page.getByRole("button", { name: "Ponów aktywację" }).click();
    await expect(page.getByRole("heading", { name: "Konto jest aktywne" })).toBeVisible();
    await expect(page.getByText("Strona firmy jest uruchomiona")).toBeVisible();
    await expect(page.getByRole("link", { name: "Przejdź do logowania" })).toHaveAttribute("href", "/admin/login/");
    expect(await db.auditLog.count({ where: { organizationId: fixture.organizationId, action: "INVITATION_ACCEPTED" } })).toBe(1);
    expect(await db.account.count({ where: { user: { organizationId: fixture.organizationId } } })).toBe(1);
    // The token is gone from the address bar; a reload lands on the login page, not a 404.
    expect(new URL(page.url()).pathname).toBe("/admin/login/");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Zaloguj się do panelu" })).toBeVisible();
    // Spent link: neutral dead end without a form.
    await page.goto(`${origin}/admin/zaproszenie/${fixture.token}`);
    await expect(page.getByRole("heading", { name: "Link jest nieaktualny" })).toBeVisible();
    await expect(page.getByLabel("Nowe hasło")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Wróć do logowania" })).toBeVisible();
    // Wrong token.
    await page.goto(`${origin}/admin/zaproszenie/${randomBytes(32).toString("base64url")}`);
    await expect(page.getByRole("heading", { name: "Link jest nieaktualny" })).toBeVisible();
    // Foreign host: the page is a plain 404, not an activation form.
    const foreign = await page.goto(`http://other-${randomUUID().slice(0, 8)}.example.test:${new URL(baseURL).port}/admin/zaproszenie/${fixture.token}`);
    expect(foreign?.status()).toBe(404);
  } finally {
    await cleanup(db, [fixture.organizationId]);
    await db.$disconnect();
  }
});

for (const [name, variant, message] of [
  ["domain pending", { publicActive: false, trialGranted: true }, "Strona firmy jeszcze nie działa"],
  ["period expired", { publicActive: true, trialGranted: false }, "Strona firmy nie jest publiczna"],
] as const) {
  test(`activation result reports the server site state: ${name}`, async ({ page, baseURL }) => {
    if (!baseURL) throw new Error("Missing trusted ingress URL");
    const db = createPrismaClient(process.env.DATABASE_URL ?? "");
    const fixture = await company(db, variant);
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`http://${fixture.host}:${new URL(baseURL).port}/admin/zaproszenie/${fixture.token}`);
      await fill(page, password);
      await page.getByRole("button", { name: "Aktywuj konto" }).click();
      await expect(page.getByRole("heading", { name: "Konto jest aktywne" })).toBeVisible();
      await expect(page.getByText(message)).toBeVisible();
      await expect(page.getByText("Strona firmy jest uruchomiona")).toHaveCount(0);
    } finally {
      await cleanup(db, [fixture.organizationId]);
      await db.$disconnect();
    }
  });
}
