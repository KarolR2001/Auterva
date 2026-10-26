import { resolve } from "node:path";
import { createPrismaClient } from "../../src/lib/prisma";
import { runAuditRetentionLoop } from "../../src/modules/audit/retention-runner";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const controller = new AbortController();
process.once("SIGTERM", () => controller.abort());
process.once("SIGINT", () => controller.abort());
const hold = process.env.TEST_HOLD === "after_claim";

try {
  process.send?.({ event: "ready" });
  await runAuditRetentionLoop({ db, signal: controller.signal, directory: resolve(".local/audit-retention-process-test"),
    leaseMs: 1_000, pollMs: 100, afterClaim: async (claim) => {
      process.send?.({ event: "claimed", id: claim.id });
      if (hold) await new Promise<void>(() => {});
    } });
} finally {
  await db.$disconnect();
}
