import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { listAudit } from "../../src/modules/audit/read";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const userId = randomUUID();
const sessionId = randomUUID();
const oldId = randomUUID();
const liveId = randomUUID();

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { id: { in: [oldId, liveId] } } });
  await db.session.deleteMany({ where: { id: sessionId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

test("tenant audit read excludes expired rows before the daily purge runs", async () => {
  const now = new Date();
  await db.organization.create({ data: { id: organizationId, slug: `audit-retention-${organizationId}` } });
  await db.user.create({ data: { id: userId, name: "Retention admin",
    email: `audit-retention-${userId}@example.test`, emailVerified: true,
    twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId } });
  await db.session.create({ data: { id: sessionId, userId, token: randomUUID(),
    expiresAt: new Date(now.getTime() + 60_000), mfaVerifiedAt: now } });
  await db.auditLog.createMany({ data: [
    { id: oldId, organizationId, actorId: userId, actorRole: "ADMIN_FIRMY",
      action: "AUTH_LOGIN_COMPLETED", entityType: "User", entityId: userId,
      requestId: randomUUID(), createdAt: new Date(now.getTime() - 365 * 86_400_000 - 60_000) },
    { id: liveId, organizationId, actorId: userId, actorRole: "ADMIN_FIRMY",
      action: "AUTH_LOGIN_COMPLETED", entityType: "User", entityId: userId,
      requestId: randomUUID(), createdAt: new Date(now.getTime() - 365 * 86_400_000 + 60_000) },
  ] });
  const rows = await listAudit(db, { actorId: userId, sessionId, organizationId });
  expect(rows.map((row) => row.id)).toContain(liveId);
  expect(rows.map((row) => row.id)).not.toContain(oldId);
  expect(await db.auditLog.findUnique({ where: { id: oldId } })).not.toBeNull();
});
