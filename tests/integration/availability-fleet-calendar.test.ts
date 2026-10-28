import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { GET as adminFleet } from "../../src/app/api/admin/availability/fleet/route";
import { GET as platformFleet } from "../../src/app/api/platform/companies/[organizationId]/availability/fleet/route";
import { GET as adminCalendar } from "../../src/app/api/admin/vehicles/[id]/availability/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const orgA = randomUUID();
const orgB = randomUUID();
const adminA = randomUUID();
const adminB = randomUUID();
const hostA = `fleet-cal-a-${orgA}.example.test`;
const hostB = `fleet-cal-b-${orgB}.example.test`;
const platformHost = `fleet-cal-platform-${randomUUID()}.example.test`;
const today = availabilityToday(new Date());
const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const ids = { active: randomUUID(), open: randomUUID(), draft: randomUUID(), archived: randomUUID(), foreign: randomUUID() };
let cookieA = "";
let cookieB = "";
let platformCookie = "";
const disposers: (() => Promise<unknown>)[] = [];
let ownedPlatformId: string | null = null;

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: orgA, slug: `fleet-cal-a-${orgA}` }, { id: orgB, slug: `fleet-cal-b-${orgB}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: hostA, area: "COMPANY_ADMIN", organizationId: orgA, status: "ACTIVE" },
    { hostname: hostB, area: "COMPANY_ADMIN", organizationId: orgB, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  const now = new Date();
  for (const id of [orgA, orgB]) {
    await db.organization.update({ where: { id }, data: { firstAdminRegisteredAt: now } });
    await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
  }
  await db.vehicle.createMany({ data: [
    { id: ids.active, organizationId: orgA, slug: "fleet-active", name: "Active", status: "PUBLISHED", sortOrder: 1,
      availableFrom: sqlDate(day(-10)), availableTo: sqlDate(day(10)) },
    { id: ids.open, organizationId: orgA, slug: "fleet-open", name: "Open", status: "PUBLISHED", sortOrder: 2,
      availableFrom: sqlDate(day(2)) },
    { id: ids.draft, organizationId: orgA, slug: "fleet-draft", name: "Draft", status: "DRAFT", sortOrder: 3 },
    { id: ids.archived, organizationId: orgA, slug: "fleet-archived", name: "Archived", status: "ARCHIVED", sortOrder: 4,
      availableFrom: sqlDate(day(-10)) },
    { id: ids.foreign, organizationId: orgB, slug: "fleet-foreign", name: "Foreign", status: "PUBLISHED",
      availableFrom: sqlDate(day(-10)) },
  ] });
  await db.availabilityBlock.createMany({ data: [
    { organizationId: orgA, vehicleId: ids.active, from: sqlDate(day(0)), to: sqlDate(day(1)), type: "MAINTENANCE",
      reference: "secret-ref", internalNote: "secret-note" },
    { organizationId: orgA, vehicleId: ids.active, from: sqlDate(day(5)), to: sqlDate(day(5)), type: "BLOCKED" },
    { organizationId: orgA, vehicleId: ids.archived, from: sqlDate(day(-3)), to: sqlDate(day(-3)), type: "OTHER" },
    { organizationId: orgB, vehicleId: ids.foreign, from: sqlDate(day(0)), to: sqlDate(day(0)), type: "RESERVED" },
  ] });
  for (const [id, org] of [[adminA, orgA], [adminB, orgB]] as const) {
    await db.user.create({ data: { id, name: "Fleet admin", email: `fleet-cal-${id}@example.test`, role: "ADMIN_FIRMY",
      organizationId: org, emailVerified: true, twoFactorEnabled: true } });
  }
  const sessionA = await verifiedFixtureSession(db, adminA);
  const sessionB = await verifiedFixtureSession(db, adminB);
  cookieA = sessionA.cookie; cookieB = sessionB.cookie;
  disposers.push(sessionA.dispose, sessionB.dispose);
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  const platformId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformId);
  else {
    ownedPlatformId = platformId;
    await db.user.create({ data: { id: platformId, name: "Fleet platform", email: `fleet-cal-platform-${platformId}@example.test`,
      role: "SUPERADMIN_AUTERVA", emailVerified: true, twoFactorEnabled: true } });
  }
  const platformSession = await verifiedFixtureSession(db, platformId);
  platformCookie = platformSession.cookie;
  disposers.push(platformSession.dispose);
});

afterAll(async () => {
  for (const dispose of disposers) await dispose();
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await db.user.deleteMany({ where: { id: { in: [adminA, adminB, ...(ownedPlatformId ? [ownedPlatformId] : [])] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostA, hostB, platformHost] } } });
  await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await db.$disconnect();
});

type Item = { vehicleId: string; name: string; status: string; days: { date: string; available: boolean }[];
  blocks: Record<string, unknown>[] };
type Page = { from: string; to: string; total: number; page: number; pageSize: number; items: Item[] };

const admin = (query: string, cookie = cookieA, host = hostA) => adminFleet(
  new Request(`http://${host}/api/admin/availability/fleet?${query}`, { headers: { host, cookie } }));
const platform = (org: string, query: string, cookie = platformCookie) => platformFleet(
  new Request(`http://${platformHost}/api/platform/companies/${org}/availability/fleet?${query}`,
    { headers: { host: platformHost, cookie } }), { params: Promise.resolve({ organizationId: org }) });
const range = (from: string, to: string, extra = "") => `from=${from}&to=${to}${extra}`;

test("fleet grid equals the single-vehicle calendars and omits reference, note and foreign vehicles", async () => {
  const response = await admin(range(day(-5), day(7)));
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("X-Request-Id")).toMatch(/^[0-9a-f-]{36}$/i);
  const page = await response.json() as Page;
  expect(page).toMatchObject({ from: day(-5), to: day(7), total: 4, page: 1, pageSize: 25 });
  expect(page.items.map((item) => item.vehicleId)).toEqual([ids.active, ids.open, ids.draft, ids.archived]);
  for (const item of page.items) {
    const single = await adminCalendar(new Request(
      `http://${hostA}/api/admin/vehicles/${item.vehicleId}/availability?${range(day(-5), day(7))}`,
      { headers: { host: hostA, cookie: cookieA } }), { params: Promise.resolve({ id: item.vehicleId }) });
    const expected = await single.json() as { days: Item["days"]; blocks: { id: string; from: string; to: string; type: string; version: number }[] };
    expect(item.days).toEqual(expected.days);
    expect(item.blocks.map(({ id, from, to, type, version }) => ({ id, from, to, type, version })))
      .toEqual(expected.blocks.map(({ id, from, to, type, version }) => ({ id, from, to, type, version })));
  }
  const active = page.items[0]!;
  expect(active.days.find((d) => d.date === day(0))?.available).toBe(false);
  expect(active.days.find((d) => d.date === day(1))?.available).toBe(false);
  expect(active.days.find((d) => d.date === day(2))?.available).toBe(true);
  expect(active.days.find((d) => d.date === day(5))?.available).toBe(false);
  expect(active.days.find((d) => d.date === day(-6))).toBeUndefined();
  expect(page.items[1]!.days.map((d) => d.available)).toEqual(page.items[1]!.days.map((d) => d.date >= day(2)));
  expect(page.items[2]!.days.every((d) => !d.available)).toBe(true);
  expect(active.blocks[0]).toMatchObject({ type: "MAINTENANCE", typeLabel: "Serwis", from: day(0), to: day(1) });
  const text = JSON.stringify(page);
  expect(text).not.toContain("secret-ref");
  expect(text).not.toContain("secret-note");
  expect(text).not.toContain(ids.foreign);
  expect(Object.keys(active.blocks[0]!).sort()).toEqual(["from", "id", "to", "type", "typeLabel", "version"]);
});

