import { prisma } from "@/lib/prisma";
import { createMediaStorage } from "@/modules/media/storage";
import { runMediaWorkerLoop } from "@/modules/media/worker";

const storage = createMediaStorage();
const controller = new AbortController();
process.once("SIGINT", () => controller.abort());
process.once("SIGTERM", () => controller.abort());
try {
  await prisma.$queryRaw`SELECT 1`;
  process.stdout.write("Media worker ready\n");
  await runMediaWorkerLoop(prisma, storage, controller.signal);
} finally {
  storage.client.destroy();
  await prisma.$disconnect();
}
