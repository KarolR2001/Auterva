import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../src/lib/prisma";
import { createMediaStorage, putImmutable, removeObject } from "../../src/modules/media/storage";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const secrets = Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));

type Reply = { status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer };
/** Every call is its own TCP connection with its own (empty) cookie jar: a cold context. */
function call(port: number, host: string, method: string, path: string, options: { cookie?: string; json?: unknown } = {}) {
  const payload = options.json !== undefined ? Buffer.from(JSON.stringify(options.json)) : undefined;
  return new Promise<Reply>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, method, path, agent: false, headers: {
      Host: host, Connection: "close", ...(method === "GET" ? {} : { Origin: `http://${host}` }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(payload ? { "Content-Type": "application/json", "Content-Length": payload.length } : {}) } }, (response) => {
      const parts: Buffer[] = [];
      response.on("data", (chunk: Buffer) => parts.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts) }));
    });
    request.on("error", reject);
    request.end(payload);
  });
}

test("a warmed public photo stops at the next cold request after unpublish; /_next/image never serves media", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const storage = createMediaStorage({ ...process.env, ...secrets });
  const org = randomUUID(); const vehicleId = randomUUID(); const imageId = randomUUID(); const userId = randomUUID();
  const adminHost = `img-e2e-${org}.example.test`; const publicHost = `img-pub-${org}.example.test`;
  const storageKey = `private/${org}/${vehicleId}/${imageId}/raw`;
  const keys = [`${storageKey}/large.webp`, `${storageKey}/thumb.webp`];
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  const categoryId = randomUUID();
  try {
    const webp = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#336699" } }).webp().toBuffer();
    for (const key of keys) await putImmutable(storage, key, webp, "image/webp");
    await db.organization.create({ data: { id: org, slug: `img-e2e-${org}`, firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) } });
    await db.serviceAccess.create({ data: { organizationId: org,
      paidThrough: new Date(`${new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`) } });
    await db.hostMapping.createMany({ data: [
      { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: org, status: "ACTIVE" },
      { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId: org, status: "ACTIVE" }] });
    await db.user.create({ data: { id: userId, name: "Image E2E admin", role: "ADMIN_FIRMY", organizationId: org,
      email: `img-e2e-${userId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    session = await verifiedFixtureSession(db, userId);
    await db.vehicleCategory.create({ data: { id: categoryId, code: `img-e2e-${categoryId}`, name: "Auto", requiresSeats: false } });
    await db.vehicle.create({ data: { id: vehicleId, organizationId: org, status: "PUBLISHED", name: "Auto", slug: "auto",
      categoryId, shortDescription: "K", description: "Opis", availableFrom: new Date("2026-01-01T00:00:00.000Z") } });
    await db.vehicleImage.create({ data: { id: imageId, organizationId: org, vehicleId, storageKey, mime: "image/webp",
      width: 8, height: 6, bytes: webp.length, status: "READY", isCover: true,
      variants: { large: keys[0], thumb: keys[1] } } });
    const url = `/api/public/media/${imageId}/large/`;
    for (let n = 0; n < 3; n++) {
      const warm = await call(port, publicHost, "GET", url);
      expect(warm.status).toBe(200);
      expect(warm.headers["cache-control"]).toBe("no-store");
      expect(warm.body.equals(webp)).toBe(true);
    }
    expect((await call(port, publicHost, "GET", `/api/public/media/${imageId}/raw/`)).status).toBe(404);
    // the optimizer must not fetch (and cache) media routes
    for (const target of [url, `/api/admin/vehicles/${vehicleId}/images/${imageId}/large/`])
      expect((await call(port, publicHost, "GET", `/_next/image/?url=${encodeURIComponent(target)}&w=640&q=75`)).status).toBe(400);
    // private preview needs the session; the public host never serves it
    const preview = `/api/admin/vehicles/${vehicleId}/images/${imageId}/large/`;
    expect((await call(port, adminHost, "GET", preview)).status).toBe(403);
    const ok = await call(port, adminHost, "GET", preview, { cookie: session.cookie });
    expect([ok.status, ok.headers["cache-control"]]).toEqual([200, "private, no-store"]);
    expect((await call(port, publicHost, "GET", preview, { cookie: session.cookie })).status).toBe(404);
    // unpublish through the real route, then read from a cold context
    const unpublish = await call(port, adminHost, "POST", `/api/admin/vehicles/${vehicleId}/unpublish/`,
      { cookie: session.cookie, json: { expectedVersion: 0 } });
    expect(unpublish.status).toBe(200);
    const gone = await call(port, publicHost, "GET", url);
    expect(gone.status).toBe(404);
    expect(gone.headers["cache-control"]).toBe("no-store");
    expect((await call(port, publicHost, "GET", `/api/public/media/${imageId}/thumb/`)).status).toBe(404);
    expect((await call(port, adminHost, "GET", preview, { cookie: session.cookie })).status).toBe(200);
  } finally {
    for (const key of [...keys]) await removeObject(storage, key).catch(() => {});
    storage.client.destroy();
    await db.auditLog.deleteMany({ where: { organizationId: org } });
    await db.vehicleImage.deleteMany({ where: { organizationId: org } });
    await db.vehicle.deleteMany({ where: { id: vehicleId } });
    await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
    if (session) await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.hostMapping.deleteMany({ where: { organizationId: org } });
    await db.serviceAccess.deleteMany({ where: { organizationId: org } });
    await db.organization.deleteMany({ where: { id: org } });
    await db.$disconnect();
  }
});
