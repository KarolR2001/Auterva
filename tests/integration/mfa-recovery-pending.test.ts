import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { hashPassword } from "better-auth/crypto";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";
import { recoverMfaByOperator } from "../../scripts/recover-mfa";
import type { Prisma } from "../../src/generated/prisma/client";

/**
 * #387: after a login with a recovery code the old factor is gone until a new TOTP is confirmed. In that window a
 * password alone must not open an enrollment session (D-05 pt. 4/5): only the session that consumed the recovery code
 * may enroll, otherwise the operator procedure. Real HTTP gateway and PostgreSQL; both administrator roles.
 */
const TEST_TIMEOUT_MS = 90_000;

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const instance = createAuth(db, true);
const organizationId = randomUUID();
const companyHost = `admin-${randomUUID()}.example.test`;
const platformHost = `platform-${randomUUID()}.example.test`;
const companyEmail = `recovery-${randomUUID()}@example.test`;
const password = "Fixture password 9384!";
let companyUserId = "";

type SuperadminSnapshot = {
  userId: string; email: string; created: boolean; twoFactorEnabled: boolean | null;
  credential: { id: string; password: string | null } | null; factors: Prisma.TwoFactorCreateManyInput[];
};
let superadmin: SuperadminSnapshot | null = null;

beforeAll(async () => {
  await db.rateLimitEvent.deleteMany();
  await db.organization.create({ data: { id: organizationId, slug: `recovery-${organizationId}` } });
  await db.hostMapping.createMany({ data: [
    { hostname: companyHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  const registered = await instance.api.signUpEmail({ body: { name: "Recovery fixture", email: companyEmail, password } });
  companyUserId = registered.user.id;
  await db.user.update({ where: { id: companyUserId }, data: { role: "ADMIN_FIRMY", organizationId, emailVerified: true } });

  // MVP has exactly one superadmin (DB singleton). Reuse the seeded one under a test password and an empty factor,
  // and restore its credential and factor rows byte for byte afterwards, so seeded access stays valid.
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true, email: true, twoFactorEnabled: true } });
  if (existing) {
    const credential = await db.account.findFirst({ where: { userId: existing.id, providerId: "credential" }, select: { id: true, password: true } });
    const factors = await db.twoFactor.findMany({ where: { userId: existing.id } });
    superadmin = { userId: existing.id, email: existing.email, created: false, twoFactorEnabled: existing.twoFactorEnabled, credential, factors };
    await db.twoFactor.deleteMany({ where: { userId: existing.id } });
    await db.session.deleteMany({ where: { userId: existing.id } });
    await db.user.update({ where: { id: existing.id }, data: { twoFactorEnabled: false } });
    if (credential) await db.account.update({ where: { id: credential.id }, data: { password: await hashPassword(password) } });
    else await db.account.create({ data: { id: randomUUID(), accountId: existing.id, providerId: "credential", userId: existing.id, password: await hashPassword(password) } });
  } else {
    const platformEmail = `platform-${randomUUID()}@example.test`;
    const created = await instance.api.signUpEmail({ body: { name: "Platform recovery fixture", email: platformEmail, password } });
    await db.user.update({ where: { id: created.user.id }, data: { role: "SUPERADMIN_AUTERVA", emailVerified: true } });
    superadmin = { userId: created.user.id, email: platformEmail, created: true, twoFactorEnabled: false, credential: null, factors: [] };
  }
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await db.rateLimitEvent.deleteMany();
  const ids = [companyUserId, superadmin?.userId].filter((id): id is string => Boolean(id));
  await db.verification.deleteMany({ where: { OR: ids.map((id) => ({ value: { contains: `"userId":"${id}"` } })) } });
  if (superadmin) {
    const { userId } = superadmin;
    await db.session.deleteMany({ where: { userId } });
    if (superadmin.created) {
      await db.user.deleteMany({ where: { id: userId } });
    } else {
      await db.twoFactor.deleteMany({ where: { userId } });
      if (superadmin.factors.length) await db.twoFactor.createMany({ data: superadmin.factors });
      await db.user.update({ where: { id: userId }, data: { twoFactorEnabled: superadmin.twoFactorEnabled,
        mfaRecoveryPendingAt: null, mfaRecoverySessionId: null } });
      if (superadmin.credential) await db.account.update({ where: { id: superadmin.credential.id }, data: { password: superadmin.credential.password } });
      else await db.account.deleteMany({ where: { userId, providerId: "credential" } });
    }
  }
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: companyUserId } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [companyHost, platformHost] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
}, TEST_TIMEOUT_MS);

