import { prisma } from "@/lib/prisma";
import { createMediaStorage } from "@/modules/media/storage";
import { runMediaWorkerLoop } from "@/modules/media/worker";
import { log } from "@/modules/observability/log";
import { initProcessObservability } from "@/modules/observability/process";

const storage = createMediaStorage();
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const ops = await initProcessObservability("media-worker", { db: prisma });
try {
  await prisma.$queryRaw`SELECT 1`;
  log.info("Media worker ready", { operation: "media-worker.start", outcome: "success" });
  await runMediaWorkerLoop(prisma, storage, controller.signal);
} finally {
  await ops.close();
  storage.client.destroy();
  await prisma.$disconnect();
}
