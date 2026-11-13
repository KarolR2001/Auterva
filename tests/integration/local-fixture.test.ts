import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import * as OTPAuth from "otpauth";
import { expect, test } from "vitest";
import { seedLocalFixture, FIXTURE } from "../../scripts/seed-local-fixture";
import { fixtureId } from "../../scripts/fixture-ids";
import { seedLocalAccess } from "../../scripts/seed-local-access";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

test("A/B seed is repeatable, tenant-scoped and includes catalogue, periods and conversations", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, false);
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, false);
    const orgs = await db.query('SELECT id, slug FROM "Organization" WHERE id = ANY($1::uuid[]) ORDER BY slug', [FIXTURE.organizations]);
    expect(orgs.rows.map(({ slug }) => slug)).toEqual(["fixture-a", "fixture-b"]);
    const vehicles = await db.query('SELECT "organizationId", status, count(*)::int AS total FROM "Vehicle" WHERE "organizationId" = ANY($1::uuid[]) GROUP BY "organizationId", status', [FIXTURE.organizations]);
    expect(vehicles.rows.reduce((count, row) => count + row.total, 0)).toBe(6);
    expect(vehicles.rows.filter((row) => row.status === "PUBLISHED").reduce((count, row) => count + row.total, 0)).toBe(3);
    for (const table of ["AvailabilityBlock", "Conversation", "ChatMessage", "ServiceAccess"]) {
      const result = await db.query(`SELECT count(*)::int AS total FROM "${table}" WHERE "organizationId" = ANY($1::uuid[])`, [FIXTURE.organizations]);
      expect(result.rows[0].total).toBeGreaterThanOrEqual(2);
    }
    const users = await db.query('SELECT role, "organizationId" FROM "user" WHERE id = ANY($1::text[])', [FIXTURE.users]);
    expect(users.rows).toHaveLength(3);
    expect(users.rows.filter((row) => row.role === "ADMIN_FIRMY").map((row) => row.organizationId).sort()).toEqual([...FIXTURE.organizations].sort());
    expect(users.rows.find((row) => row.role === "SUPERADMIN_AUTERVA")?.organizationId).toBeNull();
    const platform = await db.query('SELECT "organizationId", area, status FROM "HostMapping" WHERE hostname = $1', ["platform.localhost"]);
    expect(platform.rows).toEqual([{ organizationId: null, area: "PLATFORM", status: "ACTIVE" }]);
  } finally {
    await db.end();
  }
});

test("three local roles have working password and MFA, with no session before TOTP", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const prisma = createPrismaClient(process.env.DATABASE_URL ?? "");
  await db.connect();
  try {
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    const accessPath = await seedLocalAccess(db, { ...process.env, AUTERVA_FIXTURE: "1" });
    await seedLocalAccess(db, { ...process.env, AUTERVA_FIXTURE: "1" });
    const access = JSON.parse(readFileSync(accessPath, "utf8")) as Record<string, { email: string; password: string; totpURI: string }>;
    const auth = createAuth(prisma, true);
    for (const userId of FIXTURE.users) {
      const account = access[userId];
      const totp = OTPAuth.URI.parse(account.totpURI);
      if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing fixture TOTP");
      const login = await auth.api.signInEmail({ body: { email: account.email, password: account.password }, returnHeaders: true });
      expect(login.response).toHaveProperty("twoFactorRedirect", true);
      const challengeCookie = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
      expect(await auth.api.getSession({ headers: new Headers({ cookie: challengeCookie }) })).toBeNull();
      const verified = await auth.api.verifyTOTP({ body: { code: totp.generate(), trustDevice: false }, headers: new Headers({ cookie: challengeCookie }), returnHeaders: true });
      const sessionCookie = verified.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
      expect((await auth.api.getSession({ headers: new Headers({ cookie: sessionCookie }) }))?.user.id).toBe(userId);
    }
    expect((await db.query('SELECT count(*)::int AS total FROM "twoFactor" WHERE "userId" = ANY($1::text[])', [FIXTURE.users])).rows[0].total).toBe(3);
  } finally {
    await db.query('DELETE FROM "session" WHERE "userId" = ANY($1::text[])', [FIXTURE.users]);
    await prisma.$disconnect();
    await db.end();
  }
});

