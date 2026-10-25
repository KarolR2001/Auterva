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
  await db.auditLog.deleteMany({ where: { organizationId: { in: [organizationId, otherOrganizationId] } } });
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

  let signalPressureLock!: () => void;
  let releasePressureLock!: () => void;
  const pressureLocked = new Promise<void>((resolve) => { signalPressureLock = resolve; });
  const releasePressure = new Promise<void>((resolve) => { releasePressureLock = resolve; });
  const heldFactor = db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auterva:mfa-factor:${fixtureUserId}`}, 0))`;
    signalPressureLock();
    await releasePressure;
  });
  await pressureLocked;
  try {
    const started = Date.now();
    const [pressured, otherAccount] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, () => POST(request(hostname, "mfa/rotate-backup-codes", { password, proof: "bad" }, completeCookie)))),
      POST(request(otherHostname, "sign-in/email", { email: otherEmail, password })),
    ]);
    expect(pressured.map((response) => response.status)).toEqual(Array(10).fill(409));
    for (const response of pressured) {
      expect(await response.json()).toEqual({ code: "MFA_BUSY" });
      expect(response.headers.get("Retry-After")).toBe("1");
      expect(response.headers.getSetCookie()).toEqual([]);
    }
    expect(otherAccount.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(5_000);
  } finally {
    releasePressureLock();
    await heldFactor;
  }

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
  expect(recoveryRace.filter((response) => response.status === 200)).toHaveLength(1);
  expect([401, 409]).toContain(recoveryRace.find((response) => response.status !== 200)?.status);
  const busyRecovery = recoveryRace.find((response) => response.status === 409);
  if (busyRecovery) {
    expect(await busyRecovery.json()).toEqual({ code: "MFA_BUSY" });
    expect(busyRecovery.headers.get("Retry-After")).toBe("1");
  }
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
  const secondReauth = await POST(request(hostname, "mfa/reauth", { method: "totp", code: totp.generate() }, completeCookie));
  expect(secondReauth.status).toBe(200);
  const secondProof = (await secondReauth.json() as { proof: string }).proof;
  expect((await POST(request(hostname, "mfa/rotate-backup-codes", { password, proof }, otherCookie))).status).toBe(401);
  const outcomes = await Promise.all([
    POST(request(hostname, "mfa/rotate-backup-codes", { password, proof }, completeCookie)),
    POST(request(hostname, "mfa/rotate-backup-codes", { password, proof: secondProof }, completeCookie)),
  ]);
  expect(outcomes.filter((response) => response.status === 200)).toHaveLength(1);
  expect([401, 409]).toContain(outcomes.find((response) => response.status !== 200)?.status);
  const rotated = outcomes.find((response) => response.status === 200);
  if (!rotated) throw new Error("Missing successful rotation");
  const currentCodes = (await rotated.json() as { backupCodes: string[] }).backupCodes;
  expect(currentCodes).toHaveLength(10);
  expect((await POST(request(hostname, "mfa/rotate-backup-codes", { password, proof }, completeCookie))).status).toBe(401);
  expect((await POST(request(hostname, "mfa/rotate-backup-codes", { password, proof: secondProof }, completeCookie))).status).toBe(401);
  expect((await POST(request(hostname, "mfa/reauth", { method: "recovery", code: currentCodes[0] }, completeCookie))).status).toBe(200);
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

