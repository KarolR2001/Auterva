import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { activateCompanyInvitation } from "../../src/modules/invitations/activate";
import { decryptMailPayload, type MailPayload } from "../../src/modules/jobs/outbox";
import { processClaimedJob, type MailProvider } from "../../src/modules/jobs/processor";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { archiveCompany, restoreCompany } from "../../src/modules/organizations/archive";
import { processDueReminders } from "../../src/modules/reminders/deliver";
import { getServiceStatus } from "../../src/modules/reminders/read";
import { lockReminderCompany, reconcileReminders } from "../../src/modules/reminders/reconcile";
import { changePaidThrough } from "../../src/modules/service-period/mutations";
import { GET as adminStatus } from "../../src/app/api/admin/service-period/route";
import { GET as platformStatus } from "../../src/app/api/platform/companies/[organizationId]/service-period/route";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { createHash } from "node:crypto";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const secondDb = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
// Period mutations resolve the web process key from the environment when a queued mail must be rebound.
process.env.MAIL_PAYLOAD_KEY = key.toString("hex");
const HOUR = 60 * 60_000;
const organizations: string[] = [];
const platformSession = randomUUID();
let platformUserId: string;
let createdPlatformUser = false;
let platformHttp: Awaited<ReturnType<typeof verifiedFixtureSession>>;
const sessions: Array<Awaited<ReturnType<typeof verifiedFixtureSession>>> = [];
const platformHost = `reminders-platform-${randomUUID()}.example.test`;

type Company = Awaited<ReturnType<typeof company>>;
const at = (value: string) => new Date(value);
const slotKeys = (rows: { offsetDays: number; channel: string; slotAt: Date }[]) =>
  rows.map((row) => `${row.channel}:${row.offsetDays}:${row.slotAt.toISOString()}`).sort();

beforeAll(async () => {
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformUserId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, platformUserId);
  else {
    await db.user.create({ data: { id: platformUserId, name: "Reminder operator",
      email: `reminder-${platformUserId}@example.test`, emailVerified: true, twoFactorEnabled: true,
      role: "SUPERADMIN_AUTERVA" } });
    createdPlatformUser = true;
  }
  await db.session.create({ data: { id: platformSession, userId: platformUserId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 3 * HOUR), mfaVerifiedAt: new Date() } });
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  platformHttp = await verifiedFixtureSession(db, platformUserId);
});