test("pagination is stable, bounded and reports total", async () => {
  const first = await (await admin(range(day(0), day(1), "&pageSize=3"))).json() as Page;
  const second = await (await admin(range(day(0), day(1), "&pageSize=3&page=2"))).json() as Page;
  const beyond = await (await admin(range(day(0), day(1), "&pageSize=3&page=3"))).json() as Page;
  expect(first.items.map((i) => i.vehicleId)).toEqual([ids.active, ids.open, ids.draft]);
  expect(second.items.map((i) => i.vehicleId)).toEqual([ids.archived]);
  expect([first.total, second.total, beyond.total]).toEqual([4, 4, 4]);
  expect(beyond.items).toEqual([]);
  expect((await admin(range(day(0), day(1), "&pageSize=100"))).status).toBe(200);
});

test("a committed block change is visible in the next read", async () => {
  const before = await (await admin(range(day(8), day(8)))).json() as Page;
  expect(before.items[0]!.days).toEqual([{ date: day(8), available: true }]);
  const block = await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: ids.active,
    from: sqlDate(day(8)), to: sqlDate(day(8)), type: "RESERVED" } });
  const blocked = await (await admin(range(day(8), day(8)))).json() as Page;
  expect(blocked.items[0]!.days).toEqual([{ date: day(8), available: false }]);
  expect(blocked.items[0]!.blocks).toHaveLength(1);
  await db.availabilityBlock.delete({ where: { id: block.id } });
  const after = await (await admin(range(day(8), day(8)))).json() as Page;
  expect(after.items[0]!.days).toEqual([{ date: day(8), available: true }]);
  expect(after.items[0]!.blocks).toEqual([]);
});

