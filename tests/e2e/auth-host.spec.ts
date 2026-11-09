import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

test("an active company host requires TOTP and revokes the old cookie on logout", async ({
  request,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing E2E base URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const fixtureAuth = createAuth(db, true, baseURL);
  const company = randomUUID();
  const hostname = new URL(baseURL).hostname;
  const email = `host-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  await db.organization.create({
    data: { id: company, slug: `host-${company}` },
  });
  await db.hostMapping.create({
    data: {
      hostname,
      area: "COMPANY_ADMIN",
      organizationId: company,
      status: "ACTIVE",
    },
  });
  try {
    const registered = await fixtureAuth.api.signUpEmail({
      body: { name: "Fixture", email, password },
    });
    await db.user.update({
      where: { id: registered.user.id },
      data: {
        organizationId: company,
        role: "ADMIN_FIRMY",
        emailVerified: true,
      },
    });

    expect(
      (
        await request.post("/api/auth/sign-up/email/", {
          data: { name: "X", email, password },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post("/api/auth/two-factor/disable/", {
          data: { password },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.post("/api/auth/two-factor/view-backup-codes/", {
          data: { password },
        })
      ).status(),
    ).toBe(404);
    expect(
      (
        await request.get("/api/auth/get-session/", {
          headers: { host: `company-b.test:${new URL(baseURL).port}` },
        })
      ).status(),
    ).toBe(404);

    const first = await request.post("/api/auth/sign-in/email/", {
      headers: { origin: baseURL },
      data: { email, password },
    });
    expect(first.status()).toBe(200);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(401);
    const enrollment = await request.post("/api/auth/two-factor/enable/", {
      headers: { origin: baseURL },
      data: { password, method: "totp" },
    });
    expect(enrollment.status()).toBe(200);
    const setup = (await enrollment.json()) as {
      totpURI: string;
      backupCodes?: string[];
    };
    expect(setup.backupCodes).toBeUndefined();
    const totp = OTPAuth.URI.parse(setup.totpURI);
    if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
    const confirmed = await request.post("/api/auth/two-factor/verify-totp/", {
      headers: { origin: baseURL },
      data: { code: totp.generate(), trustDevice: false },
    });
    expect(confirmed.status()).toBe(200);
    expect(
      ((await confirmed.json()) as { backupCodes: string[] }).backupCodes,
    ).toHaveLength(10);
    const sessionResponse = await request.get("/api/auth/get-session/");
    expect(sessionResponse.status()).toBe(200);
    const session = (await sessionResponse.json()) as {
      session: { id: string };
      user: { email: string };
    };
    expect(session.user.email).toBe(email);
    expect(
      (
        await db.session.findUnique({
          where: { id: session.session.id },
          select: { mfaVerifiedAt: true },
        })
      )?.mfaVerifiedAt,
    ).not.toBeNull();
    expect(
      await db.auditLog.count({
        where: { organizationId: company, action: "AUTH_LOGIN_COMPLETED" },
      }),
    ).toBe(1);

    expect(
      (
        await request.post("/api/auth/sign-out/", {
          headers: { origin: baseURL },
          data: {},
        })
      ).status(),
    ).toBe(200);
    expect(
      await db.auditLog.count({
        where: { organizationId: company, action: "AUTH_LOGOUT" },
      }),
    ).toBe(1);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(401);
    const login = await request.post("/api/auth/sign-in/email/", {
      headers: { origin: baseURL },
      data: { email, password },
    });
    expect(await login.json()).toHaveProperty("twoFactorRedirect", true);
    expect(
      (
        await request.post("/api/auth/two-factor/verify-totp/", {
          headers: { origin: baseURL },
          data: { code: totp.generate(), trustDevice: true },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post("/api/auth/two-factor/verify-totp/", {
          headers: { origin: baseURL },
          data: { code: totp.generate(), trustDevice: false },
        })
      ).status(),
    ).toBe(200);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(200);
  } finally {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user)
      await db.verification.deleteMany({
        where: {
          OR: [
            { value: user.id },
            { value: { contains: `"userId":"${user.id}"` } },
          ],
        },
      });
    await db.auditLog.deleteMany({ where: { organizationId: company } });
    await db.user.deleteMany({ where: { email } });
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.organization.delete({ where: { id: company } });
    await db.$disconnect();
  }
});

test("an open panel distinguishes network failure from server revocation", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(45_000);
  if (!baseURL) throw new Error("Missing E2E base URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const organizationId = randomUUID();
  const userId = randomUUID();
  const hostname = `panel-${randomUUID()}.localhost`;
  const origin = new URL(baseURL);
  origin.hostname = hostname;
  await db.organization.create({
    data: {
      id: organizationId,
      slug: `panel-${organizationId}`,
      name: "Firma Alfa",
    },
  });
  await db.hostMapping.create({
    data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
  });
  await db.user.create({
    data: {
      id: userId,
      name: "Administrator Alfa",
      email: `panel-${userId}@example.test`,
      emailVerified: true,
      twoFactorEnabled: true,
      role: "ADMIN_FIRMY",
      organizationId,
    },
  });
  const session = await verifiedFixtureSession(db, userId);
  try {
    const cookieValue = session.cookie.slice(session.cookie.indexOf("=") + 1);
    await page.context().addCookies([
      {
        name: "better-auth.session_token",
        value: cookieValue,
        url: origin.origin,
      },
    ]);
    const firstCheck = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/get-session/" &&
        response.status() === 200,
    );
    await page.goto(`${origin.origin}/admin/`);
    await firstCheck;
    await expect(page.getByRole("heading", { name: "Panel", exact: true })).toBeVisible();

    const sessionUrl = /\/api\/auth\/get-session\/?$/;
    const interrupt = (route: import("@playwright/test").Route) =>
      route.abort("failed");
    await page.route(sessionUrl, interrupt);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByText("Nie udało się sprawdzić dostępu"),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Panel", exact: true })).toBeHidden();
    await expect(page.getByText("Sesja wygasła")).toHaveCount(0);

    await page.unroute(sessionUrl, interrupt);
    await page.getByRole("button", { name: "Spróbuj ponownie" }).click();
    // The dashboard heading comes from a client component on the dev server of this project; allow for a loaded machine.
    await expect(page.getByRole("heading", { name: "Panel", exact: true })).toBeVisible({ timeout: 20_000 });

    await session.dispose();
    await expect(page.getByText("Sesja wygasła")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("heading", { name: "Panel", exact: true })).toHaveCount(0);
  } finally {
    await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
});

test("a cold start of the company panel without a session lands on the login of the same host", async ({
  page,
  baseURL,
}) => {
  if (!baseURL) throw new Error("Missing E2E base URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const organizationId = randomUUID();
  const hostname = `cold-${randomUUID()}.localhost`;
  const origin = new URL(baseURL);
  origin.hostname = hostname;
  await db.organization.create({
    data: {
      id: organizationId,
      slug: `cold-${organizationId}`,
      name: "Firma Zimna",
    },
  });
  await db.hostMapping.create({
    data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
  });
  try {
    await page.goto(`${origin.origin}/admin/`);
    await expect(page).toHaveURL(/\/admin\/login\/?\?returnTo=%2Fadmin$/);
    await expect(page.getByRole("heading", { name: "Panel", exact: true })).toHaveCount(0);
  } finally {
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
