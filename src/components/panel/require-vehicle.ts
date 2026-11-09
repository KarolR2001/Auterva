import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

/**
 * Server check for a page about one vehicle (#284, #289): the vehicle must belong to the company the actor is already
 * authorized for. The query is narrowed to that company, so a foreign and a missing vehicle are indistinguishable: both
 * are the same neutral 404 (never a 200 with a message). Call it only after the actor and the company were verified.
 */
export async function requireVehicleInCompany(organizationId: string, vehicleId: string): Promise<void> {
  const found = await prisma.vehicle.findFirst({ where: { id: vehicleId, organizationId }, select: { id: true } });
  if (!found) notFound();
}
