import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const instance = createAuth(db, true);
const organizationId = randomUUID();
const hostname = `admin-${randomUUID()}.example.test`;
const otherOrganizationId = randomUUID();
const otherHostname = `admin-${randomUUID()}.example.test`;
const publicHost = `public-${randomUUID()}.example.test`;
const platformHost = `platform-${randomUUID()}.example.test`;
const email = `http-${randomUUID()}@example.test`;
const otherEmail = `http-${randomUUID()}@example.test`;
const password = "Fixture password 9384!";
let fixtureUserId = "";

beforeAll(async () => {
  await db.rateLimitEvent.deleteMany();
  await db.organization.create({ data: { id: organizationId, slug: `http-${organizationId}` } });
  await db.organization.create({ data: { id: otherOrganizationId, slug: `http-${otherOrganizationId}` } });
  await db.hostMapping.createMany({ data: [
    { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: otherHostname, area: "COMPANY_ADMIN", organizationId: otherOrganizationId, status: "ACTIVE" },
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  const registered = await instance.api.signUpEmail({ body: { name: "HTTP fixture", email, password } });
  fixtureUserId = registered.user.id;
  await db.user.update({ where: { id: registered.user.id }, data: { role: "ADMIN_FIRMY", organizationId, emailVerified: true } });
  const other = await instance.api.signUpEmail({ body: { name: "Other company fixture", email: otherEmail, password } });
  await db.user.update({ where: { id: other.user.id }, data: { role: "ADMIN_FIRMY", organizationId: otherOrganizationId, emailVerified: true } });
});

afterAll(async () => {
  await db.rateLimitEvent.deleteMany();
  await db.verification.deleteMany({ where: { OR: [
    { value: fixtureUserId }, { value: { contains: `"userId":"${fixtureUserId}"` } },
  ] } });
  await db.auditLog.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { email: { in: [email, otherEmail] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostname, otherHostname, publicHost, platformHost] } } });
  await db.organization.deleteMany({ where: { id: { in: [organizationId, otherOrganizationId] } } });
  await db.$disconnect();
});

