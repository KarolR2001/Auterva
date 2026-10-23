import { getServerEnv } from "../lib/env";
import { prisma } from "../lib/prisma";

getServerEnv();
await prisma.$queryRaw`SELECT 1`;
process.stdout.write("Worker entrypoint ready; business handlers are not installed yet\n");

await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});
await prisma.$disconnect();
