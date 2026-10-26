import { createPrismaClient } from "../../src/lib/prisma";
import { exportAuditRange } from "../../src/modules/audit/operator-export";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const now = new Date("2026-10-26T12:00:00.000Z");
const cutoff = new Date(now.getTime() - 365 * 86_400_000);

void exportAuditRange(db, { from: new Date(cutoff.getTime() + 60_000),
  to: new Date(cutoff.getTime() + 4 * 60 * 60_000), now,
  key: Buffer.alloc(32, 7), directory: process.env.TEST_EXPORT_DIRECTORY ?? "",
  clock: () => now,
  beforeWrite: async (id) => {
    process.send?.({ event: "pending", id });
    await new Promise<void>((resolve) => {
      process.on("message", (message) => { if (message === "write") resolve(); });
    });
  },
  afterWrite: async (id) => {
    process.send?.({ event: "written", id });
    await new Promise<void>(() => {});
  },
}).finally(async () => { await db.$disconnect(); });
