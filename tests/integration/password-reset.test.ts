import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { decryptMailPayload, enqueueMail } from "../../src/modules/jobs/outbox";
import { requestPasswordReset, resetPassword } from "../../src/modules/auth/account-operations";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const otherOrganizationId = randomUUID();
const hostname = `reset-${randomUUID()}.example.test`;
const otherHostname = `reset-${randomUUID()}.example.test`;
const email = `reset-${randomUUID()}@example.test`;
const userId = randomUUID();
const pendingUserId = randomUUID();
const pendingEmail = `pending-${randomUUID()}@example.test`;
const originalPassword = "Original password 9384!";
const nextPassword = "Next password 9384!";
const mailKey = randomBytes(32);
// One fixture clock for relative TTL assertions; Better Auth's cleanup uses
// the actual process clock, so an old absolute timestamp would expire mid-run.
const now = new Date();
const scope = { area: "COMPANY_ADMIN" as const, organizationId };
const ownRequestIds: string[] = [];
const testIp = `10.${randomBytes(3).join(".")}`;
let enrolledTotp: OTPAuth.TOTP | null = null;

beforeAll(async () => {
  await db.organization.createMany({ data: [
    { id: organizationId, slug: `reset-${organizationId}` },
    { id: otherOrganizationId, slug: `reset-${otherOrganizationId}` },
  ] });
  await db.hostMapping.createMany({ data: [
    { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: otherHostname, area: "COMPANY_ADMIN", organizationId: otherOrganizationId, status: "ACTIVE" },
  ] });
  await db.user.create({ data: { id: userId, email, name: "Reset fixture", emailVerified: true,
    twoFactorEnabled: false, role: "ADMIN_FIRMY", organizationId } });
  await db.account.create({ data: { id: randomUUID(), accountId: userId,
    providerId: "credential", userId, password: await hashPassword(originalPassword) } });
  await db.user.create({ data: { id: pendingUserId, email: pendingEmail, name: "Pending fixture",
    emailVerified: false, twoFactorEnabled: false, role: "ADMIN_FIRMY", organizationId: otherOrganizationId } });
});

afterAll(async () => {
  await db.job.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId } });
  await db.passwordResetRequest.deleteMany({ where: { OR: [
    { id: { in: ownRequestIds } }, { hostname: { in: [hostname, otherHostname] } },
  ] } });
  await db.verification.deleteMany({ where: { identifier: `password-reset:${email}` } });
  await db.verification.deleteMany({ where: { identifier: `password-reset:${pendingEmail}` } });
  await db.auditLog.deleteMany({ where: { actorId: userId } });
  await db.user.deleteMany({ where: { id: { in: [userId, pendingUserId] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostname, otherHostname] } } });
  await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await db.$disconnect();
});

test("pending preregistration without credentials cannot obtain or consume a reset proof", async () => {
  const pendingScope = { area: "COMPANY_ADMIN" as const, organizationId: otherOrganizationId };
  const baseline = await db.user.findUniqueOrThrow({ where: { id: pendingUserId } });
  const requestKey = randomUUID();
  expect(await requestPasswordReset(db, { email: pendingEmail, idempotencyKey: requestKey,
    scope: pendingScope, hostname: otherHostname, now, mailKey })).toEqual({ accepted: true });
  const requestKeyHash = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(requestKey).digest("hex");
  const receipt = await db.passwordResetRequest.findUniqueOrThrow({ where: { requestKeyHash } });
  expect(receipt.userId).toBeNull();
  expect(await db.verification.count({ where: { identifier: `password-reset:${pendingEmail}` } })).toBe(0);
  expect(await db.job.count({ where: { kind: "MAIL_PASSWORD_RESET", organizationId: otherOrganizationId } })).toBe(0);
  // Even a prematurely verified reservation is not a credential account.
  await db.user.update({ where: { id: pendingUserId }, data: { emailVerified: true } });
  const verifiedKey = randomUUID();
  await requestPasswordReset(db, { email: pendingEmail, idempotencyKey: verifiedKey,
    scope: pendingScope, hostname: otherHostname, now, mailKey });
  expect(await db.verification.count({ where: { identifier: `password-reset:${pendingEmail}` } })).toBe(0);
  expect(await db.job.count({ where: { kind: "MAIL_PASSWORD_RESET", organizationId: otherOrganizationId } })).toBe(0);
  const forgedToken = randomBytes(32).toString("base64url");
  const verificationId = randomUUID();
  await db.verification.create({ data: { id: verificationId, identifier: `password-reset:${pendingEmail}`,
    value: createHash("sha256").update(forgedToken).digest("hex"),
    expiresAt: new Date(now.getTime() + 30 * 60_000) } });
  await db.passwordResetRequest.update({ where: { requestKeyHash }, data: {
    userId: pendingUserId, verificationId,
  } });
  await expect(db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET",
    scope: "COMPANY_ADMIN", organizationId: otherOrganizationId, recipient: pendingEmail,
    referenceId: verificationId, token: forgedToken, runAt: now }, mailKey))).rejects.toThrow(/Reset recipient/);
  expect(await db.job.count({ where: { kind: "MAIL_PASSWORD_RESET", organizationId: otherOrganizationId } })).toBe(0);
  const beforeAttempt = await db.user.findUniqueOrThrow({ where: { id: pendingUserId } });
  expect(await resetPassword(db, { token: forgedToken, newPassword: nextPassword,
    scope: pendingScope, hostname: otherHostname, now, requestId: randomUUID() })).toBe(false);
  expect(await resetPassword(db, { token: randomBytes(32).toString("base64url"), newPassword: nextPassword,
    scope: pendingScope, hostname: otherHostname, now, requestId: randomUUID() })).toBe(false);
  expect(await db.account.count({ where: { userId: pendingUserId } })).toBe(0);
  expect(await db.user.findUniqueOrThrow({ where: { id: pendingUserId } })).toEqual(beforeAttempt);
  expect(await db.auditLog.count({ where: { actorId: pendingUserId } })).toBe(0);
  expect(baseline.emailVerified).toBe(false);
});

