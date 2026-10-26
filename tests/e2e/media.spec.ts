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

async function withCompany(run: (ctx: { db: ReturnType<typeof createPrismaClient>; host: string;
  vehicleId: string; organizationId: string; cookie: string }) => Promise<void>) {
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
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
      organizationId, email: `media-e2e-${userId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    session = await verifiedFixtureSession(db, userId);
    await run({ db, host, vehicleId, organizationId, cookie: session.cookie });
  } finally {
    const storage = createMediaStorage({ ...process.env, ...secrets });
    for (const record of await db.imageUpload.findMany({ where: { organizationId } }))
      for (const key of [record.stagingKey, record.rawKey, `${record.rawKey}/large.webp`,
        `${record.rawKey}/thumb.webp`]) await removeObject(storage, key).catch(() => {});
    storage.client.destroy();
    await db.job.deleteMany({ where: { organizationId } });
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.vehicleImage.deleteMany({ where: { organizationId } });
    await db.imageUpload.deleteMany({ where: { organizationId } });
    if (session) await session.dispose();
    await db.user.deleteMany({ where: { id: userId } });
    await db.hostMapping.deleteMany({ where: { organizationId } });
    await db.vehicle.deleteMany({ where: { id: vehicleId } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
}

type Streamed = { status: number; at: number; body: Record<string, unknown> };

/** Raw chunked POST: `script` writes the body; the response time is measured from the start. */
function streamed(port: number, host: string, vehicleId: string, headers: Record<string, string>,
  script: (write: (chunk: Buffer) => void, end: () => void, responded: () => boolean) => Promise<void>) {
  return new Promise<Streamed & { endedAt: number | null }>((resolve, reject) => {
    const started = Date.now();
    let endedAt: number | null = null;
    let done = false;
    const request = httpRequest({ hostname: "127.0.0.1", port, method: "POST",
      path: `/api/admin/vehicles/${vehicleId}/images/`,
      headers: { Host: host, "Content-Type": "image/png",
        ...(headers["Content-Length"] ? {} : { "Transfer-Encoding": "chunked" }), ...headers } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        done = true;
        try { resolve({ status: response.statusCode ?? 0, at: Date.now() - started, endedAt,
          body: raw ? JSON.parse(raw) : {} }); } catch (error) { reject(error); }
      });
    });
    request.on("error", (error) => { if (!done) reject(error); });
    request.flushHeaders();
    const write = (chunk: Buffer) => { if (!done && !request.destroyed) request.write(chunk); };
    const end = () => { endedAt = Date.now() - started; if (!done && !request.destroyed) request.end(); };
    void script(write, end, () => done).catch(reject);
  });
}

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

test("built server rejects an unauthenticated slow chunked body before it ends", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  await withCompany(async ({ db, host, vehicleId, organizationId }) => {
    const result = await streamed(Number(new URL(baseURL).port), host, vehicleId,
      { Origin: `http://${host}`, "Idempotency-Key": randomUUID() }, async (write, end, responded) => {
        for (let index = 0; index < 8 && !responded(); index++) {
          write(Buffer.alloc(1024, 1));
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        end();
      });
    expect(result.status).toBe(403);
    expect(result.at).toBeLessThan(2_000);
    expect(result.endedAt === null || result.endedAt >= result.at).toBe(true);
    expect(await db.imageUpload.count({ where: { organizationId } })).toBe(0);
  });
});

test("built server answers 408 on an idle body, 413 on a declared oversize length and at 10 MB + 1", async ({ baseURL }) => {
  test.setTimeout(60_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  await withCompany(async ({ db, host, vehicleId, organizationId, cookie }) => {
    const base = () => ({ Origin: `http://${host}`, Cookie: cookie, "Idempotency-Key": randomUUID() });
    const idle = await streamed(port, host, vehicleId, base(), async (write) => { write(Buffer.alloc(512, 1)); });
    expect(idle.status).toBe(408);
    expect(idle.at).toBeGreaterThanOrEqual(2_500);
    expect(idle.at).toBeLessThan(8_000);
    const reservedBefore = await db.imageUpload.count({ where: { organizationId } });
    const declared = await streamed(port, host, vehicleId, { ...base(), "Content-Length": "10000001" },
      async () => { /* No body is ever sent: the declared length alone decides. */ });
    expect(declared.status).toBe(413);
    expect(declared.at).toBeLessThan(2_000);
    expect(await db.imageUpload.count({ where: { organizationId } })).toBe(reservedBefore);
    const sendChunked = (size: number) => streamed(port, host, vehicleId, base(), async (write, end) => {
      for (let sent = 0; sent < size; sent += 1_000_000) write(Buffer.alloc(Math.min(1_000_000, size - sent), 7));
      end();
    });
    const exact = await sendChunked(10_000_000);
    expect(exact.status).toBe(422); // accepted by the size gate, rejected as not an image
    const over = await sendChunked(10_000_001);
    expect(over.status).toBe(413);
    const rejected = await db.imageUpload.findMany({ where: { organizationId, state: "REJECTED" } });
    expect(rejected).toHaveLength(2);
  });
});
