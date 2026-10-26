import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { exportAuditRange, readAuditExport, sweepExpiredAuditExports } from "../../src/modules/audit/operator-export";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const now = new Date("2026-10-26T12:00:00.000Z");
const cutoff = new Date(now.getTime() - 365 * 86_400_000);
const key = randomBytes(32);
const auditIds: string[] = [];
const exportIds: string[] = [];
let directory: string;

afterAll(async () => {
  await db.auditOperatorExport.deleteMany({ where: { id: { in: exportIds } } });
  await db.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  await db.$disconnect();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("operator export is encrypted, bounded to live rows and removed at the earliest retention end", async () => {
  directory = await mkdtemp(resolve(".local/audit-export-test-"));
  const firstId = randomUUID();
  const secondId = randomUUID();
  auditIds.push(firstId, secondId);
  await db.auditLog.createMany({ data: [
    { id: firstId, eventKey: randomUUID(), actorId: "fixture:operator-a", actorRole: "OPERATOR",
      action: "MFA_OPERATOR_RECOVERY", entityType: "User", entityId: randomUUID(), requestId: randomUUID(),
      createdAt: new Date(cutoff.getTime() + 2 * 60 * 60_000),
      safeChanges: { changedFields: ["status"], before: { status: "ACTIVE", email: "secret@example.test" }, secret: "hidden" } },
    { id: secondId, eventKey: randomUUID(), actorId: "fixture:operator-b", actorRole: "OPERATOR",
      action: "MFA_OPERATOR_RECOVERY", entityType: "User", entityId: randomUUID(), requestId: randomUUID(),
      createdAt: new Date(cutoff.getTime() + 3 * 60 * 60_000) },
  ] });
  await expect(exportAuditRange(db, { from: new Date(cutoff.getTime() - 1), to: now, now, key, directory }))
    .rejects.toThrow("AUDIT_EXPORT_OUTSIDE_RETENTION");
  const from = new Date(cutoff.getTime() + 60_000);
  const to = new Date(cutoff.getTime() + 4 * 60 * 60_000);
  const receipt = await exportAuditRange(db, { from, to, now, key, directory, clock: () => now });
  exportIds.push(receipt.id);
  expect(receipt).toMatchObject({ status: "READY", count: 2,
    expiresAt: new Date(now.getTime() + 2 * 60 * 60_000) });
  const bytes = await readFile(resolve(directory, receipt.artifactName));
  expect(bytes.toString()).not.toContain("fixture:operator-a");
  expect(bytes.toString()).not.toContain("secret@example.test");
  const records = await readAuditExport(db, receipt.id, { now, key, directory });
  expect(records).toHaveLength(2);
  expect(JSON.stringify(records)).not.toContain("secret@example.test");
  expect(JSON.stringify(records)).not.toContain("hidden");
  await expect(readAuditExport(db, receipt.id, { now: new Date(Number.NaN), key, directory }))
    .rejects.toThrow("Invalid audit export clock");
  expect(await sweepExpiredAuditExports(db, { now: new Date(receipt.expiresAt.getTime() - 1), directory })).toBe(0);
  expect(await sweepExpiredAuditExports(db, { now: receipt.expiresAt, directory })).toBe(1);
  await expect(stat(resolve(directory, receipt.artifactName))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readAuditExport(db, receipt.id, { now: receipt.expiresAt, key, directory }))
    .rejects.toThrow("AUDIT_EXPORT_EXPIRED");
  expect((await db.auditOperatorExport.findUniqueOrThrow({ where: { id: receipt.id } })).status).toBe("DELETED");
});

test("failed and interrupted exports never report READY and are swept", async () => {
  const from = new Date(cutoff.getTime() + 60_000);
  const to = new Date(cutoff.getTime() + 4 * 60 * 60_000);
  await expect(exportAuditRange(db, { from, to, now, key, directory, clock: () => now,
    afterWrite: async () => { throw new Error("fixture write interrupted"); } }))
    .rejects.toThrow("fixture write interrupted");
  const failed = await db.auditOperatorExport.findFirstOrThrow({ where: { fromAt: from, toAt: to, status: "FAILED" } });
  exportIds.push(failed.id);
  expect(failed.errorCode).toBe("AUDIT_EXPORT_INCOMPLETE");
  await expect(stat(resolve(directory, failed.artifactName))).rejects.toMatchObject({ code: "ENOENT" });
  const orphanId = randomUUID();
  const orphan = await db.auditOperatorExport.create({ data: { id: orphanId, artifactName: `${orphanId}.bin`,
    fromAt: from, toAt: to, count: 0, expiresAt: new Date(now.getTime() + 60 * 60_000),
    createdAt: new Date(now.getTime() - 6 * 60_000), status: "PENDING" } });
  exportIds.push(orphan.id);
  await writeFile(resolve(directory, orphan.artifactName), randomBytes(64), { mode: 0o600 });
  expect(await sweepExpiredAuditExports(db, { now, directory })).toBe(1);
  expect((await db.auditOperatorExport.findUniqueOrThrow({ where: { id: failed.id } })).status).toBe("FAILED");
  expect(await sweepExpiredAuditExports(db, { now: new Date(now.getTime() + 5 * 60_000), directory })).toBe(1);
  expect((await db.auditOperatorExport.findUniqueOrThrow({ where: { id: orphan.id } })).status).toBe("DELETED");
  await expect(stat(resolve(directory, orphan.artifactName))).rejects.toMatchObject({ code: "ENOENT" });
});