afterAll(async () => {
  await db.reminderIntent.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.reminderPlan.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.job.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.invitation.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.account.deleteMany({ where: { user: { organizationId: { in: organizations } } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
  for (const session of sessions) await session.dispose();
  await platformHttp.dispose();
  await db.session.deleteMany({ where: { id: platformSession } });
  await db.user.deleteMany({ where: { organizationId: { in: organizations } } });
  if (createdPlatformUser) await db.user.deleteMany({ where: { id: platformUserId } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
  await secondDb.$disconnect();
});

async function company(options: { registeredAt?: Date | null; trial?: boolean; paidThrough?: string | null;
  admin?: boolean } = {}) {
  const organizationId = randomUUID();
  const label = organizationId.slice(0, 8);
  const registeredAt = options.registeredAt === undefined ? null : options.registeredAt;
  const userId = randomUUID();
  const email = `reminder-${organizationId}@example.test`;
  organizations.push(organizationId);
  await db.organization.create({ data: { id: organizationId, slug: `reminders-${label}`,
    firstAdminRegisteredAt: registeredAt } });
  await db.user.create({ data: { id: userId, name: "Reminder admin", email, role: "ADMIN_FIRMY", organizationId,
    emailVerified: options.admin !== false, twoFactorEnabled: options.admin !== false } });
  const adminHost = `reminders-admin-${label}.example.test`;
  const publicHost = `reminders-public-${label}.example.test`;
  await db.hostMapping.createMany({ data: [
    { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" }] });
  await db.serviceAccess.create({ data: { organizationId, periodVersion: 1,
    paidThrough: options.paidThrough ? new Date(`${options.paidThrough}T00:00:00.000Z`) : null,
    trialGranted: !!options.trial,
    ...(options.trial && registeredAt ? { trialStartedAt: registeredAt,
      trialEndsAt: new Date(registeredAt.getTime() + 336 * HOUR) } : {}) } });
  return { organizationId, userId, email, adminHost, publicHost };
}

/** Plans the schedule from the current rows, as the period mutations do inside their own transaction. */
function plan(organizationId: string, now: Date) {
  return db.$transaction(async (tx) => {
    await lockReminderCompany(tx, organizationId);
    return reconcileReminders(tx, organizationId, { now, loadKey: () => key });
  });
}

type Worker = { sent: MailPayload[]; provider: MailProvider };
// The claim loop is global; every assertion is scoped to the company under test.
const sentTo = (w: Worker, c: { email: string }) => w.sent.filter((mail) => mail.recipient === c.email);
function worker(): Worker {
  const sent: MailPayload[] = [];
  return { sent, provider: { send: async (mail) => { sent.push(mail); return { kind: "accepted", providerId: `fx-${sent.length}` }; } } };
}
/** One worker pass with a controlled clock: sweep, deliver claimed mail, sweep outcomes. */
async function tick(now: Date, w: Worker, client = db, emails?: string[]) {
  await processDueReminders(client, now, key, organizations);
  for (;;) {
    const claim = await claimNextJob(client, now, 30_000, true);
    if (!claim) break;
    await processClaimedJob(client, claim, { key, now, mode: "development",
      allowedRecipients: new Set(emails ?? organizations.map((id) => `reminder-${id}@example.test`)),
      provider: w.provider });
  }
  await processDueReminders(client, now, key, organizations);
}
const intents = (organizationId: string, where: object = {}) => db.reminderIntent.findMany({
  where: { organizationId, ...where }, orderBy: [{ slotAt: "asc" }, { channel: "asc" }] });
const op = (organizationId: string, now: Date) => ({ actorId: platformUserId, sessionId: platformSession,
  organizationId, eventKey: randomUUID(), requestId: randomUUID(), now });

test("activation plans the future 7/1/0 series for panel and e-mail in the same transaction", async () => {
  const now = at("2026-10-18T10:00:00.000Z"); // CEST; trial ends 01.11 10:00Z (CET)
  const organizationId = randomUUID();
  const userId = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const adminHost = `reminders-activate-${organizationId}.example.test`;
  const email = `reminder-${organizationId}@example.test`;
  organizations.push(organizationId);
  await db.organization.create({ data: { id: organizationId, slug: `rem-act-${organizationId.slice(0, 8)}` } });
  await db.user.create({ data: { id: userId, email, name: "Pending", role: "ADMIN_FIRMY", organizationId,
    emailVerified: false, twoFactorEnabled: false } });
  await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.serviceAccess.create({ data: { organizationId, trialGranted: true,
    paidThrough: new Date("2026-10-17T00:00:00.000Z") } });
  await db.invitation.create({ data: { organizationId, recipientEmail: email, issuedHost: adminHost,
    tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(),
    issuedAt: new Date(now.getTime() - 60_000), expiresAt: new Date(now.getTime() - 60_000 + 168 * HOUR) } });
  expect(await intents(organizationId)).toHaveLength(0);
  await plan(organizationId, now); // pre-registration: no boundary, no intents
  expect(await intents(organizationId)).toHaveLength(0);
  await activateCompanyInvitation(db, { token, hostname: adminHost, password: "Activation password 4421!",
    requestId: randomUUID(), clock: () => now });
  const rows = await intents(organizationId);
  expect(slotKeys(rows)).toEqual([
    "EMAIL:0:2026-11-01T08:00:00.000Z", "EMAIL:1:2026-10-31T08:00:00.000Z", "EMAIL:7:2026-10-25T08:00:00.000Z",
    "PANEL:0:2026-11-01T08:00:00.000Z", "PANEL:1:2026-10-31T08:00:00.000Z", "PANEL:7:2026-10-25T08:00:00.000Z"]);
  expect(rows.every((row) => row.status === "PENDING" && row.source === "TRIAL" && row.periodVersion === 1
    && row.effectiveEndsAt.toISOString() === "2026-11-01T10:00:00.000Z")).toBe(true);
  expect(await db.reminderPlan.findUniqueOrThrow({ where: { organizationId } })).toMatchObject({
    source: "TRIAL", periodVersion: 1 });
  // The expired payment (22.10) is not a boundary after the trial starts: one series only.
  const retry = await activateCompanyInvitation(db, { token, hostname: adminHost, password: "Other password 9921!",
    requestId: randomUUID(), clock: () => at("2026-10-19T10:00:00.000Z") });
  expect(retry).toMatchObject({ registeredAt: now.toISOString() });
  expect(await intents(organizationId)).toHaveLength(6);
});

test("due slots deliver once per channel across restarts and two parallel workers", async () => {
  const registered = at("2026-10-18T10:00:00.000Z");
  const c = await company({ registeredAt: registered, trial: true });
  await plan(c.organizationId, registered);
  const w = worker();
  await tick(at("2026-10-25T07:59:59.000Z"), w);
  expect(w.sent).toHaveLength(0);
  expect(await intents(c.organizationId, { status: { not: "PENDING" } })).toHaveLength(0);
  const slot = at("2026-10-25T08:00:00.000Z");
  await Promise.all([tick(slot, w), tick(slot, w, secondDb)]);
  await tick(slot, w); // restart: same intents, no duplicate mail
  await tick(new Date(slot.getTime() + HOUR), w, secondDb);
  expect(w.sent.filter((mail) => mail.recipient === c.email)).toHaveLength(1);
  const rows = await intents(c.organizationId, { offsetDays: 7 });
  expect(rows.map((row) => `${row.channel}:${row.status}`).sort()).toEqual(["EMAIL:DELIVERED", "PANEL:DELIVERED"]);
  expect(await db.job.count({ where: { organizationId: c.organizationId, kind: "MAIL_REMINDER" } })).toBe(1);
  const mail = w.sent.find((item) => item.recipient === c.email)!;
  expect(mail).toMatchObject({ kind: "MAIL_REMINDER", organizationId: c.organizationId, periodVersion: 1 });
  expect(mail.text).toContain("Okres próbny kończy się 01.11.2026 o 11:00");
  expect(mail.url).toBe(`https://${c.adminHost}/admin/`);
  expect(mail.text).not.toContain("Opłac");
  const email = rows.find((row) => row.channel === "EMAIL")!;
  expect(email.deliveredAt).not.toBeNull();
  expect(email.jobId).not.toBeNull();
});

test("two concurrent sweeps on separate connections create exactly one job per due intent", async () => {
  const registered = at("2026-11-02T10:00:00.000Z");
  const c = await company({ registeredAt: registered, trial: true });
  await plan(c.organizationId, registered);
  const late = at("2026-11-16T09:00:00.000Z"); // 7 and 1 and trial end, all overdue: three separate slots
  await Promise.all([processDueReminders(db, late, key, organizations), processDueReminders(secondDb, late, key, organizations),
    processDueReminders(db, late, key, organizations)]);
  const jobs = await db.job.findMany({ where: { organizationId: c.organizationId } });
  expect(jobs).toHaveLength(3);
  expect(new Set(jobs.map((job) => job.dedupeKey)).size).toBe(3);
  expect(await intents(c.organizationId, { channel: "PANEL", status: "DELIVERED" })).toHaveLength(3);
});

test("catch-up after an outage sends each overdue slot once, separately, with the current state in the text", async () => {
  const registered = at("2026-03-15T10:00:00.000Z");
  const c = await company({ registeredAt: registered, trial: true }); // trial ends 29.03 10:00Z (12:00 CEST)
  await plan(c.organizationId, registered);
  const w = worker();
  const after = at("2026-03-30T06:00:00.000Z"); // worker was down through every slot and the expiry
  await tick(after, w);
  await tick(after, w);
  await tick(new Date(after.getTime() + 5 * HOUR), w, secondDb);
  const mails = w.sent.filter((mail) => mail.recipient === c.email);
  expect(mails).toHaveLength(3);
  expect(new Set(mails.map((mail) => mail.referenceId)).size).toBe(3);
  expect(mails.every((mail) => mail.text.includes("Okres próbny już wygasł"))).toBe(true);
  expect(mails.every((mail) => mail.text.includes("Konto aktywne. Publiczna oferta jest obecnie wyłączona."))).toBe(true);
  expect(await db.job.count({ where: { organizationId: c.organizationId } })).toBe(3);
});

test("extension changes the plan: queued old mail is skipped, old banners disappear, new slots are future-only", async () => {
  const start = at("2026-10-17T10:00:00.000Z");
  const c = await company({ registeredAt: start, paidThrough: null });
  await changePaidThrough(db, { ...op(c.organizationId, start), expectedVersion: 1, paidThrough: "2026-10-25" });
  const oldRows = await intents(c.organizationId);
  expect(slotKeys(oldRows).filter((row) => row.startsWith("EMAIL"))).toEqual([
    "EMAIL:0:2026-10-25T08:00:00.000Z", "EMAIL:1:2026-10-24T07:00:00.000Z", "EMAIL:7:2026-10-18T07:00:00.000Z"]);
  const w = worker();
  const first = at("2026-10-18T07:00:00.000Z");
  await processDueReminders(db, first, key, organizations); // panel shown, e-mail queued but not yet sent
  expect((await getServiceStatus(db, c.organizationId, first))!.reminders).toHaveLength(1);
  const queued = await db.job.findFirstOrThrow({ where: { organizationId: c.organizationId } });
  await changePaidThrough(db, { ...op(c.organizationId, new Date(first.getTime() + 600_000)),
    expectedVersion: 2, paidThrough: "2026-10-31" });
  await tick(new Date(first.getTime() + 601_000), w);
  expect(sentTo(w, c)).toHaveLength(0);
  expect(await db.job.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "SKIPPED", errorCode: "STALE_INTENT" });
  const old = await intents(c.organizationId, { effectiveEndsAt: at("2026-10-25T23:00:00.000Z") });
  // Delivered history stays delivered; everything undelivered lost its validity.
  expect(old.filter((row) => row.status !== "DELIVERED").every((row) => row.status === "SUPERSEDED")).toBe(true);
  expect(old.filter((row) => row.status === "DELIVERED").map((row) => row.channel)).toEqual(["PANEL"]);
  expect((await getServiceStatus(db, c.organizationId, first))!.reminders).toHaveLength(0);
  const fresh = await intents(c.organizationId, { effectiveEndsAt: at("2026-10-31T23:00:00.000Z"), status: "PENDING" });
  expect(slotKeys(fresh)).toEqual([
    "EMAIL:0:2026-10-31T08:00:00.000Z", "EMAIL:1:2026-10-30T08:00:00.000Z", "EMAIL:7:2026-10-24T07:00:00.000Z",
    "PANEL:0:2026-10-31T08:00:00.000Z", "PANEL:1:2026-10-30T08:00:00.000Z", "PANEL:7:2026-10-24T07:00:00.000Z"]);
  await tick(at("2026-10-24T07:00:00.000Z"), w);
  await tick(at("2026-10-25T08:00:00.000Z"), w); // the old end date no longer produces anything
  expect(sentTo(w, c)).toHaveLength(1);
  expect(sentTo(w, c)[0].text).toContain("31.10.2026");
  expect(sentTo(w, c)[0].text).not.toContain("25.10.2026");
});

test("a slot becomes due when the extension is saved at 08:59, but is not created backwards at 09:01", async () => {
  const slot = at("2026-10-24T07:00:00.000Z"); // 09:00 CEST for end 31.10
  for (const [minutes, expected] of [[-1, true], [1, false]] as const) {
    const c = await company({ registeredAt: at("2026-10-01T10:00:00.000Z"), paidThrough: "2026-10-25" });
    await plan(c.organizationId, at("2026-10-01T10:00:00.000Z"));
    await changePaidThrough(db, { ...op(c.organizationId, new Date(slot.getTime() + minutes * 60_000)),
      expectedVersion: 1, paidThrough: "2026-10-31" });
    const rows = await intents(c.organizationId, { effectiveEndsAt: at("2026-10-31T23:00:00.000Z"), offsetDays: 7 });
    expect(rows.length).toBe(expected ? 2 : 0);
    if (expected) {
      const w = worker();
      await tick(slot, w);
      expect(w.sent.filter((mail) => mail.recipient === c.email)).toHaveLength(1);
    }
  }
});

test("unchanged boundary keeps an overdue intent and rebinds a queued mail to the new version without a second job", async () => {
  const start = at("2026-10-18T10:00:00.000Z"); // trial ends 01.11 10:00Z
  const c = await company({ registeredAt: start, trial: true });
  await plan(c.organizationId, start);
  const due = at("2026-10-25T08:00:00.000Z");
  await processDueReminders(db, due, key, organizations); // -7 materialized (queued mail) but the worker "crashes" before sending
  const before = await db.job.findFirstOrThrow({ where: { organizationId: c.organizationId } });
  expect(decryptMailPayload(before.payload, key).periodVersion).toBe(1);
  // 25.10 10:00 CET: payment to 30.10 ends 30.10 23:00Z, earlier than the trial: the boundary stays.
  const result = await changePaidThrough(db, { ...op(c.organizationId, at("2026-10-25T09:00:00.000Z")),
    expectedVersion: 1, paidThrough: "2026-10-30" });
  expect(result.periodVersion).toBe(2);
  const rows = await intents(c.organizationId);
  expect(rows).toHaveLength(6); // no new -7 backwards, no lost one
  expect(rows.some((row) => row.status === "SUPERSEDED")).toBe(false);
  // Open intents carry the new version; the already delivered panel slot is final history under its key.
  expect(rows.filter((row) => row.status === "PENDING" || row.status === "QUEUED")
    .every((row) => row.periodVersion === 2 && row.source === "TRIAL")).toBe(true);
  expect(rows.filter((row) => row.status === "DELIVERED").map((row) => `${row.channel}:${row.offsetDays}`)).toEqual(["PANEL:7"]);
  const after = await db.job.findUniqueOrThrow({ where: { id: before.id } });
  expect(after.status).toBe("PENDING");
  expect(decryptMailPayload(after.payload, key)).toMatchObject({ periodVersion: 2, text: decryptMailPayload(before.payload, key).text });
  const w = worker();
  await tick(at("2026-10-25T09:05:00.000Z"), w);
  expect(sentTo(w, c)).toHaveLength(1);
  expect(await db.job.count({ where: { organizationId: c.organizationId } })).toBe(1);
  const status = (await getServiceStatus(db, c.organizationId, at("2026-10-25T09:05:00.000Z")))!;
  expect(status.period).toMatchObject({ headline: "PAID", paidValid: true, trialValid: true, effectiveSource: "TRIAL" });
  expect(status.reminders.map((row) => row.offsetDays)).toEqual([7]);
  // The overdue, undelivered panel slot also survives a version bump.
  const c2 = await company({ registeredAt: start, trial: true });
  await plan(c2.organizationId, start);
  await changePaidThrough(db, { ...op(c2.organizationId, due), expectedVersion: 1, paidThrough: "2026-10-30" });
  await processDueReminders(db, new Date(due.getTime() + 1_000), key, organizations);
  expect(await intents(c2.organizationId, { channel: "PANEL", offsetDays: 7, status: "DELIVERED" })).toHaveLength(1);
});

test("overlapping paid and trial: one series for the later boundary, label says paid", async () => {
  const start = at("2026-03-22T11:00:00.000Z"); // trial ends 05.04 11:00Z
  const c = await company({ registeredAt: start, trial: true });
  await changePaidThrough(db, { ...op(c.organizationId, start), expectedVersion: 1, paidThrough: "2026-03-29" });
  const rows = await intents(c.organizationId);
  expect(rows).toHaveLength(6);
  expect(slotKeys(rows.filter((row) => row.channel === "EMAIL"))).toEqual([
    "EMAIL:0:2026-04-05T07:00:00.000Z", "EMAIL:1:2026-04-04T07:00:00.000Z", "EMAIL:7:2026-03-29T07:00:00.000Z"]);
  const during = (await getServiceStatus(db, c.organizationId, at("2026-03-25T00:00:00.000Z")))!;
  expect(during.period.headline).toBe("PAID");
  const afterPaid = (await getServiceStatus(db, c.organizationId, at("2026-03-30T00:00:00.000Z")))!;
  expect(afterPaid.period).toMatchObject({ headline: "TRIAL", paidValid: false, trialValid: true });
  expect(afterPaid.site.state).toBe("VISIBLE");
  expect(afterPaid.expiredNotice).toBeNull();
});

test("shortening to an ended date supersedes the series but the panel status keeps working with the D-11 notice", async () => {
  const start = at("2026-10-20T10:00:00.000Z");
  const c = await company({ registeredAt: start, paidThrough: "2026-11-30" });
  await plan(c.organizationId, start);
  expect((await intents(c.organizationId, { status: "PENDING" })).length).toBe(6);
  await changePaidThrough(db, { ...op(c.organizationId, start), expectedVersion: 1, paidThrough: "2026-10-19" });
  expect(await intents(c.organizationId, { status: "PENDING" })).toHaveLength(0);
  const status = (await getServiceStatus(db, c.organizationId, start))!;
  expect(status).toMatchObject({ site: { state: "PERIOD_EXPIRED", publicVisible: false }, reminders: [] });
  expect(status.expiredNotice).toBe("Konto aktywne. Publiczna oferta jest obecnie wyłączona. Skontaktuj się z Autervą w sprawie uruchomienia okresu usługi.");
  const w = worker();
  await tick(at("2026-11-23T07:00:00.000Z"), w);
  expect(sentTo(w, c)).toHaveLength(0);
});

test("archive supersedes pending and queued intents; restore re-plans only future slots", async () => {
  const start = at("2026-10-01T10:00:00.000Z");
  const c = await company({ registeredAt: start, paidThrough: "2026-11-10" }); // -7 = 03.11 08:00Z, -1 = 09.11, 0 = 10.11
  await plan(c.organizationId, start);
  await processDueReminders(db, at("2026-11-03T08:00:00.000Z"), key, organizations); // -7 delivered/queued
  const queued = await db.job.findFirstOrThrow({ where: { organizationId: c.organizationId } });
  const org = await db.organization.findUniqueOrThrow({ where: { id: c.organizationId } });
  const archived = await archiveCompany(db, { ...op(c.organizationId, at("2026-11-03T08:30:00.000Z")), expectedVersion: org.version });
  expect(archived.periodVersion).toBe(2);
  const w = worker();
  await tick(at("2026-11-03T09:00:00.000Z"), w);
  await tick(at("2026-11-09T08:00:00.000Z"), w);
  expect(sentTo(w, c)).toHaveLength(0); // nothing leaves for an archived company
  expect(await db.job.findUniqueOrThrow({ where: { id: queued.id } })).toMatchObject({ status: "SKIPPED" });
  expect(await intents(c.organizationId, { status: { in: ["PENDING", "QUEUED"] } })).toHaveLength(0);
  expect((await db.reminderPlan.findUniqueOrThrow({ where: { organizationId: c.organizationId } })).effectiveEndsAt).toBeNull();
  const restored = await restoreCompany(db, { ...op(c.organizationId, at("2026-11-09T07:00:00.000Z")), expectedVersion: archived.version });
  expect(restored.periodVersion).toBe(3);
  const revived = await intents(c.organizationId, { status: "PENDING" });
  expect(slotKeys(revived)).toEqual(["EMAIL:0:2026-11-10T08:00:00.000Z", "EMAIL:1:2026-11-09T08:00:00.000Z",
    "PANEL:0:2026-11-10T08:00:00.000Z", "PANEL:1:2026-11-09T08:00:00.000Z"]);
  await tick(at("2026-11-09T08:00:00.000Z"), w);
  expect(sentTo(w, c)).toHaveLength(1);
  expect(sentTo(w, c)[0].text).toContain("Publiczna oferta pozostaje wyłączona do odblokowania");
  // The -7 slot that fell inside the archive stays superseded and was not resurrected.
  expect(await intents(c.organizationId, { offsetDays: 7, channel: "EMAIL", status: "SUPERSEDED" })).toHaveLength(1);
});

test("a company archived after its job was queued never sends, even if the stale event is retried later", async () => {
  const start = at("2026-10-01T10:00:00.000Z");
  const c = await company({ registeredAt: start, paidThrough: "2026-11-10" });
  await plan(c.organizationId, start);
  await processDueReminders(db, at("2026-11-03T08:00:00.000Z"), key, organizations);
  const claim = await claimNextJob(db, at("2026-11-03T08:00:01.000Z"), 30_000, true);
  expect(claim).not.toBeNull();
  const org = await db.organization.findUniqueOrThrow({ where: { id: c.organizationId } });
  await archiveCompany(db, { ...op(c.organizationId, at("2026-11-03T08:00:02.000Z")), expectedVersion: org.version });
  const w = worker();
  await processClaimedJob(db, claim!, { key, now: at("2026-11-03T08:00:03.000Z"), mode: "development",
    allowedRecipients: new Set([c.email]), provider: w.provider });
  expect(sentTo(w, c)).toHaveLength(0);
});

test("an uncertain provider outcome is mirrored on the intent and never retried blindly", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const c = await company({ registeredAt: start, trial: true });
  await plan(c.organizationId, start);
  const due = at("2026-10-25T08:00:00.000Z");
  await processDueReminders(db, due, key, organizations);
  await db.job.updateMany({ where: { organizationId: c.organizationId }, data: { maxAttempts: 1 } });
  let calls = 0;
  const timeout: MailProvider = { send: async () => { calls++; return { kind: "transient" }; } };
  const claim = await claimNextJob(db, due, 30_000, true);
  await processClaimedJob(db, claim!, { key, now: due, mode: "development", allowedRecipients: new Set([c.email]), provider: timeout });
  await processDueReminders(db, due, key, organizations);
  const row = await db.reminderIntent.findFirstOrThrow({ where: { organizationId: c.organizationId, channel: "EMAIL", offsetDays: 7 } });
  expect(row.status).toBe("UNCERTAIN");
  const w = worker();
  await tick(new Date(due.getTime() + 2 * HOUR), w);
  await tick(new Date(due.getTime() + 30 * HOUR), w); // also well past the provider key window of the first slot
  expect(calls).toBe(1);
  expect((await db.reminderIntent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("UNCERTAIN");
  expect(await db.job.count({ where: { organizationId: c.organizationId, dedupeKey: `MAIL_REMINDER:${row.id}` } })).toBe(1);
  expect(w.sent.filter((mail) => mail.referenceId === row.id)).toHaveLength(0);
});

test("a recipient that is not the verified MFA administrator at delivery time is skipped without a job", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const c = await company({ registeredAt: start, trial: true });
  await plan(c.organizationId, start);
  await db.user.update({ where: { id: c.userId }, data: { twoFactorEnabled: false } });
  const w = worker();
  await tick(at("2026-10-25T08:00:00.000Z"), w);
  expect(sentTo(w, c)).toHaveLength(0);
  expect(await db.job.count({ where: { organizationId: c.organizationId } })).toBe(0);
  expect(await intents(c.organizationId, { channel: "EMAIL", offsetDays: 7 })).toMatchObject([
    { status: "SKIPPED", errorCode: "RECIPIENT_INVALID" }]);
  expect(await intents(c.organizationId, { channel: "PANEL", offsetDays: 7, status: "DELIVERED" })).toHaveLength(1);
});

test("companies planned before this feature are reconciled by the sweep, future slots only", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const c = await company({ registeredAt: start, trial: true });
  expect(await db.reminderPlan.findUnique({ where: { organizationId: c.organizationId } })).toBeNull();
  const now = at("2026-10-31T07:00:00.000Z"); // -7 is already past, -1 (08:00Z) and 0 are still ahead
  await processDueReminders(db, now, key, organizations);
  expect(await db.reminderPlan.findUniqueOrThrow({ where: { organizationId: c.organizationId } })).toMatchObject({ periodVersion: 1 });
  expect((await intents(c.organizationId)).map((row) => row.offsetDays).sort()).toEqual([0, 0, 1, 1]);
});

test("reconcile failure rolls the period change back with its version", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const c = await company({ registeredAt: start, paidThrough: "2026-11-30" });
  await plan(c.organizationId, start);
  const failing = db.$extends({ query: { reminderPlan: { async upsert() { throw new Error("injected reconcile failure"); } } } });
  await expect(changePaidThrough(failing as typeof db, { ...op(c.organizationId, start), expectedVersion: 1,
    paidThrough: "2026-12-15" })).rejects.toThrow("injected reconcile failure");
  expect(await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: c.organizationId } }))
    .toMatchObject({ periodVersion: 1 });
  expect((await db.reminderIntent.findMany({ where: { organizationId: c.organizationId } }))
    .every((row) => row.effectiveEndsAt.toISOString() === "2026-11-30T23:00:00.000Z")).toBe(true);
});

test("panel API: admin reads own company only, superadmin reads a company card, others are refused", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const a = await company({ registeredAt: start, trial: true });
  const b = await company({ registeredAt: start, trial: true });
  await plan(a.organizationId, start);
  await plan(b.organizationId, start);
  await processDueReminders(db, at("2026-10-25T08:00:00.000Z"), key, organizations);
  const adminSession = await verifiedFixtureSession(db, a.userId);
  sessions.push(adminSession);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at("2026-10-25T08:00:01.000Z"));
  try {
    const call = (host: string, cookie: string, path = "/api/admin/service-period") =>
      adminStatus(new Request(`http://${host}${path}`, { headers: { host, cookie } }));
    const own = await call(a.adminHost, adminSession.cookie);
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("no-store");
    expect(own.headers.get("x-request-id")).toBeTruthy();
    const body = await own.json();
    expect(body.serverTime).toBe("2026-10-25T08:00:01.000Z");
    expect(body).toMatchObject({ organizationId: a.organizationId,
      period: { headline: "TRIAL", trialValid: true, effectiveSource: "TRIAL" } });
    expect(body.reminders).toHaveLength(1);
    expect(body.reminders[0]).toMatchObject({ offsetDays: 7, source: "TRIAL" });
    expect(JSON.stringify(body)).not.toContain(b.organizationId);
    expect(JSON.stringify(body)).not.toContain("internalNote");
    // Admin A's session on company B's host or without a session is refused.
    expect((await call(b.adminHost, adminSession.cookie)).status).toBe(403);
    expect((await call(a.adminHost, "better-auth.session_token=forged")).status).toBe(403);
    expect((await call(a.publicHost, adminSession.cookie)).status).toBe(404);
    expect((await call(a.adminHost, adminSession.cookie, "/api/admin/service-period?x=1")).status).toBe(400);
    const platform = (organizationId: string, host = platformHost, cookie = platformHttp.cookie) =>
      platformStatus(new Request(`http://${host}/api/platform/companies/${organizationId}/service-period`,
        { headers: { host, cookie } }), { params: Promise.resolve({ organizationId }) });
    const card = await platform(b.organizationId);
    expect(card.status).toBe(200);
    expect(await card.json()).toMatchObject({ organizationId: b.organizationId, period: { headline: "TRIAL" } });
    expect((await platform(b.organizationId, a.adminHost)).status).toBe(404);
    expect((await platform(b.organizationId, platformHost, adminSession.cookie)).status).toBe(403);
    expect((await platform("not-a-uuid")).status).toBe(400);
    // Expiry never blocks the panel: after the trial and no payment the API answers with the notice.
    vi.setSystemTime(at("2026-11-02T00:00:00.000Z"));
    const expired = await call(a.adminHost, adminSession.cookie);
    expect(expired.status).toBe(200);
    expect(await expired.json()).toMatchObject({ period: { headline: "EXPIRED", trialValid: false } });
    expect((await getServiceStatus(db, a.organizationId, at("2026-11-02T00:00:00.000Z")))!.expiredNotice)
      .toContain("Konto aktywne.");
  } finally {
    vi.useRealTimers();
  }
});

test("a failing item does not starve the rest of the sweep and stays retryable", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const broken = await company({ registeredAt: start, trial: true });
  const healthy = await company({ registeredAt: start, trial: true });
  await plan(broken.organizationId, start);
  await plan(healthy.organizationId, start);
  const due = at("2026-10-25T08:00:00.000Z");
  const failing = db.$extends({ query: { job: { async createMany() { throw new Error("injected outbox failure"); } } } });
  await processDueReminders(failing as typeof db, due, key, organizations);
  for (const c of [broken, healthy]) {
    expect(await intents(c.organizationId, { channel: "PANEL", offsetDays: 7, status: "DELIVERED" })).toHaveLength(1);
    expect(await intents(c.organizationId, { channel: "EMAIL", offsetDays: 7, status: "PENDING" })).toHaveLength(1);
  }
  const w = worker();
  await tick(new Date(due.getTime() + 60_000), w); // outbox recovered and the 30 s backoff has passed: both go out once
  expect(sentTo(w, broken)).toHaveLength(1);
  expect(sentTo(w, healthy)).toHaveLength(1);
});

