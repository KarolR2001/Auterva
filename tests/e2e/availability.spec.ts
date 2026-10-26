import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";

function onHost(port: number, host: string, path: string, body?: object) {
  const data = body ? JSON.stringify(body) : null;
  return new Promise<{ status: number; body: unknown; cacheControl: string | undefined }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path,
      method: body ? "POST" : "GET",
      headers: { Host: host, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) },
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
