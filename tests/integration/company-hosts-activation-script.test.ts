import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { activateProviderHosts } from "../../scripts/activate-provider-hosts";

// D-26 (#152): operator script for existing companies; preview by default, exact base match only.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const marker = randomUUID().slice(0, 8);
const adminBase = `adm-${marker}.example.test`;
const publicBase = `pub-${marker}.example.test`;
const slug = `legacy-${marker}`;
const org = randomUUID();
const other = randomUUID();
const hosts = {
  admin: `${slug}.${adminBase}`, pub: `${slug}.${publicBase}`,
  wrongBase: `${slug}.elsewhere-${marker}.example.test`,
  swapped: `${slug}.${publicBase.replace("pub-", "pub2-")}`,
  custom: `www.${slug}.klient.example.test`,
  otherAdmin: `other-${marker}.${adminBase}`,
};
const statusOf = async (hostname: string) => (await db.hostMapping.findUniqueOrThrow({ where: { hostname } })).status;
const run = (apply: boolean) => activateProviderHosts(db, { adminBaseDomain: adminBase, publicBaseDomain: publicBase, apply });

beforeAll(async () => {
  await db.organization.create({ data: { id: org, slug } });
  await db.organization.create({ data: { id: other, slug: `x-${slug}` } });
  const row = (organizationId: string, hostname: string, area: string, kind = "PROVIDER") =>
    ({ organizationId, hostname, area, kind, status: "PENDING" });
  await db.hostMapping.createMany({ data: [
    row(org, hosts.admin, "COMPANY_ADMIN"), row(org, hosts.pub, "COMPANY_PUBLIC"),
    row(org, hosts.wrongBase, "COMPANY_PUBLIC"), row(org, hosts.swapped, "COMPANY_ADMIN"),
    row(org, hosts.custom, "COMPANY_PUBLIC", "CUSTOM"),
    // another company's host under this slug-less name does not match its own slug
    row(other, hosts.otherAdmin, "COMPANY_ADMIN"),
  ] });
});

afterAll(async () => {
  await db.hostMapping.deleteMany({ where: { organizationId: { in: [org, other] } } });
  await db.organization.deleteMany({ where: { id: { in: [org, other] } } });
  await db.$disconnect();
});

test("preview changes nothing; apply activates only slug + configured base of the right area; rerun is a no-op", async () => {
  const preview = await run(false);
  expect(preview.applied).toBe(false);
  expect(preview.toActivate.map((h) => h.hostname).sort()).toEqual([hosts.admin, hosts.pub].sort());
  for (const hostname of Object.values(hosts)) expect(await statusOf(hostname)).toBe("PENDING");
  const applied = await run(true);
  expect(applied.toActivate.map((h) => h.hostname).sort()).toEqual([hosts.admin, hosts.pub].sort());
  expect(applied.skipped.map((h) => h.hostname)).toEqual(expect.arrayContaining([hosts.wrongBase, hosts.swapped, hosts.otherAdmin]));
  expect(await statusOf(hosts.admin)).toBe("ACTIVE");
  expect(await statusOf(hosts.pub)).toBe("ACTIVE");
  for (const hostname of [hosts.wrongBase, hosts.swapped, hosts.custom, hosts.otherAdmin]) {
    expect(await statusOf(hostname)).toBe("PENDING");
  }
  const again = await run(true);
  expect(again.toActivate).toEqual([]);
  expect(await statusOf(hosts.custom)).toBe("PENDING");
});

test("refuses missing or identical base domains", async () => {
  await expect(activateProviderHosts(db, { adminBaseDomain: "", publicBaseDomain: publicBase, apply: true })).rejects.toThrow();
  await expect(activateProviderHosts(db, { adminBaseDomain: adminBase, publicBaseDomain: adminBase, apply: true })).rejects.toThrow();
});
