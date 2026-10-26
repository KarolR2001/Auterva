import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

test("an active company host requires TOTP and revokes the old cookie on logout", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("Missing E2E base URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const fixtureAuth = createAuth(db, true, baseURL);
  const company = randomUUID();
  const hostname = new URL(baseURL).hostname;
  const email = `host-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  await db.organization.create({ data: { id: company, slug: `host-${company}` } });
  await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  try {
    const registered = await fixtureAuth.api.signUpEmail({ body: { name: "Fixture", email, password } });
    await db.user.update({ where: { id: registered.user.id }, data: { organizationId: company, role: "ADMIN_FIRMY", emailVerified: true } });

    expect((await request.post("/api/auth/sign-up/email/", { data: { name: "X", email, password } })).status()).toBe(404);
    expect((await request.post("/api/auth/two-factor/disable/", { data: { password } })).status()).toBe(404);
    expect((await request.post("/api/auth/two-factor/view-backup-codes/", { data: { password } })).status()).toBe(404);
    expect((await request.get("/api/auth/get-session/", { headers: { host: `company-b.test:${new URL(baseURL).port}` } })).status()).toBe(404);

    const first = await request.post("/api/auth/sign-in/email/", { headers: { origin: baseURL }, data: { email, password } });
    expect(first.status()).toBe(200);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(401);
    const enrollment = await request.post("/api/auth/two-factor/enable/", { headers: { origin: baseURL }, data: { password, method: "totp" } });
    expect(enrollment.status()).toBe(200);
    const setup = await enrollment.json() as { totpURI: string; backupCodes?: string[] };
    expect(setup.backupCodes).toBeUndefined();
    const totp = OTPAuth.URI.parse(setup.totpURI);
    if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
    const confirmed = await request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate(), trustDevice: false } });
    expect(confirmed.status()).toBe(200);
    expect((await confirmed.json() as { backupCodes: string[] }).backupCodes).toHaveLength(10);
    const sessionResponse = await request.get("/api/auth/get-session/");
    expect(sessionResponse.status()).toBe(200);
    const session = await sessionResponse.json() as { session: { id: string }; user: { email: string } };
    expect(session.user.email).toBe(email);
    expect((await db.session.findUnique({ where: { id: session.session.id }, select: { mfaVerifiedAt: true } }))?.mfaVerifiedAt).not.toBeNull();
    expect(await db.auditLog.count({ where: { organizationId: company, action: "AUTH_LOGIN_COMPLETED" } })).toBe(1);

    expect((await request.post("/api/auth/sign-out/", { headers: { origin: baseURL }, data: {} })).status()).toBe(200);
    expect(await db.auditLog.count({ where: { organizationId: company, action: "AUTH_LOGOUT" } })).toBe(1);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(401);
    const login = await request.post("/api/auth/sign-in/email/", { headers: { origin: baseURL }, data: { email, password } });
    expect(await login.json()).toHaveProperty("twoFactorRedirect", true);
    expect((await request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate(), trustDevice: true } })).status()).toBe(400);
    expect((await request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate(), trustDevice: false } })).status()).toBe(200);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(200);
  } finally {
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await db.verification.deleteMany({ where: { OR: [
      { value: user.id }, { value: { contains: `"userId":"${user.id}"` } },
    ] } });
    await db.auditLog.deleteMany({ where: { organizationId: company } });
    await db.user.deleteMany({ where: { email } });
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.organization.delete({ where: { id: company } });
    await db.$disconnect();
  }
});