test("range is inclusive, up to 365 days and may be historical; leap day is its own date", async () => {
  expect(((await (await admin(range(day(-3), day(-3)))).json()) as Page).items[3]!.days)
    .toEqual([{ date: day(-3), available: false }]);
  expect((await admin(range(day(0), day(364)))).status).toBe(200);
  const big = await (await admin(range("2027-12-01", "2028-11-29", "&pageSize=1"))).json() as Page;
  expect(big.items[0]!.days).toHaveLength(365);
  expect(big.items[0]!.days.some((d) => d.date === "2028-02-29")).toBe(true);
  for (const query of [range(day(0), day(365)), range(day(1), day(0)), "from=2026-02-30&to=2026-03-01", `from=${day(0)}`,
    range(day(0), day(1), "&page=0"), range(day(0), day(1), "&pageSize=0"), range(day(0), day(1), "&pageSize=101"),
    range(day(0), day(1), "&pageSize=1.5"), range(day(0), day(1), "&page=1000001"), range(day(0), day(1), "&extra=1"),
    range(day(0), day(1), "&page=1&page=2"), range(day(0), day(1), "&pageSize=abc")]) {
    const response = await admin(query);
    expect([400], query).toContain(response.status);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
});

test("authorization and company isolation hold for admins and superadmin", async () => {
  const query = range(day(0), day(1));
  expect((await admin(query, "")).status).toBe(403);
  expect((await admin(query, platformCookie)).status).toBe(403);
  expect((await admin(query, cookieB)).status).toBe(403); // B's admin on A's host
  const own = await (await admin(query, cookieB, hostB)).json() as Page;
  expect(own.items.map((i) => i.vehicleId)).toEqual([ids.foreign]);
  const viaPlatform = await (await platform(orgA, query)).json() as Page;
  expect(viaPlatform.items.map((i) => i.vehicleId)).toEqual([ids.active, ids.open, ids.draft, ids.archived]);
  expect(((await (await platform(orgB, query)).json()) as Page).items.map((i) => i.vehicleId)).toEqual([ids.foreign]);
  expect((await platform(orgA, query, cookieA)).status).toBe(403);
  expect((await platform(orgA, query, "")).status).toBe(403);
  expect((await platform(randomUUID(), query)).status).toBe(403);
  const bad = await platform("not-a-uuid", query);
  expect(bad.status).toBe(400);
  expect(await bad.json()).toEqual({ code: "INVALID_ID" });
  expect((await adminFleet(new Request(`http://${platformHost}/api/admin/availability/fleet?${query}`,
    { headers: { host: platformHost, cookie: platformCookie } }))).status).toBe(403);
});

test("expired service period keeps the grid readable; archiving the company closes it for its admin only", async () => {
  const query = range(day(0), day(1));
  // The trial grant is immutable: model an ended period as an expired paid period instead.
  await db.serviceAccess.delete({ where: { organizationId: orgA } });
  await db.serviceAccess.create({ data: { organizationId: orgA, paidThrough: sqlDate(day(-1)) } });
  expect((await admin(query)).status).toBe(200);
  await db.organization.update({ where: { id: orgA }, data: { archivedAt: new Date() } });
  try {
    expect((await admin(query)).status).toBe(403);
    expect((await platform(orgA, query)).status).toBe(200);
  } finally {
    await db.organization.update({ where: { id: orgA }, data: { archivedAt: null } });
  }
});
