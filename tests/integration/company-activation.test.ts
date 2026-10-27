import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { activateCompanyInvitation } from "../../src/modules/invitations/activate";
import { inspectCompanyInvitation } from "../../src/modules/invitations/issue";
import { resolvePublicVisibility } from "../../src/modules/service-period/public";
import { POST as activatePost } from "../../src/app/api/auth/invitation/[token]/route";
import { GET as authGet, POST as authPost } from "../../src/app/api/auth/[...all]/route";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { recoverMfaByOperator } from "../../scripts/recover-mfa";
import { FIXTURE } from "../../scripts/fixture-ids";
import { seedLocalFixture } from "../../scripts/seed-local-fixture";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { cancelCompanyInvitation, issueCompanyInvitation } from "../../src/modules/invitations/issue";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizations: string[] = [];
const password = "New company password 8842!";

function barrier() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

async function pendingCompany(options: { now: Date; trialGranted?: boolean; publicReady?: boolean }) {
  const organizationId = randomUUID();
  const userId = randomUUID();
  const label = organizationId.slice(0, 8);
  const hostname = `activate-${label}.sites.example.test`;
  const publicHostname = `activate-${label}.public.example.test`;
  const email = `activate-${organizationId}@example.test`;
  const token = randomBytes(32).toString("base64url");
  organizations.push(organizationId);
  await db.organization.create({ data: { id: organizationId, slug: `activate-${label}`, name: "Pending activation" } });
  await db.user.create({ data: { id: userId, email, name: "Pending admin", role: "ADMIN_FIRMY",
    organizationId, emailVerified: false, twoFactorEnabled: false } });
  await db.hostMapping.createMany({ data: [
    { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: publicHostname, area: "COMPANY_PUBLIC", organizationId,
      status: options.publicReady ? "ACTIVE" : "PENDING" },
  ] });
  await db.serviceAccess.create({ data: { organizationId, trialGranted: options.trialGranted ?? true } });
  const invitation = await db.invitation.create({ data: { organizationId, recipientEmail: email,
    issuedHost: hostname, tokenHash: createHash("sha256").update(token).digest("hex"),
    issueKey: randomUUID(), issuedAt: options.now,
    expiresAt: new Date(options.now.getTime() + 168 * 60 * 60_000) } });
  return { organizationId, userId, email, hostname, publicHostname, token, invitationId: invitation.id };
}

afterAll(async () => {
  await db.job.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.invitation.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.session.deleteMany({ where: { user: { organizationId: { in: organizations } } } });
  await db.account.deleteMany({ where: { user: { organizationId: { in: organizations } } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.user.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});

test.each([
  ["spring DST", "2026-03-28T23:30:00.000Z"],
  ["autumn DST", "2026-10-24T23:30:00.000Z"],
])("%s: one activation starts exactly 336 UTC hours and retry preserves credentials", async (_label, instant) => {
  const now = new Date(instant);
  const fixture = await pendingCompany({ now: new Date(now.getTime() - 60_000), publicReady: true });
  const input = { token: fixture.token, hostname: fixture.hostname, password,
    requestId: randomUUID(), clock: () => now };
  expect(await inspectCompanyInvitation(db, { token: fixture.token, hostname: fixture.hostname, now }))
    .toMatchObject({ organizationId: fixture.organizationId });
  const [first, repeated] = await Promise.all([
    activateCompanyInvitation(db, input),
    activateCompanyInvitation(db, { ...input, password: "Different password 9292!", requestId: randomUUID() }),
  ]);
  expect(first).toMatchObject({ organizationId: fixture.organizationId, registeredAt: now.toISOString(),
    siteState: "READY", signInRequired: true });
  expect(repeated).toEqual(first);
  const organization = await db.organization.findUniqueOrThrow({ where: { id: fixture.organizationId } });
  const access = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: fixture.organizationId } });
  const account = await db.account.findFirstOrThrow({ where: { userId: fixture.userId, providerId: "credential" } });
  expect(organization.firstAdminRegisteredAt).toEqual(now);
  expect(access.trialStartedAt).toEqual(now);
  expect((access.trialEndsAt?.getTime() ?? NaN) - now.getTime()).toBe(336 * 60 * 60_000);
  expect(access.periodVersion).toBe(1);
  expect(account.password).not.toBe(password);
  expect((await verifyPassword({ hash: account.password!, password }))
    || (await verifyPassword({ hash: account.password!, password: "Different password 9292!" }))).toBe(true);
  expect(await activateCompanyInvitation(db, { ...input, password: "Third password 9922!",
    requestId: randomUUID() })).toEqual(first);
  expect((await db.account.findUniqueOrThrow({ where: { id: account.id } })).password).toBe(account.password);
  expect(await db.account.count({ where: { userId: fixture.userId } })).toBe(1);
  expect(await db.auditLog.count({ where: { organizationId: fixture.organizationId,
    action: "INVITATION_ACCEPTED" } })).toBe(1);
  expect(await db.session.count({ where: { userId: fixture.userId } })).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: fixture.userId } })).twoFactorEnabled).toBe(false);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: fixture.invitationId } })).usedAt).toEqual(now);
  expect(await resolvePublicVisibility(db, fixture.publicHostname, now)).toMatchObject({ organizationId: fixture.organizationId });
});

