import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { requestPasswordReset, resetPassword } from "../../src/modules/auth/account-operations";
import { decryptMailPayload } from "../../src/modules/jobs/outbox";
import { createFeedToken, hashFeedToken } from "../../src/modules/calendar-feed/tokens";
import { privateFeed } from "../../src/modules/calendar-feed/feed-http";
import { GET as feedRoute } from "../../src/app/api/calendar/feed/[token]/route";
import { GET as adminList, POST as adminCreate } from "../../src/app/api/admin/calendar-feeds/route";
import { DELETE as adminRevoke } from "../../src/app/api/admin/calendar-feeds/[id]/route";
import { POST as adminRotate } from "../../src/app/api/admin/calendar-feeds/[id]/rotate/route";
import { GET as platformList } from "../../src/app/api/platform/companies/[organizationId]/calendar-feeds/route";
import { DELETE as platformRevoke } from "../../src/app/api/platform/companies/[organizationId]/calendar-feeds/[id]/route";
import { POST as authPost } from "../../src/app/api/auth/[...all]/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const orgA = randomUUID();
const orgB = randomUUID();
const adminA = randomUUID();
const adminB = randomUUID();
const vehicleA = randomUUID();
const vehicleA2 = randomUUID();
const draftBlocked = randomUUID();
const hiddenBlocked = randomUUID();
const archivedBlocked = randomUUID();
const vehicleB = randomUUID();
const hostA = `feed-a-${orgA}.example.test`;
const hostB = `feed-b-${orgB}.example.test`;
const publicHostA = `feed-pub-${orgA}.example.test`;
const platformHost = `feed-platform-${randomUUID()}.example.test`;
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const ip = () => `10.${randomBytes(3).join(".")}`;
const password = "Feed fixture password 9384!";
const evilName = "Auto\r\nBEGIN:VEVENT\r\nSUMMARY:Podrobiony, ze;srednikiem\\";
let cookieA = "";
let cookieB = "";
let platformCookie = "";
let platformId = "";
let ownedPlatform = false;
const disposers: Array<() => Promise<unknown>> = [];

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: orgA, slug: `feed-${orgA}` }, { id: orgB, slug: `feed-${orgB}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: hostA, area: "COMPANY_ADMIN", organizationId: orgA, status: "ACTIVE" },
    { hostname: hostB, area: "COMPANY_ADMIN", organizationId: orgB, status: "ACTIVE" },
    { hostname: publicHostA, area: "COMPANY_PUBLIC", organizationId: orgA, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  const now = new Date();
  for (const id of [orgA, orgB]) {
    await db.organization.update({ where: { id }, data: { firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
  }
  for (const [id, organizationId] of [[adminA, orgA], [adminB, orgB]] as const) {
    await db.user.create({ data: { id, name: "Feed admin", email: `feed-${id}@example.test`, role: "ADMIN_FIRMY",
      organizationId, emailVerified: true, twoFactorEnabled: true } });
    await db.account.create({ data: { id: randomUUID(), userId: id, accountId: id, providerId: "credential",
      password: await hashPassword(password) } });
  }
  await db.vehicle.createMany({ data: [
    { id: vehicleA, organizationId: orgA, slug: `feed-a-${vehicleA}`, name: evilName, status: "PUBLISHED",
      availableFrom: sqlDate(day(-10)), availableTo: sqlDate(day(20)) },
    { id: vehicleA2, organizationId: orgA, slug: `feed-a2-${vehicleA2}`, name: "Drugi", status: "DRAFT",
      availableFrom: sqlDate(day(-10)) },
    { id: draftBlocked, organizationId: orgA, slug: `feed-d-${draftBlocked}`, name: "Szkic z blokadą", status: "DRAFT",
      availableFrom: sqlDate(day(-10)), availableTo: sqlDate(day(30)) },
    { id: hiddenBlocked, organizationId: orgA, slug: `feed-h-${hiddenBlocked}`, name: "Wycofany z blokadą", status: "UNPUBLISHED",
      availableFrom: sqlDate(day(-10)), availableTo: sqlDate(day(30)) },
    { id: archivedBlocked, organizationId: orgA, slug: `feed-r-${archivedBlocked}`, name: "Archiwalny z blokadą", status: "ARCHIVED",
      availableFrom: sqlDate(day(-10)), availableTo: sqlDate(day(30)) },
    { id: vehicleB, organizationId: orgB, slug: `feed-b-${vehicleB}`, name: "Cudzy pojazd B", status: "PUBLISHED",
      availableFrom: sqlDate(day(-10)) },
  ] });
  await db.availabilityBlock.createMany({ data: [
    { organizationId: orgA, vehicleId: vehicleA, from: sqlDate(day(3)), to: sqlDate(day(3)), type: "MAINTENANCE",
      reference: "SEKRET-REF-1", internalNote: "SEKRET-NOTATKA-1" },
    { organizationId: orgA, vehicleId: vehicleA, from: sqlDate(day(4)), to: sqlDate(day(5)), type: "RESERVED",
      reference: "SEKRET-REF-2", internalNote: "SEKRET-NOTATKA-2" },
    ...[draftBlocked, hiddenBlocked, archivedBlocked].map((vehicleId) => ({ organizationId: orgA, vehicleId,
      from: sqlDate(day(7)), to: sqlDate(day(8)), type: "BLOCKED" as const })),
    { organizationId: orgB, vehicleId: vehicleB, from: sqlDate(day(1)), to: sqlDate(day(1)), type: "BLOCKED" },
  ] });
  const a = await verifiedFixtureSession(db, adminA);
  const b = await verifiedFixtureSession(db, adminB);
  cookieA = a.cookie; cookieB = b.cookie; disposers.push(a.dispose, b.dispose);
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatform = true;
    await db.user.create({ data: { id: platformId, name: "Feed platform", email: `feed-platform-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const p = await verifiedFixtureSession(db, platformId);
  platformCookie = p.cookie; disposers.push(p.dispose);
});

