import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";
import { bootstrapSuperadmin } from "../../scripts/bootstrap-superadmin";
import { recoverMfaByOperator } from "../../scripts/recover-mfa";
import { decryptMailPayload } from "../../src/modules/jobs/outbox";
import { parseMailPayloadKey } from "../../src/modules/jobs/config";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const email = `bootstrap-${randomUUID()}@example.test`;
const password = "Fixture bootstrap password 9384!";
const tokenId = randomUUID();
const platformHost = `bootstrap-${randomUUID()}.example.test`;

afterAll(async () => {
  await db.verification.deleteMany({ where: { id: tokenId } });
  await db.user.deleteMany({ where: { email } });
  await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
  await db.$disconnect();
});

test("bootstrap refuses nonempty token storage and concurrent runs create exactly one login needing MFA", async () => {
  await db.verification.create({ data: { id: tokenId, identifier: "bootstrap-test", value: "fixture", expiresAt: new Date("2027-01-01T00:00:00Z") } });
  await expect(bootstrapSuperadmin(db, { name: "Operator", email, password, platformHost })).rejects.toThrow(/empty database/);
  await db.verification.delete({ where: { id: tokenId } });

  const results = await Promise.allSettled(Array.from({ length: 2 }, () => bootstrapSuperadmin(db, { name: "Operator", email, password, platformHost })));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.hostMapping.count({ where: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE", organizationId: null } })).toBe(1);
  expect(await db.user.count({ where: { role: "SUPERADMIN_AUTERVA" } })).toBe(1);
  const auth = createAuth(db);
  const login = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  expect(login.response.user.email).toBe(email);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.twoFactorEnabled).toBe(false);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ") }) });
  expect(session?.user.id).toBe(user.id);
  expect((await db.session.findUnique({ where: { id: session?.session.id ?? "" } }))?.mfaVerifiedAt).toBeNull();

  // This is a dedicated fixture database; clear limiter traffic left by other auth tests.
  await db.rateLimitEvent.deleteMany();

  const request = (path: string, body?: object, cookie?: string) => new Request(`https://${platformHost}/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: { host: platformHost, origin: `https://${platformHost}`, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const firstLogin = await POST(request("sign-in/email", { email, password }));
  expect(firstLogin.status).toBe(200);
  const firstCookie = firstLogin.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request("get-session", undefined, firstCookie))).status).toBe(401);
  const enrollment = await POST(request("two-factor/enable", { password, method: "totp" }, firstCookie));
  expect(enrollment.status).toBe(200);
  const setup = await enrollment.json() as { totpURI: string; backupCodes?: string[] };
  expect(setup.backupCodes).toBeUndefined();
  const totp = OTPAuth.URI.parse(setup.totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing enrollment TOTP");
  const confirmation = await POST(request("two-factor/verify-totp", { code: totp.generate() }, firstCookie));
  expect(confirmation.status).toBe(200);
  expect((await confirmation.json() as { backupCodes?: string[] }).backupCodes).toHaveLength(10);
  const fullCookie = confirmation.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request("get-session", undefined, fullCookie))).status).toBe(200);

  const recovery = { targetEmail: email, operatorId: "owner-fixture", verifiedChannel: "agreed offline phone", evidenceReference: "local-fixture-1", identityConfirmed: true };
  await expect(recoverMfaByOperator(db, { ...recovery, identityConfirmed: false })).rejects.toThrow();
  expect((await GET(request("get-session", undefined, fullCookie))).status).toBe(200);
  const result = await recoverMfaByOperator(db, recovery);
  expect(result.userId).toBe(user.id);
  expect(result.revokedSessions).toBeGreaterThan(0);
  expect(await db.user.count({ where: { role: "SUPERADMIN_AUTERVA" } })).toBe(1);
  expect((await db.user.findUnique({ where: { id: user.id } }))?.twoFactorEnabled).toBe(false);
  expect(await db.twoFactor.count({ where: { userId: user.id } })).toBe(0);
  expect((await GET(request("get-session", undefined, fullCookie))).status).toBe(401);
  const recoveryAudit = await db.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: "MFA_OPERATOR_RECOVERY" } });
  expect(recoveryAudit).toMatchObject({ actorId: "operator:owner-fixture", actorRole: "OPERATOR", organizationId: null });
  expect(JSON.stringify(recoveryAudit.safeChanges)).not.toContain(recovery.evidenceReference);
  expect(recoveryAudit.safeChanges).toMatchObject({ identityConfirmed: true, revokedSessions: result.revokedSessions });
  const restarted = await POST(request("sign-in/email", { email, password }));
  expect((await restarted.json() as { enrollmentRequired?: boolean }).enrollmentRequired).toBe(true);
  const restartCookie = restarted.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const newSetup = await POST(request("two-factor/enable", { method: "totp", password }, restartCookie));
  expect(newSetup.status).toBe(200);
  const replacement = OTPAuth.URI.parse((await newSetup.json() as { totpURI: string }).totpURI);
  if (!(replacement instanceof OTPAuth.TOTP)) throw new Error("Missing replacement TOTP");
  const newlyConfirmed = await POST(request("two-factor/verify-totp", { code: replacement.generate() }, restartCookie));
  expect(newlyConfirmed.status).toBe(200);
  const newCookie = newlyConfirmed.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request("get-session", undefined, newCookie))).status).toBe(200);

  const mailKey = parseMailPayloadKey(process.env.MAIL_PAYLOAD_KEY);
  const resetRequested = await POST(request("password/request-reset", { email, idempotencyKey: randomUUID() }));
  expect(resetRequested.status).toBe(200);
  expect(await resetRequested.json()).toEqual({ accepted: true });
  const resetJob = await db.job.findFirstOrThrow({ where: { kind: "MAIL_PASSWORD_RESET", organizationId: null } });
  const resetLink = decryptMailPayload(resetJob.payload, mailKey).url;
  expect(resetLink).toMatch(new RegExp(`^https://${platformHost}/reset-hasla/`));
  const resetToken = decodeURIComponent(resetLink.split("/").at(-1)!);
  const newPassword = "New bootstrap password 9384!";
  const reset = await POST(request("password/reset", { token: resetToken, newPassword }));
  expect(reset.status).toBe(200);
  expect((await GET(request("get-session", undefined, newCookie))).status).toBe(401);
  expect((await POST(request("sign-in/email", { email, password }))).status).toBe(401);
  const afterReset = await POST(request("sign-in/email", { email, password: newPassword }));
  expect(await afterReset.json()).toEqual({ twoFactorRedirect: true });
  const challengeCookie = afterReset.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const afterMfa = await POST(request("two-factor/verify-totp", { code: replacement.generate() }, challengeCookie));
  expect(afterMfa.status).toBe(200);
  const afterMfaCookie = afterMfa.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request("get-session", undefined, afterMfaCookie))).status).toBe(200);
});
