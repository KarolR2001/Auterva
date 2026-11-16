import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import { getLaunchDiagnostics } from "../../src/modules/organizations/launch-diagnostics";
import { GET as handler } from "../../src/app/api/platform/companies/[organizationId]/launch-diagnostics/route";
import { ensureControlledFixtureAccess, verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const [a, b] = [randomUUID(), randomUUID()];
const now = new Date("2026-10-26T12:00:00.000Z");
const platformHost = `diag-platform-${randomUUID()}.example.test`;
const hostsA = { admin: `a-${a}.admin.example.test`, alias: `a-${a}.example.test`, custom: `a-${a}.custom.example.test` };
const hostsB = { admin: `b-${b}.admin.example.test`, alias: `b-${b}.example.test` };
let platformSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let adminSession: Awaited<ReturnType<typeof verifiedFixtureSession>>;
let invitationA = "";

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: a, slug: `diag-a-${a}`, name: "Diag A" },
    { id: b, slug: `diag-b-${b}`, name: "Diag B", firstAdminRegisteredAt: new Date("2026-10-20T10:00:00Z") }] });
  await db.user.create({ data: { id: randomUUID(), name: "A", email: `diag-${a}@example.test`,
    role: "ADMIN_FIRMY", organizationId: a } });
  await db.serviceAccess.createMany({ data: [{ organizationId: a, trialGranted: true }, { organizationId: b,
    trialGranted: true, trialStartedAt: new Date("2026-10-20T10:00:00Z"),
    trialEndsAt: new Date("2026-11-03T10:00:00Z") }] });
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  await db.hostMapping.createMany({ data: [
    { hostname: hostsA.admin, area: "COMPANY_ADMIN", kind: "PROVIDER", organizationId: a, status: "ACTIVE" },
    { hostname: hostsA.alias, area: "COMPANY_PUBLIC", kind: "PROVIDER", organizationId: a, status: "ACTIVE" },
    { hostname: hostsB.admin, area: "COMPANY_ADMIN", kind: "PROVIDER", organizationId: b, status: "ACTIVE" },
    { hostname: hostsB.alias, area: "COMPANY_PUBLIC", kind: "PROVIDER", organizationId: b, status: "PENDING" } ] });
  const custom = await db.hostMapping.create({ data: { hostname: hostsA.custom, area: "COMPANY_PUBLIC",
    kind: "CUSTOM", organizationId: a, status: "PENDING" } });
  await db.customDomain.create({ data: { organizationId: a, hostMappingId: custom.id,
    verificationToken: "secret-proof-token" } });
  const inv = await db.invitation.create({ data: { organizationId: a, recipientEmail: `diag-${a}@example.test`,
    issuedHost: hostsA.admin, tokenHash: randomUUID(), issueKey: randomUUID(), issuedAt: now,
    expiresAt: new Date(now.getTime() + 7 * 86_400_000) } });
  invitationA = inv.id;
  await ensureControlledFixtureAccess(db);
  platformSession = await verifiedFixtureSession(db, FIXTURE.users[2]);
  adminSession = await verifiedFixtureSession(db, FIXTURE.users[0]);
});

