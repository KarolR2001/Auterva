import { createHmac, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { POST } from "../../src/app/api/auth/[...all]/route";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const userId = randomUUID();
const hostname = `change-limit-${organizationId}.example.test`;
const email = `change-limit-${userId}@example.test`;
const sourceIp = "10.233.14.53";
const currentPassword = "Current fixture password 9384!";
let cookie = "";
let disposeSession = async () => {};

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `change-limit-${organizationId}` } });
  await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
  await db.user.create({ data: { id: userId, name: "Change limit fixture", email,
    emailVerified: true, role: "ADMIN_FIRMY", organizationId, twoFactorEnabled: true } });
  await db.account.create({ data: { id: randomUUID(), userId, accountId: userId,
    providerId: "credential", password: await hashPassword(currentPassword) } });
  const session = await verifiedFixtureSession(db, userId);
  cookie = session.cookie.replace("better-auth.session_token", "__Secure-better-auth.session_token");
  disposeSession = async () => { await session.dispose(); };
});

afterAll(async () => {
  const secret = getServerEnv().BETTER_AUTH_SECRET;
  const keys = [`auth:account:${email}`, `auth:ip:${sourceIp}`]
    .map((key) => createHmac("sha256", secret).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
  await disposeSession();
  await db.auditLog.deleteMany({ where: { actorId: userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.hostMapping.deleteMany({ where: { hostname } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

function attempt(current: string) {
  return runWithTrustedClientAddress(sourceIp, () => POST(new Request(`https://${hostname}/api/auth/password/change`, {
    method: "POST", headers: { host: hostname, origin: `https://${hostname}`,
      "content-type": "application/json", cookie },
    body: JSON.stringify({ currentPassword: current, newPassword: "Replacement fixture password 9384!" }),
  })));
}

test("wrong current password shares the five-attempt auth budget and never revokes a session", async () => {
  for (let index = 0; index < 5; index++) {
    expect((await attempt("Wrong fixture password 9384!")).status).toBe(401);
  }
  const limited = await attempt("Wrong fixture password 9384!");
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect(await db.session.count({ where: { userId } })).toBe(1);
  expect(await db.auditLog.count({ where: { actorId: userId } })).toBe(0);
});
