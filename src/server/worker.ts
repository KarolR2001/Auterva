import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { productionDomainDeps } from "../modules/domains/config";
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
  const domains = productionDomainDeps();
  // Without the platform CNAME target no ACTIVE domain can be judged; the loop skips the periodic checks (#417).
  if (!domains.config.cnameTarget)
    log.warn("Periodic domain checks disabled: AUTERVA_CUSTOM_DOMAIN_CNAME_TARGET is not set",
      { operation: "domains.recheck", outcome: "skipped" });
  await runWorkerLoop({ db: prisma, context, signal: controller.signal, domains });
} finally {
  await ops.close();
  await prisma.$disconnect();
}
