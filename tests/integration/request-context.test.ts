import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { resolveRequestArea, selectActorOrganization } from "../../src/modules/tenancy/request-context";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const a = randomUUID();
const b = randomUUID();
const hostA = `admin-${randomUUID()}.example.test`;
const publicA = `public-${randomUUID()}.example.test`;
const platform = `platform-${randomUUID()}.example.test`;
const pending = `pending-${randomUUID()}.example.test`;

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: a, slug: `context-${a}` }, { id: b, slug: `context-${b}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: hostA, area: "COMPANY_ADMIN", organizationId: a, status: "ACTIVE" },
    { hostname: publicA, area: "COMPANY_PUBLIC", organizationId: a, status: "ACTIVE" },
    { hostname: platform, area: "PLATFORM", status: "ACTIVE" },
    { hostname: pending, area: "COMPANY_ADMIN", organizationId: b, status: "PENDING" },
  ] });
});

afterAll(async () => {
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostA, publicA, platform, pending] } } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
});

test("only active exact hosts yield a request area; supplied target never changes host tenant", async () => {
  expect(await resolveRequestArea(db, hostA)).toEqual({ area: "COMPANY_ADMIN", organizationId: a });
  expect(await resolveRequestArea(db, publicA)).toEqual({ area: "COMPANY_PUBLIC", organizationId: a });
  expect(await resolveRequestArea(db, platform)).toEqual({ area: "PLATFORM", organizationId: null });
  expect(await resolveRequestArea(db, pending)).toBeNull();
  expect(await resolveRequestArea(db, `evil.${hostA}`)).toBeNull();
  expect(await resolveRequestArea(db, `${hostA},${platform}`)).toBeNull();
});

test("company actor cannot switch firms; platform actor explicitly selects an existing firm", async () => {
  const company = { userId: "company-user", role: "ADMIN_FIRMY", organizationId: a, sessionId: "company-session" } as const;
  const superadmin = { userId: "platform-user", role: "SUPERADMIN_AUTERVA", organizationId: null, sessionId: "platform-session" } as const;
  expect(await selectActorOrganization(db, { area: "COMPANY_ADMIN", organizationId: a }, company, a)).toMatchObject({ organizationId: a, actorId: "company-user" });
  expect(await selectActorOrganization(db, { area: "COMPANY_ADMIN", organizationId: a }, company, b)).toBeNull();
  expect(await selectActorOrganization(db, { area: "PLATFORM", organizationId: null }, company, a)).toBeNull();
  expect(await selectActorOrganization(db, { area: "COMPANY_ADMIN", organizationId: a }, superadmin, a)).toBeNull();
  expect(await selectActorOrganization(db, { area: "PLATFORM", organizationId: null }, superadmin, b)).toMatchObject({ organizationId: b, actorId: "platform-user" });
  expect(await selectActorOrganization(db, { area: "PLATFORM", organizationId: null }, superadmin, randomUUID())).toBeNull();
});