function request(host: string, path: string, body?: object, cookie?: string) {
  const origin = `https://${host}`;
  return new Request(`${origin}/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: { host, origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("auth HTTP accepts only an active admin host and closes signup/public/other-host entries", async () => {
  const previous = process.env.AUTERVA_AUTH_PROBE;
  delete process.env.AUTERVA_AUTH_PROBE;
  try {
    expect((await POST(request(publicHost, "sign-in/email", { email, password }))).status).toBe(404);
    expect((await POST(request(hostname, "sign-up/email", { name: "X", email, password }))).status).toBe(404);
    expect((await POST(request(hostname, "two-factor/disable", { password }))).status).toBe(404);
    const wrong = request(hostname, "sign-in/email", { email, password });
    wrong.headers.set("host", publicHost);
    expect((await POST(wrong)).status).toBe(404);
    const login = await POST(request(hostname, "sign-in/email", { email, password }));
    expect(login.status).toBe(200);
    expect(login.headers.getSetCookie().every((item) => !/domain=/i.test(item) && /httponly/i.test(item))).toBe(true);
    expect((await login.clone().json() as { token?: string }).token).toBeUndefined();
    const cookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
    expect(cookie).toContain("session_token");
    const limited = await GET(request(hostname, "get-session", undefined, cookie));
    expect(limited.status).toBe(401);
  } finally {
    if (previous === undefined) delete process.env.AUTERVA_AUTH_PROBE;
    else process.env.AUTERVA_AUTH_PROBE = previous;
  }
});

test("a valid company password on the platform host leaves no issued session", async () => {
  const before = await db.session.count({ where: { user: { email } } });
  const response = await POST(request(platformHost, "sign-in/email", { email, password }));
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await db.session.count({ where: { user: { email } } })).toBe(before);
});

test("MFA enrollment session is limited to the user's own admin host", async () => {
  const login = await POST(request(hostname, "sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const wrong = await POST(request(platformHost, "two-factor/enable", { password, method: "totp" }, cookie));
  expect(wrong.status).toBe(401);
  expect((await POST(request(otherHostname, "two-factor/enable", { password, method: "totp" }, cookie))).status).toBe(401);
  expect((await POST(request(hostname, "two-factor/enable", { password, method: "otp" }, cookie))).status).toBe(401);
  expect(await db.twoFactor.count({ where: { user: { email } } })).toBe(0);
  const own = await POST(request(hostname, "two-factor/enable", { password, method: "totp" }, cookie));
  expect(own.status).toBe(200);
  const enrollment = await own.json() as { totpURI: string; backupCodes?: string[] };
  expect(enrollment.backupCodes).toBeUndefined();
  const totp = OTPAuth.URI.parse(enrollment.totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing enrollment TOTP");
  const verified = await POST(request(hostname, "two-factor/verify-totp", { code: totp.generate(), trustDevice: false }, cookie));
  expect(verified.status).toBe(200);
  const result = await verified.json() as { backupCodes?: string[] };
  expect(result.backupCodes).toHaveLength(10);
  const fullCookie = verified.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request(hostname, "get-session", undefined, fullCookie))).status).toBe(200);
  const fullBody = await (await GET(request(hostname, "get-session", undefined, fullCookie))).json() as { session: { token?: string } };
  expect(fullBody.session.token).toBeUndefined();

  const nextLogin = await POST(request(hostname, "sign-in/email", { email, password }));
  expect(nextLogin.status).toBe(200);
  expect((await nextLogin.json() as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  const challengeCookie = nextLogin.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect(challengeCookie).toContain("two_factor");
  expect((await POST(request(platformHost, "two-factor/verify-totp", { code: totp.generate() }, challengeCookie))).status).toBe(401);
  expect((await POST(request(otherHostname, "two-factor/verify-totp", { code: totp.generate() }, challengeCookie))).status).toBe(401);
  const completed = await POST(request(hostname, "two-factor/verify-totp", { code: totp.generate() }, challengeCookie));
  expect(completed.status).toBe(200);
  const completeCookie = completed.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request(hostname, "get-session", undefined, completeCookie))).status).toBe(200);

  const otherLogin = await POST(request(hostname, "sign-in/email", { email, password }));
  const otherChallenge = otherLogin.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const otherComplete = await POST(request(hostname, "two-factor/verify-totp", { code: totp.generate() }, otherChallenge));
  expect(otherComplete.status).toBe(200);
  const otherCookie = otherComplete.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request(hostname, "get-session", undefined, otherCookie))).status).toBe(200);

  await db.rateLimitEvent.deleteMany();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    expect((await POST(request(hostname, "mfa/reauth", { method: "totp", code: null }, otherCookie))).status).toBe(401);
  }
  const reauthLimit = await POST(request(hostname, "mfa/reauth", { method: "totp", code: totp.generate() }, otherCookie));
  expect(reauthLimit.status).toBe(429);
  expect(Number(reauthLimit.headers.get("Retry-After"))).toBeGreaterThan(0);
  await db.rateLimitEvent.deleteMany();

  const firstRecovery = result.backupCodes?.[0];
  if (!firstRecovery) throw new Error("Missing recovery code");
  const recoveryRace = await Promise.all([
    POST(request(hostname, "mfa/reauth", { method: "recovery", code: firstRecovery }, completeCookie)),
    POST(request(hostname, "mfa/reauth", { method: "recovery", code: firstRecovery }, completeCookie)),
  ]);
  expect(recoveryRace.map((response) => response.status).sort()).toEqual([200, 401]);
  expect((await POST(request(hostname, "mfa/reauth", { method: "recovery", code: firstRecovery }, completeCookie))).status).toBe(401);
  expect((await POST(request(hostname, "mfa/rotate-backup-codes", { password, proof: "missing" }, completeCookie))).status).toBe(401);
  expect((await POST(request(hostname, "mfa/reauth", { method: "totp", code: "000000" }, completeCookie))).status).toBe(401);
  const expiring = await POST(request(hostname, "mfa/reauth", { method: "totp", code: totp.generate() }, completeCookie));
  expect(expiring.status).toBe(200);
  const expiringProof = (await expiring.json() as { proof: string }).proof;
  const expired = await db.verification.updateMany({
    where: { value: { contains: '"purpose":"rotate-backup-codes"' }, expiresAt: { gt: new Date() } },
    data: { expiresAt: new Date(0) },
  });
  expect(expired.count).toBeGreaterThan(0);
  expect((await POST(request(hostname, "mfa/rotate-backup-codes", { password, proof: expiringProof }, completeCookie))).status).toBe(401);
  const reauth = await POST(request(hostname, "mfa/reauth", { method: "totp", code: totp.generate() }, completeCookie));
  expect(reauth.status).toBe(200);
  const { proof } = await reauth.json() as { proof: string };
  expect(proof).toMatch(/^[a-f0-9]{64}$/);
  expect((await POST(request(hostname, "mfa/rotate-backup-codes", { password, proof }, otherCookie))).status).toBe(401);
  const [rotated, replay] = await Promise.all([
    POST(request(hostname, "mfa/rotate-backup-codes", { password, proof }, completeCookie)),
    POST(request(hostname, "mfa/rotate-backup-codes", { password, proof }, completeCookie)),
  ]);
  expect(rotated.status).toBe(200);
  expect(replay.status).toBe(401);
  expect((await rotated.json() as { backupCodes: string[] }).backupCodes).toHaveLength(10);
  expect((await POST(request(hostname, "mfa/rotate-backup-codes", { password, proof }, completeCookie))).status).toBe(401);
  expect((await GET(request(hostname, "get-session", undefined, otherCookie))).status).toBe(401);
  const untouchedOldCode = result.backupCodes?.[1];
  if (!untouchedOldCode) throw new Error("Missing second recovery code");
  expect((await POST(request(hostname, "mfa/reauth", { method: "recovery", code: untouchedOldCode }, completeCookie))).status).toBe(401);
});

test("the public gateway enforces five account failures and twenty source attempts", async () => {
  await db.rateLimitEvent.deleteMany();
  const unknown = `missing-${randomUUID()}@example.test`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await POST(request(hostname, "sign-in/email", { email: unknown, password: "Wrong password 9384!" }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "INVALID_CREDENTIALS" });
  }
  const accountLimit = await POST(request(hostname, "sign-in/email", { email: unknown, password: "Wrong password 9384!" }));
  expect(accountLimit.status).toBe(429);
  expect(Number(accountLimit.headers.get("Retry-After"))).toBeGreaterThan(0);
  for (let attempt = 5; attempt < 20; attempt += 1) {
    const response = await POST(request(hostname, "sign-in/email", { email: `unknown-${randomUUID()}@example.test`, password: "Wrong password 9384!" }));
    expect(response.status).toBe(401);
  }
  const ipLimit = await POST(request(hostname, "sign-in/email", { email: `unknown-${randomUUID()}@example.test`, password: "Wrong password 9384!" }));
  expect(ipLimit.status).toBe(429);
  expect(Number(ipLimit.headers.get("Retry-After"))).toBeGreaterThan(0);
});

test("malformed MFA and failed enrollment passwords consume the shared account budget", async () => {
  await db.rateLimitEvent.deleteMany();
  const login = await POST(request(hostname, "sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await POST(request(hostname, "two-factor/verify-totp", { code: "bad", trustDevice: true }, cookie));
    expect(response.status).toBe(400);
  }
  const limited = await POST(request(hostname, "two-factor/verify-totp", { code: "123456" }, cookie));
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);

  await db.rateLimitEvent.deleteMany();
  const otherLogin = await POST(request(otherHostname, "sign-in/email", { email: otherEmail, password }));
  expect(otherLogin.status).toBe(200);
  const otherCookie = otherLogin.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await POST(request(otherHostname, "two-factor/enable", { method: "totp", password: "wrong" }, otherCookie));
    expect(response.status).toBe(401);
  }
  const blocked = await POST(request(otherHostname, "two-factor/enable", { method: "totp", password }, otherCookie));
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
});
