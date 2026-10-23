import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { resolveHostMapping } from "../../src/modules/tenancy/host-registry";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const a = randomUUID();
const b = randomUUID();
const companyHost = `admin-${randomUUID()}.example.test`;
const publicHost = `public-${randomUUID()}.example.test`;
const marketingHost = `mkt-${randomUUID()}.example.test`;
const pendingHost = `pending-${randomUUID()}.example.test`;

afterAll(async () => {
  await db.hostMapping.deleteMany({ where: { hostname: { in: [companyHost, publicHost, marketingHost, pendingHost] } } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
});

test("active registry resolves only the exact host area and tenant", async () => {
  await db.organization.createMany({ data: [{ id: a, slug: `host-${a}` }, { id: b, slug: `host-${b}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: companyHost, area: "COMPANY_ADMIN", organizationId: a, status: "ACTIVE" },
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId: b, status: "ACTIVE" },
    { hostname: marketingHost, area: "MARKETING", status: "ACTIVE" },
    { hostname: pendingHost, area: "PLATFORM", status: "PENDING" },
  ] });
  expect(await resolveHostMapping(db, `${companyHost.toUpperCase()}:443`)).toMatchObject({
    hostname: companyHost, area: "COMPANY_ADMIN", organizationId: a,
  });
  expect(await resolveHostMapping(db, publicHost)).toMatchObject({ area: "COMPANY_PUBLIC", organizationId: b });
  expect(await resolveHostMapping(db, marketingHost)).toMatchObject({ area: "MARKETING", organizationId: null });
  expect(await resolveHostMapping(db, pendingHost)).toBeNull();
  expect(await resolveHostMapping(db, `evil.${companyHost}`)).toBeNull();
  expect(await resolveHostMapping(db, `${companyHost},${publicHost}`)).toBeNull();
});
