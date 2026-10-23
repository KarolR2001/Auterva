import type { PrismaClient } from "../../generated/prisma/client";
import type { auth } from "../../lib/auth";

export async function resolveRealtimeTenant(db: PrismaClient, instance: typeof auth, headers: Headers, allowedOrigin: string, expectedHost: string) {
  if (headers.get("origin") !== allowedOrigin || headers.get("host") !== expectedHost) return null;
  const session = await instance.api.getSession({ headers });
  if (!session) return null;
  const [proof, user] = await Promise.all([
    db.session.findUnique({ where: { id: session.session.id }, select: { userId: true, mfaVerifiedAt: true } }),
    db.user.findUnique({ where: { id: session.user.id }, select: {
      organizationId: true, role: true, disabledAt: true, emailVerified: true, twoFactorEnabled: true,
      organization: { select: { archivedAt: true } },
    } }),
  ]);
  return proof?.userId === session.user.id && proof.mfaVerifiedAt && user?.role === "ADMIN_FIRMY"
    && user.organizationId && user.emailVerified && !user.disabledAt && !user.organization?.archivedAt
    && user.twoFactorEnabled ? user.organizationId : null;
}