test("catch-up before expiry speaks from the send day: a -7 mail sent the day before the end says tomorrow", async () => {
  const registered = at("2026-10-18T10:00:00.000Z"); // trial ends 01.11 10:00Z; -7 was due 25.10
  const c = await company({ registeredAt: registered, trial: true });
  await plan(c.organizationId, registered);
  const w = worker();
  await tick(at("2026-10-31T10:00:00.000Z"), w); // the worker was down from -7 to the eve of the end
  const mails = sentTo(w, c);
  expect(mails.length).toBeGreaterThanOrEqual(2); // -7 and -1 overdue, sent separately
  expect(mails.every((mail) => mail.text.includes("(jutro)") && !mail.text.includes("za 7 dni"))).toBe(true);
});

test("permanently rejected intents become FAILED at once and cannot starve a healthy one beyond the batch", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const bad: Company[] = [];
  for (let index = 0; index < 51; index++) {
    const c = await company({ registeredAt: new Date(start.getTime() - (60 - index) * 60_000), trial: true });
    // Passes the recipient pre-check but the outbox refuses the address: a permanent enqueue error.
    await db.user.update({ where: { id: c.userId }, data: { email: `broken ${index}@example.test` } });
    bad.push(c);
  }
  const good = await company({ registeredAt: start, trial: true });
  const ids = [...bad, good].map((c) => c.organizationId);
  for (const id of ids) await plan(id, start);
  const due = at("2026-11-01T10:00:00.000Z"); // every slot overdue; bad ones sort first by slotAt
  for (let pass = 0; pass < 30; pass++) await processDueReminders(db, due, key, ids);
  expect(await db.reminderIntent.count({ where: { organizationId: { in: bad.map((c) => c.organizationId) },
    channel: "EMAIL", status: "FAILED", errorCode: "DELIVERY_REJECTED" } })).toBe(51 * 3);
  expect(await intents(good.organizationId, { channel: "EMAIL", status: "QUEUED" })).toHaveLength(3);
});

