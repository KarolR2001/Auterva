import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";

/** CLI-only recovery: the operator is a distinct real actor, never the target admin. */
export async function appendOperatorRecoveryAudit(tx: Prisma.TransactionClient, input: {
  operatorId: string; targetUserId: string; organizationId: string | null;
  evidenceReference: string; revokedSessions: number; restoreUnlock?: boolean;
}) {
  if (!/^[a-zA-Z0-9._-]{3,80}$/.test(input.operatorId)
    || !/^[a-zA-Z0-9._:/-]{3,128}$/.test(input.evidenceReference)
    || !Number.isSafeInteger(input.revokedSessions) || input.revokedSessions < 0) throw new Error("Invalid operator audit");
  const target = await tx.user.findUnique({ where: { id: input.targetUserId }, select: { role: true, organizationId: true } });
  if (!target || (target.role !== "ADMIN_FIRMY" && target.role !== "SUPERADMIN_AUTERVA")
    || target.organizationId !== input.organizationId) throw new Error("Invalid recovery target");
  return tx.auditLog.create({ data: {
    eventKey: randomUUID(), actorId: `operator:${input.operatorId}`, actorRole: "OPERATOR",
    organizationId: input.organizationId, action: "MFA_OPERATOR_RECOVERY", entityType: "User",
    entityId: input.targetUserId, requestId: randomUUID(),
    safeChanges: { evidenceDigest: createHash("sha256").update(input.evidenceReference).digest("hex"),
      identityConfirmed: true, revokedSessions: input.revokedSessions, next: "totp-enrollment",
      ...(input.restoreUnlock ? { restoreUnlock: true } : {}) },
  } });
}