test("audit failure rolls back credential, verified email, invitation and trial", async () => {
  const now = new Date("2026-10-26T10:00:00.000Z");
  const fixture = await pendingCompany({ now: new Date(now.getTime() - 60_000) });
  const failingDb = db.$extends({ query: { auditLog: { async create() {
    throw new Error("injected activation audit failure");
  } } } });
  const input = { token: fixture.token, hostname: fixture.hostname, password,
    requestId: randomUUID(), clock: () => now };
  await expect(activateCompanyInvitation(failingDb as typeof db, input))
    .rejects.toThrow("injected activation audit failure");
  expect(await db.account.count({ where: { userId: fixture.userId } })).toBe(0);
  expect((await db.user.findUniqueOrThrow({ where: { id: fixture.userId } })).emailVerified).toBe(false);
  expect((await db.invitation.findUniqueOrThrow({ where: { id: fixture.invitationId } })).usedAt).toBeNull();
  expect((await db.organization.findUniqueOrThrow({ where: { id: fixture.organizationId } })).firstAdminRegisteredAt).toBeNull();
  expect(await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: fixture.organizationId } }))
    .toMatchObject({ trialStartedAt: null, trialEndsAt: null, periodVersion: 0 });
  expect(await activateCompanyInvitation(db, input)).toMatchObject({ registeredAt: now.toISOString() });
});

test("without awarded trial, registration keeps period expired and does not create a trial", async () => {
  const now = new Date("2026-10-26T10:00:00.000Z");
  const fixture = await pendingCompany({ now: new Date(now.getTime() - 60_000),
    trialGranted: false, publicReady: true });
  expect(await activateCompanyInvitation(db, { token: fixture.token, hostname: fixture.hostname,
    password, requestId: randomUUID(), clock: () => now })).toMatchObject({
    siteState: "PERIOD_EXPIRED", registeredAt: now.toISOString(),
  });
  expect(await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: fixture.organizationId } }))
    .toMatchObject({ trialStartedAt: null, trialEndsAt: null, periodVersion: 1 });
  expect((await db.auditLog.findFirstOrThrow({ where: { organizationId: fixture.organizationId,
    action: "INVITATION_ACCEPTED" } })).safeChanges).toEqual({
      changedFields: ["periodVersion"], after: { periodVersion: 1 },
    });
  expect(await resolvePublicVisibility(db, fixture.publicHostname, now)).toBeNull();
});

