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
function call(port: number, host: string, path: string, cookie?: string) {
  return new Promise<Reply>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, method: "GET", path, agent: false,
      headers: { Host: host, Connection: "close", ...(cookie ? { Cookie: cookie } : {}) } }, (response) => {
      const parts: Buffer[] = [];
      response.on("data", (chunk: Buffer) => parts.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(parts) }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("protected preview of a draft works for its admin after the period ended, copied URLs get nothing", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const storage = createMediaStorage({ ...process.env, ...secrets });
  const [orgA, orgB, vehicleId, imageId, categoryId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const adminIds = [randomUUID(), randomUUID()];
  const adminHost = [`pv-e2e-a-${orgA}.example.test`, `pv-e2e-b-${orgB}.example.test`];
  const publicHost = `pv-e2e-pub-${orgA}.example.test`;
  const storageKey = `private/${orgA}/${vehicleId}/${imageId}/raw`;
  const keys = [`${storageKey}/large.webp`, `${storageKey}/thumb.webp`];
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  try {
    const webp = await sharp({ create: { width: 8, height: 6, channels: 3, background: "#336699" } }).webp().toBuffer();
    for (const key of keys) await putImmutable(storage, key, webp, "image/webp");
    await db.vehicleCategory.create({ data: { id: categoryId, code: `pv-e2e-${categoryId}`, name: "Auto", requiresSeats: false } });
    for (const [index, id] of [orgA, orgB].entries()) {
      await db.organization.create({ data: { id, slug: `pv-e2e-${id}`, firstAdminRegisteredAt: new Date(Date.now() - 40 * 86_400_000) } });
      // Company A's paid period ended five days ago.
      await db.serviceAccess.create({ data: { organizationId: id,
        paidThrough: new Date(`${day(index === 0 ? -5 : 30)}T00:00:00.000Z`) } });
      await db.hostMapping.create({ data: { hostname: adminHost[index], area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" } });
      await db.user.create({ data: { id: adminIds[index], name: `Preview E2E ${index}`, role: "ADMIN_FIRMY", organizationId: id,
        email: `pv-e2e-${adminIds[index]}@example.test`, emailVerified: true, twoFactorEnabled: true } });
      sessions.push(await verifiedFixtureSession(db, adminIds[index]));
    }
    await db.hostMapping.create({ data: { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId: orgA, status: "ACTIVE" } });
    await db.vehicle.create({ data: { id: vehicleId, organizationId: orgA, status: "DRAFT", name: "Szkic", slug: "szkic",
      categoryId, shortDescription: "K", description: "Opis", availableFrom: new Date(`${day(-1)}T00:00:00.000Z`) } });
    await db.vehicleImage.create({ data: { id: imageId, organizationId: orgA, vehicleId, storageKey, mime: "image/webp",
      width: 8, height: 6, bytes: webp.length, status: "READY", isCover: true, variants: { large: keys[0], thumb: keys[1] } } });

    const page = `/api/admin/preview/vehicles/${vehicleId}/`;
    const asset = `/api/admin/preview/media/${imageId}/large/`;
    const ok = await call(port, adminHost[0], page, sessions[0].cookie);
    expect([ok.status, ok.headers["cache-control"]]).toEqual([200, "private, no-store"]);
    expect(ok.headers["x-robots-tag"]).toContain("noindex");
    const body = JSON.parse(ok.body.toString()) as { preview: { vehicle: { status: string } }; vehicle: { gallery: { urls: { large: string } }[] } };
    expect(body.preview.vehicle.status).toBe("DRAFT");
    expect(body.vehicle.gallery[0].urls.large).toBe(asset);
    const bytes = await call(port, adminHost[0], asset, sessions[0].cookie);
    expect([bytes.status, bytes.headers["cache-control"]]).toEqual([200, "private, no-store"]);
    expect(bytes.body.equals(webp)).toBe(true);
    // copied URLs: no session, a foreign admin, the public host
    for (const [host, path, cookie] of [[adminHost[0], page, undefined], [adminHost[0], asset, undefined],
      [adminHost[0], page, sessions[1].cookie], [adminHost[0], asset, sessions[1].cookie]] as const) {
      const denied = await call(port, host, path, cookie);
      expect(denied.status).toBe(403);
      expect(denied.headers["cache-control"]).toBe("private, no-store");
      expect(denied.body.includes(webp)).toBe(false);
    }
    expect((await call(port, adminHost[1], page, sessions[1].cookie)).status).toBe(404);
    expect((await call(port, adminHost[1], asset, sessions[1].cookie)).status).toBe(404);
    for (const path of [page, asset]) expect((await call(port, publicHost, path, sessions[0].cookie)).status).toBe(404);
    // the ended company has no public offer, sitemap or media
    for (const path of ["/api/public/offer/", "/sitemap.xml", `/api/public/media/${imageId}/large/`])
      expect((await call(port, publicHost, path)).status).toBe(404);
  } finally {
    for (const key of keys) await removeObject(storage, key).catch(() => {});
    storage.client.destroy();
    const orgs = { organizationId: { in: [orgA, orgB] } };
    await db.auditLog.deleteMany({ where: orgs });
    await db.vehicleImage.deleteMany({ where: orgs });
    await db.vehicle.deleteMany({ where: orgs });
    await db.vehicleCategory.deleteMany({ where: { id: categoryId } });
    for (const session of sessions) await session.dispose();
    await db.user.deleteMany({ where: { id: { in: adminIds } } });
    await db.hostMapping.deleteMany({ where: orgs });
    await db.serviceAccess.deleteMany({ where: orgs });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  }
});
