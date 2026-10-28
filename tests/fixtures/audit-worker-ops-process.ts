import { createPrismaClient } from "../../src/lib/prisma";
import { runAuditWorkerProcess } from "../../src/modules/audit/retention-worker";

// Test fixture: the real worker process body on a caller-chosen (isolated) database and export directory.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const directory = process.env.AUDIT_EXPORT_DIR ?? "";
if (!directory) throw new Error("AUDIT_EXPORT_DIR is required");
try { await runAuditWorkerProcess(db, directory); } finally { await db.$disconnect(); }
