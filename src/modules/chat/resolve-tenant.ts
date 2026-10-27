import type { PrismaClient } from "../../generated/prisma/client";
import type { auth } from "../../lib/auth";
import { requireAuthorizedActor } from "../auth/authorization";
import { resolveHostMapping } from "../tenancy/host-registry";
import type { ChatRole } from "./signal";

/** Who is connected and for which company: the superadmin acts as themselves in the chosen company's context. */
export type RealtimePrincipal = { actorId: string; sessionId: string; role: ChatRole; organizationId: string };

/** The superadmin's platform-wide inbox channel: no company, only the platform session. */
export type PlatformPrincipal = { actorId: string; sessionId: string; role: "SUPERADMIN_AUTERVA" };

export type RealtimeAuthority = {
  /** Handshake of the platform channel: Origin of the PLATFORM host, session with MFA, a real superadmin. Null refuses. */
  authorizePlatform(headers: Headers): Promise<PlatformPrincipal | null>;
  /** Same verdicts as `revalidate`, for platform connections. */
  revalidatePlatform(principals: readonly PlatformPrincipal[]): Promise<boolean[]>;
  /** Handshake: Origin from the registry, session with MFA, role, company and account state. Null refuses. */
  authorize(headers: Headers, organizationId: string): Promise<RealtimePrincipal | null>;
  /** One answer per principal, in order: does the session and account still allow this connection? */
  revalidate(principals: readonly RealtimePrincipal[]): Promise<boolean[]>;
};

function parseOrigin(supplied: string | null): URL | null {
  if (!supplied) return null;
  let origin: URL;
  try { origin = new URL(supplied); } catch { return null; }
  if (origin.origin !== supplied || !["http:", "https:"].includes(origin.protocol)
    || (process.env.NODE_ENV === "production" && origin.protocol !== "https:")) return null;
  return origin;
}

export function createRealtimeAuthority(db: PrismaClient, instance: typeof auth): RealtimeAuthority {
  const sessionVerdicts = async (principals: readonly { actorId: string; sessionId: string; role: ChatRole;
    organizationId: string | null }[]) => {
    if (principals.length === 0) return [];
    const sessions = await db.session.findMany({
      where: { id: { in: [...new Set(principals.map((p) => p.sessionId))] }, expiresAt: { gt: new Date() }, mfaVerifiedAt: { not: null } },
      select: { id: true, userId: true, user: { select: { role: true, organizationId: true, disabledAt: true, emailVerified: true,
        twoFactorEnabled: true, organization: { select: { archivedAt: true } } } } },
    });
    const bySession = new Map(sessions.map((session) => [session.id, session]));
    const companyIds = [...new Set(principals.flatMap((p) => (p.role === "SUPERADMIN_AUTERVA" && p.organizationId ? [p.organizationId] : [])))];
    const companies = new Set((await db.organization.findMany({ where: { id: { in: companyIds } }, select: { id: true } }))
      .map((company) => company.id));
    // Expiry of the service period is deliberately not consulted: chat outlives it. Archive, logout, revocation,
    // a disabled account or lost MFA all end the connection.
    return principals.map((principal) => {
      const session = bySession.get(principal.sessionId);
      const user = session?.user;
      if (!session || session.userId !== principal.actorId || !user || user.disabledAt || !user.emailVerified
        || !user.twoFactorEnabled || user.role !== principal.role) return false;
      if (principal.role === "ADMIN_FIRMY") {
        return user.organizationId === principal.organizationId && !user.organization?.archivedAt;
      }
      return user.organizationId === null && (principal.organizationId === null || companies.has(principal.organizationId));
    });
  };

  return {
    async authorizePlatform(headers) {
      const origin = parseOrigin(headers.get("origin"));
      if (!origin) return null;
      const mapping = await resolveHostMapping(db, origin.host);
      if (mapping?.area !== "PLATFORM" || mapping.organizationId !== null) return null;
      const actor = await requireAuthorizedActor(db, instance, headers, { area: "PLATFORM", organizationId: null });
      return actor?.role === "SUPERADMIN_AUTERVA" && actor.organizationId === null
        ? { actorId: actor.userId, sessionId: actor.sessionId, role: "SUPERADMIN_AUTERVA" } : null;
    },

    revalidatePlatform: (principals) => sessionVerdicts(principals.map((p) => ({ ...p, organizationId: null }))),

    async authorize(headers, organizationId) {
      const origin = parseOrigin(headers.get("origin"));
      if (!origin) return null;
      const mapping = await resolveHostMapping(db, origin.host);
      if (mapping?.area === "COMPANY_ADMIN" && mapping.organizationId === organizationId) {
        const actor = await requireAuthorizedActor(db, instance, headers, { area: "COMPANY_ADMIN", organizationId });
        return actor?.role === "ADMIN_FIRMY" && actor.organizationId === organizationId
          ? { actorId: actor.userId, sessionId: actor.sessionId, role: "ADMIN_FIRMY", organizationId } : null;
      }
      if (mapping?.area === "PLATFORM" && mapping.organizationId === null) {
        const actor = await requireAuthorizedActor(db, instance, headers, { area: "PLATFORM", organizationId: null });
        if (actor?.role !== "SUPERADMIN_AUTERVA" || actor.organizationId !== null) return null;
        const company = await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
        return company ? { actorId: actor.userId, sessionId: actor.sessionId, role: "SUPERADMIN_AUTERVA", organizationId } : null;
      }
      return null;
    },

    revalidate: (principals) => sessionVerdicts(principals),
  };
}