test("transient failures back off and recover to exactly one delivery without ever turning FAILED", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const c = await company({ registeredAt: start, trial: true });
  await plan(c.organizationId, start);
  const due = at("2026-10-25T08:00:00.000Z");
  const failing = db.$extends({ query: { job: { async createMany() { throw new Error("connection reset"); } } } }) as typeof db;
  const row = () => db.reminderIntent.findFirstOrThrow({ where: { organizationId: c.organizationId, channel: "EMAIL", offsetDays: 7 } });
  await processDueReminders(failing, due, key, [c.organizationId]);
  expect(await row()).toMatchObject({ status: "PENDING", attempts: 1 });
  await processDueReminders(failing, new Date(due.getTime() + 5_000), key, [c.organizationId]); // inside backoff: skipped
  expect((await row()).attempts).toBe(1);
  for (const minutes of [1, 3, 8]) await processDueReminders(failing, new Date(due.getTime() + minutes * 60_000), key, [c.organizationId]);
  expect(await row()).toMatchObject({ status: "PENDING", attempts: 4 });
  const w = worker();
  await tick(new Date(due.getTime() + 60 * 60_000), w); // outbox healthy again
  await tick(new Date(due.getTime() + 61 * 60_000), w);
  expect(sentTo(w, c)).toHaveLength(1);
  expect(await db.job.count({ where: { organizationId: c.organizationId } })).toBe(1);
  expect((await row()).status).toBe("DELIVERED");
});

