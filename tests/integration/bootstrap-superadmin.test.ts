import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { bootstrapSuperadmin } from "../../scripts/bootstrap-superadmin";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const email = `bootstrap-${randomUUID()}@example.test`;
const password = "Fixture bootstrap password 9384!";
const tokenId = randomUUID();

afterAll(async () => {
  await db.verification.deleteMany({ where: { id: tokenId } });
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
});

test("bootstrap refuses nonempty token storage and concurrent runs create exactly one login needing MFA", async () => {
  await db.verification.create({ data: { id: tokenId, identifier: "bootstrap-test", value: "fixture", expiresAt: new Date("2027-01-01T00:00:00Z") } });
  await expect(bootstrapSuperadmin(db, { name: "Operator", email, password })).rejects.toThrow(/empty database/);
  await db.verification.delete({ where: { id: tokenId } });

  const results = await Promise.allSettled(Array.from({ length: 2 }, () => bootstrapSuperadmin(db, { name: "Operator", email, password })));
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await db.user.count({ where: { role: "SUPERADMIN_AUTERVA" } })).toBe(1);
  const auth = createAuth(db);
  const login = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  expect(login.response.user.email).toBe(email);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  expect(user.twoFactorEnabled).toBe(false);
  const session = await auth.api.getSession({ headers: new Headers({ cookie: login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ") }) });
  expect(session?.user.id).toBe(user.id);
  expect((await db.session.findUnique({ where: { id: session?.session.id ?? "" } }))?.mfaVerifiedAt).toBeNull();
});
