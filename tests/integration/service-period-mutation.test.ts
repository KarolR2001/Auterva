import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { isTransientDbError } from "../../src/modules/observability/http-observe";
import { periodFailure } from "../../src/modules/service-period/http";
import { changePaidThrough, unlockPublicAfterRestore } from "../../src/modules/service-period/mutations";
import { resolvePublicVisibility } from "../../src/modules/service-period/public";
import { PATCH as patchPeriod } from "../../src/app/api/platform/companies/[organizationId]/period/route";
import { POST as postUnlock } from "../../src/app/api/platform/companies/[organizationId]/public-unlock/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { auth } from "../../src/lib/auth";
import { requireRequestContext } from "../../src/modules/tenancy/request-context";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const companies = [randomUUID(), randomUUID()];
const hosts = companies.map((id) => `period-public-${id}.example.test`);
const platformHost = `platform-period-${randomUUID()}.example.test`;
const adminHost = `admin-period-${randomUUID()}.example.test`;
const platformSession = randomUUID();
const companyAdmin = randomUUID();
const companySession = randomUUID();
let platformUserId: string;
let createdPlatformUser = false;
let httpSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminHttpSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;

beforeAll(async () => {
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" },
    select: { id: true } });
  platformUserId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformUserId);
  else {
    await db.user.create({ data: { id: platformUserId, name: "Period operator",
      email: `period-${platformUserId}@example.test`, emailVerified: true,
      twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdPlatformUser = true;
  }
  await db.organization.createMany({ data: companies.map((id) => ({ id, slug: `period-mutation-${id}` })) });
  await db.hostMapping.createMany({ data: companies.map((id, index) => ({ organizationId: id,
    hostname: hosts[index], area: "COMPANY_PUBLIC", status: "ACTIVE" })) });
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN",
    organizationId: companies[0], status: "ACTIVE" } });
  await db.session.create({ data: { id: platformSession, userId: platformUserId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000), mfaVerifiedAt: new Date() } });
  httpSession = await verifiedFixtureSession(db, platformUserId);
  await db.user.create({ data: { id: companyAdmin, name: "Period company admin",
    email: `period-${companyAdmin}@example.test`, emailVerified: true,
    twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: companies[0] } });
  await db.session.create({ data: { id: companySession, userId: companyAdmin, token: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000), mfaVerifiedAt: new Date() } });
  adminHttpSession = await verifiedFixtureSession(db, companyAdmin);
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: { in: companies } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: companies } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: companies } } });
  await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
  await db.hostMapping.deleteMany({ where: { hostname: adminHost } });
  if (httpSession) await httpSession.dispose();
  if (adminHttpSession) await adminHttpSession.dispose();
  await db.session.deleteMany({ where: { id: { in: [platformSession, companySession] } } });
  await db.user.deleteMany({ where: { id: companyAdmin } });
  if (createdPlatformUser) await db.user.deleteMany({ where: { id: platformUserId } });
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: companies } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: companies } } });
  await db.organization.deleteMany({ where: { id: { in: companies } } });
  await db.$disconnect();
});

const actor = () => ({ actorId: platformUserId, sessionId: platformSession });

test("paid change is versioned and audited by the real platform actor; a stale edit cannot overwrite it", async () => {
  const first = await changePaidThrough(db, { ...actor(), organizationId: companies[0],
    expectedVersion: 0, paidThrough: "2026-11-08", eventKey: randomUUID(), requestId: randomUUID() });
  expect(first).toMatchObject({ paidThrough: "2026-11-08", periodVersion: 1 });
  await expect(changePaidThrough(db, { ...actor(), organizationId: companies[0],
    expectedVersion: 0, paidThrough: "2026-11-10", eventKey: randomUUID(), requestId: randomUUID() }))
    .rejects.toThrow("PERIOD_VERSION_CONFLICT");
  const audit = await db.auditLog.findMany({ where: { organizationId: companies[0], action: "PERIOD_CHANGED" } });
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({ actorId: platformUserId, actorRole: "SUPERADMIN_AUTERVA",
    safeChanges: { changedFields: ["paidThrough", "periodVersion"] } });
  await expect(changePaidThrough(db, { actorId: companyAdmin, sessionId: companySession,
    organizationId: companies[0], expectedVersion: 1, paidThrough: "2026-11-08",
    eventKey: randomUUID(), requestId: randomUUID() })).rejects.toThrow("FORBIDDEN");
  await expect(changePaidThrough(db, { actorId: companyAdmin, sessionId: companySession,
    organizationId: companies[1], expectedVersion: 0, paidThrough: "2026-11-09",
    eventKey: randomUUID(), requestId: randomUUID() })).rejects.toThrow("FORBIDDEN");
  expect(await db.auditLog.count({ where: { organizationId: companies[0], action: "PERIOD_CHANGED" } })).toBe(1);
});

