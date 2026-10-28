import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
import { assertLocalFixtureTarget } from "./fixture-safety";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

// This entrypoint is the local, operator-only adapter. #58/#60 must provide
// approved production storage/credentials before it can run on real data.
if (process.env.NODE_ENV === "production") throw new Error("AUDIT_EXPORT_PROVIDER_NOT_CONFIGURED");
const connectionString = assertLocalFixtureTarget(process.env);
const { createPrismaClient } = await import("../src/lib/prisma");
const { exportAuditRange, readAuditExport, sweepExpiredAuditExports } = await import("../src/modules/audit/operator-export");
const db = createPrismaClient(connectionString);
const directory = resolve(".local/audit-exports");
const command = process.argv[2];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function utcDate(value: string | undefined): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) throw new Error("Expected UTC ISO instant");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error("Invalid UTC instant");
  return parsed;
}

function exportKey(): Buffer {
  const value = process.env.AUDIT_EXPORT_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error("AUDIT_EXPORT_KEY must be 32 bytes in hex");
  return Buffer.from(value, "hex");
}

try {
  if (command === "worker") {
    const { runAuditWorkerProcess } = await import("../src/modules/audit/retention-worker");
    await runAuditWorkerProcess(db, directory);
  } else if (command === "export") {
    const receipt = await exportAuditRange(db, { from: utcDate(process.argv[3]), to: utcDate(process.argv[4]),
      now: new Date(), key: exportKey(), directory });
    process.stdout.write(JSON.stringify({ id: receipt.id, count: receipt.count,
      expiresAt: receipt.expiresAt, artifactName: receipt.artifactName }) + "\n");
  } else if (command === "verify") {
    const id = process.argv[3];
    if (!id || !uuid.test(id)) throw new Error("Expected export ID");
    const records = await readAuditExport(db, id, { now: new Date(), key: exportKey(), directory });
    process.stdout.write(JSON.stringify({ id, verifiedCount: records.length }) + "\n");
  } else if (command === "sweep") {
    const deleted = await sweepExpiredAuditExports(db, { now: new Date(), directory });
    process.stdout.write(JSON.stringify({ deleted }) + "\n");
  } else if (command === "retry") {
    const id = process.argv[3];
    if (!id || !uuid.test(id)) throw new Error("Expected job ID");
    const changed = await db.job.updateMany({ where: { id, kind: "AUDIT_RETENTION", status: "FAILED" },
      data: { status: "PENDING", attempts: 0, errorCode: null, runAt: new Date() } });
    if (changed.count !== 1) throw new Error("AUDIT_RETENTION_RETRY_NOT_ALLOWED");
    process.stdout.write(JSON.stringify({ id, status: "PENDING" }) + "\n");
  } else if (command === "status") {
    const jobs = await db.job.findMany({ where: { kind: "AUDIT_RETENTION" },
      orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, status: true, attempts: true, runAt: true, completedAt: true, errorCode: true } });
    const exports = await db.auditOperatorExport.findMany({ orderBy: { createdAt: "desc" }, take: 10,
      select: { id: true, status: true, count: true, fromAt: true, toAt: true, expiresAt: true,
        digest: true, errorCode: true } });
    process.stdout.write(JSON.stringify({ jobs, exports }) + "\n");
  } else {
    throw new Error("Use worker|export <fromUTC> <toUTC>|verify <id>|sweep|retry <jobId>|status");
  }
} finally {
  await db.$disconnect();
}
