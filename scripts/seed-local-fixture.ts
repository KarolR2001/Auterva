import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import { assertLocalFixtureTarget, assertOwnFixtureCluster } from "./fixture-safety";
import { FIXTURE, fixtureId as id } from "./fixture-ids";

export { FIXTURE } from "./fixture-ids";

const organizationRows = [
  [FIXTURE.organizations[0], "fixture-a", "Fixture A"],
  [FIXTURE.organizations[1], "fixture-b", "Fixture B"],
] as const;
const vehicleRows = [
  [FIXTURE.vehicles[0], 0, "bus-9", "Bus 9", id(31), "PUBLISHED", "490.00", "doba", "2026-03-28", "2026-11-03"],
  [FIXTURE.vehicles[1], 0, "auto-blokowane", "Auto blokowane", id(32), "PUBLISHED", "190.00", "doba", "2026-10-25", "2026-10-25"],
  [FIXTURE.vehicles[2], 0, "szkic-a", "Szkic A", id(32), "DRAFT", "140.00", "doba", "2026-10-23", null],
  [FIXTURE.vehicles[3], 1, "auto-wolne", "Auto wolne", id(32), "PUBLISHED", "210.00", "doba", "2026-03-29", "2026-11-01"],
  [FIXTURE.vehicles[4], 1, "ukryte-b", "Ukryte B", id(32), "UNPUBLISHED", "120.00", "doba", "2026-10-23", null],
  [FIXTURE.vehicles[5], 1, "archiwalne-b", "Archiwalne B", id(31), "ARCHIVED", "390.00", "doba", "2026-10-23", null],
] as const;

// Every deterministic ID that reset deletes (or reuses with ON CONFLICT) must
// still belong to the fixture. Checking only Organization/User leaves child IDs
// free to collide with a different tenant's valid rows.
const fixtureIdentities: ReadonlyArray<{
  table: string;
  id: string;
  fields: Record<string, string | null>;
}> = [
  ...vehicleRows.map(([vehicleId, companyIndex, slug]) => ({
    table: "Vehicle", id: vehicleId, fields: { organizationId: FIXTURE.organizations[companyIndex], slug },
  })),
  { table: "VehicleCategory", id: id(31), fields: { code: "fixture-bus" } },
  { table: "VehicleCategory", id: id(32), fields: { code: "fixture-auto" } },
  { table: "AvailabilityBlock", id: id(41), fields: { organizationId: FIXTURE.organizations[0], vehicleId: FIXTURE.vehicles[1] } },
  { table: "AvailabilityBlock", id: id(42), fields: { organizationId: FIXTURE.organizations[0], vehicleId: FIXTURE.vehicles[0] } },
  { table: "AvailabilityBlock", id: id(43), fields: { organizationId: FIXTURE.organizations[1], vehicleId: FIXTURE.vehicles[3] } },
  { table: "VehicleImage", id: id(51), fields: { organizationId: FIXTURE.organizations[0], vehicleId: FIXTURE.vehicles[0], storageKey: `fixtures/${FIXTURE.vehicles[0]}/cover.webp` } },
  { table: "VehicleImage", id: id(52), fields: { organizationId: FIXTURE.organizations[0], vehicleId: FIXTURE.vehicles[1], storageKey: `fixtures/${FIXTURE.vehicles[1]}/cover.webp` } },
  { table: "VehicleImage", id: id(54), fields: { organizationId: FIXTURE.organizations[1], vehicleId: FIXTURE.vehicles[3], storageKey: `fixtures/${FIXTURE.vehicles[3]}/cover.webp` } },
  { table: "Conversation", id: FIXTURE.conversations[0], fields: { organizationId: FIXTURE.organizations[0] } },
  { table: "Conversation", id: FIXTURE.conversations[1], fields: { organizationId: FIXTURE.organizations[1] } },
  { table: "ChatMessage", id: id(71), fields: { organizationId: FIXTURE.organizations[0], conversationId: FIXTURE.conversations[0], senderId: FIXTURE.users[0] } },
  { table: "ChatMessage", id: id(72), fields: { organizationId: FIXTURE.organizations[1], conversationId: FIXTURE.conversations[1], senderId: FIXTURE.users[1] } },
  { table: "AuditLog", id: id(91), fields: { organizationId: FIXTURE.organizations[1], actorId: FIXTURE.users[2], action: "COMPANY_ARCHIVED", entityId: FIXTURE.organizations[1] } },
  { table: "AuditLog", id: id(92), fields: { organizationId: FIXTURE.organizations[1], actorId: FIXTURE.users[2], action: "COMPANY_RESTORED", entityId: FIXTURE.organizations[1] } },
  { table: "HostMapping", id: id(81), fields: { organizationId: FIXTURE.organizations[0], hostname: "company-a.localhost", area: "COMPANY_PUBLIC" } },
  { table: "HostMapping", id: id(82), fields: { organizationId: FIXTURE.organizations[0], hostname: "admin.company-a.localhost", area: "COMPANY_ADMIN" } },
  { table: "HostMapping", id: id(83), fields: { organizationId: FIXTURE.organizations[1], hostname: "company-b.localhost", area: "COMPANY_PUBLIC" } },
  { table: "HostMapping", id: id(84), fields: { organizationId: FIXTURE.organizations[1], hostname: "admin.company-b.localhost", area: "COMPANY_ADMIN" } },
];