test("login with a recovery code revokes earlier sessions and requires new TOTP enrollment", async () => {
  await db.rateLimitEvent.deleteMany();
  const login = await POST(request(otherHostname, "sign-in/email", { email: otherEmail, password }));
  expect(login.status).toBe(200);
  const initialCookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const setup = await POST(request(otherHostname, "two-factor/enable", { method: "totp", password }, initialCookie));
  expect(setup.status).toBe(200);
  const initialTotp = OTPAuth.URI.parse((await setup.json() as { totpURI: string }).totpURI);
  if (!(initialTotp instanceof OTPAuth.TOTP)) throw new Error("Missing initial TOTP");
  const confirmed = await POST(request(otherHostname, "two-factor/verify-totp", { code: initialTotp.generate() }, initialCookie));
  expect(confirmed.status).toBe(200);
  const recoveryCode = (await confirmed.json() as { backupCodes: string[] }).backupCodes[0];
  const earlierCookie = confirmed.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request(otherHostname, "get-session", undefined, earlierCookie))).status).toBe(200);

  const challenge = await POST(request(otherHostname, "sign-in/email", { email: otherEmail, password }));
  expect((await challenge.clone().json() as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  const challengeCookies = challenge.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const recovered = await POST(request(otherHostname, "two-factor/verify-backup-code", { code: recoveryCode }, challengeCookies));
  expect(recovered.status).toBe(200);
  const recoveryCookie = recovered.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await recovered.json() as { enrollmentRequired?: boolean }).enrollmentRequired).toBe(true);
  expect((await GET(request(otherHostname, "get-session", undefined, earlierCookie))).status).toBe(401);
  expect((await GET(request(otherHostname, "get-session", undefined, recoveryCookie))).status).toBe(401);
  expect((await POST(request(otherHostname, "two-factor/verify-totp", { code: initialTotp.generate() }, challengeCookies))).status).toBe(401);
  expect(await db.auditLog.count({ where: { actorId: (await db.user.findUniqueOrThrow({ where: { email: otherEmail } })).id, action: "MFA_RECOVERY_STARTED" } })).toBe(1);

  const reenrollment = await POST(request(otherHostname, "two-factor/enable", { method: "totp", password }, recoveryCookie));
  expect(reenrollment.status).toBe(200);
  const newTotp = OTPAuth.URI.parse((await reenrollment.json() as { totpURI: string }).totpURI);
  if (!(newTotp instanceof OTPAuth.TOTP)) throw new Error("Missing replacement TOTP");
  const completed = await POST(request(otherHostname, "two-factor/verify-totp", { code: newTotp.generate() }, recoveryCookie));
  expect(completed.status).toBe(200);
  expect((await GET(request(otherHostname, "get-session", undefined, completed.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ")))).status).toBe(200);

  const pendingLogin = await POST(request(otherHostname, "sign-in/email", { email: otherEmail, password }));
  const pendingCookie = pendingLogin.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  let signalLocked!: () => void;
  let releaseLock!: () => void;
  const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
  const release = new Promise<void>((resolve) => { releaseLock = resolve; });
  const resetFactor = db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { email: otherEmail } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auterva:mfa-factor:${user.id}`}, 0))`;
    signalLocked();
    await release;
    await tx.twoFactor.deleteMany({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false } });
    await tx.verification.deleteMany({ where: { identifier: { startsWith: "auterva:mfa:" }, value: { contains: `"userId":"${user.id}"` } } });
  });
  await locked;
  const staleTotp = POST(request(otherHostname, "two-factor/verify-totp", { code: newTotp.generate() }, pendingCookie));
  const completedBeforeReset = await Promise.race([
    staleTotp.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  releaseLock();
  await resetFactor;
  expect(completedBeforeReset).toBe(true);
  const staleResult = await staleTotp;
  expect(staleResult.status).toBe(409);
  expect(staleResult.headers.get("Retry-After")).toBe("1");
  expect((await POST(request(otherHostname, "two-factor/verify-totp", { code: newTotp.generate() }, pendingCookie))).status).toBe(401);

  await db.rateLimitEvent.deleteMany();
  const newLogin = await POST(request(otherHostname, "sign-in/email", { email: otherEmail, password }));
  const newCookie = newLogin.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const firstEnable = await POST(request(otherHostname, "two-factor/enable", { method: "totp", password }, newCookie));
  expect(firstEnable.status).toBe(200);
  const firstTotp = OTPAuth.URI.parse((await firstEnable.json() as { totpURI: string }).totpURI);
  if (!(firstTotp instanceof OTPAuth.TOTP)) throw new Error("Missing first pending TOTP");

  let signalEnableLock!: () => void;
  let releaseEnableLock!: () => void;
  const enableLocked = new Promise<void>((resolve) => { signalEnableLock = resolve; });
  const allowVerified = new Promise<void>((resolve) => { releaseEnableLock = resolve; });
  const completeFactor = db.$transaction(async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { email: otherEmail } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`auterva:mfa-factor:${user.id}`}, 0))`;
    signalEnableLock();
    await allowVerified;
    await tx.twoFactor.updateMany({ where: { userId: user.id }, data: { verified: true } });
    await tx.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  });
  await enableLocked;
  const racingEnable = POST(request(otherHostname, "two-factor/enable", { method: "totp", password }, newCookie));
  const enableFinishedBeforeVerification = await Promise.race([
    racingEnable.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 250)),
  ]);
  const racingVerify = POST(request(otherHostname, "two-factor/verify-totp", { code: firstTotp.generate() }, newCookie));
  releaseEnableLock();
  await completeFactor;
  expect(enableFinishedBeforeVerification).toBe(true);
  expect((await racingEnable).status).toBe(409);
  expect((await db.twoFactor.findFirst({ where: { user: { email: otherEmail } } }))?.verified).toBe(true);
  const firstVerification = await racingVerify;
  expect([200, 409]).toContain(firstVerification.status);
  const oldFactorCompletion = firstVerification.status === 409
    ? await POST(request(otherHostname, "two-factor/verify-totp", { code: firstTotp.generate() }, newCookie))
    : firstVerification;
  expect(oldFactorCompletion.status).toBe(200);
  expect((await POST(request(otherHostname, "two-factor/enable", { method: "totp", password }, newCookie))).status).toBe(401);
  const mergedCookies = new Map(newCookie.split("; ").map((item) => [item.split("=", 1)[0], item]));
  for (const item of oldFactorCompletion.headers.getSetCookie()) {
    const entry = item.split(";", 1)[0];
    mergedCookies.set(entry.split("=", 1)[0], entry);
  }
  const verifiedCookie = [...mergedCookies.values()].join("; ");
  expect((await GET(request(otherHostname, "get-session", undefined, verifiedCookie))).status).toBe(200);
});
