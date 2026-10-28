import type { PrismaClient } from "@/generated/prisma/client";
import { initProcessObservability } from "@/modules/observability/process";
import { runAuditRetentionLoop } from "./retention-runner";

/**
 * The audit maintenance worker process body (#108), shared by `scripts/audit-retention.ts worker` and the test
 * fixture: signal handling, the OPS listener (heartbeat, sweep failures; #58) and the loop itself.
 */
export async function runAuditWorkerProcess(db: PrismaClient, directory: string): Promise<void> {
  const controller = new AbortController();
  process.once("SIGINT", () => controller.abort());
  process.once("SIGTERM", () => controller.abort());
  await db.$queryRaw`SELECT 1`;
  const ops = await initProcessObservability("audit-worker", { db });
  process.stdout.write("Audit maintenance worker ready\n");
  try { await runAuditRetentionLoop({ db, signal: controller.signal, directory }); } finally { await ops.close(); }
}
