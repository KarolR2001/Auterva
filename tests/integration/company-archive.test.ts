import { randomUUID } from "node:crypto";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import * as OTPAuth from "otpauth";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate } from "../../src/modules/availability/dates";
import { changeAccountPassword, requestPasswordReset, resetPassword } from "../../src/modules/auth/account-operations";
import { decryptMailPayload } from "../../src/modules/jobs/outbox";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { getPlatformCompany, listPlatformCompanies } from "../../src/modules/organizations/read";
import { changePaidThrough, unlockPublicAfterRestore } from "../../src/modules/service-period/mutations";
import { resolvePublicVisibility } from "../../src/modules/service-period/public";
import { GET as authGet, POST as authPost } from "../../src/app/api/auth/[...all]/route";
import { POST as archivePost } from "../../src/app/api/platform/companies/[organizationId]/archive/route";
import { POST as restorePost } from "../../src/app/api/platform/companies/[organizationId]/restore/route";
import { GET as adminVehicles } from "../../src/app/api/admin/vehicles/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const auth = createAuth(db, true);
const [orgA, orgB] = [randomUUID(), randomUUID()];
const adminHostA = `archive-admin-a-${orgA}.example.test`;
const adminHostB = `archive-admin-b-${orgB}.example.test`;
const publicHostA = `archive-public-a-${orgA}.example.test`;
const platformHost = `archive-platform-${orgA}.example.test`;
let password = "Fixture password 9384!";
const day = 24 * 60 * 60_000;
type Admin = { userId: string; email: string; organizationId: string; host: string; totp: OTPAuth.TOTP };
let adminA: Admin;
let adminB: Admin;
let platformId: string;
let platformSessionId: string;
let platformCookie: { cookie: string; dispose: () => Promise<unknown> };
let createdPlatform = false;
let vehicleA: string;
const trialStart = new Date(Date.now() - day);