async function issue(address: string, key = randomUUID(), at = now) {
  const result = await requestPasswordReset(db, { email: address, idempotencyKey: key,
    scope, hostname, now: at, mailKey });
  expect(result).toEqual({ accepted: true });
  const requestKeyHash = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(key).digest("hex");
  const receipt = await db.passwordResetRequest.findUniqueOrThrow({ where: { requestKeyHash } });
  if (!ownRequestIds.includes(receipt.id)) ownRequestIds.push(receipt.id);
  return receipt;
}

test("neutral request, encrypted outbox and idempotent retry do not renew the 30-minute proof", async () => {
  const unknown = `missing-${randomUUID()}@example.test`;
  const unknownKey = randomUUID();
  await issue(unknown, unknownKey);
  expect(await db.verification.count({ where: { identifier: `password-reset:${unknown}` } })).toBe(0);
  const key = randomUUID();
  const first = await issue(email, key);
  const verification = await db.verification.findUniqueOrThrow({ where: { id: first.verificationId! } });
  expect(verification.expiresAt).toEqual(new Date(now.getTime() + 30 * 60_000));
  const job = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${verification.id}` } });
  expect(JSON.stringify(job.payload)).not.toContain(email);
  const payload = decryptMailPayload(job.payload, mailKey);
  expect(payload.url).toMatch(new RegExp(`^https://${hostname}/admin/reset-hasla/`));
  await issue(email, key, new Date(now.getTime() + 60_000));
  expect(await db.verification.findUniqueOrThrow({ where: { id: verification.id } })).toMatchObject({
    value: verification.value, expiresAt: verification.expiresAt,
  });
  expect(await db.job.count({ where: { dedupeKey: job.dedupeKey } })).toBe(1);
});

test("new request revokes old token; host, exact expiry and concurrent consumption are enforced", async () => {
  const old = await issue(email, randomUUID(), now);
  const oldJob = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${old.verificationId}` } });
  const oldToken = decodeURIComponent(decryptMailPayload(oldJob.payload, mailKey).url.split("/").at(-1)!);
  const nextAt = new Date(now.getTime() + 5_000);
  const latest = await issue(email, randomUUID(), nextAt);
  const latestJob = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${latest.verificationId}` } });
  const token = decodeURIComponent(decryptMailPayload(latestJob.payload, mailKey).url.split("/").at(-1)!);
  const scanner = await GET(new Request(`https://${hostname}/api/auth/password/reset?token=${token}`,
    { headers: { host: hostname } }));
  expect(scanner.status).toBe(405);
  expect(await db.verification.count({ where: { id: latest.verificationId! } })).toBe(1);
  expect(await resetPassword(db, { token: oldToken, newPassword: nextPassword,
    scope, hostname, now: nextAt, requestId: randomUUID() })).toBe(false);
  expect(await resetPassword(db, { token, newPassword: nextPassword,
    scope, hostname: otherHostname, now: nextAt, requestId: randomUUID() })).toBe(false);
  expect(await resetPassword(db, { token, newPassword: nextPassword,
    scope, hostname, now: new Date(nextAt.getTime() + 30 * 60_000), requestId: randomUUID() })).toBe(false);
  await db.session.create({ data: { id: randomUUID(), token: randomUUID(), userId,
    expiresAt: new Date(nextAt.getTime() + 60 * 60_000), mfaVerifiedAt: nextAt } });
  const outcomes = await Promise.all([
    resetPassword(db, { token, newPassword: nextPassword, scope, hostname, now: nextAt, requestId: randomUUID() }),
    resetPassword(db, { token, newPassword: nextPassword, scope, hostname, now: nextAt, requestId: randomUUID() }),
  ]);
  expect(outcomes.sort()).toEqual([false, true]);
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect(await verifyPassword({ hash: (await db.account.findFirstOrThrow({ where: { userId } })).password!,
    password: nextPassword })).toBe(true);
  expect(await db.auditLog.count({ where: { actorId: userId, action: "AUTH_PASSWORD_CHANGED" } })).toBe(1);
  expect(await db.verification.count({ where: { identifier: `password-reset:${email}` } })).toBe(0);
});

