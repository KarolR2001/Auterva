import "dotenv/config";
import { createPrismaClient } from "../src/lib/prisma";
import { COMPANY_PURGE_TABLES } from "../src/modules/organizations/purge";
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const orgs = await db.organization.findMany({ where: { OR: [{ slug: { startsWith: "purge-" } }, { slug: { startsWith: "purged-" } }] }, select: { id: true } });
for (const { id } of orgs) {
  for (const { table, where } of COMPANY_PURGE_TABLES) await db.$executeRawUnsafe(`DELETE FROM "${table}" WHERE ${where}`, id);
  await db.auditLog.deleteMany({ where: { organizationId: id } });
  await db.organization.delete({ where: { id } });
}
console.log("removed", orgs.length);
await db.$disconnect();
