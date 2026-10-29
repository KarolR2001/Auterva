import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import { appendAudit, type AppendAuditInput } from "../../src/modules/audit/append";
import * as adminRoute from "../../src/app/api/admin/audit/route";
import * as platformRoute from "../../src/app/api/platform/companies/[organizationId]/audit/route";
import { ensureControlledFixtureAccess } from "../fixtures/verified-session";

// #74: panel audit read over HTTP on PostgreSQL — companies A/B/C (C archived), their admins and the superadmin.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed fixture responses are asserted structurally
type Json = Record<string, any>;
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [orgA, orgB, orgC] = [randomUUID(), randomUUID(), randomUUID()];
const orgs = [orgA, orgB, orgC];
const adminIds = orgs.map(() => randomUUID());
const adminHosts = orgs.map((id) => `audit-read-admin-${id}.example.test`);
const platformHost = `audit-read-platform-${randomUUID()}.example.test`;
const superId = FIXTURE.users[2];
const vehicleB = randomUUID();
const sessionIds: string[] = [];
type Session = { id: string; cookie: string };
let adminSession: Session[] = [];
let superSession: Session;

function secret() {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET is required for fixture sessions");
  return value;
}
async function session(userId: string, mfa = true, expiresAt = new Date(Date.now() + 60 * 60_000)): Promise<Session> {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.session.create({ data: { id, userId, token, expiresAt, mfaVerifiedAt: mfa ? new Date() : null } });
  sessionIds.push(id);
  return { id, cookie: `better-auth.session_token=${token}.${createHmac("sha256", secret()).update(token).digest("base64")}` };
}
function get(host: string, path: string, cookie: string) {
  return new Request(`https://${host}${path}`, { headers: { host, cookie } });
}
const ctx = (organizationId: string) => ({ params: Promise.resolve({ organizationId }) });
async function adminRead(index: number, search = "", cookie = adminSession[index].cookie, host = adminHosts[index]) {
  return adminRoute.GET(get(host, `/api/admin/audit/${search}`, cookie));
}
async function platformRead(organizationId: string, search = "", cookie = superSession.cookie, host = platformHost) {
  return platformRoute.GET(get(host, `/api/platform/companies/${organizationId}/audit/${search}`, cookie), ctx(organizationId));
}
async function json(response: Response) {
  return { status: response.status, body: await response.json() as Json, headers: response.headers };
}
async function append(input: Omit<AppendAuditInput, "eventKey" | "requestId"> & { requestId?: string }) {
  return db.$transaction((tx) => appendAudit(tx, { eventKey: randomUUID(), requestId: randomUUID(), ...input }));
}
const asAdmin = (index: number) => ({ actorId: adminIds[index], sessionId: adminSession[index].id, organizationId: orgs[index] });
const asSuper = (organizationId: string) => ({ actorId: superId, sessionId: superSession.id, organizationId });
async function allPages(read: (search: string) => Promise<Response>, limit: number, between?: () => Promise<void>) {
  const ids: string[] = [];
  let cursor: string | null = null;
  do {
    const page = await json(await read(`?limit=${limit}${cursor ? `&cursor=${cursor}` : ""}`));
    expect(page.status).toBe(200);
    ids.push(...page.body.entries.map((entry: Json) => entry.id));
    cursor = page.body.nextCursor;
    if (between) await between();
  } while (cursor);
  return ids;
}
function limiterHash(key: string) {
  return createHmac("sha256", secret()).update(key).digest("hex");
}