function postReset(host: string, path: string, body: object, origin = `https://${host}`, cookie?: string,
  sourceIp = testIp) {
  return runWithTrustedClientAddress(sourceIp, () => POST(new Request(`https://${host}/api/auth/${path}`, { method: "POST",
    headers: { host, origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body) })));
}

test("HTTP reset is host/Origin scoped, neutral and uses the encrypted outbox", async () => {
  await db.serviceAccess.create({ data: { organizationId, trialGranted: true,
    trialStartedAt: new Date(now.getTime() - 30 * 86_400_000),
    trialEndsAt: new Date(now.getTime() - 16 * 86_400_000),
    paidThrough: new Date(now.getTime() - 3 * 86_400_000) } });
  const previous = process.env.MAIL_PAYLOAD_KEY;
  process.env.MAIL_PAYLOAD_KEY = mailKey.toString("hex");
  try {
    const idempotencyKey = randomUUID();
    const body = { email, idempotencyKey };
    expect((await postReset(otherHostname, "password/request-reset", {
      ...body, idempotencyKey: randomUUID() })).status).toBe(200);
    expect((await postReset(hostname, "password/request-reset", body, `https://${otherHostname}`)).status).toBe(403);
    const own = await postReset(hostname, "password/request-reset", body);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ accepted: true });
    expect(own.headers.getSetCookie()).toEqual([]);
    const unknown = await postReset(hostname, "password/request-reset", {
      email: `missing-${randomUUID()}@example.test`, idempotencyKey: randomUUID() });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({ accepted: true });
    const job = await db.job.findFirstOrThrow({ where: { organizationId,
      kind: "MAIL_PASSWORD_RESET" }, orderBy: { createdAt: "desc" } });
    const token = decodeURIComponent(decryptMailPayload(job.payload, mailKey).url.split("/").at(-1)!);
    const wrongHost = await postReset(otherHostname, "password/reset", { token,
      newPassword: "Third password 9384!" });
    expect(wrongHost.status).toBe(401);
    const completed = await postReset(hostname, "password/reset", { token,
      newPassword: "Third password 9384!" });
    expect(completed.status).toBe(200);
    expect(await verifyPassword({ hash: (await db.account.findFirstOrThrow({ where: { userId } })).password!,
      password: "Third password 9384!" })).toBe(true);
  } finally {
    if (previous === undefined) delete process.env.MAIL_PAYLOAD_KEY;
    else process.env.MAIL_PAYLOAD_KEY = previous;
  }
});