function cookieOf(response: Response) {
  return response.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
}
function authRequest(host: string, path: string, body?: object, cookie?: string) {
  const origin = `https://${host}`;
  return new Request(`${origin}/api/auth/${path}`, { method: body ? "POST" : "GET",
    headers: { host, origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined });
}
const signIn = (admin: Admin) => authPost(authRequest(admin.host, "sign-in/email", { email: admin.email, password }));
const verify = (admin: Admin, cookie: string) =>
  authPost(authRequest(admin.host, "two-factor/verify-totp", { code: admin.totp.generate() }, cookie));
const session = (admin: Admin, cookie: string) => authGet(authRequest(admin.host, "get-session", undefined, cookie));

async function createAdmin(organizationId: string, host: string): Promise<Admin> {
  const email = `archive-${randomUUID()}@example.test`;
  const registered = await auth.api.signUpEmail({ body: { name: "Archive admin", email, password } });
  await db.user.update({ where: { id: registered.user.id },
    data: { role: "ADMIN_FIRMY", organizationId, emailVerified: true } });
  const admin = { userId: registered.user.id, email, organizationId, host } as Admin;
  const login = await signIn(admin);
  expect(login.status).toBe(200);
  const enabled = await authPost(authRequest(host, "two-factor/enable", { password, method: "totp" }, cookieOf(login)));
  const totp = OTPAuth.URI.parse((await enabled.json() as { totpURI: string }).totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP enrollment");
  admin.totp = totp;
  expect((await verify(admin, cookieOf(login))).status).toBe(200);
  return admin;
}

async function fullSession(admin: Admin) {
  const challenge = await signIn(admin);
  expect(await challenge.json()).toEqual({ twoFactorRedirect: true });
  const done = await verify(admin, cookieOf(challenge));
  expect(done.status).toBe(200);
  return cookieOf(done);
}

async function waitForLockWaiters(count: number) {
  for (let i = 0; i < 200; i++) {
    const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (rows[0].n >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Expected blocked transactions did not appear");
}

/** Holds a row lock on a separate connection so the order of waiting writers is deterministic. */
async function holdLock(sql: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN");
  await client.query(sql);
  return { client, release: async () => { await client.query("COMMIT"); await client.end(); } };
}

const op = (organizationId: string, expectedVersion: number) => ({ actorId: platformId,
  sessionId: platformSessionId, organizationId, expectedVersion, eventKey: randomUUID(), requestId: randomUUID() });
const orgRow = (id: string) => db.organization.findUniqueOrThrow({ where: { id } });

async function dataSnapshot(organizationId: string) {
  const [vehicles, images, blocks, messages, conversation, hosts, access, settings] = await Promise.all([
    db.vehicle.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    db.vehicleImage.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    db.availabilityBlock.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    db.chatMessage.findMany({ where: { organizationId }, orderBy: { id: "asc" } }),
    db.conversation.findMany({ where: { organizationId } }),
    db.hostMapping.findMany({ where: { organizationId }, orderBy: { hostname: "asc" } }),
    db.serviceAccess.findMany({ where: { organizationId } }),
    db.siteSettings.findMany({ where: { organizationId } }),
  ]);
  const stable = access.map((row) => ({ ...row, periodVersion: 0, changedById: null, updatedAt: null }));
  return { vehicles, images, blocks, messages, conversation, hosts, access: stable, settings };
}

beforeAll(async () => {
  await db.rateLimitEvent.deleteMany();
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformId);
  else {
    await db.user.create({ data: { id: platformId, name: "Archive operator", email: `archive-${platformId}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdPlatform = true;
  }
  platformCookie = await verifiedFixtureSession(db, platformId);
  platformSessionId = (await db.session.findUniqueOrThrow({
    where: { token: platformCookie.cookie.split("=")[1].split(".")[0] } })).id;
  await db.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, slug: `archive-${id}`,
    firstAdminRegisteredAt: trialStart })) });
  await db.hostMapping.createMany({ data: [
    { hostname: adminHostA, area: "COMPANY_ADMIN", organizationId: orgA, status: "ACTIVE" },
    { hostname: adminHostB, area: "COMPANY_ADMIN", organizationId: orgB, status: "ACTIVE" },
    { hostname: publicHostA, area: "COMPANY_PUBLIC", organizationId: orgA, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  for (const id of [orgA, orgB]) await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true,
    trialStartedAt: trialStart, trialEndsAt: new Date(trialStart.getTime() + 14 * day),
    paidThrough: sqlDate(new Date(Date.now() + 10 * day).toISOString().slice(0, 10)) } });
  adminA = await createAdmin(orgA, adminHostA);
  adminB = await createAdmin(orgB, adminHostB);
  const vehicle = await db.vehicle.create({ data: { organizationId: orgA, slug: "archive-bus", name: "Archive bus",
    status: "PUBLISHED" } });
  vehicleA = vehicle.id;
  await db.vehicleImage.create({ data: { organizationId: orgA, vehicleId: vehicleA, storageKey: `archive/${randomUUID()}`,
    mime: "image/jpeg", width: 800, height: 600, bytes: 1000, isCover: true, status: "READY" } });
  await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: vehicleA,
    from: sqlDate("2026-12-01"), to: sqlDate("2026-12-03"), internalNote: "private", reference: "R-1" } });
  const conversation = await db.conversation.create({ data: { organizationId: orgA } });
  await db.chatMessage.create({ data: { organizationId: orgA, conversationId: conversation.id,
    clientMessageId: randomUUID(), body: "Hello before archive" } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.passwordResetRequest.deleteMany({ where: { userId: { in: [adminA.userId, adminB.userId] } } });
  await db.job.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.chatMessage.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.conversation.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.verification.deleteMany({ where: { OR: [adminA, adminB].flatMap((a) => [
    { value: { contains: a.userId } }, { identifier: `password-reset:${a.email}` }]) } });
  await db.user.deleteMany({ where: { id: { in: [adminA.userId, adminB.userId] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [adminHostA, adminHostB, publicHostA, platformHost] } } });
  await platformCookie.dispose();
  if (createdPlatform) await db.user.deleteMany({ where: { id: platformId } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.rateLimitEvent.deleteMany();
  await db.$disconnect();
});

test("archive is refused for non-superadmin actors, stale versions and a failing audit, and changes nothing", async () => {
  const adminCookie = await fullSession(adminA);
  const adminSession = (await db.session.findFirstOrThrow({ where: { userId: adminA.userId, mfaVerifiedAt: { not: null } } })).id;
  await expect(archiveCompany(db, { ...op(orgA, 0), actorId: adminA.userId, sessionId: adminSession }))
    .rejects.toThrow("FORBIDDEN");
  await expect(archiveCompany(db, op(orgA, 5))).rejects.toThrow("COMPANY_VERSION_CONFLICT");
  await expect(archiveCompany(db, op(randomUUID(), 0))).rejects.toThrow("COMPANY_NOT_FOUND");
  // A reused audit event key fails after the sessions were deleted and must roll everything back.
  const reused = randomUUID();
  await db.auditLog.create({ data: { eventKey: reused, actorId: platformId, actorRole: "SUPERADMIN_AUTERVA",
    organizationId: orgB, action: "COMPANY_UPDATED", entityType: "Organization", entityId: orgB, requestId: randomUUID() } });
  await expect(archiveCompany(db, { ...op(orgA, 0), eventKey: reused })).rejects.toThrow();
  expect((await orgRow(orgA)).archivedAt).toBeNull();
  expect((await orgRow(orgA)).version).toBe(0);
  expect((await session(adminA, adminCookie)).status).toBe(200);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "COMPANY_ARCHIVED" } })).toBe(0);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "AUTH_SESSIONS_REVOKED" } })).toBe(0);
});

test("archive atomically blocks login, revokes sessions and challenges, audits the real actor and keeps all data", async () => {
  const adminCookie = await fullSession(adminA);
  const bCookie = await fullSession(adminB);
  const pendingChallenge = cookieOf(await signIn(adminA));
  await db.verification.create({ data: { id: randomUUID(), identifier: `password-reset:${adminA.email}`,
    value: "digest", expiresAt: new Date(Date.now() + day) } });
  const beforeA = await dataSnapshot(orgA);
  const beforeB = await dataSnapshot(orgB);
  const orgBBefore = await orgRow(orgB);
  const accessBefore = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: orgA } });
  const result = await archiveCompany(db, op(orgA, 0));
  // Step 2 of the approved period contract: periodVersion rises atomically; trial, payment and bounds do not change.
  const accessAfter = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: orgA } });
  expect(accessAfter.periodVersion).toBe(accessBefore.periodVersion + 1);
  expect({ ...accessAfter, periodVersion: 0, changedById: null, updatedAt: null })
    .toEqual({ ...accessBefore, periodVersion: 0, changedById: null, updatedAt: null });
  expect(result.periodVersion).toBe(accessAfter.periodVersion);
  expect(await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "COMPANY_ARCHIVED" } }))
    .toMatchObject({ safeChanges: { after: { periodVersion: accessAfter.periodVersion } } });
  expect(result).toMatchObject({ version: 1, publicRequiresPaid: true, publicUnlockRequired: true });
  expect(result.revokedSessions).toBeGreaterThanOrEqual(1);
  const archived = await orgRow(orgA);
  expect(archived.archivedAt).not.toBeNull();
  expect(archived).toMatchObject({ publicRequiresPaid: true, publicUnlockRequired: true, version: 1 });
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);
  expect(await db.verification.count({ where: { OR: [{ value: { contains: adminA.userId } },
    { identifier: `password-reset:${adminA.email}` }] } })).toBe(0);
  // Existing session, pending challenge and fresh login are all refused; no session is issued.
  expect((await session(adminA, adminCookie)).status).toBe(401);
  expect((await verify(adminA, pendingChallenge)).status).toBe(401);
  const login = await signIn(adminA);
  expect(login.status).toBe(401);
  expect(login.headers.getSetCookie()).toEqual([]);
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);
  const apiRequest = new Request(`https://${adminHostA}/api/admin/vehicles`, { headers: { host: adminHostA,
    origin: `https://${adminHostA}`, cookie: adminCookie } });
  expect((await adminVehicles(apiRequest)).status).toBeGreaterThanOrEqual(401);
  // Company B is untouched.
  expect(await orgRow(orgB)).toEqual(orgBBefore);
  expect((await session(adminB, bCookie)).status).toBe(200);
  expect(await dataSnapshot(orgB)).toEqual(beforeB);
  // Nothing was deleted or rewritten for A: same fleet, images, blocks, chat, hosts, period.
  expect(await dataSnapshot(orgA)).toEqual(beforeA);
  // The public gate refuses even though both trial and payment are valid.
  expect(await resolvePublicVisibility(db, publicHostA, new Date())).toBeNull();
  const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "COMPANY_ARCHIVED" } });
  expect(audit).toMatchObject({ actorId: platformId, actorRole: "SUPERADMIN_AUTERVA" });
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "AUTH_SESSIONS_REVOKED" } })).toBeGreaterThanOrEqual(1);
  // The archive stays readable by the superadmin and the list filter does not change status.
  const hidden = await listPlatformCompanies(db, { search: `archive-${orgA}`, includeArchived: false, page: 1, pageSize: 10 });
  expect(hidden.items).toHaveLength(0);
  const shown = await listPlatformCompanies(db, { search: `archive-${orgA}`, includeArchived: true, page: 1, pageSize: 10 });
  expect(shown.items[0]).toMatchObject({ organizationId: orgA, organizationVersion: 1 });
  expect(shown.items[0].archivedAt).not.toBeNull();
  expect(await orgRow(orgA)).toMatchObject({ version: 1 });
  expect((await getPlatformCompany(db, orgA))?.publication).toMatchObject({ visible: false, unlockRequired: true });
  await expect(archiveCompany(db, op(orgA, 1))).rejects.toThrow("COMPANY_ALREADY_ARCHIVED");
  await expect(unlockPublicAfterRestore(db, { ...op(orgA, 1), expectedOrganizationVersion: 1 }))
    .rejects.toThrow("PERIOD_ARCHIVED");
});

