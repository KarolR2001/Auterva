import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { expect, test } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for PostgreSQL schema tests");

async function inRollback(run: (db: Client) => Promise<void>) {
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("BEGIN");
    await run(db);
  } finally {
    await db.query("ROLLBACK");
    await db.end();
  }
}

async function organization(db: Client) {
  const id = randomUUID();
  await db.query('INSERT INTO "Organization" (id, slug) VALUES ($1, $2)', [id, `fixture-${id}`]);
  return id;
}

test("database rejects the same email after case and whitespace normalization", async () => inRollback(async (db) => {
  const id = randomUUID();
  const email = `Owner-${id}@example.test`;
  await db.query('INSERT INTO "user" (id, name, email, "updatedAt") VALUES ($1, $2, $3, now())', [id, "Owner", email]);
  await expect(db.query('INSERT INTO "user" (id, name, email, "updatedAt") VALUES ($1, $2, $3, now())', [randomUUID(), "Other", ` ${email.toLowerCase()} `]))
    .rejects.toMatchObject({ code: "23505" });
}));

test("database permits one active company admin and rejects a second", async () => inRollback(async (db) => {
  const company = await organization(db);
  await db.query('INSERT INTO "user" (id, name, email, "updatedAt", "organizationId", role) VALUES ($1, $2, $3, now(), $4, $5)', [randomUUID(), "First", `${randomUUID()}@example.test`, company, "ADMIN_FIRMY"]);
  await expect(db.query('INSERT INTO "user" (id, name, email, "updatedAt", "organizationId", role) VALUES ($1, $2, $3, now(), $4, $5)', [randomUUID(), "Second", `${randomUUID()}@example.test`, company, "ADMIN_FIRMY"]))
    .rejects.toMatchObject({ code: "23505" });
}));

test("vehicle slug is unique inside one company but reusable by another", async () => inRollback(async (db) => {
  const a = await organization(db);
  const b = await organization(db);
  const slug = `shared-${randomUUID()}`;
  await db.query('INSERT INTO "Vehicle" (id, "organizationId", slug) VALUES ($1, $2, $3)', [randomUUID(), a, slug]);
  await db.query('INSERT INTO "Vehicle" (id, "organizationId", slug) VALUES ($1, $2, $3)', [randomUUID(), b, slug]);
  await expect(db.query('INSERT INTO "Vehicle" (id, "organizationId", slug) VALUES ($1, $2, $3)', [randomUUID(), a, slug]))
    .rejects.toMatchObject({ code: "23505" });
}));

test("normalized hostname cannot change owner by case variant", async () => inRollback(async (db) => {
  const a = await organization(db);
  const b = await organization(db);
  const host = `${randomUUID()}.example.test`;
  await db.query('INSERT INTO "HostMapping" (id, "organizationId", hostname, area) VALUES ($1, $2, $3, $4)', [randomUUID(), a, host, "COMPANY_PUBLIC"]);
  await expect(db.query('INSERT INTO "HostMapping" (id, "organizationId", hostname, area) VALUES ($1, $2, $3, $4)', [randomUUID(), b, host.toUpperCase(), "COMPANY_PUBLIC"]))
    .rejects.toMatchObject({ code: "23505" });
}));