test("reset limits share the account budget across hosts and cap twenty requests per trusted IP", async () => {
  const previous = process.env.MAIL_PAYLOAD_KEY;
  process.env.MAIL_PAYLOAD_KEY = mailKey.toString("hex");
  try {
    const missing = `limited-${randomUUID()}@example.test`;
    const accountIp = `10.${randomBytes(3).join(".")}`;
    const otherIp = `10.${randomBytes(3).join(".")}`;
    for (let index = 0; index < 3; index++) {
      expect((await postReset(hostname, "password/request-reset", {
        email: missing, idempotencyKey: randomUUID(),
      }, undefined, undefined, accountIp)).status).toBe(200);
    }
    const blockedAccount = await postReset(otherHostname, "password/request-reset", {
      email: missing, idempotencyKey: randomUUID(),
    }, undefined, undefined, otherIp);
    expect(blockedAccount.status).toBe(429);
    expect(Number(blockedAccount.headers.get("Retry-After"))).toBeGreaterThan(0);
    const ip = `10.${randomBytes(3).join(".")}`;
    for (let index = 0; index < 20; index++) {
      expect((await postReset(hostname, "password/request-reset", {
        email: `missing-${index}-${randomUUID()}@example.test`, idempotencyKey: randomUUID(),
      }, undefined, undefined, ip)).status).toBe(200);
    }
    const blockedIp = await postReset(hostname, "password/request-reset", {
      email: `missing-${randomUUID()}@example.test`, idempotencyKey: randomUUID(),
    }, undefined, undefined, ip);
    expect(blockedIp.status).toBe(429);
    expect(Number(blockedIp.headers.get("Retry-After"))).toBeGreaterThan(0);
  } finally {
    if (previous === undefined) delete process.env.MAIL_PAYLOAD_KEY;
    else process.env.MAIL_PAYLOAD_KEY = previous;
  }
});

