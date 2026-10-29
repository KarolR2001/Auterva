import { randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { auditRetentionCutoff } from "../../src/modules/audit/retention";
import { runAuditRetentionLoop } from "../../src/modules/audit/retention-runner";

test("nonprivate export directory does not stop the independent purge job", async () => {
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  await mkdir(resolve(".local"), { recursive: true });
  const directory = await mkdtemp(resolve(".local/audit-retention-runner-"));
  const now = new Date("2026-10-27T18:00:00.000Z");
  const auditId = randomUUID();
  const jobId = randomUUID();
  const controller = new AbortController();
  try {
    await chmod(directory, 0o755);
    await db.auditLog.create({ data: { id: auditId, actorId: "fixture:runner", actorRole: "OPERATOR",
      action: "MFA_OPERATOR_RECOVERY", entityType: "User", entityId: randomUUID(),
      requestId: randomUUID(), createdAt: new Date(auditRetentionCutoff(now).getTime() - 1) } });
    await db.job.create({ data: { id: jobId, kind: "AUDIT_RETENTION", organizationId: null,
      dedupeKey: `fixture-audit-runner-${jobId}`,
      payload: { cutoff: auditRetentionCutoff(now).toISOString() },
      runAt: new Date(now.getTime() - 1_000), maxAttempts: 5 } });
    const deadline = setTimeout(() => controller.abort(), 5_000);
    try {
      await runAuditRetentionLoop({ db, directory, signal: controller.signal,
        clock: () => now, pollMs: 100, afterClaim: async (claim) => {
          if (claim.id === jobId) controller.abort();
        } });
    } finally {
      clearTimeout(deadline);
    }
    expect((await db.job.findUniqueOrThrow({ where: { id: jobId } })).status).toBe("SENT");
    expect(await db.auditLog.findUnique({ where: { id: auditId } })).toBeNull();
  } finally {
    controller.abort();
    const scheduled = await db.job.findFirst({ where: { dedupeKey: "AUDIT_RETENTION:2026-10-27",
      kind: "AUDIT_RETENTION", organizationId: null }, select: { id: true } });
    if (scheduled) {
      await db.auditRetentionManifest.deleteMany({ where: { jobId: scheduled.id } });
      await db.job.delete({ where: { id: scheduled.id } });
    }
    await db.auditRetentionManifest.deleteMany({ where: { jobId } });
    await db.job.deleteMany({ where: { id: jobId } });
    await db.auditLog.deleteMany({ where: { id: auditId } });
    await db.$disconnect();
    await rm(directory, { recursive: true, force: true });
  }
});