test("wrong host, boundary 168h, revoked link and pending public domain leave account unchanged", async () => {
  const issuedAt = new Date("2026-10-24T10:00:00.000Z");
  const fixture = await pendingCompany({ now: issuedAt, publicReady: false });
  const attempt = (hostname: string, now: Date) => activateCompanyInvitation(db, {
    token: fixture.token, hostname, password, requestId: randomUUID(), clock: () => now,
  });
  expect(await attempt("other.sites.example.test", issuedAt)).toBeNull();
  expect(await attempt(fixture.hostname, new Date(issuedAt.getTime() + 168 * 60 * 60_000))).toBeNull();
  expect(await db.account.count({ where: { userId: fixture.userId } })).toBe(0);
  const beforeExpiry = new Date(issuedAt.getTime() + 168 * 60 * 60_000 - 1);
  expect(await attempt(fixture.hostname, beforeExpiry)).toMatchObject({ siteState: "DOMAIN_PENDING" });
  expect(await resolvePublicVisibility(db, fixture.publicHostname, beforeExpiry)).toBeNull();
  const other = await pendingCompany({ now: issuedAt });
  await db.invitation.update({ where: { id: other.invitationId }, data: { revokedAt: issuedAt } });
  expect(await activateCompanyInvitation(db, { token: other.token, hostname: other.hostname,
    password, requestId: randomUUID(), clock: () => issuedAt })).toBeNull();
  expect(await db.account.count({ where: { userId: other.userId } })).toBe(0);
  const changed = await pendingCompany({ now: issuedAt });
  const alias = `alias-${changed.hostname}`;
  await db.hostMapping.update({ where: { hostname: changed.hostname }, data: { status: "PENDING" } });
  await db.hostMapping.create({ data: { organizationId: changed.organizationId,
    hostname: alias, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  expect(await activateCompanyInvitation(db, { token: changed.token, hostname: changed.hostname,
    password, requestId: randomUUID(), clock: () => issuedAt })).toBeNull();
  expect(await activateCompanyInvitation(db, { token: changed.token, hostname: alias,
    password, requestId: randomUUID(), clock: () => issuedAt })).toBeNull();
  await db.invitation.update({ where: { id: changed.invitationId }, data: { issuedHost: null } });
  expect(await activateCompanyInvitation(db, { token: changed.token, hostname: changed.hostname,
    password, requestId: randomUUID(), clock: () => issuedAt })).toBeNull();
  expect(await db.account.count({ where: { userId: changed.userId } })).toBe(0);
});

test("HTTP activation enforces bound company host and Origin before writing, and returns no session", async () => {
  const now = new Date();
  const fixture = await pendingCompany({ now: new Date(now.getTime() - 60_000), publicReady: true });
  const params = { params: Promise.resolve({ token: fixture.token }) };
  const send = (host: string, origin: string) => runWithTrustedClientAddress("127.0.0.2", () =>
    activatePost(new Request(`http://127.0.0.1:3480/api/auth/invitation/${fixture.token}`, {
      method: "POST", headers: { host, origin, "content-type": "application/json",
        "x-request-id": "attacker-chosen" }, body: JSON.stringify({ password }),
    }), params));
  expect((await send("other.sites.example.test", "http://other.sites.example.test")).status).toBe(404);
  expect((await send(fixture.hostname, "http://sibling.example.test")).status).toBe(403);
  expect(await db.account.count({ where: { userId: fixture.userId } })).toBe(0);
  const secret = process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_SECRET;
  try {
    const failed = await send(fixture.hostname, `http://${fixture.hostname}`);
    expect(failed.status).toBe(500);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    expect(failed.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await failed.json()).toEqual({ code: "INTERNAL_ERROR" });
    expect(await db.account.count({ where: { userId: fixture.userId } })).toBe(0);
  } finally {
    if (secret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = secret;
  }
  const accepted = await send(fixture.hostname, `http://${fixture.hostname}`);
  expect(accepted.status).toBe(200);
  expect(accepted.headers.get("cache-control")).toBe("no-store");
  expect(accepted.headers.get("referrer-policy")).toBe("no-referrer");
  expect(accepted.headers.get("set-cookie")).toBeNull();
  expect(accepted.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  expect(accepted.headers.get("x-request-id")).not.toBe("attacker-chosen");
  expect(await accepted.json()).toMatchObject({ organizationId: fixture.organizationId,
    siteState: "READY", signInRequired: true });
  expect((await send(fixture.hostname, `http://${fixture.hostname}`)).status).toBe(200);
  expect(await db.auditLog.count({ where: { organizationId: fixture.organizationId,
    action: "INVITATION_ACCEPTED" } })).toBe(1);
  const authRequest = (path: string, body?: object, cookie?: string) => new Request(
    `http://${fixture.hostname}/api/auth/${path}`, { method: body ? "POST" : "GET",
      headers: { host: fixture.hostname, origin: `http://${fixture.hostname}`,
        ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined });
  const login = await runWithTrustedClientAddress("127.0.0.2", () => authPost(authRequest(
    "sign-in/email", { email: fixture.email, password })));
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect(cookie).toContain("session_token");
  expect((await runWithTrustedClientAddress("127.0.0.2", () => authGet(authRequest(
    "get-session", undefined, cookie)))).status).toBe(401);
  expect(await db.auditLog.count({ where: { actorId: fixture.userId,
    action: "AUTH_LOGIN_COMPLETED" } })).toBe(0);
});

test("operator recovery can audit its target while activation holds the organization lock", async () => {
  const now = new Date();
  const fixture = await pendingCompany({ now: new Date(now.getTime() - 60_000) });
  const recoveryUpdated = barrier();
  const resumeRecovery = barrier();
  const activationLocked = barrier();
  const resumeActivation = barrier();
  const recoveryDb = db.$extends({ query: { user: { async update({ args, query }) {
    const result = await query(args);
    if (args.where.id === fixture.userId) {
      recoveryUpdated.release();
      await resumeRecovery.wait;
    }
    return result;
  } } } });
  const activationDb = db.$extends({ query: { user: { async findMany({ args, query }) {
    if (args.where?.organizationId === fixture.organizationId) {
      activationLocked.release();
      await resumeActivation.wait;
    }
    return query(args);
  } } } });
  const recovery = recoverMfaByOperator(recoveryDb as typeof db, {
    targetEmail: fixture.email, operatorId: "fixture-operator", verifiedChannel: "known-channel",
    evidenceReference: `fixture-${fixture.userId}`, identityConfirmed: true,
  });
  await recoveryUpdated.wait;
  const activation = activateCompanyInvitation(activationDb as typeof db, {
    token: fixture.token, hostname: fixture.hostname, password,
    requestId: randomUUID(), clock: () => now,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await activationLocked.wait;
    resumeRecovery.release();
    const result = await Promise.race([
      recovery.then(() => "completed" as const),
      new Promise<"blocked">((resolve) => { timer = setTimeout(() => resolve("blocked"), 2_000); }),
    ]);
    expect(result).toBe("completed");
  } finally {
    if (timer) clearTimeout(timer);
    resumeRecovery.release();
    resumeActivation.release();
    await Promise.allSettled([recovery, activation]);
  }
  expect(await activation).toMatchObject({ organizationId: fixture.organizationId });
  expect(await db.auditLog.count({ where: { organizationId: fixture.organizationId,
    action: "MFA_OPERATOR_RECOVERY" } })).toBe(1);
});

test.each([
  ["cancel", "activation-first"], ["cancel", "mutation-first"],
  ["resend", "activation-first"], ["resend", "mutation-first"],
] as const)("%s versus activation, %s: organization lock gives one outcome", async (kind, order) => {
  const now = new Date();
  const fixture = await pendingCompany({ now: new Date(now.getTime() - 60_000) });
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  const actorId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, actorId);
  else await db.user.create({ data: { id: actorId, email: `operator-${actorId}@example.test`,
    name: "Fixture operator", role: "SUPERADMIN_AUTERVA",
    emailVerified: true, twoFactorEnabled: true } });
  const session = await verifiedFixtureSession(db, actorId);
  const sessionToken = session.cookie.split("=")[1].split(".")[0];
  const sessionId = (await db.session.findUniqueOrThrow({ where: { token: sessionToken } })).id;
  const reached = barrier();
  const resume = barrier();
  const activationDb = db.$extends({ query: { user: { async findMany({ args, query }) {
    if (order === "activation-first" && args.where?.organizationId === fixture.organizationId) {
      reached.release();
      await resume.wait;
    }
    return query(args);
  } } } });
  const mutationDb = db.$extends({ query: { invitation: { async update({ args, query }) {
    const result = await query(args);
    if (order === "mutation-first" && args.where.id === fixture.invitationId) {
      reached.release();
      await resume.wait;
    }
    return result;
  } } } });
  const activate = () => activateCompanyInvitation(activationDb as typeof db, {
    token: fixture.token, hostname: fixture.hostname, password,
    requestId: randomUUID(), clock: () => now,
  });
  const mutate = () => kind === "cancel"
    ? cancelCompanyInvitation(mutationDb as typeof db, { actorId, sessionId,
      organizationId: fixture.organizationId, invitationId: fixture.invitationId,
      requestId: randomUUID(), now })
    : issueCompanyInvitation(mutationDb as typeof db, { actorId, sessionId,
      organizationId: fixture.organizationId, adminBaseDomain: "sites.example.test",
      idempotencyKey: randomUUID(), requestId: randomUUID(), now, mailKey: randomBytes(32) });
  try {
    if (order === "activation-first") {
      const activation = activate();
      await reached.wait;
      const mutation = mutate();
      resume.release();
      expect(await activation).toMatchObject({ organizationId: fixture.organizationId });
      if (kind === "cancel") expect(await mutation).toBe(false);
      else await expect(mutation).rejects.toThrow("INVITATION_COMPANY_INACTIVE");
    } else {
      const mutation = mutate();
      await reached.wait;
      const activation = activate();
      resume.release();
      if (kind === "cancel") expect(await mutation).toBe(true);
      else expect(await mutation).toMatchObject({ invitationId: expect.any(String) });
      expect(await activation).toBeNull();
    }
    expect(await db.account.count({ where: { userId: fixture.userId } }))
      .toBe(order === "activation-first" ? 1 : 0);
    expect(await db.auditLog.count({ where: { organizationId: fixture.organizationId,
      action: "INVITATION_ACCEPTED" } })).toBe(order === "activation-first" ? 1 : 0);
  } finally {
    resume.release();
    await session.dispose();
    if (!existing) await db.user.delete({ where: { id: actorId } });
  }
}, 30_000);

test.each([0, 1] as const)("foreign fixture identity %i cannot trigger access writes during activation setup", async (index) => {
  const raw = new Client({ connectionString: process.env.DATABASE_URL });
  await raw.connect();
  try {
    await seedLocalFixture(raw, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    const userId = FIXTURE.users[index];
    const original = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true } });
    await db.user.update({ where: { id: userId }, data: { email: `foreign-${randomUUID()}@example.test` } });
    try {
      await expect(ensureControlledSuperadminMfa(db, FIXTURE.users[2])).rejects.toThrow("Fixture identity mismatch");
      expect(await db.account.count({ where: { userId: { in: [...FIXTURE.users] } } })).toBe(0);
      expect(await db.twoFactor.count({ where: { userId: { in: [...FIXTURE.users] } } })).toBe(0);
      expect(await db.session.count({ where: { userId: { in: [...FIXTURE.users] } } })).toBe(0);
    } finally {
      await db.user.update({ where: { id: userId }, data: { email: original.email } });
      await seedLocalFixture(raw, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    }
  } finally {
    await raw.end();
  }
});