function request(host: string, path: string, body?: object, cookie?: string) {
  const origin = `https://${host}`;
  return new Request(`${origin}/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: { host, origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}
const cookies = (response: Response) => response.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
const issuesSession = (response: Response) => response.headers.getSetCookie().some((item) => /session_token=[^;]+/.test(item) && !/max-age=0/i.test(item));

/** A valid Better Auth session cookie that did not come from a recovery code (e.g. leaked/forged before the fix). */
async function plainSession(userId: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required");
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { id: randomUUID(), userId, token, expiresAt: new Date(Date.now() + 60 * 60_000) } });
  return `better-auth.session_token=${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;
}

async function enroll(host: string, email: string) {
  const login = await POST(request(host, "sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  // An account that never had MFA (invitation/bootstrap) still gets the limited enrollment session.
  expect((await login.clone().json() as { enrollmentRequired?: boolean }).enrollmentRequired).toBe(true);
  const cookie = cookies(login);
  const setup = await POST(request(host, "two-factor/enable", { method: "totp", password }, cookie));
  expect(setup.status).toBe(200);
  const totp = OTPAuth.URI.parse((await setup.json() as { totpURI: string }).totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing TOTP");
  const confirmed = await POST(request(host, "two-factor/verify-totp", { code: totp.generate() }, cookie));
  expect(confirmed.status).toBe(200);
  return (await confirmed.json() as { backupCodes: string[] }).backupCodes;
}

async function startRecovery(host: string, email: string, code: string) {
  const challenge = await POST(request(host, "sign-in/email", { email, password }));
  expect((await challenge.clone().json() as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  const recovered = await POST(request(host, "two-factor/verify-backup-code", { code }, cookies(challenge)));
  expect(recovered.status).toBe(200);
  expect((await recovered.clone().json() as { enrollmentRequired?: boolean }).enrollmentRequired).toBe(true);
  return cookies(recovered);
}

async function passwordOnlyIsRefused(host: string, email: string, userId: string) {
  const before = await db.session.count({ where: { userId } });
  // Parallel attempts from another browser: none of them opens an enrollment session.
  const attempts = await Promise.all([0, 1, 2].map(() => POST(request(host, "sign-in/email", { email, password }))));
  for (const attempt of attempts) {
    expect(attempt.status).toBe(401);
    expect(await attempt.json()).toEqual({ code: "INVALID_CREDENTIALS" });
    expect(issuesSession(attempt)).toBe(false);
  }
  expect(await db.session.count({ where: { userId } })).toBe(before);
}

async function scenario(host: string, email: string, userId: string) {
  // The audit log is immutable, so a reused database keeps events of earlier runs; assert only on this run's.
  const [{ startedAt }] = await db.$queryRaw<{ startedAt: Date }[]>`SELECT clock_timestamp() AS "startedAt"`;
  await db.rateLimitEvent.deleteMany();
  const codes = await enroll(host, email);
  const recoveryCookie = await startRecovery(host, email, codes[0]);

  await db.rateLimitEvent.deleteMany();
  await passwordOnlyIsRefused(host, email, userId);
  const pending = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaRecoveryPendingAt: true, mfaRecoverySessionId: true } });
  expect(pending.mfaRecoveryPendingAt).toBeInstanceOf(Date);
  expect(pending.mfaRecoverySessionId).toEqual(expect.any(String));
  // Another unused recovery code cannot be presented: the old factor no longer exists and no challenge is issued.
  await db.rateLimitEvent.deleteMany();
  // A session that did not consume the recovery code cannot enroll a factor nor confirm one.
  const foreign = await plainSession(userId);
  expect((await POST(request(host, "two-factor/enable", { method: "totp", password }, foreign))).status).toBe(401);
  expect(await db.twoFactor.count({ where: { userId } })).toBe(0);
  expect((await POST(request(host, "two-factor/verify-totp", { code: "123456" }, foreign))).status).toBe(401);
  expect((await GET(request(host, "get-session", undefined, foreign))).status).toBe(401);
  expect((await GET(request(host, "get-session", undefined, recoveryCookie))).status).toBe(401);

  // The legitimate recovery session finishes the re-enrollment and only then gets full access.
  await db.rateLimitEvent.deleteMany();
  const setup = await POST(request(host, "two-factor/enable", { method: "totp", password }, recoveryCookie));
  expect(setup.status).toBe(200);
  const totp = OTPAuth.URI.parse((await setup.json() as { totpURI: string }).totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing replacement TOTP");
  // The foreign session still cannot confirm the factor prepared by the recovery session.
  expect((await POST(request(host, "two-factor/verify-totp", { code: totp.generate() }, foreign))).status).toBe(401);
  const completed = await POST(request(host, "two-factor/verify-totp", { code: totp.generate() }, recoveryCookie));
  expect(completed.status).toBe(200);
  expect((await completed.json() as { backupCodes: string[] }).backupCodes).toHaveLength(10);
  expect((await GET(request(host, "get-session", undefined, cookies(completed)))).status).toBe(200);
  const cleared = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { mfaRecoveryPendingAt: true, mfaRecoverySessionId: true, twoFactorEnabled: true } });
  expect(cleared).toEqual({ mfaRecoveryPendingAt: null, mfaRecoverySessionId: null, twoFactorEnabled: true });
  const audit = await db.auditLog.findMany({ where: { actorId: userId, createdAt: { gte: startedAt }, action: { in: ["MFA_RECOVERY_STARTED", "MFA_RECOVERY_COMPLETED"] } },
    orderBy: { createdAt: "asc" }, select: { action: true, safeChanges: true } });
  expect(audit.map((entry) => entry.action)).toEqual(["MFA_RECOVERY_STARTED", "MFA_RECOVERY_COMPLETED"]);
  expect(JSON.stringify(audit)).not.toMatch(new RegExp(`${codes[0]}|${totp.secret.base32}`));

  // After completion a password login is an ordinary MFA challenge again, never an enrollment session.
  await db.rateLimitEvent.deleteMany();
  const next = await POST(request(host, "sign-in/email", { email, password }));
  expect((await next.json() as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
}

test("company admin: password alone during a pending recovery opens no enrollment session", async () => {
  await scenario(companyHost, companyEmail, companyUserId);
}, TEST_TIMEOUT_MS);

test("superadmin: password alone during a pending recovery opens no enrollment session", async () => {
  if (!superadmin) throw new Error("Superadmin fixture missing");
  await scenario(platformHost, superadmin.email, superadmin.userId);
}, TEST_TIMEOUT_MS);

test("an abandoned recovery stays locked for the password; only the operator procedure reopens enrollment", async () => {
  // Start from a known factor: the operator procedure resets the account, then an ordinary first enrollment.
  await recoverMfaByOperator(db, { targetEmail: companyEmail, operatorId: "op-387", verifiedChannel: "phone-known",
    evidenceReference: "ticket:387-a", identityConfirmed: true });
  await db.rateLimitEvent.deleteMany();
  const backup = await enroll(companyHost, companyEmail);
  await startRecovery(companyHost, companyEmail, backup[1]);
  await db.rateLimitEvent.deleteMany();
  await passwordOnlyIsRefused(companyHost, companyEmail, companyUserId);

  await recoverMfaByOperator(db, { targetEmail: companyEmail, operatorId: "op-387", verifiedChannel: "phone-known",
    evidenceReference: "ticket:387-b", identityConfirmed: true });
  const reset = await db.user.findUniqueOrThrow({ where: { id: companyUserId }, select: { mfaRecoveryPendingAt: true, mfaRecoverySessionId: true } });
  expect(reset).toEqual({ mfaRecoveryPendingAt: null, mfaRecoverySessionId: null });
  await db.rateLimitEvent.deleteMany();
  const login = await POST(request(companyHost, "sign-in/email", { email: companyEmail, password }));
  expect(login.status).toBe(200);
  expect((await login.json() as { enrollmentRequired?: boolean }).enrollmentRequired).toBe(true);
}, TEST_TIMEOUT_MS);
