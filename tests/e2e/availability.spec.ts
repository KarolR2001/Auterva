import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

function onHost(port: number, host: string, path: string, body?: object, extra: { method?: string; cookie?: string } = {}) {
  const data = body ? JSON.stringify(body) : null;
  const method = extra.method ?? (body ? "POST" : "GET");
  return new Promise<{ status: number; body: unknown; cacheControl: string | undefined }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method,
      headers: { Host: host, ...(extra.cookie ? { Cookie: extra.cookie } : {}),
        ...(method !== "GET" ? { Origin: `http://${host}` } : {}), ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0,
          body: raw && response.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : null,
          cacheControl: response.headers["cache-control"] }); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(data ?? undefined);
  });
}

test("built public availability reflects committed block and period changes on the mapped host", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = Number(new URL(baseURL).port);
  const organizationId = randomUUID();
  const vehicleId = randomUUID();
  const host = `availability-http-${organizationId}.example.test`;
  const slug = `availability-http-${vehicleId}`;
  const today = availabilityToday();
  const now = new Date();
  await db.organization.create({ data: { id: organizationId, slug: `availability-http-${organizationId}`,
    firstAdminRegisteredAt: now } });
  try {
    await db.hostMapping.create({ data: { hostname: host, organizationId, area: "COMPANY_PUBLIC", status: "ACTIVE" } });
    await db.serviceAccess.create({ data: { organizationId, trialGranted: true, trialStartedAt: now,
      trialEndsAt: new Date(now.getTime() + 336 * 60 * 60_000) } });
    await db.vehicle.create({ data: { id: vehicleId, organizationId, slug, status: "PUBLISHED",
      availableFrom: sqlDate(today) } });
    await db.availabilityBlock.create({ data: { organizationId, vehicleId, from: sqlDate(today), to: sqlDate(today),
      type: "MAINTENANCE", internalNote: "never-public" } });
    const path = "/api/public/availability/check/";
    const body = { slug, from: today, to: today };
    const blocked = await onHost(port, host, path, body);
    expect(blocked.status).toBe(200);
    expect(blocked.body).toEqual({ available: false });
    expect(blocked.cacheControl).toBe("no-store");
    expect((await onHost(port, host, `/api/public/vehicles/${slug}/calendar/?from=${today}&to=${today}`)).body)
      .toEqual({ days: [{ date: today, available: false }] });
    expect((await onHost(port, `other.${host}`, path, body)).status).toBe(404);
    await db.availabilityBlock.deleteMany({ where: { vehicleId } });
    expect((await onHost(port, host, path, body)).body).toEqual({ available: true });
    await db.organization.update({ where: { id: organizationId }, data: { publicUnlockRequired: true } });
    expect((await onHost(port, host, path, body)).status).toBe(404);
  } finally {
    await db.availabilityBlock.deleteMany({ where: { vehicleId } });
    await db.vehicle.deleteMany({ where: { id: vehicleId } });
    await db.serviceAccess.deleteMany({ where: { organizationId } });
    await db.hostMapping.deleteMany({ where: { hostname: host } });
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }
});

test("built ingress: an admin block write is immediately visible to a separate public context, A/B stay isolated", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = Number(new URL(baseURL).port);
  const [orgA, orgB, adminA, adminB, vehicleA, vehicleB] = Array.from({ length: 6 }, () => randomUUID());
  const hosts = { adminA: `blk-e2e-admin-a-${orgA}.example.test`, adminB: `blk-e2e-admin-b-${orgB}.example.test`,
    publicA: `blk-e2e-public-a-${orgA}.example.test`, publicB: `blk-e2e-public-b-${orgB}.example.test` };
  const slugA = `blk-e2e-a-${vehicleA}`;
  const slugB = `blk-e2e-b-${vehicleB}`;
  const today = availabilityToday();
  const day = (offset: number) => new Date(sqlDate(today).getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const now = new Date();
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  try {
    for (const [id, slug] of [[orgA, "a"], [orgB, "b"]]) {
      await db.organization.create({ data: { id, slug: `blk-e2e-${slug}-${id}`, firstAdminRegisteredAt: now } });
      await db.serviceAccess.create({ data: { organizationId: id, trialGranted: true, trialStartedAt: now,
        trialEndsAt: new Date(now.getTime() + 336 * 3_600_000) } });
    }
    await db.hostMapping.createMany({ data: [
      { hostname: hosts.adminA, organizationId: orgA, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: hosts.adminB, organizationId: orgB, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: hosts.publicA, organizationId: orgA, area: "COMPANY_PUBLIC", status: "ACTIVE" },
      { hostname: hosts.publicB, organizationId: orgB, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    ] });
    await db.vehicle.createMany({ data: [
      { id: vehicleA, organizationId: orgA, slug: slugA, status: "PUBLISHED", availableFrom: sqlDate(day(0)) },
      { id: vehicleB, organizationId: orgB, slug: slugB, status: "PUBLISHED", availableFrom: sqlDate(day(0)) },
    ] });
    for (const [id, organizationId] of [[adminA, orgA], [adminB, orgB]]) {
      await db.user.create({ data: { id, name: "Block E2E admin", role: "ADMIN_FIRMY", organizationId,
        email: `blk-e2e-${id}@example.test`, emailVerified: true, twoFactorEnabled: true } });
      sessions.push(await verifiedFixtureSession(db, id));
    }
    const check = (host: string, slug: string) => onHost(port, host, "/api/public/availability/check/",
      { slug, from: day(2), to: day(3) });
    expect((await check(hosts.publicA, slugA)).body).toEqual({ available: true }); // warm public read
    const created = await onHost(port, hosts.adminA, `/api/admin/vehicles/${vehicleA}/blocks/`,
      { fields: { from: day(2), to: day(3), type: "MAINTENANCE", reference: "E2E-SECRET", internalNote: "E2E-NOTE" } },
      { cookie: sessions[0].cookie });
    expect(created.status).toBe(201);
    const block = created.body as { id: string; version: number };
    const fresh = await check(hosts.publicA, slugA);
    expect(fresh.body).toEqual({ available: false });
    expect(JSON.stringify(fresh.body)).not.toMatch(/E2E-|MAINTENANCE|Serwis/);
    expect(fresh.cacheControl).toBe("no-store");
    expect((await onHost(port, hosts.adminA, `/api/admin/vehicles/${vehicleA}/blocks/`,
      { fields: { from: day(3), to: day(4), type: "OTHER" } }, { cookie: sessions[0].cookie })).status).toBe(409);
    const blockPath = `/api/admin/vehicles/${vehicleA}/blocks/${block.id}/`;
    expect((await onHost(port, hosts.adminB, blockPath, { expectedVersion: 0, fields: { type: "OTHER" } },
      { method: "PATCH", cookie: sessions[1].cookie })).status).toBe(404);
    expect((await check(hosts.publicB, slugB)).body).toEqual({ available: true });
    expect((await onHost(port, hosts.adminA, blockPath, { expectedVersion: 0 },
      { method: "DELETE", cookie: sessions[0].cookie })).status).toBe(200);
    expect((await check(hosts.publicA, slugA)).body).toEqual({ available: true });
  } finally {
    await db.availabilityBlock.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.vehicle.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.hostMapping.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    for (const session of sessions) await session.dispose();
    await db.user.deleteMany({ where: { id: { in: [adminA, adminB] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  }
});