test("a persistent transient-looking failure ends FAILED only after the whole backoff window; parallel sweeps count once", async () => {
  const start = at("2026-10-18T10:00:00.000Z");
  const c = await company({ registeredAt: start, trial: true });
  await plan(c.organizationId, start);
  const due = at("2026-10-25T08:00:00.000Z");
  const failing = db.$extends({ query: { job: { async createMany() { throw new Error("pool timeout"); } } } }) as typeof db;
  const failingSecond = secondDb.$extends({ query: { job: { async createMany() { throw new Error("pool timeout"); } } } }) as typeof db;
  const row = () => db.reminderIntent.findFirstOrThrow({ where: { organizationId: c.organizationId, channel: "EMAIL", offsetDays: 7 } });
  await Promise.all([processDueReminders(failing, due, key, [c.organizationId]),
    processDueReminders(failingSecond, due, key, [c.organizationId])]);
  expect((await row()).attempts).toBe(1);
  for (let index = 1; index < 12; index++) {
    expect((await row()).status).toBe("PENDING");
    await processDueReminders(failing, new Date(due.getTime() + index * 2 * HOUR), key, [c.organizationId]);
  }
  expect(await row()).toMatchObject({ status: "FAILED", errorCode: "DELIVERY_ERROR", attempts: 12 });
});
