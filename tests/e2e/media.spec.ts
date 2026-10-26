import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { createMediaStorage, readLimited, removeObject } from "../../src/modules/media/storage";
import { processMediaClaim } from "../../src/modules/media/worker";
import { verifiedFixtureSession } from "../fixtures/verified-session";

const secrets = Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));

function upload(port: number, host: string, vehicleId: string, cookie: string,
  key: string, bytes: Buffer) {
  return new Promise<{ status: number; cache: string | undefined; body: Record<string, unknown> }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, method: "POST",
      path: `/api/admin/vehicles/${vehicleId}/images/`, headers: { Host: host,
        Origin: `http://${host}`, Cookie: cookie, "Content-Type": "image/png",
        "Idempotency-Key": key, "Content-Length": bytes.length } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0,
          cache: response.headers["cache-control"], body: JSON.parse(raw) }); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(bytes);
  });
}

test("built ingress uploads private bytes and a media worker commits exactly one READY image", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const storage = createMediaStorage({ ...process.env, ...secrets });
  const organizationId = randomUUID();
  const vehicleId = randomUUID();
  const userId = randomUUID();
  const host = `media-e2e-${organizationId}.example.test`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  try {
    await db.organization.create({ data: { id: organizationId, slug: `media-e2e-${organizationId}` } });
    await db.vehicle.create({ data: { id: vehicleId, organizationId } });
    await db.hostMapping.create({ data: { hostname: host, organizationId, area: "COMPANY_ADMIN", status: "ACTIVE" } });
    await db.user.create({ data: { id: userId, name: "Media E2E admin", role: "ADMIN_FIRMY",
      organizationId, email: `media-e2e-${userId}@example.test`, emailVerified: true,
      twoFactorEnabled: true } });
    session = await verifiedFixtureSession(db, userId);
    const bytes = await sharp({ create: { width: 320, height: 200, channels: 3,
      background: "#558899" } }).png().toBuffer();
    const key = randomUUID();
    const port = Number(new URL(baseURL).port);
    const accepted = await upload(port, host, vehicleId, session.cookie, key, bytes);
    expect(accepted).toMatchObject({ status: 202, cache: "no-store",
      body: { imageId: expect.any(String), state: "PROCESSING" } });
    const record = await db.imageUpload.findFirstOrThrow({ where: { organizationId, vehicleId, reservationKey: key } });
    expect(await readLimited(storage, record.rawKey)).toEqual(bytes);
    expect(await db.vehicleImage.count({ where: { id: record.imageId } })).toBe(0);
    const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
    expect(claim).not.toBeNull();
    expect(await processMediaClaim(db, storage, claim!)).toBe(true);
    expect((await db.vehicleImage.findUniqueOrThrow({ where: { id: record.imageId } })).status).toBe("READY");
    expect((await upload(port, host, vehicleId, session.cookie, key, bytes)).status).toBe(200);
    const different = await sharp({ create: { width: 320, height: 200, channels: 3,
      background: "#995588" } }).png().toBuffer();
    expect((await upload(port, host, vehicleId, session.cookie, key, different)).status).toBe(409);
    expect(await db.imageUpload.count({ where: { organizationId, vehicleId } })).toBe(1);
  } finally {
    const uploads = await db.imageUpload.findMany({ where: { organizationId } });
    for (const record of uploads) for (const key of [record.stagingKey, record.rawKey,
      `${record.rawKey}/large.webp`, `${record.rawKey}/thumb.webp`]) await removeObject(storage, key).catch(() => {});
    await db.job.deleteMany({ where: { organizationId } });
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.vehicleImage.deleteMany({ where: { organizationId } });
    await db.imageUpload.deleteMany({ where: { organizationId } });
    if (session) await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.hostMapping.deleteMany({ where: { organizationId } });
    await db.vehicle.deleteMany({ where: { id: vehicleId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    storage.client.destroy();
    await db.$disconnect();
  }
});