afterAll(async () => {
  for (const dispose of disposers) await dispose();
  await db.rateLimitEvent.deleteMany();
  await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.passwordResetRequest.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.verification.deleteMany({ where: { identifier: { in: [`password-reset:feed-${adminA}@example.test`] } } });
  await db.job.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.calendarFeedToken.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.user.deleteMany({ where: { id: { in: [adminA, adminB, ...(ownedPlatform ? [platformId] : [])] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostA, hostB, publicHostA, platformHost] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.$disconnect();
});

const call = (handler: (request: Request, context: never) => Promise<Response>, host: string, cookie: string,
  method: string, path: string, params?: object, body?: object) =>
  handler(new Request(`http://${host}${path}`, { method, headers: { host, cookie, origin: `http://${host}`,
    "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }),
  { params: Promise.resolve(params ?? {}) } as never);
const create = (label = "Kalendarz Google", host = hostA, cookie = cookieA) =>
  call(adminCreate, host, cookie, "POST", "/api/admin/calendar-feeds", undefined, { label });
const feed = (secret: string, host = hostA, at?: Date) => runWithTrustedClientAddress(ip(), () =>
  privateFeed(new Request(`http://${host}/api/calendar/feed/${secret}.ics`, { headers: { host } }), `${secret}.ics`, at));
async function issue(organizationId = orgA, actorId = adminA, label = "Test") {
  const session = await liveSession(actorId);
  return createFeedToken(db, { actorId, sessionId: session.id, organizationId, requestId: randomUUID(), label });
}
const liveSession = (userId: string) => db.session.findFirstOrThrow({ where: { userId, mfaVerifiedAt: { not: null },
  expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
const unfold = (body: string) => body.replace(/\r\n /g, "");

test("admin creates a feed: secret shown once, only the hash is stored, list never exposes it, audit is clean", async () => {
  const response = await create();
  expect(response.status).toBe(201);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const created = await response.json();
  expect(created.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(created.path).toBe(`/api/calendar/feed/${created.token}.ics`);
  expect(created.url).toBe(`http://${hostA}${created.path}`);
  expect(created).toMatchObject({ label: "Kalendarz Google", status: "ACTIVE" });
  const row = await db.calendarFeedToken.findUniqueOrThrow({ where: { id: created.id } });
  expect(row.tokenHash).toBe(createHash("sha256").update(created.token).digest("hex"));
  expect(JSON.stringify(row)).not.toContain(created.token);
  expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(365 * 86_400_000);
  const listed = await call(adminList, hostA, cookieA, "GET", "/api/admin/calendar-feeds");
  const text = await listed.text();
  expect(text).not.toContain(created.token);
  expect(text).not.toContain(row.tokenHash);
  expect(JSON.parse(text)).toMatchObject({ activeLimit: 5, validityDays: 365 });
  const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "CALENDAR_FEED_CREATED", entityId: created.id } });
  expect(audit.safeChanges).toEqual({ count: 1 });
  expect(JSON.stringify(audit)).not.toContain(created.token);
  expect(JSON.stringify(audit)).not.toContain(row.tokenHash);
  expect((await call(adminCreate, hostA, cookieA, "POST", "/api/admin/calendar-feeds", undefined, { label: "" })).status).toBe(400);
  expect((await call(adminCreate, hostA, cookieA, "POST", "/api/admin/calendar-feeds", undefined, { label: "a\nb" })).status).toBe(400);
  expect((await call(adminCreate, hostA, cookieA, "POST", "/api/admin/calendar-feeds", undefined, { label: "x", extra: 1 })).status).toBe(400);
  expect((await call(adminCreate, hostA, "", "POST", "/api/admin/calendar-feeds", undefined, { label: "x" })).status).toBe(403);
});

test("at most five active feeds per company, also under parallel creates; isolation between companies", async () => {
  await db.calendarFeedToken.deleteMany({ where: { organizationId: orgA } });
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => create(`Równoległy ${index}`)));
  const statuses = results.map((result) => result.status).sort();
  expect(statuses).toEqual([201, 201, 201, 201, 201, 409, 409, 409]);
  expect(await db.calendarFeedToken.count({ where: { organizationId: orgA, revokedAt: null } })).toBe(5);
  expect((await create("Szósty")).status).toBe(409);
  expect((await create("Firma B", hostB, cookieB)).status).toBe(201);
  const listA = await (await call(adminList, hostA, cookieA, "GET", "/api/admin/calendar-feeds")).json();
  expect(listA.items).toHaveLength(5);
  const foreign = await db.calendarFeedToken.findFirstOrThrow({ where: { organizationId: orgB } });
  expect((await call(adminRevoke, hostA, cookieA, "DELETE", `/api/admin/calendar-feeds/${foreign.id}`, { id: foreign.id })).status).toBe(404);
  expect((await call(adminRotate, hostA, cookieA, "POST", `/api/admin/calendar-feeds/${foreign.id}/rotate`, { id: foreign.id })).status).toBe(404);
  expect((await call(adminList, hostB, cookieA, "GET", "/api/admin/calendar-feeds")).status).toBe(403);
  expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id: foreign.id } })).revokedAt).toBeNull();
});