test("concurrent edits yield one version winner and audit rolls back with a rejected event", async () => {
  const updates = await Promise.allSettled(["2026-11-09", "2026-11-10"].map((paidThrough) =>
    changePaidThrough(db, { ...actor(), organizationId: companies[0], expectedVersion: 1,
      paidThrough, eventKey: randomUUID(), requestId: randomUUID() })));
  expect(updates.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(updates.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect((await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: companies[0] } })).periodVersion).toBe(2);
  await expect(changePaidThrough(db, { ...actor(), organizationId: companies[0], expectedVersion: 2,
    paidThrough: "2026-11-11", eventKey: "not-a-uuid", requestId: randomUUID() })).rejects.toThrow();
  expect((await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: companies[0] } })).periodVersion).toBe(2);
  expect(await db.auditLog.count({ where: { organizationId: companies[0], action: "PERIOD_CHANGED" } })).toBe(2);
});

test("restored public unlock requires paid term and remains paid-only after later shortening", async () => {
  const at = new Date("2026-11-08T22:59:59.999Z");
  const trialStarted = new Date("2026-11-01T10:00:00.000Z");
  await db.organization.update({ where: { id: companies[1] }, data: {
    firstAdminRegisteredAt: trialStarted, publicRequiresPaid: true, publicUnlockRequired: true, version: 1,
  } });
  await db.serviceAccess.create({ data: { organizationId: companies[1],
    trialGranted: true, trialStartedAt: trialStarted,
    trialEndsAt: new Date(trialStarted.getTime() + 336 * 60 * 60_000),
  } });
  await expect(unlockPublicAfterRestore(db, { ...actor(), organizationId: companies[1],
    expectedOrganizationVersion: 1, eventKey: randomUUID(), requestId: randomUUID(), now: at }))
    .rejects.toThrow("PERIOD_PAYMENT_REQUIRED");
  await changePaidThrough(db, { ...actor(), organizationId: companies[1],
    expectedVersion: 0, paidThrough: "2026-11-08", eventKey: randomUUID(), requestId: randomUUID() });
  await unlockPublicAfterRestore(db, { ...actor(), organizationId: companies[1],
    expectedOrganizationVersion: 1, eventKey: randomUUID(), requestId: randomUUID(), now: at });
  expect(await resolvePublicVisibility(db, hosts[1], at)).toMatchObject({ organizationId: companies[1] });
  await changePaidThrough(db, { ...actor(), organizationId: companies[1],
    expectedVersion: 1, paidThrough: "2026-11-07", eventKey: randomUUID(), requestId: randomUUID() });
  expect(await resolvePublicVisibility(db, hosts[1], at)).toBeNull();
  expect((await db.organization.findUniqueOrThrow({ where: { id: companies[1] } })).publicUnlockRequired).toBe(false);
  expect((await db.organization.findUniqueOrThrow({ where: { id: companies[1] } })).publicRequiresPaid).toBe(true);
});

test("HTTP period transport checks platform host, origin, MFA, input and event replay", async () => {
  const organizationId = companies[0];
  const path = `/api/platform/companies/${organizationId}/period`;
  const invoke = (host: string, origin: string, body: unknown, cookie = httpSession.cookie) =>
    patchPeriod(new Request(`http://127.0.0.1:3339${path}`, { method: "PATCH", headers: {
      host, origin, cookie, "content-type": "application/json",
    }, body: JSON.stringify(body) }), { params: Promise.resolve({ organizationId }) });
  const version = (await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } })).periodVersion;
  const eventKey = randomUUID();
  expect((await invoke(hosts[0], `http://${hosts[0]}`, { paidThrough: "2026-11-20", expectedVersion: version, eventKey })).status).toBe(404);
  expect((await invoke(platformHost, "http://sibling.example.test", { paidThrough: "2026-11-20", expectedVersion: version, eventKey })).status).toBe(403);
  expect((await invoke(platformHost, `http://${platformHost}`, { paidThrough: "2026-11-20", expectedVersion: version, eventKey }, "bad")).status).toBe(403);
  expect((await invoke(platformHost, `http://${platformHost}`, { paidThrough: "2026-13-20", expectedVersion: version, eventKey })).status).toBe(422);
  expect((await invoke(platformHost, `http://${platformHost}`, { paidThrough: "2026-11-20", expectedVersion: "0", eventKey })).status).toBe(400);
  const changed = await invoke(`${platformHost}.`, `http://${platformHost}.`, { paidThrough: "2026-11-20", expectedVersion: version, eventKey });
  expect(changed.status).toBe(200);
  expect(changed.headers.get("cache-control")).toBe("no-store");
  expect(changed.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect((await invoke(platformHost, `http://${platformHost}`, { paidThrough: "2026-11-21", expectedVersion: version + 1, eventKey })).status).toBe(409);
  expect((await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } })).paidThrough?.toISOString().slice(0, 10)).toBe("2026-11-20");
});

