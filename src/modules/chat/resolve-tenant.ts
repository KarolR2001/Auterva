import type { PrismaClient } from "../../generated/prisma/client";
import type { auth } from "../../lib/auth";

export async function resolveRealtimeTenant(db: PrismaClient, instance: typeof auth, headers: Headers, allowedOrigin: string) {
  if (headers.get("origin") !== allowedOrigin) return null;
  const session = await instance.api.getSession({ headers });
  if (!session) return null;
  const [proof, user] = await Promise.all([
    db.session.findUnique({ where: { id: session.session.id }, select: { mfaVerifiedAt: true } }),
    db.user.findUnique({ where: { id: session.user.id }, select: { organizationId: true, twoFactorEnabled: true } }),
  ]);
  return proof?.mfaVerifiedAt && user?.twoFactorEnabled ? user.organizationId : null;
}
