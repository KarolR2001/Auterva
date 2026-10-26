import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { availabilityToday, sqlDate } from "../../src/modules/availability/dates";
import { verifiedFixtureSession } from "../fixtures/verified-session";

function onHost(port: number, host: string, path: string,
  options: { method?: string; cookie?: string; body?: object } = {}) {
  const data = options.body === undefined ? null : JSON.stringify(options.body);
  return new Promise<{ status: number; body: Record<string, unknown>; cache: string | undefined }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
      headers: { Host: host, ...(options.cookie ? { Cookie: options.cookie } : {}),
        ...(options.method && options.method !== "GET" ? { Origin: `http://${host}` } : {}),
        ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}) },
    }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0,
          body: raw && response.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : {},
          cache: response.headers["cache-control"] }); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(data ?? undefined);
  });
}

test("built ingress saves a draft, validates publication and stops public reads on hide or period expiry", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = Number(new URL(baseURL).port);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const categoryId = randomUUID();
  const adminHost = `fleet-admin-${organizationId}.example.test`;
  const publicHost = `fleet-public-${organizationId}.example.test`;
  const today = availabilityToday();
  const yesterday = new Date(`${today}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  let vehicleId: string | undefined;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  await db.organization.create({ data: { id: organizationId, slug: `fleet-e2e-${organizationId}`,
    firstAdminRegisteredAt: new Date() } });
  try {
    await db.user.create({ data: { id: userId, name: "Fleet E2E admin", role: "ADMIN_FIRMY",
      organizationId, email: `fleet-e2e-${userId}@example.test`, emailVerified: true,
      twoFactorEnabled: true } });
    session = await verifiedFixtureSession(db, userId);
    await db.vehicleCategory.create({ data: { id: categoryId, code: `fleet-e2e-${categoryId}`,
      name: "Auto", requiresSeats: false } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost, organizationId, area: "COMPANY_ADMIN", status: "ACTIVE" },
      { hostname: publicHost, organizationId, area: "COMPANY_PUBLIC", status: "ACTIVE" },
    ] });
    await db.serviceAccess.create({ data: { organizationId, paidThrough: sqlDate(today) } });
    const root = "/api/admin/vehicles/";
    const draft = await onHost(port, adminHost, root, { method: "POST", cookie: session.cookie,
      body: { fields: { name: "Auto E2E", price: null } } });
    expect(draft.status).toBe(201);
    expect(draft.cache).toBe("no-store");
    vehicleId = draft.body.id as string;
    const slug = draft.body.slug as string;
    expect(slug).toBe("auto-e2e");
    const publishPath = `${root}${vehicleId}/publish/`;
    const refused = await onHost(port, adminHost, publishPath, { method: "POST", cookie: session.cookie,
      body: { expectedVersion: 0 } });
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: "PUBLISHING_REQUIREMENTS_NOT_MET",
      fieldErrors: { description: expect.any(String), images: expect.any(String) } });
    const edited = await onHost(port, adminHost, `${root}${vehicleId}/`, { method: "PATCH", cookie: session.cookie,
      body: { expectedVersion: 0, fields: { categoryId, shortDescription: "Opis",
        description: "Pełny opis", availableFrom: today } } });
    expect(edited.status).toBe(200);
    await db.vehicleImage.create({ data: { organizationId, vehicleId, status: "READY", isCover: true,
      storageKey: `fleet/e2e/${vehicleId}/cover.webp`, mime: "image/webp", width: 600, height: 400, bytes: 1000 } });
    expect((await onHost(port, adminHost, publishPath, { method: "POST", cookie: session.cookie,
      body: { expectedVersion: 1 } })).status).toBe(200);
    const check = "/api/public/availability/check/";
    expect((await onHost(port, publicHost, check,
      { method: "POST", body: { slug, from: today, to: today } })).body).toEqual({ available: true });
    expect((await onHost(port, adminHost, `${root}?status=PUBLISHED&availableToday=true`,
      { cookie: session.cookie })).body).toMatchObject({ total: 1,
      items: [{ id: vehicleId, availableToday: true }] });
    expect((await onHost(port, adminHost, `${root}${vehicleId}/unpublish/`, { method: "POST",
      cookie: session.cookie, body: { expectedVersion: 2 } })).status).toBe(200);
    expect((await onHost(port, publicHost, check,
      { method: "POST", body: { slug, from: today, to: today } })).status).toBe(404);
    await db.serviceAccess.update({ where: { organizationId },
      data: { paidThrough: sqlDate(yesterday.toISOString().slice(0, 10)) } });
    expect((await onHost(port, adminHost, `${root}${vehicleId}/`, { method: "PATCH", cookie: session.cookie,
      body: { expectedVersion: 3, fields: { name: "Edycja po końcu okresu" } } })).status).toBe(200);
    expect((await onHost(port, publicHost, check,
      { method: "POST", body: { slug, from: today, to: today } })).status).toBe(404);
  } finally {
    await db.vehicleImage.deleteMany({ where: { organizationId } });
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.vehicle.deleteMany({ where: { organizationId } });
    await db.serviceAccess.deleteMany({ where: { organizationId } });
    await db.hostMapping.deleteMany({ where: { organizationId } });
    if (session) await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
    await db.organization.delete({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
