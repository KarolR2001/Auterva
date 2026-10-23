import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { consumeFixtureInvitation, inspectFixtureInvitation, issueFixtureInvitation } from "../fixtures/invitation-probe";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const scope = { organizationId, email: `invite-${randomUUID()}@example.test`, host: "company-a.example.test" };
const now = new Date("2027-01-01T10:00:00Z");

afterAll(async () => {
  await db.verification.deleteMany({ where: { identifier: { startsWith: `fixture-invite:${organizationId}:` } } });
  await db.$disconnect();
});

test("PostgreSQL fixture invitation is host/company-bound, GET-safe, one-use and resend revokes old token", async () => {
  const first = await issueFixtureInvitation(db, scope, now);
  const wrongHost = { ...scope, host: "company-b.example.test" };
  const wrongCompany = { ...scope, organizationId: randomUUID() };
  expect(await inspectFixtureInvitation(db, wrongHost, first, now)).toBeNull();
  expect(await inspectFixtureInvitation(db, wrongCompany, first, now)).toBeNull();
  expect(await inspectFixtureInvitation(db, scope, first, new Date("2027-01-08T10:00:00Z"))).toBeNull();
  expect(await inspectFixtureInvitation(db, scope, first, now)).not.toBeNull();
  expect(await inspectFixtureInvitation(db, scope, first, now)).not.toBeNull();
  const consumed = await Promise.all([consumeFixtureInvitation(db, scope, first, now), consumeFixtureInvitation(db, scope, first, now)]);
  expect(consumed.filter(Boolean)).toHaveLength(1);

  const old = await issueFixtureInvitation(db, scope, now);
  const resent = await issueFixtureInvitation(db, scope, now, true);
  expect(await consumeFixtureInvitation(db, scope, old, now)).toBe(false);
  expect(await consumeFixtureInvitation(db, scope, resent, now)).toBe(true);
});
