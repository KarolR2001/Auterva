import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PrismaClient } from "../../src/generated/prisma/client";

type Scope = { organizationId: string; email: string; host: string };

function identifier(scope: Scope) {
  return `fixture-invite:${scope.organizationId}:${scope.email.toLowerCase()}:${scope.host.toLowerCase()}`;
}
function digest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function issueFixtureInvitation(db: PrismaClient, scope: Scope, now: Date, resend = false) {
  const key = identifier(scope);
  if (resend) await db.verification.deleteMany({ where: { identifier: key } });
  const token = randomBytes(32).toString("base64url");
  await db.verification.create({ data: { id: randomUUID(), identifier: key, value: digest(token), expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) } });
  return token;
}

export async function inspectFixtureInvitation(db: PrismaClient, scope: Scope, token: string, now: Date) {
  return db.verification.findFirst({ where: { identifier: identifier(scope), value: digest(token), expiresAt: { gt: now } }, select: { id: true } });
}

export async function consumeFixtureInvitation(db: PrismaClient, scope: Scope, token: string, now: Date) {
  const result = await db.verification.deleteMany({ where: { identifier: identifier(scope), value: digest(token), expiresAt: { gt: now } } });
  return result.count === 1;
}