beforeAll(async () => {
  await ensureControlledFixtureAccess(db);
  await db.organization.createMany({ data: orgs.map((id, index) => ({ id, slug: `audit-read-${id}`,
    name: `Audit ${"ABC"[index]}`, firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) })) });
  await db.hostMapping.createMany({ data: [
    ...orgs.map((organizationId, index) => ({ hostname: adminHosts[index], area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" })),
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" }] });
  await db.user.createMany({ data: orgs.map((organizationId, index) => ({ id: adminIds[index], name: `Audit admin ${index}`,
    email: `audit-read-${adminIds[index]}@example.test`, role: "ADMIN_FIRMY", organizationId,
    emailVerified: true, twoFactorEnabled: true })) });
  adminSession = [await session(adminIds[0]), await session(adminIds[1]), await session(adminIds[2])];
  superSession = await session(superId);
});

beforeEach(async () => {
  const keys = [`api:read:${superId}:platform`, ...orgs.map((org, index) => `api:read:${adminIds[index]}:${org}`)];
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map(limiterHash) } } });
});

afterAll(async () => {
  await db.session.deleteMany({ where: { id: { in: sessionIds } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.user.deleteMany({ where: { id: { in: adminIds } } });
  await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: { in: orgs } }, { hostname: platformHost }] } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  await db.$disconnect();
});

test("each role reads only the company from its context; foreign company, object and filters return no data", async () => {
  const ownA = await append({ ...asAdmin(0), action: "BLOCK_CREATED", entityId: randomUUID() });
  const superA = await append({ ...asSuper(orgA), action: "SETTINGS_CHANGED", entityId: orgA,
    changes: { changedFields: ["phone"] } });
  const ownB = await append({ ...asAdmin(1), action: "VEHICLE_UPDATED", entityId: vehicleB });

  const a = await json(await adminRead(0));
  expect(a.status).toBe(200);
  expect(a.headers.get("cache-control")).toBe("no-store");
  const idsA = a.body.entries.map((entry: Json) => entry.id);
  expect(idsA).toEqual(expect.arrayContaining([ownA.id, superA.id]));
  expect(idsA).not.toContain(ownB.id);
  // The superadmin's change keeps its real actor in the company's history (ADM-17).
  expect(a.body.entries.find((entry: Json) => entry.id === superA.id).actor).toEqual({ id: superId, role: "SUPERADMIN_AUTERVA" });
  expect(a.body.entries.find((entry: Json) => entry.id === ownA.id).actor).toEqual({ id: adminIds[0], role: "ADMIN_FIRMY" });

  // B's object id, B's actor, a company parameter or B's host never reveal B's rows to admin A.
  expect((await json(await adminRead(0, `?entityId=${vehicleB}`))).body.entries).toEqual([]);
  expect((await json(await adminRead(0, `?actorId=${adminIds[1]}`))).body.entries).toEqual([]);
  expect((await adminRead(0, `?organizationId=${orgB}`)).status).toBe(400);
  expect((await adminRead(0, "", adminSession[0].cookie, adminHosts[1])).status).toBe(403);
  expect((await platformRead(orgB, "", adminSession[0].cookie)).status).toBe(403);

  const superB = await json(await platformRead(orgB));
  expect(superB.status).toBe(200);
  expect(superB.body.entries.map((entry: Json) => entry.id)).toEqual([ownB.id]);
  const superAll = await json(await platformRead(orgA, `?entityType=Vehicle&entityId=${vehicleB}`));
  expect(superAll.body.entries).toEqual([]);
  expect((await platformRead(orgA, "", superSession.cookie, adminHosts[0])).status).toBe(404);
  expect((await adminRead(0, "", superSession.cookie)).status).toBe(403);
  expect((await platformRead(randomUUID())).status).toBe(403);
  expect((await platformRead("not-a-uuid")).status).toBe(400);
});

test("filters by time, actor, action and object stay inside the company", async () => {
  const blockId = randomUUID();
  const created = await append({ ...asAdmin(0), action: "BLOCK_UPDATED", entityId: blockId });
  const bySuper = await append({ ...asSuper(orgA), action: "BLOCK_DELETED", entityId: blockId });
  const read = async (search: string) => (await json(await adminRead(0, search))).body.entries.map((entry: Json) => entry.id);

  expect(await read(`?entityType=AvailabilityBlock&entityId=${blockId}`)).toEqual([bySuper.id, created.id]);
  expect(await read(`?entityId=${blockId}&actorRole=SUPERADMIN_AUTERVA`)).toEqual([bySuper.id]);
  expect(await read(`?entityId=${blockId}&actorId=${adminIds[0]}`)).toEqual([created.id]);
  expect(await read(`?entityId=${blockId}&action=BLOCK_DELETED`)).toEqual([bySuper.id]);
  const from = created.createdAt.toISOString();
  const after = new Date(bySuper.createdAt.getTime() + 1).toISOString();
  expect(await read(`?entityId=${blockId}&from=${from}&to=${after}`)).toEqual([bySuper.id, created.id]);
  expect(await read(`?entityId=${blockId}&to=${from}`)).toEqual([]);
  expect(await read(`?entityId=${blockId}&from=${after}`)).toEqual([]);

  for (const search of ["?action=DROP_TABLE", "?entityType=Chat", "?actorRole=OWNER", "?limit=0", "?limit=101",
    "?from=2026-10-29", "?from=2026-10-29T10:00:00.000%2B01:00", `?from=${after}&to=${from}`, "?cursor=bm90LWEtY3Vyc29y",
    "?entityId=%27%3B--", "?limit=5&limit=6", "?sql=select"]) {
    const response = await json(await adminRead(0, search));
    expect([search, response.status, response.body.code]).toEqual([search, 400, "INVALID_INPUT"]);
  }
});

test("keyset pagination neither loses nor duplicates entries while new ones are appended", async () => {
  const existing: string[] = [];
  for (let index = 0; index < 23; index++)
    existing.push((await append({ ...asAdmin(0), action: "VEHICLE_UPDATED", entityId: randomUUID() })).id);
  // Rows in the same millisecond differ only in microseconds; a millisecond cursor would skip them.
  const sameMs = await db.$queryRaw<{ id: string }[]>`
    INSERT INTO "AuditLog" (id, "eventKey", "organizationId", "actorId", "actorRole", action, "entityType", "entityId", "requestId", "createdAt")
    SELECT gen_random_uuid(), gen_random_uuid(), ${orgA}::uuid, ${adminIds[0]}, 'ADMIN_FIRMY', 'VEHICLE_UPDATED', 'Vehicle',
      gen_random_uuid()::text, gen_random_uuid()::text, date_trunc('milliseconds', now() - interval '1 minute') + n * interval '1 microsecond'
    FROM generate_series(1, 5) n RETURNING id::text AS id`;
  const before = await allPages((search) => adminRead(0, search), 100);
  expect(before).toEqual(expect.arrayContaining([...existing, ...sameMs.map((row) => row.id)]));

  const appended: string[] = [];
  const paged = await allPages((search) => adminRead(0, search), 4, async () => {
    appended.push((await append({ ...asSuper(orgA), action: "VEHICLE_HIDDEN", entityId: randomUUID() })).id);
  });
  expect(new Set(paged).size).toBe(paged.length);
  expect(paged).toEqual(before);
  expect(paged.some((id) => appended.includes(id))).toBe(false);
  const fresh = await allPages((search) => adminRead(0, search), 100);
  expect(fresh).toEqual([...appended.reverse(), ...before]);

  const limitOne = await allPages((search) => platformRead(orgA, search), 1);
  expect(limitOne.filter((id) => sameMs.some((row) => row.id === id)).length).toBe(5);
  expect(new Set(limitOne).size).toBe(limitOne.length);
});

test("old/new values are redacted like the write side and time is UTC", async () => {
  const published = await append({ ...asAdmin(0), action: "VEHICLE_PUBLISHED", entityId: randomUUID(),
    changes: { changedFields: ["status", "name"], before: { status: "DRAFT" }, after: { status: "PUBLISHED" } } });
  const unsafeId = randomUUID();
  const legacyId = randomUUID();
  await db.auditLog.createMany({ data: [
    // A row written outside appendAudit with values the write side forbids must still be redacted on read.
    { id: unsafeId, eventKey: randomUUID(), organizationId: orgA, actorId: adminIds[0], actorRole: "ADMIN_FIRMY",
      action: "SETTINGS_CHANGED", entityType: "SiteSettings", entityId: orgA, requestId: randomUUID(),
      safeChanges: { changedFields: ["phone", "password", "internalNote"], before: { phone: "+48 600 100 200", status: "DRAFT" },
        after: { internalNote: "prywatna notatka", token: "tok_secret", status: "javascript:alert(1)" },
        message: "pełna treść czatu", token: "tok_secret", ip: "203.0.113.7" } },
    { id: legacyId, eventKey: null, organizationId: orgA, actorId: adminIds[0], actorRole: "ADMIN_FIRMY",
      action: "AUTH_LOGIN_COMPLETED", entityType: "User", entityId: adminIds[0], requestId: randomUUID(),
      safeChanges: { changedFields: ["status"] } },
  ] });
  const response = await adminRead(0, "?limit=100");
  const text = await response.text();
  for (const leaked of ["+48 600", "password", "internalNote", "prywatna", "tok_secret", "czatu", "203.0.113.7", "javascript"])
    expect(text).not.toContain(leaked);
  const entries = (JSON.parse(text) as Json).entries as Json[];
  const safe = entries.find((entry) => entry.id === published.id)!;
  expect(safe.changes).toEqual({ changedFields: ["status", "name"], before: { status: "DRAFT" }, after: { status: "PUBLISHED" } });
  expect(safe.createdAt).toBe(published.createdAt.toISOString());
  expect(safe.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const [row] = await db.$queryRaw<{ epoch: string }[]>`SELECT (EXTRACT(EPOCH FROM "createdAt") * 1000)::bigint::text AS epoch
    FROM "AuditLog" WHERE id = ${published.id}::uuid`;
  expect(Date.parse(safe.createdAt)).toBe(Number(row.epoch));
  expect(entries.find((entry) => entry.id === unsafeId)!.changes).toEqual({ changedFields: ["phone"], before: { status: "DRAFT" } });
  expect(entries.find((entry) => entry.id === legacyId)!.changes).toBeNull();
  for (const entry of entries) expect(Object.keys(entry).sort()).toEqual(["action", "actor", "changes", "createdAt", "entity", "id", "requestId"]);
});

test("rows past the 365-day retention are not returned even when the filter asks for them", async () => {
  const oldId = randomUUID();
  await db.auditLog.create({ data: { id: oldId, eventKey: randomUUID(), organizationId: orgA, actorId: adminIds[0],
    actorRole: "ADMIN_FIRMY", action: "AUTH_LOGOUT", entityType: "User", entityId: adminIds[0], requestId: randomUUID(),
    createdAt: new Date(Date.now() - 366 * 86_400_000) } });
  const page = await json(await adminRead(0, `?from=${new Date(Date.now() - 400 * 86_400_000).toISOString()}&action=AUTH_LOGOUT`));
  expect(page.status).toBe(200);
  expect(page.body.entries.map((entry: Json) => entry.id)).not.toContain(oldId);
});

test("there is no HTTP method to edit or delete the audit", async () => {
  const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  expect(Object.keys(adminRoute).filter((name) => methods.includes(name))).toEqual(["GET"]);
  expect(Object.keys(platformRoute).filter((name) => methods.includes(name))).toEqual(["GET"]);
  const audit = await import("../../src/modules/audit/read");
  expect(Object.keys(audit).filter((name) => /update|delete|remove|purge|edit/i.test(name))).toEqual([]);
});

test("account state: archive, missing MFA, disabled and expired sessions refuse the read", async () => {
  const entry = await append({ ...asAdmin(2), action: "VEHICLE_CREATED", entityId: randomUUID() });
  expect((await adminRead(2)).status).toBe(200);
  await db.organization.update({ where: { id: orgC }, data: { archivedAt: new Date() } });
  // A leftover session of the archived company's admin is refused; the superadmin still reads that company.
  expect((await adminRead(2)).status).toBe(403);
  const archived = await json(await platformRead(orgC));
  expect(archived.status).toBe(200);
  expect(archived.body.entries.map((row: Json) => row.id)).toContain(entry.id);

  const noMfaAdmin = await session(adminIds[0], false);
  expect((await adminRead(0, "", noMfaAdmin.cookie)).status).toBe(403);
  const noMfaSuper = await session(superId, false);
  expect((await platformRead(orgA, "", noMfaSuper.cookie)).status).toBe(403);
  const expired = await session(adminIds[1], true, new Date(Date.now() - 1_000));
  expect((await adminRead(1, "", expired.cookie)).status).toBe(403);
  expect((await adminRead(1, "", "")).status).toBe(403);

  await db.user.update({ where: { id: adminIds[1] }, data: { disabledAt: new Date() } });
  try { expect((await adminRead(1)).status).toBe(403); }
  finally { await db.user.update({ where: { id: adminIds[1] }, data: { disabledAt: null } }); }
});
