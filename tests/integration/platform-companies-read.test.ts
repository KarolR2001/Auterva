import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import { sqlDate } from "../../src/modules/availability/dates";
import { resolveServicePeriod } from "../../src/modules/service-period/state";
import { getPlatformCompany, listPlatformCompanies } from "../../src/modules/organizations/read";
import { GET as listHandler } from "../../src/app/api/platform/companies/route";
import { GET as detailHandler } from "../../src/app/api/platform/companies/[organizationId]/route";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const ids = Array.from({ length: 6 }, () => randomUUID());
const adminIds = Array.from({ length: 6 }, () => randomUUID());
const platformHost = `platform-read-${randomUUID()}.example.test`;
const adminHost = `admin-read-${randomUUID()}.example.test`;
const publicHosts = ids.map((id) => `public-read-${id}.example.test`);
const now = new Date("2026-10-26T12:00:00.000Z");
const registeredAt = new Date("2026-10-20T10:00:00.000Z");
const trialEndsAt = new Date(registeredAt.getTime() + 336 * 60 * 60_000);
const baseline = { paid: 0, trial: 0 };
let platformSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let restrictedSessionId = "";
let restrictedCookie = "";

beforeAll(async () => {
  const existing = await db.organization.findMany({ select: { firstAdminRegisteredAt: true, archivedAt: true,
    publicUnlockRequired: true, publicRequiresPaid: true,
    serviceAccess: { select: { paidThrough: true, trialGranted: true, trialStartedAt: true, trialEndsAt: true } } } });
  for (const company of existing) {
    const kpi = resolveServicePeriod({ paidThrough: company.serviceAccess?.paidThrough?.toISOString().slice(0, 10) ?? null,
      trialGranted: company.serviceAccess?.trialGranted ?? false,
      trialStartedAt: company.serviceAccess?.trialStartedAt ?? null,
      trialEndsAt: company.serviceAccess?.trialEndsAt ?? null, registeredAt: company.firstAdminRegisteredAt,
      archivedAt: company.archivedAt, publicUnlockRequired: company.publicUnlockRequired,
      publicRequiresPaid: company.publicRequiresPaid, domainReady: false }, now).kpi;
    if (kpi === "PAID") baseline.paid++;
    if (kpi === "TRIAL") baseline.trial++;
  }
  await db.organization.createMany({ data: ids.map((id, index) => ({ id,
    slug: `platform-read-${id}`, name: ["KPI A Paid", "KPI B Trial", "KPI C Both",
      "KPI D Expired", "KPI E Archived", "KPI F Preregistered"][index],
    firstAdminRegisteredAt: index === 5 ? null : registeredAt,
    archivedAt: index === 4 ? new Date("2026-10-24T12:00:00.000Z") : null,
  })) });
  await db.user.createMany({ data: ids.map((organizationId, index) => ({ id: adminIds[index],
    name: `Read admin ${index}`, email: `read-${adminIds[index]}@example.test`, role: "ADMIN_FIRMY",
    organizationId, emailVerified: index !== 5, twoFactorEnabled: index !== 5 })) });
  await db.serviceAccess.createMany({ data: ids.map((organizationId, index) => ({ organizationId,
    paidThrough: [0, 2, 4, 5].includes(index) ? sqlDate(index === 4 ? "2026-11-30" : "2026-10-26")
      : index === 3 ? sqlDate("2026-10-25") : null,
    trialGranted: index === 1 || index === 2,
    trialStartedAt: index === 1 || index === 2 ? registeredAt : null,
    trialEndsAt: index === 1 || index === 2 ? trialEndsAt : null,
  })) });
  await db.hostMapping.createMany({ data: [
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
    { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: FIXTURE.organizations[0], status: "ACTIVE" },
    ...ids.map((organizationId, index) => ({ hostname: publicHosts[index], organizationId,
      area: "COMPANY_PUBLIC", status: index === 5 ? "PENDING" : "ACTIVE" })),
  ] });
  await db.conversation.create({ data: { organizationId: ids[0] } });
  await db.invitation.create({ data: { organizationId: ids[5], recipientEmail: `read-${adminIds[5]}@example.test`,
    issuedHost: `pending-${ids[5]}.example.test`, tokenHash: randomUUID(), issueKey: randomUUID(),
    issuedAt: now, expiresAt: new Date(now.getTime() + 7 * 86_400_000) } });
  platformSession = await verifiedFixtureSession(db, FIXTURE.users[2]);
  adminSession = await verifiedFixtureSession(db, FIXTURE.users[0]);
  const token = randomBytes(32).toString("base64url");
  restrictedSessionId = randomUUID();
  await db.session.create({ data: { id: restrictedSessionId, userId: FIXTURE.users[2], token,
    expiresAt: new Date(Date.now() + 60 * 60_000), mfaVerifiedAt: null } });
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Fixture auth secret is required");
  restrictedCookie = `better-auth.session_token=${token}.${createHmac("sha256", secret).update(token).digest("base64")}`;
});