test("restore returns login only: no trial or payment renewal, publication stays locked until the existing unlock", async () => {
  const access = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: orgA } });
  const archivedPeriodVersion = access.periodVersion;
  await expect(restoreCompany(db, op(orgA, 0))).rejects.toThrow("COMPANY_VERSION_CONFLICT");
  const restored = await restoreCompany(db, op(orgA, 1));
  expect(restored).toEqual({ archivedAt: null, version: 2, periodVersion: archivedPeriodVersion + 1,
    publicRequiresPaid: true, publicUnlockRequired: true });
  const afterRestore = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: orgA } });
  expect(afterRestore.periodVersion).toBe(archivedPeriodVersion + 1);
  expect({ ...afterRestore, periodVersion: 0, changedById: null, updatedAt: null })
    .toEqual({ ...access, periodVersion: 0, changedById: null, updatedAt: null });
  access.periodVersion = afterRestore.periodVersion;
  expect(await orgRow(orgA)).toMatchObject({ archivedAt: null, publicRequiresPaid: true, publicUnlockRequired: true, version: 2 });
  await expect(restoreCompany(db, op(orgA, 2))).rejects.toThrow("COMPANY_NOT_ARCHIVED");
  // Old sessions did not come back; a new login works.
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);
  const cookie = await fullSession(adminA);
  expect((await session(adminA, cookie)).status).toBe(200);
  // Valid payment and valid trial are not enough: the explicit unlock is still required.
  expect(await resolvePublicVisibility(db, publicHostA, new Date())).toBeNull();
  await changePaidThrough(db, { ...op(orgA, 0), expectedVersion: access.periodVersion,
    paidThrough: null });
  await expect(unlockPublicAfterRestore(db, { ...op(orgA, 2), expectedOrganizationVersion: 2 }))
    .rejects.toThrow("PERIOD_PAYMENT_REQUIRED");
  expect(await resolvePublicVisibility(db, publicHostA, new Date())).toBeNull();
  await changePaidThrough(db, { ...op(orgA, 0), expectedVersion: access.periodVersion + 1,
    paidThrough: new Date(Date.now() + 10 * day).toISOString().slice(0, 10) });
  expect(await resolvePublicVisibility(db, publicHostA, new Date())).toBeNull();
  await unlockPublicAfterRestore(db, { ...op(orgA, 2), expectedOrganizationVersion: 2 });
  expect(await resolvePublicVisibility(db, publicHostA, new Date())).toMatchObject({ organizationId: orgA });
  // A later payment shortening hides the page even though the trial is still valid.
  await changePaidThrough(db, { ...op(orgA, 0), expectedVersion: access.periodVersion + 2, paidThrough: null });
  expect(await resolvePublicVisibility(db, publicHostA, new Date())).toBeNull();
  const audits = await db.auditLog.findMany({ where: { organizationId: orgA, action: "COMPANY_UPDATED" } });
  expect(audits.every((row) => row.actorId === platformId && row.actorRole === "SUPERADMIN_AUTERVA")).toBe(true);
  expect(audits.length).toBeGreaterThanOrEqual(2);
  await db.organization.update({ where: { id: orgA }, data: { version: 2 } });
});

