import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
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

test("sweep cannot remove an export that becomes READY after candidate selection", async () => {
  const ownDirectory = await mkdtemp(resolve(".local/audit-export-race-"));
  let releaseWriter!: () => void;
  let writerReached!: () => void;
  const writerReady = new Promise<void>((resolveReady) => { writerReached = resolveReady; });
  const writerGate = new Promise<void>((resolveGate) => { releaseWriter = resolveGate; });
  let releaseSweep!: () => void;
  let sweepReached!: () => void;
  const sweepReady = new Promise<void>((resolveReady) => { sweepReached = resolveReady; });
  const sweepGate = new Promise<void>((resolveGate) => { releaseSweep = resolveGate; });
  try {
    const writer = exportAuditRange(db, { from: new Date(cutoff.getTime() + 60_000),
      to: new Date(cutoff.getTime() + 4 * 60 * 60_000), now, key, directory: ownDirectory,
      clock: () => now, afterWrite: async () => { writerReached(); await writerGate; } });
    await writerReady;
    const pending = await db.auditOperatorExport.findFirstOrThrow({ where: { status: "PENDING",
      fromAt: new Date(cutoff.getTime() + 60_000) }, orderBy: { createdAt: "desc" } });
    exportIds.push(pending.id);
    await db.auditOperatorExport.update({ where: { id: pending.id },
      data: { createdAt: new Date(now.getTime() - 6 * 60_000) } });
    const sweep = sweepExpiredAuditExports(db, { now, directory: ownDirectory,
      afterCandidatesRead: async () => { sweepReached(); await sweepGate; } });
    await sweepReady;
    releaseWriter();
    const receipt = await writer;
    expect(receipt.status).toBe("READY");
    releaseSweep();
    expect(await sweep).toBe(0);
    expect(await readAuditExport(db, receipt.id, { now, key, directory: ownDirectory })).toBeInstanceOf(Array);
  } finally {
    releaseWriter?.(); releaseSweep?.();
    await rm(ownDirectory, { recursive: true, force: true });
  }
});

test("later sweep removes bytes written after a receipt was deleted", async () => {
  const ownDirectory = await mkdtemp(resolve(".local/audit-export-late-"));
  const id = randomUUID();
  exportIds.push(id);
  try {
    await db.auditOperatorExport.create({ data: { id, artifactName: `${id}.bin`,
      fromAt: new Date(cutoff.getTime() + 60_000), toAt: now, count: 0,
      expiresAt: new Date(now.getTime() + 60_000),
      createdAt: new Date(now.getTime() - 6 * 60_000), status: "PENDING" } });
    expect(await sweepExpiredAuditExports(db, { now, directory: ownDirectory })).toBe(1);
    const artifact = resolve(ownDirectory, `${id}.bin`);
    await writeFile(artifact, randomBytes(32), { mode: 0o600 });
    expect(await sweepExpiredAuditExports(db, { now, directory: ownDirectory })).toBe(0);
    await expect(stat(artifact)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(ownDirectory, { recursive: true, force: true });
  }
});

function waitExportMessage(child: ChildProcess, event: string): Promise<{ id: string }> {
  return new Promise((resolveMessage, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error(`Exporter did not report ${event}`)); }, 5_000);
    const onMessage = (message: unknown) => {
      const value = message as { event?: string; id?: string };
      if (value.event === event && value.id) { cleanup(); resolveMessage({ id: value.id }); }
    };
    const onClose = () => { cleanup(); reject(new Error(`Exporter closed before ${event}`)); };
    const cleanup = () => { clearTimeout(timeout); child.off("message", onMessage); child.off("close", onClose); };
    child.on("message", onMessage);
    child.on("close", onClose);
  });
}

test("SIGKILL after a late write leaves no READY receipt and next sweep removes the orphan", async () => {
  const ownDirectory = await mkdtemp(resolve(".local/audit-export-process-"));
  const child = spawn(process.execPath, ["--import", "tsx", "tests/fixtures/audit-export-process.ts"], {
    cwd: process.cwd(), env: { ...process.env, TEST_EXPORT_DIRECTORY: ownDirectory },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  try {
    const { id } = await waitExportMessage(child, "pending");
    exportIds.push(id);
    const sweptAt = new Date(now.getTime() + 6 * 60_000);
    expect(await sweepExpiredAuditExports(db, { now: sweptAt, directory: ownDirectory })).toBe(1);
    const written = waitExportMessage(child, "written");
    child.send("write");
    expect((await written).id).toBe(id);
    child.kill("SIGKILL");
    await once(child, "close");
    expect((await db.auditOperatorExport.findUniqueOrThrow({ where: { id } })).status).toBe("DELETED");
    const artifact = resolve(ownDirectory, `${id}.bin`);
    expect((await stat(artifact)).size).toBeGreaterThan(0);
    expect(await sweepExpiredAuditExports(db, { now: sweptAt, directory: ownDirectory })).toBe(0);
    await expect(stat(artifact)).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    child.kill("SIGKILL");
    await rm(ownDirectory, { recursive: true, force: true });
  }
}, 15_000);
