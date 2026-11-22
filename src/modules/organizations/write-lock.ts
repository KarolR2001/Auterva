import type { Prisma } from "@/generated/prisma/client";

type LockActor = { role: "ADMIN_FIRMY" | "SUPERADMIN_AUTERVA" };

/**
 * D-23 (#151): the single place where a company write takes the Organization row lock. FOR UPDATE and
 * FOR NO KEY UPDATE both conflict with the lock of archive/restore (FOR NO KEY UPDATE), so a write and a state
 * change of one company never interleave. A superadmin may write into an archived company; the company
 * administrator never may (his sessions are revoked, and this check denies him again under the lock).
 * Returns null for a missing or purged company (#419) or an archived one seen by a non-superadmin.
 */
export async function lockCompanyForWrite(tx: Prisma.TransactionClient, actor: LockActor,
  organizationId: string, mode: "UPDATE" | "NO_KEY_UPDATE"): Promise<{ archived: boolean } | null> {
  const rows = mode === "UPDATE"
    ? await tx.$queryRaw<{ archivedAt: Date | null; purgeStartedAt: Date | null }[]>`
        SELECT "archivedAt", "purgeStartedAt" FROM "Organization" WHERE id = ${organizationId}::uuid FOR UPDATE`
    : await tx.$queryRaw<{ archivedAt: Date | null; purgeStartedAt: Date | null }[]>`
        SELECT "archivedAt", "purgeStartedAt" FROM "Organization" WHERE id = ${organizationId}::uuid FOR NO KEY UPDATE`;
  // #419 (D-58): a company whose purge started is gone for every writer, the superadmin included.
  if (rows.length !== 1 || rows[0].purgeStartedAt !== null) return null;
  const archived = rows[0].archivedAt !== null;
  if (archived && actor.role !== "SUPERADMIN_AUTERVA") return null;
  return { archived };
}