test("superadmin lists and revokes in the company context but cannot create or rotate", async () => {
  await db.calendarFeedToken.deleteMany({ where: { organizationId: orgA } });
  const issued = await issue();
  const listed = await call(platformList, platformHost, platformCookie, "GET", `/api/platform/companies/${orgA}/calendar-feeds`, { organizationId: orgA });
  expect(listed.status).toBe(200);
  const text = await listed.text();
  expect(text).not.toContain(issued.secret);
  expect(JSON.parse(text).items.map((item: { id: string }) => item.id)).toEqual([issued.id]);
  const revoked = await call(platformRevoke, platformHost, platformCookie, "DELETE", `/api/platform/companies/${orgA}/calendar-feeds/${issued.id}`,
    { organizationId: orgA, id: issued.id });
  expect(revoked.status).toBe(200);
  expect(await revoked.json()).toMatchObject({ id: issued.id, status: "REVOKED" });
  expect((await feed(issued.secret)).status).toBe(404);
  const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "CALENDAR_FEED_REVOKED", entityId: issued.id } });
  expect(audit.actorRole).toBe("SUPERADMIN_AUTERVA");
  expect(audit.safeChanges).toEqual({ count: 1 });
  // The admin host never serves the platform routes, and the platform session never creates a feed.
  const session = await liveSession(platformId);
  await expect(createFeedToken(db, { actorId: platformId, sessionId: session.id, organizationId: orgA,
    requestId: randomUUID(), label: "x" })).rejects.toThrow("FEED_FORBIDDEN");
  // Idempotent revoke: a second call succeeds and writes no second audit row.
  expect((await call(platformRevoke, platformHost, platformCookie, "DELETE", `/api/platform/companies/${orgA}/calendar-feeds/${issued.id}`,
    { organizationId: orgA, id: issued.id })).status).toBe(200);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "CALENDAR_FEED_REVOKED", entityId: issued.id } })).toBe(1);
});

