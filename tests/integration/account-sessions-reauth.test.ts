import { randomUUID } from "node:crypto";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, expect, test } from "vitest";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import * as exportRoute from "../../src/app/api/admin/export/route";
import { EXPORT_COMPANY_DATA_PURPOSE } from "../../src/modules/auth/reauth-proof";

// #72: the real reauth path with a real TOTP (producer in /mfa/reauth, consumer in /sessions/end and /mfa/rotate-backup-codes).
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const instance = createAuth(db, true);
const organizationId = randomUUID();
const host = `sessions-reauth-${randomUUID()}.example.test`;
const otherHost = `sessions-reauth-other-${randomUUID()}.example.test`;
const email = `sessions-reauth-${randomUUID()}@example.test`;
const password = "Fixture password 9384!";
let userId = "";
let totp: OTPAuth.TOTP;
let cookie = "";       // full MFA session
let secondCookie = ""; // second full MFA session
let pendingCookie = ""; // signed in, but MFA not proven

const cookies = (response: Response) => response.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
const call = (method: "GET" | "POST", path: string, jar: string, body?: object, origin = `https://${host}`, target = host) =>
  runWithTrustedClientAddress("10.7.7.7", () => (method === "GET" ? GET : POST)(new Request(`https://${target}/api/auth/${path}`, {
    method, headers: { host: target, origin, ...(body ? { "content-type": "application/json" } : {}), ...(jar ? { cookie: jar } : {}) },
    body: body ? JSON.stringify(body) : undefined })));
async function fullSession() {
  const login = await call("POST", "sign-in/email", "", { email, password });
  expect(login.status).toBe(200);
  const challenge = cookies(login);
  const done = await call("POST", "two-factor/verify-totp", challenge, { code: totp.generate() });
  expect(done.status).toBe(200);
  return cookies(done);
}
const reauth = (jar: string, extra: object = {}) => call("POST", "mfa/reauth", jar, { method: "totp", code: totp.generate(), ...extra });
const proofOf = async (response: Response) => (await response.json() as { proof: string }).proof;
const sessionCount = () => db.session.count({ where: { userId } });

