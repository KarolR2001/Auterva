import type { PrismaClient } from "../../generated/prisma/client";
import type { auth } from "../../lib/auth";
import { getServerEnv } from "../../lib/env";

export type AuthHost = { area: "PLATFORM" | "COMPANY_ADMIN"; organizationId: string | null };

export async function resolveAuthHost(db: PrismaClient, host: string | null, requestUrl: string): Promise<AuthHost | null> {
  if (!host || !/^[a-z0-9.-]+(?::[0-9]{1,5})?$/i.test(host)) return null;
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  const configured = new URL(getServerEnv().BETTER_AUTH_URL);
  // Next's local server presents localhost internally although the loopback
  // listener receives Host: 127.0.0.1. #13 replaces this narrow local case
  // with a verified ingress adapter for real multi-host routing.
  const localNextAlias = configured.hostname === "127.0.0.1" && url.hostname === "localhost"
    && url.port === configured.port && host.toLowerCase() === configured.host.toLowerCase();
  if (url.host.toLowerCase() !== host.toLowerCase() && !localNextAlias) return null;
  const hostname = localNextAlias ? configured.hostname : url.hostname;
  const mapping = await db.hostMapping.findFirst({
    where: { hostname: { equals: hostname, mode: "insensitive" }, status: "ACTIVE" },
    select: { area: true, organizationId: true },
  });
  if (mapping?.area === "PLATFORM" && mapping.organizationId === null) return { area: "PLATFORM", organizationId: null };
  if (mapping?.area === "COMPANY_ADMIN" && mapping.organizationId !== null) return { area: "COMPANY_ADMIN", organizationId: mapping.organizationId };
  return null;
}

export async function requireScopedActor(db: PrismaClient, instance: typeof auth, headers: Headers, scope: AuthHost): Promise<{ userId: string; sessionId: string; organizationId: string | null; role: string; twoFactorEnabled: boolean } | null> {
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
  return { userId: session.user.id, sessionId: session.session.id, organizationId: user.organizationId, role: user.role, twoFactorEnabled: user.twoFactorEnabled === true };
}

export async function requireAuthorizedActor(db: PrismaClient, instance: typeof auth, headers: Headers, scope: AuthHost): Promise<{ userId: string; sessionId: string; organizationId: string | null; role: string } | null> {
  const actor = await requireScopedActor(db, instance, headers, scope);
  if (!actor?.twoFactorEnabled) return null;
  const proof = await db.session.findUnique({ where: { id: actor.sessionId }, select: { userId: true, mfaVerifiedAt: true } });
  if (!proof?.mfaVerifiedAt || proof.userId !== actor.userId) return null;
  return { userId: actor.userId, sessionId: actor.sessionId, organizationId: actor.organizationId, role: actor.role };
}