test("feed shows only unavailability ranges: no type, reference, note or block id; DTEND is the day after; headers", async () => {
  await db.calendarFeedToken.deleteMany({ where: { organizationId: orgA } });
  const { secret } = await issue();
  const response = await feed(secret);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("X-Request-Id")).toBeTruthy();
  expect(response.headers.get("Set-Cookie")).toBeNull();
  const body = await response.text();
  const text = unfold(body);
  expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(body.endsWith("END:VCALENDAR\r\n")).toBe(true);
  for (const secretText of ["SEKRET", "MAINTENANCE", "RESERVED", "BLOCKED", "Serwis", "Cudzy pojazd B"]) expect(text).not.toContain(secretText);
  const blockIds = (await db.availabilityBlock.findMany({ where: { organizationId: orgA }, select: { id: true } })).map(({ id }) => id);
  for (const id of blockIds) expect(text).not.toContain(id);
  expect(text).not.toContain(vehicleA);
  // Vehicle A: before activity [today, today+... ] is not unavailable (activity started 10 days ago), blocks day+3 and
  // day+4..+5 merge into one range 3..5 (DTEND day+6), then everything after the activity end (day+21..day+365).
  const events = text.split("BEGIN:VEVENT\r\n").slice(1);
  const dates = events.map((event) => ({ start: /DTSTART;VALUE=DATE:(\d{8})/.exec(event)![1], end: /DTEND;VALUE=DATE:(\d{8})/.exec(event)![1] }));
  const compact = (value: string) => value.replaceAll("-", "");
  expect(dates).toContainEqual({ start: compact(day(3)), end: compact(day(6)) });
  expect(dates).toContainEqual({ start: compact(day(21)), end: compact(day(366)) });
  expect(events.filter((event) => event.includes("SUMMARY:Niedostępny: Drugi"))).toHaveLength(0);
  // D-47: only PUBLISHED vehicles; a draft, unpublished or archived vehicle with a block never appears.
  for (const name of ["Szkic z blokadą", "Wycofany z blokadą", "Archiwalny z blokadą", "Drugi"]) expect(text).not.toContain(name);
  expect(text).not.toContain(`DTSTART;VALUE=DATE:${day(7).replaceAll("-", "")}`);
  expect(events.some((event) => /UID:[0-9a-f]{40}@auterva/.test(event))).toBe(true);
  // The company's second vehicle has no unavailable day; the other company's vehicle never appears.
  expect(text).not.toContain("Cudzy");
  // CRLF injection in the vehicle name stays inside one escaped SUMMARY line.
  expect(body.split("\r\n").filter((line) => line.startsWith("BEGIN:VEVENT")).length).toBe(events.length);
  expect(text).toContain("SUMMARY:Niedostępny: Auto\\nBEGIN:VEVENT\\nSUMMARY:Podrobiony\\, ze\\;srednikiem\\\\");
  for (const line of body.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  expect((await db.calendarFeedToken.findFirstOrThrow({ where: { organizationId: orgA } })).lastUsedAt).not.toBeNull();
});

test("the route handler serves the feed on the company admin host only; unknown, foreign host and public host look the same", async () => {
  const { secret } = await issue();
  const viaRoute = (host: string, token: string) => runWithTrustedClientAddress(ip(), () => feedRoute(
    new Request(`http://${host}/api/calendar/feed/${token}`, { headers: { host } }), { params: Promise.resolve({ token }) }));
  expect((await viaRoute(hostA, `${secret}.ics`)).status).toBe(200);
  const refusals = await Promise.all([viaRoute(hostA, `${randomBytes(32).toString("base64url")}.ics`),
    viaRoute(hostA, `${secret}`), viaRoute(hostA, `${secret}.ICS`), viaRoute(hostA, "short.ics"),
    viaRoute(hostB, `${secret}.ics`), viaRoute(publicHostA, `${secret}.ics`), viaRoute(platformHost, `${secret}.ics`)]);
  for (const refused of refusals) {
    expect(refused.status).toBe(404);
    expect(await refused.text()).toBe("");
    expect(refused.headers.get("Cache-Control")).toBe("private, no-store");
    expect(refused.headers.get("Content-Type")).toContain("text/plain");
  }
});

