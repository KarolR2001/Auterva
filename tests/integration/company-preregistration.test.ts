import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { preregisterCompany } from "../../src/modules/organizations/onboarding";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const marker = randomUUID();
const platformHost = `platform-onboarding-${marker}.example.test`;
const slug = `onboarding-${marker.slice(0, 8)}`;
const adminEmail = `onboarding-${marker}@example.test`;
const ids: string[] = [];
let actorId: string;
let createdActor = false;
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let sessionId: string;

beforeAll(async () => {
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  actorId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, actorId);
  else {
    await db.user.create({ data: { id: actorId, name: "Onboarding operator",
      email: `operator-${marker}@example.test`, emailVerified: true,
      twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdActor = true;
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  session = await verifiedFixtureSession(db, actorId);
  const token = session.cookie.split("=")[1].split(".")[0];
  sessionId = (await db.session.findUniqueOrThrow({ where: { token } })).id;
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await db.operationReceipt.deleteMany({ where: { organizationId: { in: ids } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: ids } } });
  await db.user.deleteMany({ where: { organizationId: { in: ids } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  if (session) await session.dispose();
  await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
  if (createdActor) await db.user.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
});

test("preregistration reserves one global email without credentials, trial start or publication; retry is identical", async () => {
  const key = randomUUID();
  const input = { actorId, sessionId, name: "Onboarding company", slug,
    adminEmail, adminBaseDomain: "sites.example.test", publicBaseDomain: "public.example.test",
    trialGranted: true, paidThrough: null, idempotencyKey: key, requestId: randomUUID() };
  const created = await preregisterCompany(db, input);
  ids.push(created.organizationId);
  expect(created).toMatchObject({ organizationId: expect.any(String),
    adminHostname: `${slug}.sites.example.test`, invitationStatus: "NOT_ISSUED" });
  const repeated = await preregisterCompany(db, { ...input, requestId: randomUUID() });
  expect(repeated).toEqual(created);
  expect(await db.organization.count({ where: { slug } })).toBe(1);
  const organization = await db.organization.findUniqueOrThrow({ where: { id: created.organizationId },
    include: { users: true, serviceAccess: true, hosts: true } });
  expect(organization.firstAdminRegisteredAt).toBeNull();
  expect(organization.users).toHaveLength(1);
  expect(organization.users[0]).toMatchObject({ email: adminEmail, role: "ADMIN_FIRMY",
    emailVerified: false, twoFactorEnabled: false });
  expect(await db.account.count({ where: { userId: organization.users[0].id } })).toBe(0);
  expect(organization.serviceAccess).toMatchObject({ trialGranted: true,
    trialStartedAt: null, trialEndsAt: null, paidThrough: null });
  expect(organization.hosts).toEqual(expect.arrayContaining([
    expect.objectContaining({ hostname: `${slug}.sites.example.test`, area: "COMPANY_ADMIN", status: "PENDING" }),
    expect.objectContaining({ hostname: `${slug}.public.example.test`, area: "COMPANY_PUBLIC", status: "PENDING" }),
  ]));
  expect(await db.invitation.count({ where: { organizationId: created.organizationId } })).toBe(0);
  expect(await db.auditLog.count({ where: { organizationId: created.organizationId, action: "COMPANY_CREATED" } })).toBe(1);
});

test("concurrent retry has one company and mismatched input cannot reuse its receipt", async () => {
  const nextSlug = `retry-${marker.slice(0, 8)}`;
  const key = randomUUID();
  const input = { actorId, sessionId, name: "Retry company", slug: nextSlug,
    adminEmail: `retry-${marker}@example.test`, adminBaseDomain: "sites.example.test",
    publicBaseDomain: "public.example.test", trialGranted: false, paidThrough: null,
    idempotencyKey: key, requestId: randomUUID() };
  const results = await Promise.all([
    preregisterCompany(db, input),
    preregisterCompany(db, { ...input, requestId: randomUUID() }),
  ]);
  ids.push(results[0].organizationId);
  expect(results[0]).toEqual(results[1]);
  expect(await db.organization.count({ where: { slug: nextSlug } })).toBe(1);
  expect(await db.auditLog.count({ where: { organizationId: results[0].organizationId,
    action: "COMPANY_CREATED" } })).toBe(1);
  await expect(preregisterCompany(db, { ...input, name: "Changed company",
    requestId: randomUUID() })).rejects.toThrow("COMPANY_IDEMPOTENCY_CONFLICT");
  expect(await db.organization.count({ where: { slug: nextSlug } })).toBe(1);
});

test("global email and occupied host refuse creation without changing their owner", async () => {
  const emailSlug = `email-${marker.slice(0, 8)}`;
  const base = { actorId, sessionId, name: "Conflicting company", slug: emailSlug,
    adminEmail, adminBaseDomain: "sites.example.test", publicBaseDomain: "public.example.test",
    trialGranted: false, paidThrough: null, idempotencyKey: randomUUID(), requestId: randomUUID() };
  await expect(preregisterCompany(db, base)).rejects.toThrow("COMPANY_CONFLICT");
  expect(await db.organization.count({ where: { slug: emailSlug } })).toBe(0);
  const hostSlug = `host-${marker.slice(0, 8)}`;
  const occupiedHost = `${hostSlug}.sites.example.test`;
  await db.hostMapping.create({ data: { hostname: occupiedHost, area: "PLATFORM", status: "ACTIVE" } });
  try {
    await expect(preregisterCompany(db, { ...base, slug: hostSlug,
      adminEmail: `host-${marker}@example.test`, idempotencyKey: randomUUID() }))
      .rejects.toThrow("COMPANY_CONFLICT");
    expect(await db.organization.count({ where: { slug: hostSlug } })).toBe(0);
    expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname: occupiedHost } }))
      .toMatchObject({ area: "PLATFORM", organizationId: null });
  } finally {
    await db.hostMapping.delete({ where: { hostname: occupiedHost } });
  }
});