test("profile edits only name; password change requires full MFA and current password, then revokes all sessions", async () => {
  const currentPassword = "Third password 9384!";
  const login = await postReset(hostname, "sign-in/email", { email, password: currentPassword });
  expect(login.status).toBe(200);
  const limitedCookie = login.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  expect((await postReset(hostname, "profile", { name: "New Name" }, undefined, limitedCookie)).status).toBe(401);
  const enable = await postReset(hostname, "two-factor/enable", { method: "totp", password: currentPassword },
    undefined, limitedCookie);
  expect(enable.status).toBe(200);
  const totp = OTPAuth.URI.parse((await enable.json() as { totpURI: string }).totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("TOTP enrollment fixture missing");
  enrolledTotp = totp;
  const verified = await postReset(hostname, "two-factor/verify-totp", { code: totp.generate() },
    undefined, limitedCookie);
  expect(verified.status).toBe(200);
  const fullCookie = verified.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ") || limitedCookie;
  const sessionCountBeforeWrongHost = await db.session.count({ where: { userId } });
  const wrongHostLogin = await postReset(otherHostname, "sign-in/email", { email, password: currentPassword });
  expect(wrongHostLogin.status).toBe(401);
  expect(wrongHostLogin.headers.getSetCookie()).toEqual([]);
  expect(await db.session.count({ where: { userId } })).toBe(sessionCountBeforeWrongHost);
  expect((await postReset(otherHostname, "profile", { name: "Wrong Tenant" }, undefined, fullCookie)).status).toBe(401);
  expect((await postReset(hostname, "profile", { name: "Wrong", role: "SUPERADMIN_AUTERVA" },
    undefined, fullCookie)).status).toBe(400);
  // #176: NUL and other control characters in the name are a client error, not a PostgreSQL 500.
  for (const name of ["a\u0000b", "a\u0001b", "a\nb"]) {
    const refused = await postReset(hostname, "profile", { name }, undefined, fullCookie);
    expect(refused.status, JSON.stringify(name)).toBe(400);
    expect(await refused.json()).toEqual({ code: "INVALID_REQUEST", fieldErrors: { name: "INVALID_CHARACTERS" } });
  }
  expect((await postReset(hostname, "profile", { name: "New Name" }, undefined, fullCookie)).status).toBe(200);
  expect(await db.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({
    name: "New Name", role: "ADMIN_FIRMY", organizationId,
  });
  const wrong = await postReset(hostname, "password/change", { currentPassword: "wrong password",
    newPassword: "Fourth password 9384!" }, undefined, fullCookie);
  expect(wrong.status).toBe(401);
  const waitingLogin = await postReset(hostname, "sign-in/email", { email, password: currentPassword });
  expect(waitingLogin.status).toBe(200);
  expect(await waitingLogin.json()).toEqual({ twoFactorRedirect: true });
  const waitingCookie = waitingLogin.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  const [changed, competingMfa] = await Promise.all([
    postReset(hostname, "password/change", { currentPassword,
      newPassword: "Fourth password 9384!" }, undefined, fullCookie),
    postReset(hostname, "two-factor/verify-totp", { code: totp.generate() }, undefined, waitingCookie),
  ]);
  expect(changed.status).toBe(200);
  expect([200, 401]).toContain(competingMfa.status);
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect((await postReset(hostname, "profile", { name: "After revocation" }, undefined, fullCookie)).status).toBe(401);
  expect(await verifyPassword({ hash: (await db.account.findFirstOrThrow({ where: { userId } })).password!,
    password: "Fourth password 9384!" })).toBe(true);
  expect((await postReset(hostname, "two-factor/verify-totp", { code: totp.generate() },
    undefined, waitingCookie)).status).toBe(401);
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect(await db.auditLog.count({ where: { actorId: userId, action: "AUTH_PROFILE_UPDATED" } })).toBe(1);
});

test("an audit write failure rolls back token consumption, password and session revocation", async () => {
  const receipt = await issue(email);
  const job = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${receipt.verificationId}` } });
  const token = decodeURIComponent(decryptMailPayload(job.payload, mailKey).url.split("/").at(-1)!);
  const sessionId = randomUUID();
  await db.session.create({ data: { id: sessionId, token: randomUUID(), userId,
    expiresAt: new Date(now.getTime() + 60 * 60_000), mfaVerifiedAt: now } });
  const previousHash = (await db.account.findFirstOrThrow({ where: { userId } })).password;
  const previousAuditCount = await db.auditLog.count({ where: { actorId: userId } });
  const failingAudit = db.$extends({ query: { auditLog: {
    async createMany() { throw new Error("injected audit failure"); },
  } } });
  await expect(resetPassword(failingAudit as typeof db, { token, newPassword: "Rolled back password 9384!",
    scope, hostname, now, requestId: randomUUID() })).rejects.toThrow("injected audit failure");
  expect((await db.account.findFirstOrThrow({ where: { userId } })).password).toBe(previousHash);
  expect(await db.session.count({ where: { id: sessionId } })).toBe(1);
  expect(await db.verification.count({ where: { id: receipt.verificationId! } })).toBe(1);
  expect(await db.auditLog.count({ where: { actorId: userId } })).toBe(previousAuditCount);
  await db.session.delete({ where: { id: sessionId } });
});

test("expired service keeps reset and MFA login available; archive blocks issuance and login", async () => {
  const pendingLogin = await postReset(hostname, "sign-in/email", {
    email, password: "Fourth password 9384!",
  });
  expect(pendingLogin.status).toBe(200);
  expect(await pendingLogin.json()).toEqual({ twoFactorRedirect: true });
  const pendingCookie = pendingLogin.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  const receipt = await issue(email);
  const job = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${receipt.verificationId}` } });
  const token = decodeURIComponent(decryptMailPayload(job.payload, mailKey).url.split("/").at(-1)!);
  if (!enrolledTotp) throw new Error("Missing enrolled MFA fixture");
  const [resetResult, competingMfa] = await Promise.all([
    resetPassword(db, { token, newPassword: "Fifth password 9384!",
      scope, hostname, now, requestId: randomUUID() }),
    postReset(hostname, "two-factor/verify-totp", { code: enrolledTotp.generate() },
      undefined, pendingCookie),
  ]);
  expect(resetResult).toBe(true);
  expect([200, 401]).toContain(competingMfa.status);
  expect(await db.session.count({ where: { userId } })).toBe(0);
  expect((await postReset(hostname, "two-factor/verify-totp", { code: enrolledTotp.generate() },
    undefined, pendingCookie)).status).toBe(401);
  const afterResetLogin = await postReset(hostname, "sign-in/email", {
    email, password: "Fifth password 9384!",
  });
  expect(afterResetLogin.status).toBe(200);
  expect(await afterResetLogin.json()).toEqual({ twoFactorRedirect: true });
  const afterResetCookie = afterResetLogin.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  const completedMfa = await postReset(hostname, "two-factor/verify-totp", {
    code: enrolledTotp.generate(),
  }, undefined, afterResetCookie);
  expect(completedMfa.status).toBe(200);
  const fullCookie = completedMfa.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
  expect((await GET(new Request(`https://${hostname}/api/auth/get-session`,
    { headers: { host: hostname, cookie: fullCookie } }))).status).toBe(200);
  await db.organization.update({ where: { id: organizationId }, data: { archivedAt: now } });
  const archived = await issue(email);
  expect(archived.userId).toBeNull();
  expect(archived.verificationId).toBeNull();
  expect((await GET(new Request(`https://${hostname}/api/auth/get-session`,
    { headers: { host: hostname, cookie: fullCookie } }))).status).toBe(401);
  const sessionsBeforeArchivedLogin = await db.session.count({ where: { userId } });
  const archivedLogin = await postReset(hostname, "sign-in/email", { email, password: "Fifth password 9384!" });
  expect(archivedLogin.status).toBe(401);
  expect(archivedLogin.headers.getSetCookie()).toEqual([]);
  expect(await db.session.count({ where: { userId } })).toBe(sessionsBeforeArchivedLogin);
});