test("the next read shows a changed block immediately (no application cache)", async () => {
  const { secret } = await issue();
  const before = unfold(await (await feed(secret)).text());
  expect(before).not.toContain(`DTSTART;VALUE=DATE:${day(10).replaceAll("-", "")}\r\n`);
  const created = await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: vehicleA,
    from: sqlDate(day(10)), to: sqlDate(day(10)), type: "OTHER" } });
  const added = unfold(await (await feed(secret)).text());
  expect(added).toContain(`DTSTART;VALUE=DATE:${day(10).replaceAll("-", "")}\r\nDTEND;VALUE=DATE:${day(11).replaceAll("-", "")}`);
  await db.availabilityBlock.delete({ where: { id: created.id } });
  expect(unfold(await (await feed(secret)).text())).not.toContain(`DTSTART;VALUE=DATE:${day(10).replaceAll("-", "")}\r\n`);
});

test("window starts at today in Europe/Warsaw across the DST switch (frozen clock)", async () => {
  const { secret } = await issue();
  const read = async (iso: string) => unfold(await (await feed(secret, hostA, new Date(iso))).text());
  // 2026-03-28T23:30Z is 00:30 on 29 March (CET); 2026-03-29T22:30Z is 00:30 on 30 March (CEST, after the switch).
  // Vehicle A is active from day(-10) to day(20) relative to the real today, so with a frozen 2026 clock the days
  // before its activity start are unavailable: the first event starts exactly on the Warsaw "today".
  expect(await read("2026-03-28T23:30:00Z")).toContain("DTSTART;VALUE=DATE:20260329");
  expect(await read("2026-03-29T22:30:00Z")).toContain("DTSTART;VALUE=DATE:20260330");
  expect(await read("2026-10-24T22:30:00Z")).toContain("DTSTART;VALUE=DATE:20261025");
  expect(await read("2026-10-26T23:30:00Z")).toContain("DTSTART;VALUE=DATE:20261027");
});

test("rotation invalidates the old secret at once; parallel rotations leave exactly one live successor", async () => {
  await db.calendarFeedToken.deleteMany({ where: { organizationId: orgA } });
  const first = await (await create("Do obrotu")).json();
  const rotated = await call(adminRotate, hostA, cookieA, "POST", `/api/admin/calendar-feeds/${first.id}/rotate`, { id: first.id });
  expect(rotated.status).toBe(200);
  const second = await rotated.json();
  expect(second.id).not.toBe(first.id);
  expect(second.label).toBe("Do obrotu");
  expect((await feed(first.token)).status).toBe(404);
  expect((await feed(second.token)).status).toBe(200);
  expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id: first.id } })).revokedReason).toBe("ROTATED");
  const outcomes = await Promise.all([1, 2, 3].map(() => call(adminRotate, hostA, cookieA, "POST",
    `/api/admin/calendar-feeds/${second.id}/rotate`, { id: second.id })));
  expect(outcomes.map((result) => result.status).sort()).toEqual([200, 404, 404]);
  expect(await db.calendarFeedToken.count({ where: { organizationId: orgA, revokedAt: null } })).toBe(1);
  expect((await feed(second.token)).status).toBe(404);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "CALENDAR_FEED_ROTATED" } })).toBe(2);
});

test("revoked and expired tokens, a disabled or demoted creator and an expired service period", async () => {
  const revoked = await issue();
  expect((await call(adminRevoke, hostA, cookieA, "DELETE", `/api/admin/calendar-feeds/${revoked.id}`, { id: revoked.id })).status).toBe(200);
  expect((await feed(revoked.secret)).status).toBe(404);
  const expired = await issue();
  await db.calendarFeedToken.update({ where: { id: expired.id }, data: { createdAt: new Date(Date.now() - 400 * 86_400_000),
    expiresAt: new Date(Date.now() - 86_400_000) } });
  expect((await feed(expired.secret)).status).toBe(404);
  const live = await issue();
  // E13: the service period ending does not switch the private feed off.
  // The trial lasts 336 h; a read 30 days from now (token still valid for 365 days) happens after it ended.
  expect((await feed(live.secret, hostA, new Date(Date.now() + 30 * 86_400_000))).status).toBe(200);
  expect((await feed(live.secret)).status).toBe(200);
  await db.user.update({ where: { id: adminA }, data: { disabledAt: new Date() } });
  expect((await feed(live.secret)).status).toBe(404);
  await db.user.update({ where: { id: adminA }, data: { disabledAt: null, role: "ADMIN_FIRMY", organizationId: orgA } });
  expect((await feed(live.secret)).status).toBe(200);
});

