import type { Prisma } from "@/generated/prisma/client";

type LockActor = { role: "ADMIN_FIRMY" | "SUPERADMIN_AUTERVA" };

/**
 * D-23 (#151): the single place where a company write takes the Organization row lock. FOR UPDATE and
 * FOR NO KEY UPDATE both conflict with the lock of archive/restore (FOR NO KEY UPDATE), so a write and a state
 * change of one company never interleave. A superadmin may write into an archived company; the company
 * administrator never may (his sessions are revoked, and this check denies him again under the lock).
 * Returns null for a missing company or an archived one seen by a non-superadmin.
 */
export async function lockCompanyForWrite(tx: Prisma.TransactionClient, actor: LockActor,
  organizationId: string, mode: "UPDATE" | "NO_KEY_UPDATE"): Promise<{ archived: boolean } | null> {
  const rows = mode === "UPDATE"
    ? await tx.$queryRaw<{ archivedAt: Date | null }[]>`
        SELECT "archivedAt" FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`
    : await tx.$queryRaw<{ archivedAt: Date | null }[]>`
        SELECT "archivedAt" FROM "Organization" WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`;
  if (rows.length !== 1) return null;
  const archived = rows[0].archivedAt !== null;
  if (archived && actor.role !== "SUPERADMIN_AUTERVA") return null;
  return { archived };
}
