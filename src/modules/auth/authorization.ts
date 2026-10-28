import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import type { auth } from "../../lib/auth";
import { bindLogActor, ensureLogContext } from "../observability/log";
import { resolveHostMapping } from "../tenancy/host-registry";

export type AuthHost = { area: "PLATFORM" | "COMPANY_ADMIN"; organizationId: string | null };

export async function resolveAuthHost(db: PrismaClient, authority: string | null): Promise<AuthHost | null> {
  const mapping = authority ? await resolveHostMapping(db, authority) : null;
  if (mapping?.area === "PLATFORM" || mapping?.area === "COMPANY_ADMIN") {
    return { area: mapping.area, organizationId: mapping.organizationId };
  }
  return null;
}

export async function requireScopedActor(db: PrismaClient | Prisma.TransactionClient, instance: typeof auth, headers: Headers, scope: AuthHost): Promise<{ userId: string; sessionId: string; organizationId: string | null; role: string; twoFactorEnabled: boolean } | null> {
  const logContext = ensureLogContext(); // synchronous prefix: see ensureLogContext
  const session = await instance.api.getSession({ headers });
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.user.id }, select: {
    role: true, organizationId: true, twoFactorEnabled: true, disabledAt: true, emailVerified: true,
    organization: { select: { archivedAt: true } },
  } });
  if (!user || !user.emailVerified || user.disabledAt) return null;
  if (scope.area === "PLATFORM") {
    if (user.role !== "SUPERADMIN_AUTERVA" || user.organizationId !== null) return null;
  } else if (user.role !== "ADMIN_FIRMY" || user.organizationId !== scope.organizationId || user.organization?.archivedAt) {
    return null;
  }
  bindLogActor(logContext, { userId: session.user.id, role: user.role, organizationId: user.organizationId ?? scope.organizationId });
  return { userId: session.user.id, sessionId: session.session.id, organizationId: user.organizationId, role: user.role, twoFactorEnabled: user.twoFactorEnabled === true };
}

export async function requireAuthorizedActor(db: PrismaClient | Prisma.TransactionClient, instance: typeof auth, headers: Headers, scope: AuthHost): Promise<{ userId: string; sessionId: string; organizationId: string | null; role: string } | null> {
  const actor = await requireScopedActor(db, instance, headers, scope);
  if (!actor?.twoFactorEnabled) return null;
  const proof = await db.session.findUnique({ where: { id: actor.sessionId }, select: { userId: true, mfaVerifiedAt: true } });
  if (!proof?.mfaVerifiedAt || proof.userId !== actor.userId) return null;
  return { userId: actor.userId, sessionId: actor.sessionId, organizationId: actor.organizationId, role: actor.role };
}