test("per-address limit applies before the token lookup and a per-token limit follows", async () => {
  const { secret } = await issue();
  const sameIp = ip();
  const hit = (token: string) => runWithTrustedClientAddress(sameIp, () => privateFeed(
    new Request(`http://${hostA}/x`, { headers: { host: hostA } }), `${token}.ics`));
  const unknown = randomBytes(32).toString("base64url");
  for (let index = 0; index < 60; index++) expect((await hit(unknown)).status).toBe(404);
  const limited = await hit(secret);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(await limited.text()).toBe("");
  // The token limit (30 per hour) holds across addresses.
  let last = 200;
  for (let index = 0; index < 31; index++) last = (await feed(secret)).status;
  expect(last).toBe(429);
});

test("archiving revokes every feed and a restore does not bring them back", async () => {
  await db.calendarFeedToken.deleteMany({ where: { organizationId: orgB } });
  const { secret, id } = await issue(orgB, adminB);
  expect((await feed(secret, hostB)).status).toBe(200);
  const session = await liveSession(platformId);
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgB }, select: { version: true } });
  const op = (expectedVersion: number) => ({ actorId: platformId, sessionId: session.id, organizationId: orgB,
    expectedVersion, eventKey: randomUUID(), requestId: randomUUID() });
  await archiveCompany(db, op(org.version));
  expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id } })).revokedReason).toBe("COMPANY_ARCHIVED");
  expect((await feed(secret, hostB)).status).toBe(404);
  const audit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgB, action: "CALENDAR_FEED_REVOKED" } });
  expect(audit.safeChanges).toEqual({ count: 1 });
  await restoreCompany(db, op(org.version + 1));
  expect((await feed(secret, hostB)).status).toBe(404);
  expect((await call(adminList, hostB, cookieB, "GET", "/api/admin/calendar-feeds")).status).toBe(403);
});

test("a password reset and a password change by the creating administrator revoke their feeds", async () => {
  const email = `feed-${adminA}@example.test`;
  const mailKey = randomBytes(32);
  const now = new Date();
  const scope = { area: "COMPANY_ADMIN" as const, organizationId: orgA };
  await db.calendarFeedToken.deleteMany({ where: { organizationId: orgA } });
  const mine = await issue();
  const other = await issue(orgA, adminA, "Druga");
  expect(await requestPasswordReset(db, { email, idempotencyKey: randomUUID(), scope, hostname: hostA, now, mailKey })).toEqual({ accepted: true });
  const verification = await db.verification.findFirstOrThrow({ where: { identifier: `password-reset:${email}` } });
  const job = await db.job.findFirstOrThrow({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${verification.id}` } });
  const token = decodeURIComponent(decryptMailPayload(job.payload, mailKey).url.split("/").at(-1)!);
  expect(await resetPassword(db, { token, newPassword: "Reset fixture password 9384!", scope, hostname: hostA, now, requestId: randomUUID() })).toBe(true);
  for (const secret of [mine.secret, other.secret]) expect((await feed(secret)).status).toBe(404);
  expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id: mine.id } })).revokedReason).toBe("PASSWORD_CHANGED");
  const resetAudit = await db.auditLog.findFirstOrThrow({ where: { organizationId: orgA, action: "CALENDAR_FEED_REVOKED", actorId: adminA },
    orderBy: { createdAt: "desc" } });
  expect(resetAudit.safeChanges).toEqual({ count: 2 });
  // Password change from a logged-in session: same effect.
  const session = await verifiedFixtureSession(db, adminA);
  disposers.push(session.dispose);
  const again = await issue();
  expect((await feed(again.secret)).status).toBe(200);
  const cookie = session.cookie.replace("better-auth.session_token", "__Secure-better-auth.session_token");
  const changed = await runWithTrustedClientAddress(ip(), () => authPost(new Request(`https://${hostA}/api/auth/password/change`, {
    method: "POST", headers: { host: hostA, origin: `https://${hostA}`, "content-type": "application/json", cookie },
    body: JSON.stringify({ currentPassword: "Reset fixture password 9384!", newPassword: "Changed fixture password 9384!" }) })));
  expect(changed.status).toBe(200);
  expect((await feed(again.secret)).status).toBe(404);
  expect((await db.calendarFeedToken.findUniqueOrThrow({ where: { id: again.id } })).revokedReason).toBe("PASSWORD_CHANGED");
  expect(hashFeedToken(again.secret)).toHaveLength(64);
});
