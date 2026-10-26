import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { decryptMailPayload, enqueueMail } from "../../src/modules/jobs/outbox";
import { FIXTURE } from "../../scripts/fixture-ids";
import { seedLocalFixture } from "../../scripts/seed-local-fixture";
import { ensureControlledSuperadminMfa } from "../fixtures/verified-session";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { processClaimedJob } from "../../src/modules/jobs/processor";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = randomBytes(32);
const organizationId = randomUUID();
const adminId = randomUUID();
const hostname = `${randomUUID()}.example.test`;

async function preparedSuperadmin() {
  // The shared seed can write credentials for all three users, so guard all
  // three identities before allowing it to touch any of them.
  const expected = [
    { id: FIXTURE.users[0], email: "admin-a@example.test", role: "ADMIN_FIRMY",
      organizationId: FIXTURE.organizations[0], slug: "fixture-a" },
    { id: FIXTURE.users[1], email: "admin-b@example.test", role: "ADMIN_FIRMY",
      organizationId: FIXTURE.organizations[1], slug: "fixture-b" },
    { id: FIXTURE.users[2], email: "superadmin@example.test", role: "SUPERADMIN_AUTERVA",
      organizationId: null, slug: null },
  ] as const;
  const users = await db.user.findMany({ where: { id: { in: [...FIXTURE.users] } },
    select: { id: true, email: true, role: true, organizationId: true, emailVerified: true,
      disabledAt: true, organization: { select: { slug: true, archivedAt: true,
        firstAdminRegisteredAt: true } } } });
  const byId = new Map(users.map((user) => [user.id, user]));
  for (const identity of expected) {
    const user = byId.get(identity.id);
    if (!user || user.email !== identity.email || user.role !== identity.role
      || user.organizationId !== identity.organizationId || !user.emailVerified || user.disabledAt
      || (identity.slug === null ? user.organization !== null
        : user.organization?.slug !== identity.slug || user.organization.archivedAt
          || !user.organization.firstAdminRegisteredAt)) {
      throw new Error("Fixture identity mismatch");
    }
  }
  const superadmin = byId.get(FIXTURE.users[2])!;
  await ensureControlledSuperadminMfa(db, superadmin.id);
  if (await db.account.count({ where: { userId: superadmin.id,
    providerId: "credential", password: { not: null } } }) !== 1) {
    throw new Error("Fixture credential missing");
  }
  return superadmin;
}

test("foreign A or B identity refuses access setup without any fixture writes", async () => {
  const raw = new Client({ connectionString: process.env.DATABASE_URL });
  await raw.connect();
  try {
    for (const index of [0, 1]) {
      await seedLocalFixture(raw, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
      const userId = FIXTURE.users[index];
      const original = await db.user.findUniqueOrThrow({ where: { id: userId } });
      await db.user.update({ where: { id: userId }, data: { email: `foreign-${randomUUID()}@example.test` } });
      try {
        await expect(preparedSuperadmin()).rejects.toThrow("Fixture identity mismatch");
        expect(await db.account.count({ where: { userId: { in: [...FIXTURE.users] } } })).toBe(0);
        expect(await db.twoFactor.count({ where: { userId: { in: [...FIXTURE.users] } } })).toBe(0);
        expect(await db.session.count({ where: { userId: { in: [...FIXTURE.users] } } })).toBe(0);
      } finally {
        await db.user.update({ where: { id: userId }, data: { email: original.email } });
      }
    }
  } finally {
    await raw.end();
  }
});

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
    role: "ADMIN_FIRMY", organizationId, emailVerified: false, twoFactorEnabled: false } });
  await db.hostMapping.create({ data: { organizationId, hostname, area: "COMPANY_ADMIN", status: "ACTIVE" } });
  const job = await db.$transaction(async (tx) => {
    await tx.invitation.create({ data: { id: invitationId, organizationId, recipientEmail: "qa@example.test",
      issuedHost: hostname,
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
  await db.user.update({ where: { id: adminId }, data: { emailVerified: true, twoFactorEnabled: true } });
  await expect(db.$transaction(async (tx) => {
    await enqueueMail(tx, { kind: "MAIL_REMINDER", organizationId, recipient: "qa@example.test",
      referenceId: "period-1", periodVersion: 2, runAt: now }, key);
    throw new Error("domain rollback");
  })).rejects.toThrow("domain rollback");
  expect(await db.job.count({ where: { organizationId } })).toBe(1);
});

test("real superadmin reset uses PLATFORM; company A, B and platform scopes do not mix", async () => {
  const superadmin = await preparedSuperadmin();
  const adminA = await db.user.findUniqueOrThrow({ where: { id: FIXTURE.users[0] } });
  const adminB = await db.user.findUniqueOrThrow({ where: { id: FIXTURE.users[1] } });
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