async function assertFixtureIdentities(db: Client) {
  for (const { table, id: rowId, fields } of fixtureIdentities) {
    // The table names above are source constants, never input from a caller.
    const result = await db.query(`SELECT * FROM "${table}" WHERE id = $1 FOR UPDATE`, [rowId]);
    if (result.rows[0] && Object.entries(fields).some(([field, expected]) => result.rows[0][field] !== expected)) {
      throw new Error(`Fixture identity collision in ${table}; refusing to overwrite data`);
    }
  }
}

/**
 * `--reset` from the CLI: audit rows are append-only (audit-append-and-access.md), so instead of deleting
 * them the whole disposable local fixture schema is recreated and migrated. Only the guarded database.
 */
const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function recreateFixtureSchema(db: Client, env: Record<string, string | undefined>, root = repoDir) {
  assertLocalFixtureTarget(env);
  await assertOwnFixtureCluster(db, root);
  const current = await db.query("SELECT current_database() AS name");
  if (current.rows[0]?.name !== "auterva_fixture_9") throw new Error("Refusing to recreate a non-fixture database");
  await db.query("DROP SCHEMA public CASCADE");
  await db.query("CREATE SCHEMA public");
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], { stdio: "inherit", env: { ...process.env, ...env } });
}

export async function seedLocalFixture(db: Client, env: Record<string, string | undefined>, reset: boolean,
  root = repoDir) {
  assertLocalFixtureTarget(env);
  if (reset) await assertOwnFixtureCluster(db, root);
  await db.query("BEGIN");
  try {
    // Existing fixture IDs must still refer to the expected companies. A mixed database is refused.
    const existing = await db.query('SELECT id, slug FROM "Organization" WHERE id = ANY($1::uuid[]) OR slug IN ($2, $3) FOR UPDATE', [FIXTURE.organizations, "fixture-a", "fixture-b"]);
    for (const row of existing.rows) {
      if (!organizationRows.some(([expectedId, slug]) => row.id === expectedId && row.slug === slug)) {
        throw new Error("Fixture identity collision; refusing to overwrite data");
      }
    }
    const knownUsers = [
      [FIXTURE.users[0], "admin-a@example.test", FIXTURE.organizations[0], "ADMIN_FIRMY"],
      [FIXTURE.users[1], "admin-b@example.test", FIXTURE.organizations[1], "ADMIN_FIRMY"],
      [FIXTURE.users[2], "superadmin@example.test", null, "SUPERADMIN_AUTERVA"],
    ] as const;
    const existingUsers = await db.query('SELECT id, email, "organizationId", role FROM "user" WHERE id = ANY($1::text[]) OR email = ANY($2::text[]) FOR UPDATE', [FIXTURE.users, knownUsers.map((row) => row[1])]);
    for (const row of existingUsers.rows) {
      if (!knownUsers.some(([userId, email, orgId, role]) => row.id === userId && row.email === email && row.organizationId === orgId && row.role === role)) {
        throw new Error("Fixture user identity collision; refusing to overwrite data");
      }
    }
    await assertFixtureIdentities(db);
    if (reset) {
      const orgs = [...FIXTURE.organizations];
      // Delete only IDs created by this seed. Unexpected dependants make the transaction fail.
      await db.query('DELETE FROM "ChatMessage" WHERE id = ANY($1::uuid[])', [[id(71), id(72)]]);
      await db.query('DELETE FROM "Conversation" WHERE id = ANY($1::uuid[])', [FIXTURE.conversations]);
      await db.query('DELETE FROM "Job" WHERE kind IN (\'MEDIA_PROCESS\', \'MAIL_REMINDER\') AND "organizationId" = ANY($1::uuid[])', [orgs]);
      await db.query('DELETE FROM "ReminderIntent" WHERE "organizationId" = ANY($1::uuid[])', [orgs]);
      await db.query('DELETE FROM "ReminderPlan" WHERE "organizationId" = ANY($1::uuid[])', [orgs]);
      await db.query('DELETE FROM "ImageUpload" WHERE "vehicleId" = ANY($1::uuid[])', [FIXTURE.vehicles]);
      await db.query('DELETE FROM "VehicleImage" WHERE id = ANY($1::uuid[]) OR "vehicleId" = ANY($2::uuid[])', [[id(51), id(52), id(54)], FIXTURE.vehicles]);
      await db.query('DELETE FROM "AvailabilityBlock" WHERE id = ANY($1::uuid[])', [[id(41), id(42), id(43)]]);
      await db.query('DELETE FROM "SlugRedirect" WHERE "vehicleId" = ANY($1::uuid[])', [FIXTURE.vehicles]);
      await db.query('DELETE FROM "Vehicle" WHERE id = ANY($1::uuid[])', [FIXTURE.vehicles]);
      await db.query('DELETE FROM "AuditLog" WHERE id = ANY($1::uuid[])', [[id(91), id(92)]]);
      await db.query('DELETE FROM "ServiceAccess" WHERE "organizationId" = ANY($1::uuid[])', [orgs]);
      await db.query('DELETE FROM "SiteSettings" WHERE "organizationId" = ANY($1::uuid[])', [orgs]);
      await db.query('DELETE FROM "HostMapping" WHERE id = ANY($1::uuid[])', [[id(81), id(82), id(83), id(84)]]);
      await db.query('DELETE FROM "session" WHERE "userId" = ANY($1::text[])', [FIXTURE.users]);
      await db.query('DELETE FROM "account" WHERE "userId" = ANY($1::text[])', [FIXTURE.users]);
      await db.query('DELETE FROM "twoFactor" WHERE "userId" = ANY($1::text[])', [FIXTURE.users]);
      await db.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [FIXTURE.users]);
      await db.query('DELETE FROM "Organization" WHERE id = ANY($1::uuid[])', [orgs]);
    }
    for (const [orgId, slug, name] of organizationRows) {
      await db.query('INSERT INTO "Organization" (id, slug, name, "firstAdminRegisteredAt") VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [orgId, slug, name, "2026-10-20T10:00:00Z"]);
      await db.query('INSERT INTO "SiteSettings" ("organizationId", "publicName", "showPrices") VALUES ($1, $2, true) ON CONFLICT ("organizationId") DO NOTHING', [orgId, name]);
    }
    for (const [hostId, companyIndex, hostname, area] of [
      [id(81), 0, "company-a.localhost", "COMPANY_PUBLIC"],
      [id(82), 0, "admin.company-a.localhost", "COMPANY_ADMIN"],
      [id(83), 1, "company-b.localhost", "COMPANY_PUBLIC"],
      [id(84), 1, "admin.company-b.localhost", "COMPANY_ADMIN"],
    ] as const) {
      await db.query('INSERT INTO "HostMapping" (id, "organizationId", hostname, area, status) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING', [hostId, FIXTURE.organizations[companyIndex], hostname, area, "ACTIVE"]);
    }
    for (const [categoryId, code, name, seats] of [[id(31), "fixture-bus", "Bus", true], [id(32), "fixture-auto", "Auto", false]] as const) {
      await db.query('INSERT INTO "VehicleCategory" (id, code, name, "requiresSeats") VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING', [categoryId, code, name, seats]);
    }
    for (const [userId, name, email, orgId, role] of [
      [FIXTURE.users[0], "Admin A", "admin-a@example.test", FIXTURE.organizations[0], "ADMIN_FIRMY"],
      [FIXTURE.users[1], "Admin B", "admin-b@example.test", FIXTURE.organizations[1], "ADMIN_FIRMY"],
      [FIXTURE.users[2], "Superadmin", "superadmin@example.test", null, "SUPERADMIN_AUTERVA"],
    ] as const) {
      await db.query('INSERT INTO "user" (id, name, email, "emailVerified", "organizationId", role, "updatedAt") VALUES ($1, $2, $3, true, $4, $5, now()) ON CONFLICT (id) DO NOTHING', [userId, name, email, orgId, role]);
    }
    await db.query('INSERT INTO "ServiceAccess" ("organizationId", "paidThrough") VALUES ($1, $2) ON CONFLICT ("organizationId") DO NOTHING', [FIXTURE.organizations[0], "2026-11-30"]);
    await db.query('INSERT INTO "ServiceAccess" ("organizationId", "trialGranted", "trialStartedAt", "trialEndsAt") VALUES ($1, true, $2, $3) ON CONFLICT ("organizationId") DO NOTHING', [FIXTURE.organizations[1], "2026-10-20T10:00:00Z", "2026-11-03T10:00:00Z"]);
    for (const [vehicleId, companyIndex, slug, name, categoryId, status, price, priceUnit, from, to] of vehicleRows) {
      const orgId = FIXTURE.organizations[companyIndex];
      await db.query('INSERT INTO "Vehicle" (id, "organizationId", slug, name, "categoryId", "shortDescription", description, seats, status, price, "priceUnit", "availableFrom", "availableTo") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (id) DO NOTHING', [vehicleId, orgId, slug, name, categoryId, `Testowy ${name}`, `${name} w danych testowych.`, categoryId === id(31) ? 9 : 5, status, price, priceUnit, from, to]);
    }
    for (const [blockId, vehicleId, companyIndex, from, to, type] of [
      [id(41), FIXTURE.vehicles[1], 0, "2026-10-25", "2026-10-25", "BLOCKED"],
      [id(42), FIXTURE.vehicles[0], 0, "2026-03-29", "2026-03-29", "MAINTENANCE"],
      [id(43), FIXTURE.vehicles[3], 1, "2026-11-01", "2026-11-01", "RESERVED"],
    ] as const) {
      await db.query('INSERT INTO "AvailabilityBlock" (id, "organizationId", "vehicleId", "from", "to", type) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', [blockId, FIXTURE.organizations[companyIndex], vehicleId, from, to, type]);
    }
    for (const [imageId, vehicleId, companyIndex] of [[id(51), FIXTURE.vehicles[0], 0], [id(52), FIXTURE.vehicles[1], 0], [id(54), FIXTURE.vehicles[3], 1]] as const) {
      const orgId = FIXTURE.organizations[companyIndex];
      await db.query('INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes, alt, "isCover", status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) ON CONFLICT (id) DO NOTHING', [imageId, orgId, vehicleId, `fixtures/${vehicleId}/cover.webp`, "image/webp", 480, 320, 26030, "Testowy pojazd", "READY"]);
    }
    for (const [companyIndex, conversationId, messageId, senderId, body] of [
      [0, FIXTURE.conversations[0], id(71), FIXTURE.users[0], "Wiadomość testowa firmy A"],
      [1, FIXTURE.conversations[1], id(72), FIXTURE.users[1], "Wiadomość testowa firmy B"],
    ] as const) {
      const orgId = FIXTURE.organizations[companyIndex];
      await db.query('INSERT INTO "Conversation" (id, "organizationId") VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [conversationId, orgId]);
      await db.query('INSERT INTO "ChatMessage" (id, "organizationId", "conversationId", "senderId", "clientMessageId", body) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING', [messageId, orgId, conversationId, senderId, id(70 + companyIndex), body]);
    }
    // B has a preserved archive/restore history while remaining active for A/B tests.
    for (const [auditId, action] of [[id(91), "COMPANY_ARCHIVED"], [id(92), "COMPANY_RESTORED"]] as const) {
      await db.query('INSERT INTO "AuditLog" (id, "organizationId", "actorId", "actorRole", action, "entityType", "entityId", "requestId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING', [auditId, FIXTURE.organizations[1], FIXTURE.users[2], "SUPERADMIN_AUTERVA", action, "Organization", FIXTURE.organizations[1], auditId]);
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnv({ path: ".env", quiet: true });
  const reset = process.argv.slice(2).includes("--reset");
  const target = assertLocalFixtureTarget(process.env);
  const db = new Client({ connectionString: target });
  try {
    await db.connect();
    if (reset) await recreateFixtureSchema(db, process.env);
    await seedLocalFixture(db, process.env, false);
    const { seedLocalAccess } = await import("./seed-local-access");
    await seedLocalAccess(db, process.env);
    process.stdout.write(`Fixture A/B ${reset ? "reset and seeded" : "seeded"}; local credentials enrolled with MFA.\n`);
  } finally {
    await db.end();
  }
}
