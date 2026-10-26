import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { createMediaStorage } from "../../src/modules/media/storage";
import { cleanupExpiredImageUploads } from "../../src/modules/media/worker";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizationId = randomUUID();
const vehicleId = randomUUID();
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const storage = createMediaStorage({ ...process.env, ...secrets });
const now = new Date();
const old = new Date(now.getTime() - 3_600_000);

function row(state: string, updatedAt: Date, expiresAt: Date) {
  const id = randomUUID();
  const imageId = randomUUID();
  return { id, organizationId, vehicleId, reservationKey: randomUUID(), imageId, state,
    stagingKey: `staging/${organizationId}/${vehicleId}/${id}`,
    rawKey: `private/${organizationId}/${vehicleId}/${imageId}/raw`,
    createdAt: new Date(updatedAt.getTime() - 60_000), updatedAt, expiresAt };
}

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `cleanup-${organizationId}` } });
  await db.vehicle.create({ data: { id: vehicleId, organizationId } });
});

afterAll(async () => {
  await db.imageUpload.deleteMany({ where: { organizationId } });
  await db.vehicle.deleteMany({ where: { id: vehicleId } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  storage.client.destroy();
  await db.$disconnect();
});

test("a FAILED upload gets its cleanup marker at once; the next pass does nothing", async () => {
  const failed = row("FAILED", old, new Date(old.getTime() + 60_000));
  await db.imageUpload.create({ data: failed });
  expect(await cleanupExpiredImageUploads(db, storage, now)).toBe(1);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: failed.id } })).storageCleanedAt).not.toBeNull();
  expect(await cleanupExpiredImageUploads(db, storage, now)).toBe(0);
});

test("more than 100 FAILED uploads never block a new expired reservation", async () => {
  const failed = Array.from({ length: 101 }, (_, index) =>
    row("FAILED", new Date(old.getTime() + index), new Date(old.getTime() + 60_000)));
  const stale = row("RESERVED", new Date(now.getTime() - 600_000), new Date(now.getTime() - 120_000));
  await db.imageUpload.createMany({ data: [...failed, stale] });
  let total = 0;
  for (let pass = 0; pass < 3; pass++) total += await cleanupExpiredImageUploads(db, storage, now);
  expect(total).toBe(102);
  expect((await db.imageUpload.findUniqueOrThrow({ where: { id: stale.id } })).state).toBe("EXPIRED");
  expect(await db.imageUpload.count({ where: { organizationId, storageCleanedAt: null } })).toBe(0);
  expect(await cleanupExpiredImageUploads(db, storage, now)).toBe(0);
}, 60_000);
