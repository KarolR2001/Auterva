import type { PrismaClient } from "../../generated/prisma/client";

export async function getVehicleForTenant(db: PrismaClient, organizationId: string, id: string) {
  return db.vehicle.findUnique({ where: { organizationId_id: { organizationId, id } } });
}