test("unlock transport is versioned and serialized with a paid-term change", async () => {
  const organizationId = companies[1];
  await changePaidThrough(db, { ...actor(), organizationId, expectedVersion: 2,
    paidThrough: null, eventKey: randomUUID(), requestId: randomUUID() });
  await db.organization.update({ where: { id: organizationId }, data: { publicUnlockRequired: true,
    publicRequiresPaid: true, version: { increment: 1 } } });
  const version = (await db.organization.findUniqueOrThrow({ where: { id: organizationId } })).version;
  const path = `/api/platform/companies/${organizationId}/public-unlock`;
  const request = (eventKey: string) => postUnlock(new Request(`http://127.0.0.1:3339${path}`, {
    method: "POST", headers: { host: platformHost, origin: `http://${platformHost}`,
      cookie: httpSession.cookie, "content-type": "application/json" },
    body: JSON.stringify({ expectedOrganizationVersion: version, eventKey }),
  }), { params: Promise.resolve({ organizationId }) });
  const unlock = await request(randomUUID());
  expect(unlock.status).toBe(422);
  expect((await unlock.json()).code).toBe("PERIOD_PAYMENT_REQUIRED");
  await changePaidThrough(db, { ...actor(), organizationId, expectedVersion: 3,
    paidThrough: "2026-11-30", eventKey: randomUUID(), requestId: randomUUID() });
  const released = await request(randomUUID());
  expect(released.status).toBe(200);
  expect((await request(randomUUID())).status).toBe(409);
  expect((await db.organization.findUniqueOrThrow({ where: { id: organizationId } })).publicRequiresPaid).toBe(true);
});

test("shortening payment racing unlock cannot expose a restored company on live trial alone", async () => {
  const organizationId = companies[1];
  const at = new Date("2026-11-08T22:59:59.999Z");
  const before = await db.organization.update({ where: { id: organizationId }, data: {
    publicUnlockRequired: true, publicRequiresPaid: true, version: { increment: 1 },
  } });
  const period = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } });
  const settled = await Promise.allSettled([
    unlockPublicAfterRestore(db, { ...actor(), organizationId,
      expectedOrganizationVersion: before.version, now: at,
      eventKey: randomUUID(), requestId: randomUUID() }),
    changePaidThrough(db, { ...actor(), organizationId,
      expectedVersion: period.periodVersion, paidThrough: "2026-11-07",
      eventKey: randomUUID(), requestId: randomUUID() }),
  ]);
  expect(settled[1].status).toBe("fulfilled");
  if (settled[0].status === "rejected") expect(String(settled[0].reason)).toContain("PERIOD_PAYMENT_REQUIRED");
  expect(await resolvePublicVisibility(db, hosts[1], at)).toBeNull();
  const company = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  expect(company.publicRequiresPaid).toBe(true);
  expect(await db.auditLog.count({ where: { organizationId, action: "PERIOD_CHANGED" } })).toBe(5);
  expect(await db.auditLog.count({ where: { organizationId, action: "COMPANY_UPDATED" } }))
    .toBe(company.publicUnlockRequired ? 2 : 3);
});

test("ordinary period expiry denies public access but preserves the same company's verified admin session", async () => {
  const organizationId = companies[0];
  await db.organization.update({ where: { id: organizationId }, data: {
    firstAdminRegisteredAt: new Date("2026-01-01T10:00:00.000Z"),
  } });
  await db.serviceAccess.update({ where: { organizationId }, data: { paidThrough: null } });
  expect(await resolvePublicVisibility(db, hosts[0], new Date())).toBeNull();
  const headers = new Headers({ host: adminHost, cookie: adminHttpSession.cookie });
  expect(await requireRequestContext(db, auth, headers, organizationId))
    .toMatchObject({ actorId: companyAdmin, role: "ADMIN_FIRMY", organizationId });
  expect(await db.session.findUnique({ where: { id: companySession } })).not.toBeNull();
});