test("reset leaves unrelated tenant intact and refuses a fixture user ID collision", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const foreignId = randomUUID();
  try {
    await db.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2)', [foreignId, `unrelated-${foreignId}`]);
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    expect((await db.query('SELECT count(*)::int AS total FROM "Organization" WHERE id = $1', [foreignId])).rows[0].total).toBe(1);
    await db.query('UPDATE "user" SET name = $2, email = $3 WHERE id = $1', [FIXTURE.users[0], "Foreign", `foreign-${foreignId}@example.test`]);
    await expect(seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true)).rejects.toThrow(/collision/);
    expect((await db.query('SELECT count(*)::int AS total FROM "Vehicle" WHERE "organizationId" = $1', [FIXTURE.organizations[0]])).rows[0].total).toBe(3);
  } finally {
    await db.query('UPDATE "user" SET name = $2, email = $3 WHERE id = $1', [FIXTURE.users[0], "Admin A", "admin-a@example.test"]);
    await db.query('DELETE FROM "Organization" WHERE id = $1', [foreignId]);
    await db.end();
  }
});

test("reset rolls back when an unmarked row was added inside a fixture company", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const foreignVehicle = randomUUID();
  try {
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    await db.query('INSERT INTO "Vehicle" (id, "organizationId", name) VALUES ($1,$2,$3)', [foreignVehicle, FIXTURE.organizations[0], "Unmarked data"]);
    await expect(seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true)).rejects.toMatchObject({ code: "23001" });
    expect((await db.query('SELECT count(*)::int AS total FROM "Vehicle" WHERE "organizationId" = $1', [FIXTURE.organizations[0]])).rows[0].total).toBe(4);
  } finally {
    await db.query('DELETE FROM "Vehicle" WHERE id = $1', [foreignVehicle]);
    await db.end();
  }
});

test("reset refuses a fixture block ID reassigned to an unrelated tenant", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const foreignOrg = randomUUID();
  const foreignVehicle = randomUUID();
  const blockId = fixtureId(41);
  try {
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    await db.query('INSERT INTO "Organization" (id, slug) VALUES ($1,$2)', [foreignOrg, `foreign-${foreignOrg}`]);
    await db.query('INSERT INTO "Vehicle" (id, "organizationId", name) VALUES ($1,$2,$3)', [foreignVehicle, foreignOrg, "Foreign vehicle"]);
    await db.query('UPDATE "AvailabilityBlock" SET "organizationId" = $1, "vehicleId" = $2 WHERE id = $3', [foreignOrg, foreignVehicle, blockId]);
    await expect(seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true)).rejects.toThrow(/collision/);
    expect((await db.query('SELECT count(*)::int AS total FROM "AvailabilityBlock" WHERE id = $1 AND "organizationId" = $2', [blockId, foreignOrg])).rows[0].total).toBe(1);
    expect((await db.query('SELECT count(*)::int AS total FROM "Vehicle" WHERE "organizationId" = $1', [FIXTURE.organizations[0]])).rows[0].total).toBe(3);
  } finally {
    await db.query('UPDATE "AvailabilityBlock" SET "organizationId" = $1, "vehicleId" = $2 WHERE id = $3', [FIXTURE.organizations[0], FIXTURE.vehicles[1], blockId]);
    await db.query('DELETE FROM "Vehicle" WHERE id = $1', [foreignVehicle]);
    await db.query('DELETE FROM "Organization" WHERE id = $1', [foreignOrg]);
    await db.end();
  }
});

test("reset refuses a fixture image ID reassigned to an unrelated tenant", async () => {
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const foreignOrg = randomUUID();
  const foreignVehicle = randomUUID();
  const imageId = fixtureId(51);
  try {
    await seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true);
    await db.query('INSERT INTO "Organization" (id, slug) VALUES ($1,$2)', [foreignOrg, `foreign-${foreignOrg}`]);
    await db.query('INSERT INTO "Vehicle" (id, "organizationId", name) VALUES ($1,$2,$3)', [foreignVehicle, foreignOrg, "Foreign vehicle"]);
    await db.query('UPDATE "VehicleImage" SET "organizationId" = $1, "vehicleId" = $2 WHERE id = $3', [foreignOrg, foreignVehicle, imageId]);
    await expect(seedLocalFixture(db, { ...process.env, AUTERVA_FIXTURE: "1" }, true)).rejects.toThrow(/collision/);
    expect((await db.query('SELECT count(*)::int AS total FROM "VehicleImage" WHERE id = $1 AND "organizationId" = $2', [imageId, foreignOrg])).rows[0].total).toBe(1);
    expect((await db.query('SELECT count(*)::int AS total FROM "Vehicle" WHERE "organizationId" = $1', [FIXTURE.organizations[0]])).rows[0].total).toBe(3);
  } finally {
    await db.query('UPDATE "VehicleImage" SET "organizationId" = $1, "vehicleId" = $2 WHERE id = $3', [FIXTURE.organizations[0], FIXTURE.vehicles[0], imageId]);
    await db.query('DELETE FROM "Vehicle" WHERE id = $1', [foreignVehicle]);
    await db.query('DELETE FROM "Organization" WHERE id = $1', [foreignOrg]);
    await db.end();
  }
});