afterAll(async () => {
  if (restrictedSessionId) await db.session.deleteMany({ where: { id: restrictedSessionId } });
  if (platformSession) await platformSession.dispose();
  if (adminSession) await adminSession.dispose();
  await db.invitation.deleteMany({ where: { organizationId: { in: ids } } });
  await db.conversation.deleteMany({ where: { organizationId: { in: ids } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [platformHost, adminHost, ...publicHosts] } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: ids } } });
  await db.user.deleteMany({ where: { id: { in: adminIds } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test("list keeps expired and preregistered companies, counts before paging, and excludes archive by default", async () => {
  const first = await listPlatformCompanies(db, { search: "KPI", includeArchived: false,
    page: 1, pageSize: 2 }, now);
  const second = await listPlatformCompanies(db, { search: "KPI", includeArchived: false,
    page: 2, pageSize: 2 }, now);
  const third = await listPlatformCompanies(db, { search: "KPI", includeArchived: false,
    page: 3, pageSize: 2 }, now);
  expect([first.total, second.total, third.total]).toEqual([5, 5, 5]);
  expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.organizationId)))
    .toEqual(new Set([ids[0], ids[1], ids[2], ids[3], ids[5]]));
  expect(first.kpis).toEqual({ paidCompanies: baseline.paid + 3, trialCompanies: baseline.trial + 1 });
  expect(second.kpis).toEqual(first.kpis);
  const withArchive = await listPlatformCompanies(db, { search: "KPI", includeArchived: true,
    page: 1, pageSize: 20 }, now);
  expect(withArchive.total).toBe(6);
  expect(withArchive.items.some((item) => item.organizationId === ids[4])).toBe(true);
  expect(withArchive.kpis).toEqual(first.kpis);
  expect((await db.organization.findUniqueOrThrow({ where: { id: ids[4] } })).archivedAt).not.toBeNull();
  const adminSearch = await listPlatformCompanies(db, { search: `read-${adminIds[5]}`,
    includeArchived: false, page: 1, pageSize: 20 }, now);
  expect(adminSearch.items.map((item) => item.organizationId)).toEqual([ids[5]]);
});

test("card separates period, registration, public host, invitation and optional conversation", async () => {
  const both = await getPlatformCompany(db, ids[2], now);
  expect(both).toMatchObject({ organizationId: ids[2], archivedAt: null,
    registration: { status: "REGISTERED" },
    period: { headline: "PAID", kpi: "PAID", effectiveSource: "TRIAL", periodVersion: 0 },
    publication: { visible: true, domainReady: true }, organizationVersion: 0,
    conversationId: null });
  const pending = await getPlatformCompany(db, ids[5], now);
  expect(pending).toMatchObject({ organizationId: ids[5], registration: { status: "PENDING" },
    period: { headline: "PAID", kpi: "PAID" }, publication: { visible: false, domainReady: false },
    conversationId: null, invitation: { deliveryStatus: "PENDING" } });
  expect(JSON.stringify(pending)).not.toContain("tokenHash");
  expect((await getPlatformCompany(db, ids[0], now))?.conversationId).toEqual(expect.any(String));
  expect(await db.conversation.count({ where: { organizationId: ids[2] } })).toBe(0);
});

test("paid inclusive Warsaw date and trial instant remain separate at the boundary", async () => {
  const beforePaidEnd = await getPlatformCompany(db, ids[3], new Date("2026-10-25T22:59:59.000Z"));
  const atPaidEnd = await getPlatformCompany(db, ids[3], new Date("2026-10-25T23:00:00.000Z"));
  expect(beforePaidEnd?.period.kpi).toBe("PAID");
  expect(atPaidEnd?.period.kpi).toBe("NONE");
  const atTrialEnd = await getPlatformCompany(db, ids[1], trialEndsAt);
  expect(atTrialEnd?.period.kpi).toBe("NONE");
});

test("HTTP reads require mapped platform and full MFA, return no-store and never create a conversation", async () => {
  const url = (path: string) => `http://127.0.0.1:3381${path}`;
  const call = (path: string, host: string, cookie: string) => new Request(url(path),
    { headers: { host, cookie } });
  const listPath = "/api/platform/companies?search=KPI&page=1&pageSize=2";
  const allowed = await listHandler(call(listPath, platformHost, platformSession.cookie));
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get("cache-control")).toBe("no-store");
  expect(allowed.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(await allowed.json()).toMatchObject({ total: 5,
    kpis: { paidCompanies: expect.any(Number), trialCompanies: expect.any(Number) } });
  expect((await listHandler(call(listPath, platformHost, adminSession.cookie))).status).toBe(403);
  expect((await listHandler(call(listPath, platformHost, restrictedCookie))).status).toBe(403);
  expect((await listHandler(call(listPath, adminHost, adminSession.cookie))).status).toBe(404);
  expect((await listHandler(call(listPath, publicHosts[0], platformSession.cookie))).status).toBe(404);
  expect((await listHandler(call("/api/platform/companies?page=0", platformHost,
    platformSession.cookie))).status).toBe(400);
  const detailPath = `/api/platform/companies/${ids[2]}`;
  expect((await detailHandler(call(detailPath, platformHost, platformSession.cookie),
    { params: Promise.resolve({ organizationId: ids[2] }) })).status).toBe(200);
  expect((await detailHandler(call("/api/platform/companies/invalid", platformHost, platformSession.cookie),
    { params: Promise.resolve({ organizationId: "invalid" }) })).status).toBe(400);
  expect((await detailHandler(call(detailPath, platformHost, adminSession.cookie),
    { params: Promise.resolve({ organizationId: ids[2] }) })).status).toBe(403);
  expect(await db.conversation.count({ where: { organizationId: ids[2] } })).toBe(0);
});
