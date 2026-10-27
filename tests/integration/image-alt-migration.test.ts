import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { defaultImageAlt } from "../../src/modules/media/vehicle-images";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const org = randomUUID();
const sql = readFileSync(new URL("../../prisma/migrations/20261028090000_image_default_alt_read_time_issue_40/migration.sql", import.meta.url), "utf8");
const names = ["Bus 9", "<b>Bus</b>‮  9", "x".repeat(500), "  Zażółć   gęślą  ", null];
const vehicles = names.map(() => randomUUID());

beforeAll(async () => {
  await db.organization.create({ data: { id: org, slug: `alt-${org}` } });
  for (const [index, name] of names.entries()) {
    await db.vehicle.create({ data: { id: vehicles[index], organizationId: org, slug: `alt-${index}-${org}`, name } });
  }
});
afterAll(async () => {
  await db.vehicleImage.deleteMany({ where: { organizationId: org } });
  await db.vehicle.deleteMany({ where: { organizationId: org } });
  await db.organization.deleteMany({ where: { id: org } });
  await db.$disconnect();
});

test("the migration clears exactly the stored defaults of #32 and keeps manual or stale text", async () => {
  let n = 0;
  const row = (vehicleId: string, position: number, alt: string | null) => db.vehicleImage.create({ data: {
    id: randomUUID(), organizationId: org, vehicleId, storageKey: `alt/${org}/${n++}`, mime: "image/webp", width: 1, height: 1,
    bytes: 1, status: "READY", position, alt } });
  const generated = [];
  for (const [index, name] of names.entries()) generated.push(await row(vehicles[index], 2, defaultImageAlt(name, 2)));
  const manual = await row(vehicles[0], 3, "Przód auta");
  const lookalike = await row(vehicles[0], 4, "Widok wnętrza, zdjęcie 5");
  const stale = await row(vehicles[0], 5, "Stara nazwa, zdjęcie 6");
  const shifted = await row(vehicles[0], 6, "Bus 9, zdjęcie 1");
  const empty = await row(vehicles[0], 8, null);
  await db.$executeRawUnsafe(sql);
  const alt = async (id: string) => (await db.vehicleImage.findUniqueOrThrow({ where: { id } })).alt;
  for (const image of generated) expect(await alt(image.id)).toBeNull();
  expect(await alt(manual.id)).toBe("Przód auta");
  expect(await alt(lookalike.id)).toBe("Widok wnętrza, zdjęcie 5");
  expect(await alt(stale.id)).toBe("Stara nazwa, zdjęcie 6");
  expect(await alt(shifted.id)).toBe("Bus 9, zdjęcie 1"); // position drifted after upload: kept (documented compromise)
  expect(await alt(empty.id)).toBeNull();
  await db.$executeRawUnsafe(sql); // idempotent
  expect(await alt(manual.id)).toBe("Przód auta");
});
