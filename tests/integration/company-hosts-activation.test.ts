import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { preregisterCompany } from "../../src/modules/organizations/onboarding";
import { issueCompanyInvitation } from "../../src/modules/invitations/issue";
import { activateCompanyInvitation } from "../../src/modules/invitations/activate";
import { decryptMailPayload } from "../../src/modules/jobs/outbox";
import { registerDomain } from "../../src/modules/domains/lifecycle";
import { getPublicSiteState } from "../../src/modules/public-offer/read";
import { resolveHostMapping } from "../../src/modules/tenancy/host-registry";

// D-26 (#152): preregistration activates both Auterva-domain hosts; the period gate still decides publication.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const marker = randomUUID();
const short = marker.slice(0, 8);
const adminBase = "sites.example.test";
const publicBase = "public.example.test";
const platformHost = `platform-d26-${marker}.example.test`;
const mailKey = randomBytes(32);
const ids: string[] = [];
const extraHosts: string[] = [];
let actorId: string;
let createdActor = false;
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let sessionId: string;

const create = (slug: string, overrides: Partial<Parameters<typeof preregisterCompany>[1]> = {}) =>
  preregisterCompany(db, { actorId, sessionId, name: `D26 ${slug}`, slug,
    adminEmail: `${slug}-${marker}@example.test`, adminBaseDomain: adminBase, publicBaseDomain: publicBase,
    trialGranted: true, paidThrough: null, idempotencyKey: randomUUID(), requestId: randomUUID(), ...overrides });

async function invitationFor(organizationId: string, adminHostname: string, now: Date) {
  const issued = await issueCompanyInvitation(db, { actorId, sessionId, organizationId,
    adminBaseDomain: adminBase, idempotencyKey: randomUUID(), requestId: randomUUID(), now, mailKey });
  const job = await db.job.findFirstOrThrow({ where: { organizationId,
    dedupeKey: `MAIL_INVITATION:${issued.invitationId}` } });
  const mail = decryptMailPayload(job.payload, mailKey);
  expect(mail.url).toMatch(new RegExp(`^https://${adminHostname}/admin/zaproszenie/`));
  return decodeURIComponent(mail.url.split("/").at(-1)!);
}

