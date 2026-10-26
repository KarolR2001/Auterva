import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL integration tests");
// Request a Warsaw startup session even when a developer's PostgreSQL defaults to UTC.
// The application factory must normalize every acquired connection before Prisma uses it.
const warsawUrl = new URL(databaseUrl);
warsawUrl.searchParams.set("options", "-c timezone=Europe/Warsaw");
const first = createPrismaClient(warsawUrl.toString());
const second = createPrismaClient(warsawUrl.toString());
const defaultClient = createPrismaClient(databaseUrl);
const organizations: string[] = [];

afterAll(async () => {
  await first.serviceAccess.deleteMany({ where: { organizationId: { in: organizations } } });
  await first.organization.deleteMany({ where: { id: { in: organizations } } });
  await first.$disconnect();
  await second.$disconnect();
  await defaultClient.$disconnect();
});

for (const [name, start] of [
  ["spring DST", "2027-03-21T10:00:00.000Z"],
  ["autumn DST", "2026-10-18T10:00:00.000Z"],
] as const) {
  test(`${name}: raw Date params and model writes retain the UTC epoch and 336-hour trial`, async () => {
    const startedAt = new Date(start);
    const endsAt = new Date(startedAt.getTime() + 336 * 60 * 60_000);
    const session = await first.$queryRaw<{ timezone: string; startEpoch: bigint; endEpoch: bigint; seconds: number }[]>`
      SELECT current_setting('TimeZone') AS timezone,
        EXTRACT(EPOCH FROM ${startedAt}::timestamptz)::bigint AS "startEpoch",
        EXTRACT(EPOCH FROM ${endsAt}::timestamptz)::bigint AS "endEpoch",
        EXTRACT(EPOCH FROM (${endsAt}::timestamptz - ${startedAt}::timestamptz))::int AS seconds
    `;
    expect(session[0]).toMatchObject({ timezone: "UTC", startEpoch: BigInt(startedAt.getTime() / 1000),
      endEpoch: BigInt(endsAt.getTime() / 1000), seconds: 336 * 3600 });

    const organizationId = randomUUID();
    organizations.push(organizationId);
    await first.organization.create({ data: { id: organizationId, slug: `timezone-${organizationId}`,
      firstAdminRegisteredAt: startedAt } });
    await first.serviceAccess.create({ data: { organizationId, trialGranted: true,
      trialStartedAt: startedAt, trialEndsAt: endsAt } });
    const stored = await first.$queryRaw<{ registeredEpoch: bigint; startedEpoch: bigint;
      endedEpoch: bigint; durationSeconds: number }[]>`
      SELECT EXTRACT(EPOCH FROM o."firstAdminRegisteredAt")::bigint AS "registeredEpoch",
        EXTRACT(EPOCH FROM s."trialStartedAt")::bigint AS "startedEpoch",
        EXTRACT(EPOCH FROM s."trialEndsAt")::bigint AS "endedEpoch",
        EXTRACT(EPOCH FROM (s."trialEndsAt" - s."trialStartedAt"))::int AS "durationSeconds"
      FROM "Organization" o JOIN "ServiceAccess" s ON s."organizationId" = o.id
      WHERE o.id = ${organizationId}::uuid
    `;
    expect(stored[0]).toEqual({ registeredEpoch: BigInt(startedAt.getTime() / 1000),
      startedEpoch: BigInt(startedAt.getTime() / 1000), endedEpoch: BigInt(endsAt.getTime() / 1000),
      durationSeconds: 336 * 3600 });
    const read = await first.serviceAccess.findUniqueOrThrow({ where: { organizationId } });
    expect(read.trialStartedAt?.getTime()).toBe(startedAt.getTime());
    expect(read.trialEndsAt?.getTime()).toBe(endsAt.getTime());
  });
}

test("SQL DATE stays a LocalDate across the Warsaw clock change", async () => {
  const organizationId = randomUUID();
  organizations.push(organizationId);
  await first.organization.create({ data: { id: organizationId, slug: `timezone-${organizationId}` } });
  for (const date of ["2026-10-25", "2027-03-28"]) {
    await first.serviceAccess.upsert({ where: { organizationId }, create: { organizationId,
      paidThrough: new Date(`${date}T00:00:00.000Z`) },
    update: { paidThrough: new Date(`${date}T00:00:00.000Z`) } });
    const stored = await first.$queryRaw<{ day: string }[]>`
      SELECT "paidThrough"::text AS day FROM "ServiceAccess" WHERE "organizationId" = ${organizationId}::uuid
    `;
    expect(stored[0]?.day).toBe(date);
    expect((await first.serviceAccess.findUniqueOrThrow({ where: { organizationId } })).paidThrough?.toISOString().slice(0, 10)).toBe(date);
  }
});

test("each pool connection and a newly constructed client begin in UTC", async () => {
  const connections = await Promise.all(Array.from({ length: 12 }, () => first.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ pid: number; timezone: string }[]>`
      SELECT pg_backend_pid() AS pid, current_setting('TimeZone') AS timezone
    `;
    await tx.$executeRaw`SELECT pg_sleep(0.05)`;
    return rows[0];
  })));
  expect(new Set(connections.map((row) => row.pid)).size).toBeGreaterThan(1);
  expect(connections.every((row) => row.timezone === "UTC")).toBe(true);
  const recreated = await second.$queryRaw<{ timezone: string }[]>`SELECT current_setting('TimeZone') AS timezone`;
  expect(recreated[0]?.timezone).toBe("UTC");
  const defaultSession = await defaultClient.$queryRaw<{ timezone: string }[]>`SELECT current_setting('TimeZone') AS timezone`;
  expect(defaultSession[0]?.timezone).toBe("UTC");
});
