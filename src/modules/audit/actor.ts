import type { Prisma } from "@/generated/prisma/client";

export async function requireAuditActor(tx: Prisma.TransactionClient, actorId: string, sessionId: string) {
  const session = await tx.session.findFirst({
    where: { id: sessionId, userId: actorId, expiresAt: { gt: new Date() }, mfaVerifiedAt: { not: null } },
    select: { user: { select: { role: true, organizationId: true, disabledAt: true, emailVerified: true,
      twoFactorEnabled: true, organization: { select: { archivedAt: true } } } } },
  });
  const actor = session?.user;
  if (!actor || !actor.emailVerified || !actor.twoFactorEnabled || actor.disabledAt
    || actor.organization?.archivedAt || (actor.role !== "ADMIN_FIRMY" && actor.role !== "SUPERADMIN_AUTERVA")
    || (actor.role === "SUPERADMIN_AUTERVA" && actor.organizationId !== null)) {
    throw new Error("Audit actor is not authorized");
  }
  return { ...actor, role: actor.role as "ADMIN_FIRMY" | "SUPERADMIN_AUTERVA" };
}

export function requireAuditScope(actor: Awaited<ReturnType<typeof requireAuditActor>>, organizationId: string | null) {
  if (actor.role === "ADMIN_FIRMY" && (!actor.organizationId || actor.organizationId !== organizationId)) {
    throw new Error("Audit tenant mismatch");
  }
}
