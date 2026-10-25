import { createHmac, randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { takeAuthenticatedApiLimit } from "../../src/modules/tenancy/api-rate-limit";

const dbA = createPrismaClient(process.env.DATABASE_URL ?? "");
const dbB = createPrismaClient(process.env.DATABASE_URL ?? "");
const actorId = randomUUID();
const companyA = randomUUID();
const companyB = randomUUID();
const at = new Date("2026-10-23T12:00:00.000Z");

afterAll(async () => {
  const keys = [
    `api:read:${actorId}:${companyA}`,
    `api:write:${actorId}:${companyA}`,
    `api:read:${actorId}:${companyB}`,
    `api:write:${actorId}:platform`,
  ].map((key) => createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(key).digest("hex"));
  await dbA.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
  await Promise.all([dbA.$disconnect(), dbB.$disconnect()]);
});

test("120 reads and 60 writes are independent shared moving-minute limits", async () => {
  const actor = { actorId, organizationId: companyA };
  for (let i = 0; i < 120; i++) {
    expect((await takeAuthenticatedApiLimit(i % 2 ? dbA : dbB, actor, "read", at)).allowed).toBe(true);
  }
  expect(await takeAuthenticatedApiLimit(dbB, actor, "read", at)).toEqual({ allowed: false, retryAfter: 60 });
  for (let i = 0; i < 60; i++) {
    expect((await takeAuthenticatedApiLimit(i % 2 ? dbA : dbB, actor, "write", at)).allowed).toBe(true);
  }
  expect(await takeAuthenticatedApiLimit(dbA, actor, "write", at)).toEqual({ allowed: false, retryAfter: 60 });
  expect((await takeAuthenticatedApiLimit(dbB, { actorId, organizationId: companyB }, "read", at)).allowed).toBe(true);
  expect((await takeAuthenticatedApiLimit(dbB, { actorId, organizationId: null }, "write", at)).allowed).toBe(true);
  expect((await takeAuthenticatedApiLimit(dbB, actor, "read", new Date(at.getTime() + 60_000))).allowed).toBe(true);
});