test("race: login and MFA committed first are revoked by archive; both orders end archived", async () => {
  await db.rateLimitEvent.deleteMany();
  // Login first: it holds the credential row, issues a challenge; archive waits and then revokes it.
  const holder = await holdLock(`SELECT a.id FROM "account" a WHERE a."userId" = '${adminA.userId}' FOR UPDATE`);
  const login = signIn(adminA);
  await waitForLockWaiters(1);
  const archive = archiveCompany(db, op(orgA, 2));
  await waitForLockWaiters(2);
  await holder.release();
  const loginResponse = await login;
  // Login committed first: it succeeded with a challenge, and only then did archive revoke it.
  expect(loginResponse.status).toBe(200);
  expect(await loginResponse.clone().json()).toEqual({ twoFactorRedirect: true });
  const issuedChallenge = cookieOf(loginResponse);
  await archive;
  expect(await db.verification.count({ where: { value: { contains: adminA.userId } } })).toBe(0);
  expect((await verify(adminA, issuedChallenge)).status).toBe(401);
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);

  // Restore (version 3) then MFA verification committed first: the full session is revoked afterwards.
  await restoreCompany(db, op(orgA, 3));
  const challenge = cookieOf(await signIn(adminA));
  const mfaHolder = await holdLock(`SELECT a.id FROM "account" a WHERE a."userId" = '${adminA.userId}' FOR UPDATE`);
  const completing = verify(adminA, challenge);
  await waitForLockWaiters(1);
  const archiving = archiveCompany(db, op(orgA, 4));
  await waitForLockWaiters(2);
  await mfaHolder.release();
  const completed = await completing;
  await archiving;
  expect(completed.status).toBe(200);
  expect((await session(adminA, cookieOf(completed))).status).toBe(401);
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);

  // Archive first (in flight): later login/MFA attempts wait, then are denied without a session.
  await restoreCompany(db, op(orgA, 5));
  const pending = cookieOf(await signIn(adminA));
  const accountHolder = await holdLock(`SELECT a.id FROM "account" a WHERE a."userId" = '${adminA.userId}' FOR UPDATE`);
  const archiveFirst = archiveCompany(db, op(orgA, 6));
  await waitForLockWaiters(1);
  const lateLogin = signIn(adminA);
  const lateMfa = verify(adminA, pending);
  await waitForLockWaiters(3);
  await accountHolder.release();
  await archiveFirst;
  expect((await lateLogin).status).toBe(401);
  expect((await lateMfa).status).toBe(401);
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);
  expect((await orgRow(orgA)).archivedAt).not.toBeNull();
});