beforeAll(async () => {
  await db.rateLimitEvent.deleteMany();
  await db.organization.create({ data: { id: organizationId, slug: `sessions-reauth-${organizationId}`, firstAdminRegisteredAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: host, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.hostMapping.create({ data: { hostname: otherHost, area: "PLATFORM", status: "ACTIVE" } });
  const registered = await instance.api.signUpEmail({ body: { name: "Sessions reauth", email, password } });
  userId = registered.user.id;
  await db.user.update({ where: { id: userId }, data: { role: "ADMIN_FIRMY", organizationId, emailVerified: true } });
  // Enrollment, exactly as in auth-http: sign in, enable TOTP, verify the first code.
  const login = await call("POST", "sign-in/email", "", { email, password });
  pendingCookie = cookies(login);
  const enrolled = await call("POST", "two-factor/enable", pendingCookie, { password, method: "totp" });
  expect(enrolled.status).toBe(200);
  const parsed = OTPAuth.URI.parse((await enrolled.json() as { totpURI: string }).totpURI);
  if (!(parsed instanceof OTPAuth.TOTP)) throw new Error("Missing enrollment TOTP");
  totp = parsed;
  const verified = await call("POST", "two-factor/verify-totp", pendingCookie, { code: totp.generate(), trustDevice: false });
  expect(verified.status).toBe(200);
  cookie = cookies(verified);
  // A session that has not proven MFA yet (password only, TOTP enabled on the account).
  pendingCookie = cookies(await call("POST", "sign-in/email", "", { email, password }));
  secondCookie = await fullSession();
});

afterAll(async () => {
  await db.rateLimitEvent.deleteMany();
  await db.verification.deleteMany({ where: { OR: [{ value: userId }, { value: { contains: `"userId":"${userId}"` } }] } });
  await db.job.deleteMany({ where: { organizationId } });
  await db.companyExport.deleteMany({ where: { organizationId } });
  await db.auditLog.deleteMany({ where: { OR: [{ organizationId }, { actorId: userId }] } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [host, otherHost] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test("a real TOTP reauth for end-sessions yields a proof that ends the other sessions", async () => {
  expect(await sessionCount()).toBe(3);
  const response = await reauth(cookie, { purpose: "end-sessions" });
  expect(response.status).toBe(200);
  const proof = await proofOf(response);
  expect(proof).toMatch(/^[a-f0-9]{64}$/);
  const ended = await call("POST", "sessions/end", cookie, { proof });
  expect(ended.status).toBe(200);
  expect(await ended.json()).toEqual({ status: true, ended: 2 }); // the second full session and the pending one
  expect((await call("GET", "get-session", secondCookie)).status).toBe(401);
  expect((await call("GET", "sessions", cookie)).status).toBe(200);
  expect(await sessionCount()).toBe(1);
  expect((await call("POST", "sessions/end", cookie, { proof })).status).toBe(401); // single use
  secondCookie = await fullSession();
});

test("a proof issued without purpose is for backup-code rotation only and is refused by sessions/end", async () => {
  const proof = await proofOf(await reauth(cookie));
  const refused = await call("POST", "sessions/end", cookie, { proof });
  expect(refused.status).toBe(401);
  expect(await sessionCount()).toBe(2);
  // It still works for its own purpose: rotation consumes it and (as designed) revokes the other sessions.
  expect((await call("POST", "mfa/rotate-backup-codes", cookie, { password, proof })).status).toBe(200);
  secondCookie = await fullSession();
});

test("an end-sessions proof is refused by backup-code rotation and stays usable for ending sessions", async () => {
  const proof = await proofOf(await reauth(cookie, { purpose: "end-sessions" }));
  expect((await call("POST", "mfa/rotate-backup-codes", cookie, { password, proof })).status).toBe(401);
  expect(await sessionCount()).toBe(2);
  expect((await call("POST", "sessions/end", cookie, { proof })).status).toBe(200);
  expect(await sessionCount()).toBe(1);
  secondCookie = await fullSession();
});

test("an unknown purpose with a valid code is refused and writes no proof", async () => {
  const before = await db.verification.count({ where: { value: { contains: `"userId":"${userId}"` } } });
  // Each refusal counts toward the failed-attempt limit, so start from a clean counter.
  for (const purpose of ["anything", 5, "END-SESSIONS"]) {
    await db.rateLimitEvent.deleteMany();
    const response = await reauth(cookie, { purpose });
    expect(response.status).toBe(401);
  }
  expect(await db.verification.count({ where: { value: { contains: `"userId":"${userId}"` } } })).toBe(before);
});

test("sessions/end refuses a foreign Origin, and sessions refuses a session without MFA proof", async () => {
  await db.rateLimitEvent.deleteMany();
  // A real session row whose MFA proof is cleared (a password-only login keeps its challenge in a cookie, not a row).
  pendingCookie = await fullSession();
  const row = await db.session.findFirstOrThrow({ where: { userId }, orderBy: { createdAt: "desc" } });
  await db.session.update({ where: { id: row.id }, data: { mfaVerifiedAt: null } });
  const proof = await proofOf(await reauth(cookie, { purpose: "end-sessions" }));
  expect((await call("POST", "sessions/end", cookie, { proof }, `https://evil-${host}`)).status).toBe(403);
  expect((await call("POST", "sessions/end", cookie, { proof }, `https://${otherHost}`)).status).toBe(403);
  expect(await sessionCount()).toBe(3);
  expect((await call("GET", "sessions", pendingCookie)).status).toBe(401);
  expect((await call("POST", "sessions/end", pendingCookie, { proof })).status).toBe(401);
  // The proof was not consumed by the refused calls.
  expect((await call("POST", "sessions/end", cookie, { proof })).status).toBe(200);
});

// #328: the real producer of the export proof (TOTP -> /mfa/reauth) and its consumer (POST /api/admin/export).
// The auth route issued https cookies (`__Secure-` prefix); the shared `auth` instance of the admin API reads the plain name.
const requestExport = (jar: string, body: object) => exportRoute.POST(new Request(`https://${host}/api/admin/export`, { method: "POST",
  headers: { host, origin: `https://${host}`, "content-type": "application/json", cookie: jar.replaceAll("__Secure-", "") }, body: JSON.stringify(body) }));

test("an export-company-data proof starts an export once, and is refused by sessions/end and backup-code rotation", async () => {
  await db.rateLimitEvent.deleteMany();
  const proof = await proofOf(await reauth(cookie, { purpose: EXPORT_COMPANY_DATA_PURPOSE }));
  expect(proof).toMatch(/^[a-f0-9]{64}$/);
  const sessionsBefore = await sessionCount();
  expect((await call("POST", "sessions/end", cookie, { proof })).status).toBe(401);
  expect((await call("POST", "mfa/rotate-backup-codes", cookie, { password, proof })).status).toBe(401);
  expect(await sessionCount()).toBe(sessionsBefore);
  const started = await requestExport(cookie, { proof, idempotencyKey: randomUUID() });
  expect(started.status).toBe(202);
  expect((await started.json() as { export: { status: string } }).export.status).toBe("PENDING");
  await db.companyExport.deleteMany({ where: { organizationId } }); // free the one-in-progress slot so only the proof decides
  await db.job.deleteMany({ where: { organizationId } });
  expect((await requestExport(cookie, { proof, idempotencyKey: randomUUID() })).status).toBe(401); // single use
  // Proofs of the other purposes do not start an export.
  const other = await proofOf(await reauth(cookie, { purpose: "end-sessions" }));
  expect((await requestExport(cookie, { proof: other, idempotencyKey: randomUUID() })).status).toBe(401);
  // A pending-MFA session cannot even ask.
  expect((await requestExport(pendingCookie, { proof: other, idempotencyKey: randomUUID() })).status).toBe(403);
});
