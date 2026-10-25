import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { FIXTURE } from "../../scripts/fixture-ids";
import { seedLocalAccess } from "../../scripts/seed-local-access";
import type { PrismaClient } from "../../src/generated/prisma/client";

// A test-only session for an existing account. It never changes that account's
// credentials, MFA factor or role, so seeded superadmin access is preserved.
export async function verifiedFixtureSession(db: PrismaClient, userId: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required for fixture sessions");
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.session.create({ data: {
    id, userId, token, expiresAt: new Date(Date.now() + 60 * 60_000), mfaVerifiedAt: new Date(),
  } });
  const signature = createHmac("sha256", secret).update(token).digest("base64");
  return { cookie: `better-auth.session_token=${token}.${signature}`, dispose: () => db.session.deleteMany({ where: { id } }) };
}

export async function ensureControlledSuperadminMfa(db: PrismaClient, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: {
    role: true, emailVerified: true, disabledAt: true, twoFactorEnabled: true,
  } });
  if (user?.role !== "SUPERADMIN_AUTERVA" || !user.emailVerified || user.disabledAt) {
    throw new Error("Existing superadmin is not an active fixture");
  }
  if (user.twoFactorEnabled) return;
  if (userId !== FIXTURE.users[2]) throw new Error("Refusing to change a non-fixture superadmin");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    // The #9 integration suite resets its own users between tests. Re-enroll
    // only that exact local fixture through its existing guarded setup path.
    await seedLocalAccess(client, { ...process.env, AUTERVA_FIXTURE: "1" });
  } finally {
    await client.end();
  }
  if (!(await db.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true } }))?.twoFactorEnabled) {
    throw new Error("Controlled superadmin MFA enrollment failed");
  }
}