test("image cannot reference a vehicle owned by another company", async () => inRollback(async (db) => {
  const a = await organization(db);
  const b = await organization(db);
  const vehicle = randomUUID();
  await db.query('INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)', [vehicle, a]);
  await expect(db.query('INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [randomUUID(), b, vehicle, `fixture/${randomUUID()}`, "image/webp", 800, 600, 1024]))
    .rejects.toMatchObject({ code: "23503" });
}));

test("block cannot reference a vehicle owned by another company", async () => inRollback(async (db) => {
  const a = await organization(db);
  const b = await organization(db);
  const vehicle = randomUUID();
  await db.query('INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)', [vehicle, a]);
  await expect(db.query('INSERT INTO "AvailabilityBlock" (id, "organizationId", "vehicleId", "from", "to") VALUES ($1, $2, $3, $4, $5)', [randomUUID(), b, vehicle, "2026-11-01", "2026-11-01"]))
    .rejects.toMatchObject({ code: "23503" });
}));

test("company role requires a company and platform role cannot inherit one", async () => inRollback(async (db) => {
  const a = await organization(db);
  const add = (role: string, company: string | null) => db.query('INSERT INTO "user" (id, name, email, "updatedAt", "organizationId", role) VALUES ($1, $2, $3, now(), $4, $5)', [randomUUID(), "Actor", `${randomUUID()}@example.test`, company, role]);
  await db.query("SAVEPOINT role_scope");
  await expect(add("ADMIN_FIRMY", null)).rejects.toMatchObject({ code: "23514" });
  await db.query("ROLLBACK TO SAVEPOINT role_scope");
  await expect(add("SUPERADMIN_AUTERVA", a)).rejects.toMatchObject({ code: "23514" });
}));

test("one vehicle cannot have two cover images", async () => inRollback(async (db) => {
  const a = await organization(db);
  const vehicle = randomUUID();
  await db.query('INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)', [vehicle, a]);
  const addCover = () => db.query('INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes, "isCover", status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)', [randomUUID(), a, vehicle, `fixture/${randomUUID()}`, "image/webp", 800, 600, 1024, "READY"]);
  await addCover();
  await expect(addCover()).rejects.toMatchObject({ code: "23505" });
}));

test("image accepts 10 000 000 bytes but rejects one byte more", async () => inRollback(async (db) => {
  const company = await organization(db);
  const vehicle = randomUUID();
  await db.query('INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)', [vehicle, company]);
  const add = (bytes: number) => db.query('INSERT INTO "VehicleImage" (id, "organizationId", "vehicleId", "storageKey", mime, width, height, bytes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [randomUUID(), company, vehicle, `fixture/${randomUUID()}`, "image/webp", 800, 600, bytes]);
  await add(10_000_000);
  await expect(add(10_000_001)).rejects.toMatchObject({ code: "23514" });
}));

test.each([
  ["missing end", "2026-10-23T10:00:00Z", null],
  ["missing start", null, "2026-11-06T10:00:00Z"],
])("trial rejects %s after grant", async (_label, start, end) => inRollback(async (db) => {
  const company = await organization(db);
  await expect(db.query('INSERT INTO "ServiceAccess" ("organizationId", "trialGranted", "trialStartedAt", "trialEndsAt") VALUES ($1, true, $2, $3)', [company, start, end]))
    .rejects.toMatchObject({ code: "23514" });
}));

test("read cursor accepts own message and NULL but rejects foreign or missing message", async () => inRollback(async (db) => {
  const a = await organization(db);
  const b = await organization(db);
  const conversationA = randomUUID();
  const conversationB = randomUUID();
  const messageA = randomUUID();
  const messageB = randomUUID();
  const userA = randomUUID();
  await db.query('INSERT INTO "Conversation" (id, "organizationId") VALUES ($1, $2), ($3, $4)', [conversationA, a, conversationB, b]);
  await db.query('INSERT INTO "ChatMessage" (id, "organizationId", "conversationId", "clientMessageId", body) VALUES ($1, $2, $3, $4, $5), ($6, $7, $8, $9, $10)', [messageA, a, conversationA, randomUUID(), "own", messageB, b, conversationB, randomUUID(), "foreign"]);
  await db.query('INSERT INTO "user" (id, name, email, "updatedAt", "organizationId", role) VALUES ($1, $2, $3, now(), $4, $5)', [userA, "A", `${randomUUID()}@example.test`, a, "ADMIN_FIRMY"]);
  const cursor = randomUUID();
  await db.query('INSERT INTO "ConversationReadCursor" (id, "organizationId", "conversationId", "userId", "lastMessageId") VALUES ($1, $2, $3, $4, $5)', [cursor, a, conversationA, userA, null]);
  await db.query('UPDATE "ConversationReadCursor" SET "lastMessageId" = $2 WHERE id = $1', [cursor, messageA]);
  await db.query("SAVEPOINT foreign_cursor");
  await expect(db.query('UPDATE "ConversationReadCursor" SET "lastMessageId" = $2 WHERE id = $1', [cursor, messageB])).rejects.toMatchObject({ code: "23503" });
  await db.query("ROLLBACK TO SAVEPOINT foreign_cursor");
  await expect(db.query('UPDATE "ConversationReadCursor" SET "lastMessageId" = $2 WHERE id = $1', [cursor, randomUUID()])).rejects.toMatchObject({ code: "23503" });
}));

test("trial start and end cannot be moved or granted twice", async () => inRollback(async (db) => {
  const company = await organization(db);
  await db.query('INSERT INTO "ServiceAccess" ("organizationId", "trialGranted", "trialStartedAt", "trialEndsAt") VALUES ($1, true, $2, $3)', [company, "2026-10-23T10:00:00Z", "2026-11-06T10:00:00Z"]);
  await expect(db.query('UPDATE "ServiceAccess" SET "trialStartedAt" = $2, "trialEndsAt" = $3 WHERE "organizationId" = $1', [company, "2026-10-24T10:00:00Z", "2026-11-07T10:00:00Z"]))
    .rejects.toMatchObject({ code: "23514" });
}));

test("first successful company-admin registration timestamp cannot be restarted", async () => inRollback(async (db) => {
  const company = await organization(db);
  await db.query('UPDATE "Organization" SET "firstAdminRegisteredAt" = $2 WHERE id = $1', [company, "2026-10-23T10:00:00Z"]);
  await expect(db.query('UPDATE "Organization" SET "firstAdminRegisteredAt" = $2 WHERE id = $1', [company, "2026-10-24T10:00:00Z"]))
    .rejects.toMatchObject({ code: "23514" });
}));

test("baseline exclusion still rejects a block overlapping on its last inclusive day", async () => inRollback(async (db) => {
  const company = await organization(db);
  const vehicle = randomUUID();
  await db.query('INSERT INTO "Vehicle" (id, "organizationId") VALUES ($1, $2)', [vehicle, company]);
  await db.query('INSERT INTO "AvailabilityBlock" (id, "organizationId", "vehicleId", "from", "to") VALUES ($1, $2, $3, $4, $5)', [randomUUID(), company, vehicle, "2026-11-01", "2026-11-03"]);
  await expect(db.query('INSERT INTO "AvailabilityBlock" (id, "organizationId", "vehicleId", "from", "to") VALUES ($1, $2, $3, $4, $5)', [randomUUID(), company, vehicle, "2026-11-03", "2026-11-05"]))
    .rejects.toMatchObject({ code: "23P01" });
}));