beforeAll(async () => {
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  actorId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, actorId);
  else {
    await db.user.create({ data: { id: actorId, name: "D26 operator", email: `operator-d26-${marker}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdActor = true;
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  session = await verifiedFixtureSession(db, actorId);
  const token = session.cookie.split("=")[1].split(".")[0];
  sessionId = (await db.session.findUniqueOrThrow({ where: { token } })).id;
});

afterAll(async () => {
  const scope = { organizationId: { in: ids } };
  await db.job.deleteMany({ where: scope });
  await db.invitation.deleteMany({ where: scope });
  await db.auditLog.deleteMany({ where: scope });
  await db.operationReceipt.deleteMany({ where: scope });
  await db.reminderIntent.deleteMany({ where: scope });
  await db.reminderPlan.deleteMany({ where: scope });
  await db.customDomain.deleteMany({ where: scope });
  await db.serviceAccess.deleteMany({ where: scope });
  await db.account.deleteMany({ where: { user: scope } });
  await db.user.deleteMany({ where: scope });
  await db.hostMapping.deleteMany({ where: scope });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [platformHost, ...extraHosts] } } });
  if (session) await session.dispose();
  if (createdActor) await db.user.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
});

test("preregistration creates two ACTIVE PROVIDER hosts, invites without manual activation, and the period gate decides publication", async () => {
  const now = new Date();
  const withTrial = await create(`trial-${short}`);
  const noPeriod = await create(`none-${short}`, { trialGranted: false });
  ids.push(withTrial.organizationId, noPeriod.organizationId);
  for (const company of [withTrial, noPeriod]) {
    expect(await db.hostMapping.findMany({ where: { organizationId: company.organizationId },
      select: { hostname: true, area: true, kind: true, status: true }, orderBy: { area: "asc" } }))
      .toEqual([
        { hostname: company.adminHostname, area: "COMPANY_ADMIN", kind: "PROVIDER", status: "ACTIVE" },
        { hostname: company.publicHostname, area: "COMPANY_PUBLIC", kind: "PROVIDER", status: "ACTIVE" }]);
    expect(await resolveHostMapping(db, company.adminHostname)).toMatchObject({ area: "COMPANY_ADMIN",
      organizationId: company.organizationId });
    // The active alias alone never publishes: before the first registration there is no valid period.
    expect(await getPublicSiteState(db, company.publicHostname, now)).toEqual({ state: "UNAVAILABLE" });
    expect(await db.auditLog.count({ where: { organizationId: company.organizationId, action: "COMPANY_CREATED" } })).toBe(1);
  }
  const trialToken = await invitationFor(withTrial.organizationId, withTrial.adminHostname, now);
  const noneToken = await invitationFor(noPeriod.organizationId, noPeriod.adminHostname, now);
  const password = "Hosts activation 4417!";
  expect(await activateCompanyInvitation(db, { token: trialToken, hostname: withTrial.adminHostname, password,
    requestId: randomUUID(), clock: () => now })).toMatchObject({ siteState: "READY" });
  expect(await getPublicSiteState(db, withTrial.publicHostname, now)).toMatchObject({ state: "ACTIVE" });
  expect(await activateCompanyInvitation(db, { token: noneToken, hostname: noPeriod.adminHostname, password,
    requestId: randomUUID(), clock: () => now })).toMatchObject({ siteState: "PERIOD_EXPIRED" });
  expect(await getPublicSiteState(db, noPeriod.publicHostname, now)).toEqual({ state: "UNAVAILABLE" });
  // Trial over: the still-active alias stops publishing.
  expect(await getPublicSiteState(db, withTrial.publicHostname, new Date(now.getTime() + 337 * 60 * 60_000)))
    .toEqual({ state: "UNAVAILABLE" });
});

test("occupied host or slug refuses creation with COMPANY_CONFLICT and keeps the owner", async () => {
  const hostSlug = `occ-${short}`;
  const publicOccupied = `${hostSlug}.${publicBase}`;
  const other = await create(`own-${short}`);
  ids.push(other.organizationId);
  await db.hostMapping.update({ where: { hostname: other.publicHostname }, data: { hostname: publicOccupied } });
  await expect(create(hostSlug)).rejects.toThrow("COMPANY_CONFLICT");
  expect(await db.organization.count({ where: { slug: hostSlug } })).toBe(0);
  expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname: publicOccupied } }))
    .toMatchObject({ organizationId: other.organizationId, status: "ACTIVE" });
  expect(await db.hostMapping.count({ where: { hostname: `${hostSlug}.${adminBase}` } })).toBe(0);
  await expect(create(`own-${short}`)).rejects.toThrow("COMPANY_CONFLICT");
  expect(await db.organization.count({ where: { slug: `own-${short}` } })).toBe(1);
});

test("parallel preregistration of one slug yields a single company with two active hosts", async () => {
  const slug = `race-${short}`;
  const results = await Promise.allSettled([create(slug), create(slug), create(slug)]);
  for (const result of results) if (result.status === "fulfilled") ids.push(result.value.organizationId);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  for (const result of results) if (result.status === "rejected") expect(String(result.reason)).toContain("COMPANY_CONFLICT");
  const organization = await db.organization.findUniqueOrThrow({ where: { slug }, include: { hosts: true } });
  expect(organization.hosts.map((h) => h.status)).toEqual(["ACTIVE", "ACTIVE"]);
});

test("custom domain is untouched: it stays PENDING and unrouted until explicit verification and activation", async () => {
  const company = await create(`cust-${short}`);
  ids.push(company.organizationId);
  const customHost = `www.cust-${short}.klient.example.test`;
  extraHosts.push(customHost);
  const view = await registerDomain(db, { actorId, sessionId, organizationId: company.organizationId,
    eventKey: randomUUID(), requestId: randomUUID(), hostname: customHost, expectedVersion: null,
    config: { cnameTarget: "edge.example.test", reservedBases: [adminBase, publicBase] } });
  expect(view.domain).toMatchObject({ hostname: customHost, status: "PENDING_OWNERSHIP" });
  expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname: customHost } }))
    .toMatchObject({ kind: "CUSTOM", status: "PENDING", canonicalTarget: null });
  expect(await resolveHostMapping(db, customHost)).toBeNull();
  expect(await db.hostMapping.findUniqueOrThrow({ where: { hostname: company.publicHostname } }))
    .toMatchObject({ kind: "PROVIDER", status: "ACTIVE", canonicalTarget: null });
});
