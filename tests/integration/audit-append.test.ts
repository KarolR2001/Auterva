import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { appendAudit } from "../../src/modules/audit/append";
import { listAudit } from "../../src/modules/audit/read";
import { ensureControlledSuperadminMfa } from "../fixtures/verified-session";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const organizations = [randomUUID(), randomUUID()];
const admins = [randomUUID(), randomUUID()];
const sessions = [randomUUID(), randomUUID()];
const vehicles = [randomUUID(), randomUUID()];
const auditIds: string[] = [];
const platformSession = randomUUID();
let platformUserId: string;
let createdPlatformUser = false;

beforeAll(async () => {
  const existingPlatform = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  platformUserId = existingPlatform?.id ?? randomUUID();
  if (existingPlatform) await ensureControlledSuperadminMfa(db, platformUserId);
  else {
    await db.user.create({ data: { id: platformUserId, name: "Audit platform", email: `audit-${platformUserId}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdPlatformUser = true;
  }
  await db.organization.createMany({ data: organizations.map((id) => ({ id, slug: `audit-${id}` })) });
  for (const index of [0, 1]) {
    await db.vehicle.create({ data: { id: vehicles[index], organizationId: organizations[index], name: `Audit car ${index}` } });
    await db.user.create({ data: {
      id: admins[index], name: `Audit admin ${index}`, email: `audit-${admins[index]}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: organizations[index],
    } });
    await db.session.create({ data: {
      id: sessions[index], userId: admins[index], token: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000), mfaVerifiedAt: new Date(),
    } });
  }
  await db.session.create({ data: { id: platformSession, userId: platformUserId, token: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000), mfaVerifiedAt: new Date() } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.session.deleteMany({ where: { id: { in: sessions } } });
  await db.session.deleteMany({ where: { id: platformSession } });
  await db.user.deleteMany({ where: { id: { in: admins } } });
  if (createdPlatformUser) await db.user.delete({ where: { id: platformUserId } });
  await db.vehicle.deleteMany({ where: { id: { in: vehicles } } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});

test("tenant read refuses B and real platform actor remains platform actor for A", async () => {
  const legacy = await db.auditLog.create({ data: {
    organizationId: organizations[0], actorId: "operator:legacy", actorRole: "OPERATOR",
    action: "MFA_OPERATOR_RECOVERY", entityType: "User", entityId: admins[0], requestId: randomUUID(),
    safeChanges: { evidenceReference: "private-reference", channel: "private-channel" },
  } });
  auditIds.push(legacy.id);
  const company = await db.$transaction((tx) => appendAudit(tx, {
    actorId: admins[1], sessionId: sessions[1], organizationId: organizations[1],
    action: "VEHICLE_UPDATED", entityId: vehicles[1], eventKey: randomUUID(), requestId: randomUUID(),
  }));
  auditIds.push(company.id);
  const platform = await db.$transaction((tx) => appendAudit(tx, {
    actorId: platformUserId, sessionId: platformSession, organizationId: organizations[0],
    action: "VEHICLE_UPDATED", entityId: randomUUID(), eventKey: randomUUID(), requestId: randomUUID(),
    changes: { changedFields: ["status"] },
  }));
  auditIds.push(platform.id);
  expect(platform).toMatchObject({ actorId: platformUserId, actorRole: "SUPERADMIN_AUTERVA", organizationId: organizations[0] });
  const rowsA = await listAudit(db, { actorId: admins[0], sessionId: sessions[0], organizationId: organizations[0] });
  expect(rowsA.some((row) => row.id === platform.id)).toBe(true);
  expect(rowsA.some((row) => row.id === company.id)).toBe(false);
  expect(rowsA.find((row) => row.id === legacy.id)?.safeChanges).toBeNull();
  await expect(listAudit(db, { actorId: admins[0], sessionId: sessions[0], organizationId: organizations[1] })).rejects.toThrow();
  const platformRowsB = await listAudit(db, { actorId: platformUserId, sessionId: platformSession, organizationId: organizations[1] });
  expect(platformRowsB.some((row) => row.id === company.id)).toBe(true);
  expect(platformRowsB.some((row) => row.id === platform.id)).toBe(false);
});

test("domain change and true actor audit commit together, with one event per operation key", async () => {
  const eventKey = randomUUID();
  const requestId = randomUUID();
  const event = await db.$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id: vehicles[0] }, data: { name: "Changed by A", featured: true } });
    return appendAudit(tx, {
      actorId: admins[0], sessionId: sessions[0], organizationId: organizations[0],
      action: "VEHICLE_UPDATED", entityId: vehicles[0], eventKey, requestId,
      changes: { changedFields: ["name", "featured"], before: { featured: false }, after: { featured: true } },
    });
  });
  auditIds.push(event.id);
  expect(event).toMatchObject({ actorId: admins[0], actorRole: "ADMIN_FIRMY", organizationId: organizations[0], action: "VEHICLE_UPDATED" });
  expect(event.safeChanges).toEqual({ changedFields: ["name", "featured"], before: { featured: false }, after: { featured: true } });
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: vehicles[0] } })).name).toBe("Changed by A");
  await expect(db.$transaction(async (tx) => {
    await tx.vehicle.update({ where: { id: vehicles[0] }, data: { name: "Duplicate retry" } });
    await appendAudit(tx, {
      actorId: admins[0], sessionId: sessions[0], organizationId: organizations[0],
      action: "VEHICLE_UPDATED", entityId: vehicles[0], eventKey, requestId,
      changes: { changedFields: ["name"] },
    });
  })).rejects.toThrow();
  expect((await db.vehicle.findUniqueOrThrow({ where: { id: vehicles[0] } })).name).toBe("Changed by A");
  expect(await db.auditLog.count({ where: { eventKey } })).toBe(1);
});

