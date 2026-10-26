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
  // The seeder touches A, B and platform. Validate every identity first.
  await ensureControlledFixtureAccess(db);
}

/** The local access seeder touches A, B and platform; verify all identities first. */
export async function ensureControlledFixtureAccess(db: PrismaClient) {
  const expected = [
    { id: FIXTURE.users[0], email: "admin-a@example.test", role: "ADMIN_FIRMY",
      organizationId: FIXTURE.organizations[0], slug: "fixture-a" },
    { id: FIXTURE.users[1], email: "admin-b@example.test", role: "ADMIN_FIRMY",
      organizationId: FIXTURE.organizations[1], slug: "fixture-b" },
    { id: FIXTURE.users[2], email: "superadmin@example.test", role: "SUPERADMIN_AUTERVA",
      organizationId: null, slug: null },
  ] as const;
  const users = await db.user.findMany({ where: { id: { in: [...FIXTURE.users] } },
    select: { id: true, email: true, role: true, organizationId: true, emailVerified: true,
      disabledAt: true, organization: { select: { slug: true, archivedAt: true,
        firstAdminRegisteredAt: true } } } });
  const byId = new Map(users.map((user) => [user.id, user]));
  for (const identity of expected) {
    const user = byId.get(identity.id);
    if (!user || user.email !== identity.email || user.role !== identity.role
      || user.organizationId !== identity.organizationId || !user.emailVerified || user.disabledAt
      || (identity.slug === null ? user.organization !== null
        : user.organization?.slug !== identity.slug || user.organization.archivedAt
          || !user.organization.firstAdminRegisteredAt)) {
      throw new Error("Fixture identity mismatch");
    }
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try { await seedLocalAccess(client, { ...process.env, AUTERVA_FIXTURE: "1" }); }
  finally { await client.end(); }
  for (const identity of expected) {
    const [user, credentials, factors] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: identity.id }, select: { twoFactorEnabled: true } }),
      db.account.count({ where: { userId: identity.id, providerId: "credential", password: { not: null } } }),
      db.twoFactor.count({ where: { userId: identity.id } }),
    ]);
    if (!user.twoFactorEnabled || credentials !== 1 || factors !== 1) throw new Error("Fixture access incomplete");
  }
  return db.user.findUniqueOrThrow({ where: { id: FIXTURE.users[2] } });
}
