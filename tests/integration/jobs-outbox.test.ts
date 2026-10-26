import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { decryptMailPayload, enqueueMail } from "../../src/modules/jobs/outbox";
import { FIXTURE } from "../../scripts/fixture-ids";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { processClaimedJob } from "../../src/modules/jobs/processor";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
const organizationId = randomUUID();
const adminId = randomUUID();
const hostname = `${randomUUID()}.example.test`;
afterAll(async () => {
  await db.job.deleteMany({ where: { organizationId } });
  await db.invitation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { id: adminId } });
  await db.hostMapping.deleteMany({ where: { organizationId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test("invitation and encrypted outbox commit together, dedupe preserves original token", async () => {
  const now = new Date("2026-10-26T10:00:00.000Z");
  const invitationId = randomUUID();
  const token = randomUUID();
  await db.organization.create({ data: { id: organizationId, slug: `jobs-${organizationId}` } });
  await db.user.create({ data: { id: adminId, name: "Fixture admin", email: "qa@example.test",
    role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true } });
  await db.hostMapping.create({ data: { organizationId, hostname, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  const job = await db.$transaction(async (tx) => {
    await tx.invitation.create({ data: { id: invitationId, organizationId, recipientEmail: "qa@example.test",
      tokenHash: createHash("sha256").update(token).digest("hex"), issueKey: randomUUID(),
      issuedAt: now, expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000) } });
    return enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId, recipient: "qa@example.test",
      referenceId: invitationId, token, runAt: now }, key);
  });
  expect(JSON.stringify(job.payload)).not.toContain(token);
  expect(JSON.stringify(job.payload)).not.toContain("qa@example.test");
  const original = decryptMailPayload(job.payload, key);
  expect(original).toMatchObject({ kind: "MAIL_INVITATION", recipient: "qa@example.test",
    referenceId: invitationId, url: `https://${hostname}/admin/zaproszenie/${encodeURIComponent(token)}` });
  const duplicate = await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId,
    recipient: "qa@example.test", referenceId: invitationId, token, runAt: now }, key));
  expect(duplicate.id).toBe(job.id);
  await db.job.update({ where: { id: job.id }, data: { status: "SENT", payload: { digest: (job.payload as { digest: string }).digest } } });
  const terminalDuplicate = await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId,
    recipient: "qa@example.test", referenceId: invitationId, token, runAt: now }, key));
  expect(terminalDuplicate.id).toBe(job.id);
  await expect(db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_INVITATION", organizationId,
    recipient: "qa@example.test", referenceId: invitationId, token: "different", runAt: now }, key))).rejects.toThrow();
  expect(await db.job.count({ where: { organizationId } })).toBe(1);
  await expect(db.$transaction(async (tx) => {
    await enqueueMail(tx, { kind: "MAIL_REMINDER", organizationId, recipient: "qa@example.test",
      referenceId: "period-1", periodVersion: 2, runAt: now }, key);
    throw new Error("domain rollback");
  })).rejects.toThrow("domain rollback");
  expect(await db.job.count({ where: { organizationId } })).toBe(1);
});

test("real superadmin reset uses PLATFORM; company A, B and platform scopes do not mix", async () => {
  const superadmin = await db.user.findUniqueOrThrow({ where: { id: FIXTURE.users[2] } });
  const adminA = await db.user.findUniqueOrThrow({ where: { id: FIXTURE.users[0] } });
  const adminB = await db.user.findUniqueOrThrow({ where: { id: FIXTURE.users[1] } });
  expect(superadmin).toMatchObject({ role: "SUPERADMIN_AUTERVA", organizationId: null });
  const platformHost = `${randomUUID()}.example.test`;
  const token = randomUUID();
  const verificationId = randomUUID();
  const now = new Date("2026-10-26T10:00:00.000Z");
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  await db.verification.create({ data: { id: verificationId, identifier: `password-reset:${superadmin.email.toLowerCase()}`,
    value: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(now.getTime() + 3_600_000) } });
  try {
    const job = await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET", scope: "PLATFORM",
      organizationId: null, recipient: superadmin.email, referenceId: verificationId, token, runAt: now }, key));
    expect((await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET", scope: "PLATFORM",
      organizationId: null, recipient: superadmin.email, referenceId: verificationId, token, runAt: now }, key))).id).toBe(job.id);
    expect(job.organizationId).toBeNull();
    expect(decryptMailPayload(job.payload, key).url).toBe(`https://${platformHost}/reset-hasla/${token}`);
    await expect(db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET", scope: "COMPANY_ADMIN",
      organizationId: organizationId, recipient: superadmin.email, referenceId: verificationId, token, runAt: now }, key))).rejects.toThrow();
    await expect(db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET", scope: "PLATFORM",
      organizationId: null, recipient: adminA.email, referenceId: verificationId, token, runAt: now }, key))).rejects.toThrow();
    expect(adminA.organizationId).not.toBe(adminB.organizationId);
    await expect(db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET", scope: "COMPANY_ADMIN",
      organizationId: adminB.organizationId!, recipient: adminA.email, referenceId: verificationId, token, runAt: now }, key))).rejects.toThrow();
    const claim = await claimNextJob(db, now, 30_000);
    expect(claim?.id).toBe(job.id);
    const sent: string[] = [];
    await processClaimedJob(db, claim!, { key, now, mode: "development",
      allowedRecipients: new Set([superadmin.email]),
      provider: { send: async (mail) => { sent.push(mail.recipient); return { kind: "accepted", providerId: "fixture-sa" }; } } });
    expect(sent).toEqual([superadmin.email]);
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "SENT" });
    expect((await db.$transaction((tx) => enqueueMail(tx, { kind: "MAIL_PASSWORD_RESET", scope: "PLATFORM",
      organizationId: null, recipient: superadmin.email, referenceId: verificationId, token, runAt: now }, key))).id).toBe(job.id);
  } finally {
    await db.job.deleteMany({ where: { dedupeKey: `MAIL_PASSWORD_RESET:${verificationId}` } });
    await db.verification.delete({ where: { id: verificationId } });
    await db.hostMapping.delete({ where: { hostname: platformHost } });
  }
});