test("wrong tenant, revoked MFA proof, unsafe payload and rollback cannot leave an audit", async () => {
  const before = await db.auditLog.count({ where: { organizationId: organizations[1] } });
  await expect(db.$transaction((tx) => appendAudit(tx, {
    actorId: admins[0], sessionId: sessions[0], organizationId: organizations[1],
    action: "VEHICLE_UPDATED", entityId: randomUUID(), eventKey: randomUUID(), requestId: randomUUID(),
    changes: { changedFields: ["status"] },
  }))).rejects.toThrow();
  expect(await db.auditLog.count({ where: { organizationId: organizations[1] } })).toBe(before);
  await expect(db.$transaction((tx) => appendAudit(tx, {
    actorId: admins[1], sessionId: sessions[1], organizationId: organizations[1],
    action: "VEHICLE_UPDATED", entityId: vehicles[1], eventKey: randomUUID(), requestId: randomUUID(),
    changes: { changedFields: ["email"], before: { email: "private@example.test" } } as never,
  }))).rejects.toThrow("Unsafe audit snapshot");
  for (const changes of [
    { changedFields: ["status"], after: { status: "127.0.0.1" } },
    { changedFields: ["startDate"], after: { startDate: "2026-02-30" } },
    { changedFields: ["isCover"], after: { isCover: "true" } },
    { changedFields: ["sortOrder"], after: { sortOrder: -1 } },
  ]) {
    await expect(db.$transaction((tx) => appendAudit(tx, {
      actorId: admins[1], sessionId: sessions[1], organizationId: organizations[1],
      action: "VEHICLE_UPDATED", entityId: vehicles[1], eventKey: randomUUID(), requestId: randomUUID(),
      changes: changes as never,
    }))).rejects.toThrow("Unsafe audit snapshot");
  }
  await expect(db.$transaction((tx) => appendAudit(tx, {
    actorId: admins[0], sessionId: sessions[0], organizationId: organizations[0],
    action: "COMPANY_UPDATED", entityId: organizations[0], eventKey: randomUUID(), requestId: randomUUID(),
  }))).rejects.toThrow("platform actor");
  const id = randomUUID();
  await expect(db.$transaction(async (tx) => {
    await appendAudit(tx, {
      actorId: admins[1], sessionId: sessions[1], organizationId: organizations[1],
      action: "VEHICLE_UPDATED", entityId: id, eventKey: randomUUID(), requestId: randomUUID(),
      changes: { changedFields: ["status"], password: "secret" } as never,
    });
  })).rejects.toThrow();
  expect(await db.auditLog.count({ where: { organizationId: organizations[1] } })).toBe(before);
  await db.session.update({ where: { id: sessions[1] }, data: { mfaVerifiedAt: null } });
  await expect(db.$transaction((tx) => appendAudit(tx, {
    actorId: admins[1], sessionId: sessions[1], organizationId: organizations[1],
    action: "VEHICLE_UPDATED", entityId: id, eventKey: randomUUID(), requestId: randomUUID(),
  }))).rejects.toThrow();
  await db.session.update({ where: { id: sessions[1] }, data: { mfaVerifiedAt: new Date() } });
  await expect(db.$transaction(async (tx) => {
    const row = await appendAudit(tx, {
      actorId: admins[1], sessionId: sessions[1], organizationId: organizations[1],
      action: "VEHICLE_UPDATED", entityId: id, eventKey: randomUUID(), requestId: randomUUID(),
    });
    auditIds.push(row.id);
    throw new Error("domain mutation failed");
  })).rejects.toThrow("domain mutation failed");
  expect(await db.auditLog.count({ where: { organizationId: organizations[1] } })).toBe(before);
});
