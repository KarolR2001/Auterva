import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { preregisterCompany } from "../../src/modules/organizations/onboarding";
import { cancelCompanyInvitation, inspectCompanyInvitation, issueCompanyInvitation } from "../../src/modules/invitations/issue";
import { decryptMailPayload, enqueueMail } from "../../src/modules/jobs/outbox";
import { requestPasswordReset } from "../../src/modules/auth/account-operations";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { POST as postCompany } from "../../src/app/api/platform/companies/route";
import { POST as postInvitation } from "../../src/app/api/platform/companies/[organizationId]/invitations/route";
import { DELETE as deleteInvitation } from "../../src/app/api/platform/companies/[organizationId]/invitations/[invitationId]/route";
import { GET as getInvitation } from "../../src/app/api/auth/invitation/[token]/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const marker = randomUUID();
const platformHost = `platform-onboarding-${marker}.example.test`;
const slug = `onboarding-${marker.slice(0, 8)}`;
const adminEmail = `onboarding-${marker}@example.test`;
const mailKey = randomBytes(32);
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
  await db.job.deleteMany({ where: { organizationId: { in: ids } } });
  await db.invitation.deleteMany({ where: { organizationId: { in: ids } } });
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
    expect.objectContaining({ hostname: `${slug}.sites.example.test`, area: "COMPANY_ADMIN", kind: "PROVIDER", status: "ACTIVE" }),
    expect.objectContaining({ hostname: `${slug}.public.example.test`, area: "COMPANY_PUBLIC", kind: "PROVIDER", status: "ACTIVE" }),
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