test("race: archive and restore serialize in both orders with exactly one winner and no deadlock", async () => {
  // Currently archived at version 7; restore queued first wins, the stale archive conflicts.
  expect((await orgRow(orgA)).version).toBe(7);
  const first = await holdLock(`SELECT id FROM "Organization" WHERE id = '${orgA}' FOR UPDATE`);
  const restoreFirst = restoreCompany(db, op(orgA, 7));
  await waitForLockWaiters(1);
  const archiveSecond = archiveCompany(db, op(orgA, 7));
  await waitForLockWaiters(2);
  await first.release();
  const outcome = await Promise.allSettled([restoreFirst, archiveSecond]);
  expect(outcome.map((entry) => entry.status)).toEqual(["fulfilled", "rejected"]);
  expect(String((outcome[1] as PromiseRejectedResult).reason)).toContain("COMPANY_VERSION_CONFLICT");
  expect(await orgRow(orgA)).toMatchObject({ archivedAt: null, version: 8 });
  // Not archived at version 8; archive queued first wins, the stale restore conflicts.
  const second = await holdLock(`SELECT id FROM "Organization" WHERE id = '${orgA}' FOR UPDATE`);
  const archiveFirst = archiveCompany(db, op(orgA, 8));
  await waitForLockWaiters(1);
  const restoreSecond = restoreCompany(db, op(orgA, 8));
  await waitForLockWaiters(2);
  await second.release();
  const reverse = await Promise.allSettled([archiveFirst, restoreSecond]);
  expect(reverse.map((entry) => entry.status)).toEqual(["fulfilled", "rejected"]);
  expect((await orgRow(orgA)).archivedAt).not.toBeNull();
  expect(await orgRow(orgA)).toMatchObject({ version: 9 });
  // Unrestricted parallel pair: exactly one of the two operations may apply.
  const parallel = await Promise.allSettled([restoreCompany(db, op(orgA, 9)), archiveCompany(db, op(orgA, 9))]);
  expect(parallel.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
});

test("race: password change and reset serialize with archive in both orders", async () => {
  const scope = { area: "COMPANY_ADMIN" as const, organizationId: orgA };
  const baseURL = `https://${adminHostA}`;
  const hash = async () => (await db.account.findFirstOrThrow({
    where: { userId: adminA.userId, providerId: "credential" } })).password;
  const ensureActive = async () => {
    const current = await orgRow(orgA);
    if (current.archivedAt) await restoreCompany(db, op(orgA, current.version));
  };
  const resetToken = async () => {
    const mailKey = randomBytes(32);
    await requestPasswordReset(db, { email: adminA.email, idempotencyKey: randomUUID(), scope,
      hostname: adminHostA, now: new Date(), mailKey });
    const receipt = await db.passwordResetRequest.findFirstOrThrow({
      where: { userId: adminA.userId, consumedAt: null }, orderBy: { createdAt: "desc" } });
    const job = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${receipt.verificationId}` } });
    return decodeURIComponent(decryptMailPayload(job.payload, mailKey).url.split("/").at(-1)!);
  };
  // The second operation starts only after the first waits on the credential row, so the order is fixed.
  const ordered = async (first: () => Promise<unknown>, second: () => Promise<unknown>) => {
    const holder = await holdLock(`SELECT a.id FROM "account" a WHERE a."userId" = '${adminA.userId}' FOR UPDATE`);
    const a = first();
    void a.catch(() => undefined);
    await waitForLockWaiters(1);
    const b = second();
    void b.catch(() => undefined);
    await waitForLockWaiters(2);
    await holder.release();
    return Promise.allSettled([a, b]);
  };
  const change = (cookie: string, current: string, next: string) => () => changeAccountPassword(db, {
    headers: new Headers({ cookie }), scope, baseURL, currentPassword: current, newPassword: next, requestId: randomUUID() });
  const reset = (token: string, next: string) => () => resetPassword(db, { token, newPassword: next, scope,
    hostname: adminHostA, now: new Date(), requestId: randomUUID() });
  const archiveNow = () => { const version = orgVersion; return archiveCompany(db, op(orgA, version)); };
  let orgVersion = 0;
  const prepare = async () => { await ensureActive(); orgVersion = (await orgRow(orgA)).version; };

  // Change committed first: the password changed, then archive removed whatever sessions remained.
  await db.rateLimitEvent.deleteMany();
  await prepare();
  let cookie = await fullSession(adminA);
  let before = await hash();
  let outcome = await ordered(change(cookie, password, "Changed fixture password 1111!"), archiveNow);
  expect(outcome.map((entry) => entry.status)).toEqual(["fulfilled", "fulfilled"]);
  expect((outcome[0] as PromiseFulfilledResult<boolean>).value).toBe(true);
  password = "Changed fixture password 1111!";
  expect(await hash()).not.toBe(before);
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);
  expect((await orgRow(orgA)).archivedAt).not.toBeNull();

  // Archive first: the queued change is refused (false => 401), the password is unchanged.
  await prepare();
  cookie = await fullSession(adminA);
  before = await hash();
  outcome = await ordered(archiveNow, change(cookie, password, "Changed fixture password 2222!"));
  expect(outcome.map((entry) => entry.status)).toEqual(["fulfilled", "fulfilled"]);
  expect((outcome[1] as PromiseFulfilledResult<boolean>).value).toBe(false);
  expect(await hash()).toBe(before);
  expect(await db.session.count({ where: { userId: adminA.userId } })).toBe(0);

  // Reset first: executed; archive then revokes the rest.
  await prepare();
  let token = await resetToken();
  before = await hash();
  outcome = await ordered(reset(token, "Reset fixture password 3333!"), archiveNow);
  expect((outcome[0] as PromiseFulfilledResult<boolean>).value).toBe(true);
  expect(outcome[1].status).toBe("fulfilled");
  password = "Reset fixture password 3333!";
  expect(await hash()).not.toBe(before);

  // Archive first: reset is refused and its proof is gone for good, even after restore.
  await prepare();
  token = await resetToken();
  before = await hash();
  outcome = await ordered(archiveNow, reset(token, "Reset fixture password 4444!"));
  expect(outcome[0].status).toBe("fulfilled");
  expect((outcome[1] as PromiseFulfilledResult<boolean>).value).toBe(false);
  expect(await hash()).toBe(before);
  expect(await db.verification.count({ where: { identifier: `password-reset:${adminA.email}` } })).toBe(0);
  await ensureActive();
  expect(await resetPassword(db, { token, newPassword: "Reset fixture password 5555!", scope,
    hostname: adminHostA, now: new Date(), requestId: randomUUID() })).toBe(false);
  expect(await hash()).toBe(before);
});

test("platform HTTP transport guards host, origin, MFA and input, and the admin session ends", async () => {
  await db.rateLimitEvent.deleteMany();
  let current = await orgRow(orgA);
  if (current.archivedAt) { await restoreCompany(db, op(orgA, current.version)); current = await orgRow(orgA); }
  const adminCookie = await fullSession(adminA);
  const call = (handler: typeof archivePost, host: string, origin: string, body: unknown, cookie = platformCookie.cookie,
    id = orgA) => handler(new Request(`https://${host}/api/platform/companies/${id}/`, { method: "POST", headers: {
    host, origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }),
  { params: Promise.resolve({ organizationId: id }) });
  const body = { expectedOrganizationVersion: current.version, eventKey: randomUUID() };
  expect((await call(archivePost, adminHostA, `https://${adminHostA}`, body)).status).toBe(404);
  expect((await call(archivePost, platformHost, "https://evil.example.test", body)).status).toBe(403);
  expect((await call(archivePost, platformHost, `https://${platformHost}`, body, adminCookie)).status).toBe(403);
  expect((await call(archivePost, platformHost, `https://${platformHost}`, { ...body, extra: 1 })).status).toBe(400);
  expect((await call(archivePost, platformHost, `https://${platformHost}`,
    { ...body, expectedOrganizationVersion: current.version + 5 })).status).toBe(409);
  const ok = await call(archivePost, platformHost, `https://${platformHost}`, body);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("Cache-Control")).toBe("no-store");
  expect(await ok.json()).toMatchObject({ version: current.version + 1, publicUnlockRequired: true });
  expect((await session(adminA, adminCookie)).status).toBe(401);
  const again = await call(archivePost, platformHost, `https://${platformHost}`,
    { ...body, expectedOrganizationVersion: current.version + 1, eventKey: randomUUID() });
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ code: "COMPANY_ALREADY_ARCHIVED" });
  const restored = await call(restorePost, platformHost, `https://${platformHost}`,
    { expectedOrganizationVersion: current.version + 1, eventKey: randomUUID() });
  expect(restored.status).toBe(200);
  expect(await restored.json()).toMatchObject({ archivedAt: null, publicUnlockRequired: true, publicRequiresPaid: true });
  expect(vehicleA).toBeTruthy();
});
