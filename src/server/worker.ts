import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { getWorkerMailContext } from "../modules/jobs/config";
import { runWorkerLoop } from "../modules/jobs/runner";
import { log } from "../modules/observability/log";
import { initProcessObservability } from "../modules/observability/process";

getServerEnv();
const context = getWorkerMailContext();
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
const ops = await initProcessObservability("worker", { db: prisma });

try {
  await prisma.$queryRaw`SELECT 1`;
  log.info("Worker ready", { operation: "worker.start", outcome: "success" });
  await runWorkerLoop({ db: prisma, context, signal: controller.signal });
} finally {
  await ops.close();
  await prisma.$disconnect();
}
