import { randomUUID } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { Client } from "pg";
import { expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { createVehicle, editVehicle } from "../../src/modules/fleet/mutations";
import { sqlDate } from "../../src/modules/availability/dates";
import { verifiedFixtureSession } from "../fixtures/verified-session";

async function waitForLock(observer: Client, predicate: (row: { pid: number; query: string }) => boolean) {
  const until = Date.now() + 5_000;
  while (Date.now() < until) {
    const result = await observer.query<{ pid: number; query: string }>(
      "SELECT pid, query FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'");
    if (result.rows.some(predicate)) return;
    await setImmediate();
  }
  throw new Error("Expected PostgreSQL row-lock waiter was not observed");
}

test("activity edit and block writer serialize on Vehicle and recheck after the lock", async () => {
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const writer = new Client({ connectionString: process.env.DATABASE_URL });
  const observer = new Client({ connectionString: process.env.DATABASE_URL });
  await Promise.all([writer.connect(), observer.connect()]);
  const writerPid = Number((await writer.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid);
  const organizationId = randomUUID();
  const userId = randomUUID();
  let vehicleId: string | undefined;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  let writerInTransaction = false;
  try {
    await db.organization.create({ data: { id: organizationId, slug: `fleet-race-${organizationId}` } });
    await db.user.create({ data: { id: userId, organizationId, name: "Race admin",
      role: "ADMIN_FIRMY", email: `fleet-race-${userId}@example.test`,
      emailVerified: true, twoFactorEnabled: true } });
    session = await verifiedFixtureSession(db, userId);
    const token = session.cookie.split("=")[1].split(".")[0];
    const sessionId = (await db.session.findUniqueOrThrow({ where: { token } })).id;
    const operation = () => ({ actorId: userId, sessionId, organizationId, requestId: randomUUID() });
    const created = await createVehicle(db, { ...operation(), fields: { name: "Race",
      availableFrom: "2026-10-25", availableTo: "2026-10-27" } });
    vehicleId = created.id;

    // Block writer wins the row lock. The real edit waits, then sees the committed block.
    await writer.query("BEGIN");
    writerInTransaction = true;
    await writer.query('SELECT id FROM "Vehicle" WHERE id = $1 FOR UPDATE', [vehicleId]);
    const losingEdit = editVehicle(db, { ...operation(), vehicleId, expectedVersion: 0,
      fields: { availableFrom: "2026-10-27", availableTo: "2026-10-27" } });
    await waitForLock(observer, (row) => row.pid !== writerPid && row.query.includes('"Vehicle"'));
    await writer.query('INSERT INTO "AvailabilityBlock" (id, "organizationId", "vehicleId", "from", "to") VALUES ($1,$2,$3,$4,$5)',
      [randomUUID(), organizationId, vehicleId, "2026-10-26", "2026-10-26"]);
    await writer.query("COMMIT");
    writerInTransaction = false;
    await expect(losingEdit).rejects.toThrow("FLEET_BLOCK_OUTSIDE_ACTIVITY");
    expect((await db.vehicle.findUniqueOrThrow({ where: { id: vehicleId } })).availableFrom)
      .toEqual(sqlDate("2026-10-25"));
    await db.availabilityBlock.deleteMany({ where: { organizationId, vehicleId } });

    // The real edit wins. A future #38 block writer waits and must validate the new activity.
    let releaseEdit!: () => void;
    let reachedUpdate!: () => void;
    const paused = new Promise<void>((resolve) => { releaseEdit = resolve; });
    const reached = new Promise<void>((resolve) => { reachedUpdate = resolve; });
    const pausedDb = db.$extends({ query: { vehicle: {
      async updateMany({ args, query }) { reachedUpdate(); await paused; return query(args); },
    } } });
    const winningEdit = editVehicle(pausedDb as typeof db, { ...operation(), vehicleId,
      expectedVersion: 0, fields: { availableFrom: "2026-10-27", availableTo: "2026-10-27" } });
    await reached;
    await writer.query("BEGIN");
    writerInTransaction = true;
    const blockLock = writer.query('SELECT "availableFrom"::text AS "fromDate", "availableTo"::text AS "toDate" FROM "Vehicle" WHERE id = $1 FOR UPDATE', [vehicleId]);
    await waitForLock(observer, (row) => row.pid === writerPid);
    releaseEdit();
    expect((await winningEdit).version).toBe(1);
    const current = await blockLock;
    expect(current.rows[0].fromDate).toBe("2026-10-27");
    const requestedBlockDate = "2026-10-26";
    expect(requestedBlockDate < current.rows[0].fromDate).toBe(true);
    await writer.query("ROLLBACK");
    writerInTransaction = false;
    expect(await db.availabilityBlock.count({ where: { organizationId, vehicleId } })).toBe(0);
  } finally {
    if (writerInTransaction) await writer.query("ROLLBACK").catch(() => undefined);
    if (vehicleId) {
      await db.availabilityBlock.deleteMany({ where: { organizationId, vehicleId } });
      await db.auditLog.deleteMany({ where: { organizationId } });
      await db.vehicle.deleteMany({ where: { organizationId } });
    }
    if (session) await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await Promise.all([db.$disconnect(), writer.end(), observer.end()]);
  }
}, 15_000);