test("platform period transport enforces the shared 60-write moving-minute budget", async () => {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Fixture auth secret missing");
  const keyHash = createHmac("sha256", secret).update(`api:write:${platformUserId}:platform`).digest("hex");
  const organizationId = companies[0];
  const route = (body: unknown) => patchPeriod(new Request(`http://127.0.0.1:3339/api/platform/companies/${organizationId}/period/`, {
    method: "PATCH", headers: { host: platformHost, origin: `http://${platformHost}`,
      cookie: httpSession.cookie, "content-type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ organizationId }) });
  await db.rateLimitEvent.deleteMany({ where: { keyHash } });
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      expect((await route({ invalid: true })).status).toBe(400);
    }
    const blocked = await route({ invalid: true });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(blocked.headers.get("cache-control")).toBe("no-store");
  } finally {
    await db.rateLimitEvent.deleteMany({ where: { keyHash } });
  }
});

// #310: under load the organization lock queues; the transaction must fail cleanly, not half-write.
test("an expired period transaction rolls back completely and maps to a retryable 503", async () => {
  const organizationId = companies[0];
  const before = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } });
  const auditBefore = await db.auditLog.count({ where: { organizationId } });
  const holder = createPrismaClient(process.env.DATABASE_URL ?? "");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
  const blocker = holder.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
    locked();
    await hold;
  }, { timeout: 15_000 });
  try {
    await lockTaken;
    // The blocked query only returns once the lock is freed; hold it past the 500 ms budget.
    setTimeout(release, 1_200);
    const error = await changePaidThrough(db, { ...actor(), organizationId, expectedVersion: before.periodVersion,
      paidThrough: "2027-01-31", eventKey: randomUUID(), requestId: randomUUID(),
      transaction: { maxWait: 2_000, timeout: 500 } }).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "P2028" });
    const response = periodFailure(error, randomUUID());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
  } finally {
    release();
    await blocker;
    await holder.$disconnect();
  }
  expect(await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({
    periodVersion: before.periodVersion, paidThrough: before.paidThrough });
  expect(await db.auditLog.count({ where: { organizationId } })).toBe(auditBefore);
});

test("an archived company is refused before the organization lock is taken", async () => {
  const organizationId = companies[1];
  await db.organization.update({ where: { id: organizationId }, data: { archivedAt: new Date(),
    publicUnlockRequired: true, publicRequiresPaid: true } });
  const holder = createPrismaClient(process.env.DATABASE_URL ?? "");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
  const blocker = holder.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
    locked();
    await hold;
  }, { timeout: 15_000 });
  try {
    await lockTaken;
    const started = Date.now();
    await expect(unlockPublicAfterRestore(db, { ...actor(), organizationId, expectedOrganizationVersion: 1,
      eventKey: randomUUID(), requestId: randomUUID(), transaction: { maxWait: 2_000, timeout: 500 } }))
      .rejects.toThrow("PERIOD_ARCHIVED");
    expect(Date.now() - started).toBeLessThan(400);
  } finally {
    release();
    await blocker;
    await holder.$disconnect();
    await db.organization.update({ where: { id: organizationId }, data: { archivedAt: null } });
  }
});

// #314: a foreign FOR UPDATE must not hang the request; lock_timeout ends the wait near its limit.
test("a held organization lock ends the wait at lock_timeout with a 503 and no write", async () => {
  const organizationId = companies[0];
  const before = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } });
  const auditBefore = await db.auditLog.count({ where: { organizationId } });
  const limited = createPrismaClient(process.env.DATABASE_URL ?? "", { lockTimeoutMs: 400, statementTimeoutMs: 10_000 });
  const holder = createPrismaClient(process.env.DATABASE_URL ?? "");
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  let locked!: () => void;
  const lockTaken = new Promise<void>((resolve) => { locked = resolve; });
  const blocker = holder.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`;
    locked();
    await hold;
  }, { timeout: 30_000 });
  try {
    await lockTaken;
    const started = Date.now();
    const error = await changePaidThrough(limited, { ...actor(), organizationId, expectedVersion: before.periodVersion,
      paidThrough: "2027-02-28", eventKey: randomUUID(), requestId: randomUUID() }).catch((reason: unknown) => reason);
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(isTransientDbError(error)).toBe(true);
    const response = periodFailure(error, randomUUID());
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("2");
    expect(await response.json()).toEqual({ code: "TEMPORARILY_UNAVAILABLE" });
  } finally {
    release();
    await blocker;
    await holder.$disconnect();
    await limited.$disconnect();
  }
  expect(await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({
    periodVersion: before.periodVersion, paidThrough: before.paidThrough });
  expect(await db.auditLog.count({ where: { organizationId } })).toBe(auditBefore);
});