test("audit failure rolls back company, pending user, hosts, period and receipt", async () => {
  const failedSlug = `audit-${marker.slice(0, 8)}`;
  const failedEmail = `audit-${marker}@example.test`;
  const beforeAudit = await db.auditLog.count({ where: { actorId, action: "COMPANY_CREATED" } });
  const failingAudit = db.$extends({ query: { auditLog: {
    async create() { throw new Error("injected company audit failure"); },
  } } });
  await expect(preregisterCompany(failingAudit as typeof db, { actorId, sessionId,
    name: "Failed audit company", slug: failedSlug, adminEmail: failedEmail,
    adminBaseDomain: "sites.example.test", publicBaseDomain: "public.example.test",
    trialGranted: true, paidThrough: null, idempotencyKey: randomUUID(),
    requestId: randomUUID() })).rejects.toThrow("injected company audit failure");
  expect(await db.organization.count({ where: { slug: failedSlug } })).toBe(0);
  expect(await db.user.count({ where: { email: failedEmail } })).toBe(0);
  expect(await db.hostMapping.count({ where: { hostname: { in: [
    `${failedSlug}.sites.example.test`, `${failedSlug}.public.example.test`] } } })).toBe(0);
  expect(await db.serviceAccess.count({ where: { organization: { slug: failedSlug } } })).toBe(0);
  expect(await db.operationReceipt.count({ where: { actorId, operation: "CREATE_COMPANY",
    organization: { slug: failedSlug } } })).toBe(0);
  expect(await db.auditLog.count({ where: { actorId, action: "COMPANY_CREATED" } })).toBe(beforeAudit);
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

test("invitation is issued without manual host activation; issue, retry, resend and GET preserve 168h and no activation", async () => {
  const organizationId = ids[0];
  const adminHostname = `${slug}.sites.example.test`;
  const now = new Date();
  const input = { actorId, sessionId, organizationId,
    adminBaseDomain: "sites.example.test", idempotencyKey: randomUUID(),
    requestId: randomUUID(), now, mailKey };
  // A still-pending host (e.g. legacy data) keeps refusing the invitation; nothing is issued.
  await db.hostMapping.update({ where: { hostname: adminHostname }, data: { status: "PENDING" } });
  await expect(issueCompanyInvitation(db, input)).rejects.toThrow("INVITATION_HOST_NOT_READY");
  expect(await db.invitation.count({ where: { organizationId } })).toBe(0);
  await db.hostMapping.update({ where: { hostname: adminHostname }, data: { status: "ACTIVE" } });
  expect(await requestPasswordReset(db, { email: adminEmail, idempotencyKey: randomUUID(),
    scope: { area: "COMPANY_ADMIN", organizationId }, hostname: adminHostname,
    now, mailKey })).toEqual({ accepted: true });
  expect(await db.verification.count({ where: { identifier: `password-reset:${adminEmail}` } })).toBe(0);
  expect(await db.job.count({ where: { organizationId } })).toBe(0);
  const legacyToken = randomBytes(32).toString("base64url");
  const legacy = await db.invitation.create({ data: { organizationId, recipientEmail: adminEmail,
    tokenHash: createHash("sha256").update(legacyToken).digest("hex"), issueKey: randomUUID(),
    issuedAt: now, expiresAt: new Date(now.getTime() + 168 * 60 * 60_000) } });
  await expect(db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId,
    recipient: adminEmail, referenceId: legacy.id, token: legacyToken, runAt: now }, mailKey)))
    .rejects.toThrow("Invitation does not match mail intent");
  expect(await inspectCompanyInvitation(db, { token: legacyToken, hostname: adminHostname, now })).toBeNull();
  await db.invitation.delete({ where: { id: legacy.id } });
  const first = await issueCompanyInvitation(db, input);
  expect(first).toMatchObject({ invitationId: expect.any(String), issuedHost: adminHostname,
    deliveryStatus: "PENDING" });
  const invitation = await db.invitation.findUniqueOrThrow({ where: { id: first.invitationId } });
  expect(invitation.issuedHost).toBe(adminHostname);
  expect(invitation.expiresAt.getTime() - invitation.issuedAt.getTime()).toBe(168 * 60 * 60_000);
  const job = await db.job.findFirstOrThrow({ where: { organizationId,
    dedupeKey: `MAIL_INVITATION:${invitation.id}` } });
  expect(JSON.stringify(job.payload)).not.toContain(adminEmail);
  const mail = decryptMailPayload(job.payload, mailKey);
  expect(mail.url).toMatch(new RegExp(`^https://${adminHostname}/admin/zaproszenie/`));
  const token = decodeURIComponent(mail.url.split("/").at(-1)!);
  const alternateHost = `aaa-${slug}.sites.example.test`;
  await db.hostMapping.create({ data: { organizationId, hostname: alternateHost,
    area: "COMPANY_ADMIN", status: "ACTIVE" } });
  expect((await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION",
    organizationId, recipient: adminEmail, referenceId: invitation.id,
    token, runAt: now }, mailKey))).id).toBe(job.id);
  expect(decryptMailPayload((await db.job.findUniqueOrThrow({ where: { id: job.id } })).payload, mailKey).url)
    .toBe(mail.url);
  expect(await inspectCompanyInvitation(db, { token, hostname: adminHostname, now }))
    .toMatchObject({ organizationId, recipientEmail: adminEmail, name: "Onboarding company" });
  expect(await inspectCompanyInvitation(db, { token, hostname: platformHost, now })).toBeNull();
  expect(await inspectCompanyInvitation(db, { token, hostname: adminHostname,
    now: invitation.expiresAt })).toBeNull();
  expect(await issueCompanyInvitation(db, { ...input, now: new Date(now.getTime() + 60_000),
    requestId: randomUUID() })).toEqual(first);
  expect(await db.invitation.count({ where: { organizationId } })).toBe(1);
  for (const failingDb of [
    db.$extends({ query: { auditLog: { async create() { throw new Error("injected invitation audit failure"); } } } }),
    db.$extends({ query: { job: { async createMany() { throw new Error("injected invitation queue failure"); } } } }),
  ]) {
    const beforeAudit = await db.auditLog.count({ where: { organizationId } });
    await expect(issueCompanyInvitation(failingDb as typeof db, { ...input,
      idempotencyKey: randomUUID(), requestId: randomUUID(),
      now: new Date(now.getTime() + 60_000) })).rejects.toThrow(/injected invitation/);
    expect(await db.invitation.count({ where: { organizationId } })).toBe(1);
    expect(await inspectCompanyInvitation(db, { token, hostname: adminHostname,
      now: new Date(now.getTime() + 60_000) })).toMatchObject({ organizationId });
    expect(await db.job.count({ where: { organizationId, kind: "MAIL_INVITATION" } })).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId } })).toBe(beforeAudit);
  }
  const resentAt = new Date(now.getTime() + 60_000);
  const second = await issueCompanyInvitation(db, { ...input, idempotencyKey: randomUUID(),
    requestId: randomUUID(), now: resentAt });
  expect(second.invitationId).not.toBe(first.invitationId);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: first.invitationId } })).revokedAt).toEqual(resentAt);
  expect(await inspectCompanyInvitation(db, { token, hostname: adminHostname, now: resentAt })).toBeNull();
  expect(await cancelCompanyInvitation(db, { actorId, sessionId, organizationId,
    invitationId: second.invitationId, requestId: randomUUID(), now: resentAt })).toBe(true);
  expect(await db.invitation.count({ where: { organizationId, revokedAt: null } })).toBe(0);
  expect(await db.organization.findUniqueOrThrow({ where: { id: organizationId } }))
    .toMatchObject({ firstAdminRegisteredAt: null });
  expect(await db.account.count({ where: { user: { organizationId } } })).toBe(0);
});

