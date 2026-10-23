import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

test("fixture auth route is host-bound, closed by default and records per-session MFA", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("Missing E2E base URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const fixtureAuth = createAuth(db, true);
  const company = randomUUID();
  const email = `host-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  await db.organization.create({ data: { id: company, slug: `host-${company}` } });
  try {
    const registered = await fixtureAuth.api.signUpEmail({ body: { name: "Fixture", email, password }, returnHeaders: true });
    await db.user.update({ where: { id: registered.response.user.id }, data: { organizationId: company } });
    const initialCookie = registered.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
    const enrolled = await fixtureAuth.api.enableTwoFactor({ body: { password, method: "totp" }, headers: new Headers({ cookie: initialCookie }) });
    if (enrolled.method !== "totp") throw new Error("Expected TOTP enrollment");
    const totp = OTPAuth.URI.parse(enrolled.totpURI);
    if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
    await fixtureAuth.api.verifyTOTP({ body: { code: totp.generate() }, headers: new Headers({ cookie: initialCookie }) });

    expect((await request.post("/api/auth/sign-up/email/", { data: { name: "X", email, password } })).status()).toBe(404);
    expect((await request.post("/api/auth/two-factor/disable/", { data: { password } })).status()).toBe(404);
    expect((await request.post("/api/auth/two-factor/view-backup-codes/", { data: { password } })).status()).toBe(404);
    expect((await request.get("/api/auth/get-session/", { headers: { host: `company-b.test:${new URL(baseURL).port}`, cookie: initialCookie } })).status()).toBe(404);

    const login = await request.post("/api/auth/sign-in/email/", { headers: { origin: baseURL }, data: { email, password } });
    expect(login.status()).toBe(200);
    expect(await login.json()).toHaveProperty("twoFactorRedirect", true);
    const invalid = await request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate(), trustDevice: true } });
    expect(invalid.status()).toBe(400);
    const verified = await request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate(), trustDevice: false } });
    expect(verified.status(), await verified.text()).toBe(200);
    const sessionResponse = await request.get("/api/auth/get-session/");
    expect(sessionResponse.status()).toBe(200);
    const session = await sessionResponse.json() as { session: { id: string }; user: { email: string } };
    expect(session.user.email).toBe(email);
    expect((await db.session.findUnique({ where: { id: session.session.id }, select: { mfaVerifiedAt: true } }))?.mfaVerifiedAt).not.toBeNull();
    expect((await request.get("/api/auth/get-session/", { headers: { host: `company-b.test:${new URL(baseURL).port}` } })).status()).toBe(404);
  } finally {
    await db.user.deleteMany({ where: { organizationId: company } });
    await db.organization.delete({ where: { id: company } });
    await db.$disconnect();
  }
});
