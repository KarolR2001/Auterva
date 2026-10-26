import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";
import { getWorkerMailContext } from "../modules/jobs/config";
import { runWorkerLoop } from "../modules/jobs/runner";

getServerEnv();
const context = getWorkerMailContext();
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());

try {
  await prisma.$queryRaw`SELECT 1`;
  process.stdout.write("Worker ready\n");
  await runWorkerLoop({ db: prisma, context, signal: controller.signal });
} finally {
  await prisma.$disconnect();
}