afterAll(async () => {
  if (platformSession) await platformSession.dispose();
  if (adminSession) await adminSession.dispose();
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.job.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.invitation.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.customDomain.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.hostMapping.deleteMany({ where: { OR: [{ organizationId: { in: [a, b] } }, { hostname: platformHost }] } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.user.deleteMany({ where: { organizationId: { in: [a, b] } } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
});

const setJob = async (data: object) => {
  await db.job.upsert({ where: { organizationId_dedupeKey: { organizationId: a, dedupeKey: `MAIL_INVITATION:${invitationA}` } },
    create: { organizationId: a, kind: "MAIL_INVITATION", dedupeKey: `MAIL_INVITATION:${invitationA}`,
      payload: { digest: "x" }, runAt: now, ...data }, update: data });
};
const diag = async (id = a) => (await getLaunchDiagnostics(db, id, now))!;

test("domain: unchecked and waiting are distinct from failures, with category and retry", async () => {
  let d = await diag();
  expect(d.domain.customDomain).toMatchObject({ state: "NOT_CHECKED", category: null, retry: { allowed: true } });
  expect(d.domain.severity).toBe("WAITING");
  const set = (data: object) => db.customDomain.update({ where: { organizationId: a }, data });
  await set({ checkedAt: now, lastFailureCode: "OWNERSHIP_TXT_MISSING" });
  d = await diag();
  expect(d.domain.customDomain).toMatchObject({ state: "WAITING", category: "OWNERSHIP" });
  expect(d.domain.severity).toBe("WAITING");
  await set({ status: "PENDING_ROUTING", lastFailureCode: "TLS_INVALID", ownershipVerifiedAt: now });
  d = await diag();
  expect(d.domain.customDomain).toMatchObject({ state: "FAILED", category: "TLS", failureCode: "TLS_INVALID",
    proofs: { ownership: true, routing: false, tls: false } });
  expect(d.domain.severity).toBe("ERROR");
  await set({ lastFailureCode: "DOMAIN_CONFIG_MISSING" });
  expect((await diag()).domain.customDomain?.retry).toEqual({ action: "VERIFY_DOMAIN", allowed: false,
    reason: "PLATFORM_CONFIG_REQUIRED" });
  await set({ status: "READY", lastFailureCode: null, routingVerifiedAt: now, tlsVerifiedAt: now });
  d = await diag();
  expect(d.domain.customDomain?.state).toBe("READY");
  expect(JSON.stringify(d)).not.toContain("secret-proof-token");
});

test("invitation delivery states come from the job; retry follows the contract", async () => {
  await setJob({ status: "PENDING", attempts: 0 });
  expect((await diag()).invitation).toMatchObject({ state: "ISSUED", severity: "WAITING",
    delivery: { state: "QUEUED" }, retry: { allowed: true } });
  await setJob({ status: "PENDING", attempts: 2, errorCode: "MAIL_TRANSIENT", runAt: new Date(now.getTime() + 20_000) });
  expect((await diag()).invitation.delivery).toMatchObject({ state: "RETRYING", errorCode: "MAIL_TRANSIENT",
    attempts: 2, nextAttemptAt: new Date(now.getTime() + 20_000).toISOString() });
  await setJob({ status: "FAILED", errorCode: "MAIL_PERMANENT", completedAt: now });
  expect((await diag()).invitation).toMatchObject({ severity: "ERROR", delivery: { state: "FAILED",
    errorCode: "MAIL_PERMANENT", lastAttemptAt: now.toISOString() }, retry: { allowed: true } });
  await setJob({ status: "FAILED", errorCode: "provider said: secret detail" });
  expect((await diag()).invitation.delivery?.errorCode).toBe("UNKNOWN");
  await setJob({ status: "UNCERTAIN", errorCode: "MAIL_OUTCOME_UNKNOWN" });
  expect((await diag()).invitation).toMatchObject({ severity: "UNCERTAIN",
    retry: { allowed: false, reason: "OPERATOR_DECISION_REQUIRED", next: "REVOKE_INVITATION" } });
  await setJob({ status: "SENT", errorCode: null });
  expect((await diag()).invitation).toMatchObject({ severity: "OK", delivery: { state: "ACCEPTED_BY_PROVIDER" } });
});

test("expired or revoked invitation, registered and archived companies", async () => {
  const later = new Date(now.getTime() + 7 * 86_400_000);
  expect((await getLaunchDiagnostics(db, a, later))!.invitation).toMatchObject({ state: "EXPIRED", severity: "ERROR" });
  await db.invitation.update({ where: { id: invitationA }, data: { revokedAt: now } });
  expect((await diag()).invitation).toMatchObject({ state: "NOT_ISSUED", severity: "WAITING" });
  expect((await diag(b)).invitation.state).toBe("NOT_APPLICABLE");
  await db.organization.update({ where: { id: a }, data: { archivedAt: now } });
  const archived = await diag();
  expect(archived).toMatchObject({ archived: true, overall: "NOT_APPLICABLE",
    domain: { severity: "NOT_APPLICABLE" }, reminders: { items: [] } });
  await db.organization.update({ where: { id: a }, data: { archivedAt: null } });
});

test("reminders: only the current boundary, no superseded slots, codes allowlisted", async () => {
  const ends = new Date("2026-11-03T10:00:00.000Z");
  const row = (offsetDays: number, status: string, extra: object = {}) => ({ organizationId: b, effectiveEndsAt: ends,
    offsetDays, channel: "EMAIL", slotAt: new Date(ends.getTime() - offsetDays * 86_400_000), source: "TRIAL",
    periodVersion: 0, status, ...extra });
  await db.reminderIntent.createMany({ data: [row(7, "DELIVERED"), row(1, "FAILED", { errorCode: "DELIVERY_REJECTED" }),
    row(0, "SUPERSEDED"),
    { ...row(7, "FAILED"), effectiveEndsAt: new Date("2026-10-01T00:00:00Z") },
    { ...row(7, "PENDING"), channel: "PANEL" }] });
  const d = await diag(b);
  expect(d.reminders.items.map((i) => [i.offsetDays, i.state, i.errorCode])).toEqual([
    [7, "DELIVERED", null], [1, "FAILED", "DELIVERY_REJECTED"]]);
  expect(d.reminders.severity).toBe("ERROR");
  expect(d.domain.aliasHost).toBe("PENDING");
  expect(d.domain.severity).toBe("ERROR");
  expect(d.overall).toBe("ERROR");
  expect(await getLaunchDiagnostics(db, randomUUID(), now)).toBeNull();
});

test("reminders: queued mail takes its state from the Job; queued and overdue pending are waiting", async () => {
  await db.reminderIntent.deleteMany({ where: { organizationId: b } });
  const ends = new Date("2026-11-03T10:00:00.000Z");
  const job = await db.job.create({ data: { organizationId: b, kind: "MAIL_REMINDER", dedupeKey: `MAIL_REMINDER:${randomUUID()}`,
    payload: { digest: "x" }, runAt: new Date(now.getTime() + 20_000), status: "PENDING", attempts: 3,
    errorCode: "MAIL_TRANSIENT" } });
  const row = (offsetDays: number, status: string, extra: object = {}) => ({ organizationId: b, effectiveEndsAt: ends,
    offsetDays, channel: "EMAIL", slotAt: new Date(ends.getTime() - offsetDays * 86_400_000), source: "TRIAL",
    periodVersion: 0, status, ...extra });
  await db.reminderIntent.createMany({ data: [row(7, "QUEUED", { jobId: job.id }),
    row(1, "PENDING", { slotAt: new Date(now.getTime() - 60_000) })] });
  const d = await diag(b);
  expect(d.reminders.items.find((i) => i.offsetDays === 7)).toMatchObject({ offsetDays: 7, state: "RETRYING", attempts: 3,
    errorCode: "MAIL_TRANSIENT", nextAttemptAt: new Date(now.getTime() + 20_000).toISOString() });
  expect(d.reminders.items.find((i) => i.offsetDays === 1)).toMatchObject({ offsetDays: 1, state: "PENDING" });
  expect(d.reminders.severity).toBe("WAITING");
  await db.job.update({ where: { id: job.id }, data: { status: "UNCERTAIN", errorCode: "MAIL_OUTCOME_UNKNOWN" } });
  expect((await diag(b)).reminders.severity).toBe("UNCERTAIN");
  await db.reminderIntent.deleteMany({ where: { organizationId: b } });
});

test("diagnostics is a read: no new rows, jobs or audit, and neighbour data never leaks", async () => {
  const count = async () => [await db.organization.count(), await db.user.count(), await db.invitation.count(),
    await db.job.count(), await db.auditLog.count(), await db.serviceAccess.count()];
  const before = await count();
  const d = await diag();
  expect(await count()).toEqual(before);
  expect(JSON.stringify(d)).not.toContain(hostsB.alias);
  expect(JSON.stringify(d)).not.toContain(b);
});

test("#417: certificate expiry, host check times, last mail (no password reset) and general causes", async () => {
  const set = (data: object) => db.customDomain.update({ where: { organizationId: a }, data });
  const day = 86_400_000;
  await set({ status: "ACTIVE", activatedAt: now, ownershipVerifiedAt: now, routingVerifiedAt: now, tlsVerifiedAt: now,
    lastFailureCode: null, checkedAt: now, tlsNotAfter: new Date(now.getTime() + 60 * day) });
  let d = await diag();
  expect(d.domain.customDomain).toMatchObject({ state: "ACTIVE", tlsExpiry: "OK",
    tlsNotAfter: new Date(now.getTime() + 60 * day).toISOString() });
  expect(d.domain.severity).toBe("OK");
  await set({ tlsNotAfter: new Date(now.getTime() + 21 * day) });
  d = await diag();
  expect(d.domain.customDomain).toMatchObject({ state: "ACTIVE", tlsExpiry: "EXPIRING_SOON" });
  expect(d.domain.severity).toBe("WAITING");
  await set({ tlsNotAfter: new Date(now.getTime() - day) });
  expect((await diag()).domain).toMatchObject({ severity: "ERROR", customDomain: { tlsExpiry: "EXPIRED" } });
  await set({ tlsNotAfter: null });
  expect((await diag()).domain.customDomain).toMatchObject({ tlsExpiry: "UNKNOWN", tlsNotAfter: null });
  // A failed periodic re-check keeps the lifecycle (ACTIVE) but is shown as a failure.
  await set({ lastFailureCode: "CNAME_MISMATCH" });
  expect((await diag()).domain).toMatchObject({ severity: "ERROR",
    customDomain: { status: "ACTIVE", state: "FAILED", category: "DNS" } });
  await set({ status: "READY", activatedAt: null, lastFailureCode: null });

  expect((await diag()).domain).toMatchObject({ aliasCheckedAt: null, adminCheckedAt: null });
  const checked = new Date("2026-10-25T08:00:00.000Z");
  await db.hostMapping.updateMany({ where: { organizationId: a, kind: "PROVIDER" }, data: { checkedAt: checked } });
  expect((await diag()).domain).toMatchObject({ aliasCheckedAt: checked.toISOString(),
    adminCheckedAt: checked.toISOString() });

  // The invitation was revoked above; its job is still a mail event. Password reset jobs are never reported.
  await db.invitation.update({ where: { id: invitationA }, data: { revokedAt: null } });
  await setJob({ status: "FAILED", attempts: 5, errorCode: "DELIVERY_REJECTED", completedAt: new Date(now.getTime() - 3_600_000) });
  await db.job.create({ data: { organizationId: a, kind: "MAIL_PASSWORD_RESET", dedupeKey: `MAIL_PASSWORD_RESET:${randomUUID()}`,
    payload: { digest: "x" }, runAt: now, status: "SENT", completedAt: now } });
  d = await diag();
  expect(d.lastMail).toEqual({ type: "INVITATION", at: new Date(now.getTime() - 3_600_000).toISOString(),
    state: "FAILED", cause: "PROVIDER_REJECTED" });
  expect(d.invitation.delivery).toMatchObject({ cause: "PROVIDER_REJECTED" });
  const causes: [string, string][] = [["MAIL_TRANSIENT", "PROVIDER_TEMPORARY"], ["MAIL_PERMANENT", "PROVIDER_REJECTED"],
    ["RECIPIENT_NOT_ALLOWED", "PLATFORM_CONFIG"], ["MAIL_OUTCOME_UNKNOWN", "OUTCOME_UNKNOWN"],
    ["STALE_INTENT", "OTHER"], ["provider said: secret detail", "OTHER"]];
  for (const [code, cause] of causes) {
    await setJob({ errorCode: code });
    const out = await diag();
    expect(out.lastMail?.cause).toBe(cause);
    expect(JSON.stringify(out.lastMail)).not.toContain(code);
  }
  // A later reminder event wins; PENDING slots are not events.
  const ends = new Date("2026-11-03T10:00:00.000Z");
  await db.organization.update({ where: { id: a }, data: { firstAdminRegisteredAt: new Date("2026-10-20T10:00:00Z") } });
  await db.serviceAccess.update({ where: { organizationId: a }, data: { trialStartedAt: new Date("2026-10-20T10:00:00Z"),
    trialEndsAt: ends } });
  await db.reminderIntent.createMany({ data: [
    { organizationId: a, effectiveEndsAt: ends, offsetDays: 7, channel: "EMAIL", slotAt: new Date("2026-10-27T10:00:00Z"),
      source: "TRIAL", periodVersion: 0, status: "PENDING" },
    { organizationId: a, effectiveEndsAt: ends, offsetDays: 1, channel: "EMAIL", slotAt: new Date("2026-10-26T10:00:00Z"),
      source: "TRIAL", periodVersion: 0, status: "DELIVERED", deliveredAt: new Date(now.getTime() - 60_000) }] });
  expect((await diag()).lastMail).toMatchObject({ type: "REMINDER", state: "DELIVERED", cause: null,
    at: new Date(now.getTime() - 60_000).toISOString() });
  await db.reminderIntent.deleteMany({ where: { organizationId: a } });
  await db.organization.update({ where: { id: a }, data: { archivedAt: now } });
  expect((await diag()).lastMail).toBeNull();
  await db.organization.update({ where: { id: a }, data: { archivedAt: null } });
});

test("HTTP: only the platform superadmin; admin, wrong host, bad id and query are refused", async () => {
  const call = (path: string, host: string, cookie: string) => handler(new Request(`http://127.0.0.1:3381${path}`,
    { headers: { host, cookie } }), { params: Promise.resolve({ organizationId: path.split("/")[4].split("?")[0] }) });
  const path = `/api/platform/companies/${a}/launch-diagnostics`;
  const ok = await call(path, platformHost, platformSession.cookie);
  expect(ok.status).toBe(200);
  expect(ok.headers.get("cache-control")).toBe("no-store");
  const body = await ok.json();
  expect(body.organizationId).toBe(a);
  expect(JSON.stringify(body)).not.toMatch(/tokenHash|payload|verificationToken|providerId|@example/);
  expect((await call(path, platformHost, adminSession.cookie)).status).toBe(403);
  expect((await call(path, hostsA.admin, adminSession.cookie)).status).toBe(404);
  expect((await call(path, hostsA.alias, platformSession.cookie)).status).toBe(404);
  expect((await call(`/api/platform/companies/${randomUUID()}/launch-diagnostics`, platformHost,
    platformSession.cookie)).status).toBe(404);
  expect((await call("/api/platform/companies/nope/launch-diagnostics", platformHost,
    platformSession.cookie)).status).toBe(400);
  expect((await call(`${path}?x=1`, platformHost, platformSession.cookie)).status).toBe(400);
});