test("HTTP scopes preregistration and invitation to verified platform and bound company host", async () => {
  const previous = { admin: process.env.AUTERVA_ADMIN_BASE_DOMAIN,
    public: process.env.AUTERVA_PUBLIC_BASE_DOMAIN, mail: process.env.MAIL_PAYLOAD_KEY };
  process.env.AUTERVA_ADMIN_BASE_DOMAIN = "sites.example.test";
  process.env.AUTERVA_PUBLIC_BASE_DOMAIN = "public.example.test";
  process.env.MAIL_PAYLOAD_KEY = mailKey.toString("hex");
  const request = (path: string, body: object, host = platformHost, origin = `http://${platformHost}`) =>
    new Request(`http://127.0.0.1:3339${path}`, { method: "POST", headers: { host, origin,
      cookie: session.cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const slugHttp = `http-${marker.slice(0, 8)}`;
  const fixtureIp = `10.${parseInt(marker.slice(0, 2), 16)}.${parseInt(marker.slice(2, 4), 16)}.${parseInt(marker.slice(4, 6), 16)}`;
  const canonicalEmail = `http-${marker}@example.test`;
  const body = { name: "HTTP company", slug: slugHttp,
    adminEmail: `  HTTP-${marker}@EXAMPLE.TEST  `,
    trialGranted: true, paidThrough: null, idempotencyKey: randomUUID() };
  try {
    expect((await postCompany(request("/api/platform/companies", body, `${slug}.sites.example.test`,
      `http://${slug}.sites.example.test`))).status).toBe(404);
    expect((await postCompany(request("/api/platform/companies", body, platformHost,
      "http://sibling.example.test"))).status).toBe(403);
    expect((await postCompany(request("/api/platform/companies", { ...body, paidThrough: "2026-13-01" }))).status).toBe(422);
    for (const [index, email] of [`a..b-${marker}@example.test`, `a<b-${marker}@example.test`].entries()) {
      const badSlug = `invalid${index}-${marker.slice(0, 8)}`;
      const beforeAudit = await db.auditLog.count({ where: { actorId, action: "COMPANY_CREATED" } });
      const beforeReceipt = await db.operationReceipt.count({ where: { actorId, operation: "CREATE_COMPANY" } });
      const response = await postCompany(request("/api/platform/companies", { ...body,
        slug: badSlug, adminEmail: email, idempotencyKey: randomUUID() }));
      if (response.status === 200) ids.push((await response.json() as { organizationId: string }).organizationId);
      expect(response.status).toBe(400);
      expect(await db.organization.count({ where: { slug: badSlug } })).toBe(0);
      expect(await db.user.count({ where: { email } })).toBe(0);
      expect(await db.operationReceipt.count({ where: { actorId, operation: "CREATE_COMPANY" } })).toBe(beforeReceipt);
      expect(await db.auditLog.count({ where: { actorId, action: "COMPANY_CREATED" } })).toBe(beforeAudit);
    }
    const created = await postCompany(request("/api/platform/companies", body));
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(created.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    const company = await created.json() as { organizationId: string; adminHostname: string };
    ids.push(company.organizationId);
    expect((await db.user.findFirstOrThrow({ where: { organizationId: company.organizationId } })).email)
      .toBe(canonicalEmail);
    expect((await postCompany(request("/api/platform/companies", { ...body,
      slug: `dupe-${marker.slice(0, 8)}`, adminEmail: canonicalEmail,
      idempotencyKey: randomUUID() }))).status).toBe(409);
    expect((await postCompany(request("/api/platform/companies", body))).status).toBe(200);
    const invitePath = `/api/platform/companies/${company.organizationId}/invitations`;
    const params = { params: Promise.resolve({ organizationId: company.organizationId }) };
    const issue = (key = randomUUID()) => runWithTrustedClientAddress(fixtureIp,
      () => postInvitation(request(invitePath, { idempotencyKey: key }), params));
    await db.hostMapping.update({ where: { hostname: company.adminHostname }, data: { status: "PENDING" } });
    expect((await issue()).status).toBe(409);
    await db.hostMapping.update({ where: { hostname: company.adminHostname }, data: { status: "ACTIVE" } });
    const invited = await issue();
    expect(invited.status).toBe(201);
    const issued = await invited.json() as { invitationId: string };
    const stored = await db.job.findFirstOrThrow({ where: { organizationId: company.organizationId,
      dedupeKey: `MAIL_INVITATION:${issued.invitationId}` } });
    const token = decryptMailPayload(stored.payload, mailKey).url.split("/").at(-1)!;
    const get = (host: string) => getInvitation(new Request(`http://127.0.0.1:3339/api/auth/invitation/${token}`, {
      headers: { host } }), { params: Promise.resolve({ token }) });
    const wrongHost = await get(platformHost);
    expect(wrongHost.status).toBe(404);
    expect(wrongHost.headers.get("referrer-policy")).toBe("no-referrer");
    expect((await get(company.adminHostname)).status).toBe(200);
    expect((await get(company.adminHostname)).status).toBe(200);
    const cancelled = await deleteInvitation(new Request(`http://127.0.0.1:3339${invitePath}/${issued.invitationId}`, {
      method: "DELETE", headers: { host: platformHost, origin: `http://${platformHost}`, cookie: session.cookie },
    }), { params: Promise.resolve({ organizationId: company.organizationId, invitationId: issued.invitationId }) });
    expect(cancelled.status).toBe(200);
    expect((await get(company.adminHostname)).status).toBe(404);
    expect((await issue()).status).toBe(201);
    const limited = await issue();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^[1-9]\d*$/);
    expect(await db.invitation.count({ where: { organizationId: company.organizationId } })).toBe(2);
  } finally {
    for (const [key, value] of [["AUTERVA_ADMIN_BASE_DOMAIN", previous.admin],
      ["AUTERVA_PUBLIC_BASE_DOMAIN", previous.public], ["MAIL_PAYLOAD_KEY", previous.mail]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
