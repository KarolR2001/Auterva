import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { createPrismaClient } from "../../src/lib/prisma";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { createMediaStorage, removeObject } from "../../src/modules/media/storage";
import { processMediaClaim } from "../../src/modules/media/worker";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed fixture responses are asserted structurally
type Json = Record<string, any>;
const secrets = Object.fromEntries(readFileSync(".local/fixture-9/secrets.env", "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));

type Reply = { status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer; json: Json };

function call(port: number, host: string, method: string, path: string,
  options: { cookie?: string; json?: unknown; bytes?: Buffer; type?: string; key?: string; origin?: boolean } = {}) {
  const payload = options.json !== undefined ? Buffer.from(JSON.stringify(options.json)) : options.bytes;
  return new Promise<Reply>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, method, path, headers: {
      Host: host, ...(options.origin === false ? {} : method === "GET" ? {} : { Origin: `http://${host}` }),
      ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(payload ? { "Content-Type": options.type ?? "application/json", "Content-Length": payload.length } : {}),
      ...(options.key ? { "Idempotency-Key": options.key } : {}) } }, (response) => {
      const parts: Buffer[] = [];
      response.on("data", (chunk: Buffer) => parts.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(parts);
        let json: Json = {};
        if (response.headers["content-type"]?.includes("application/json")) json = JSON.parse(body.toString("utf8"));
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body, json });
      });
    });
    request.on("error", reject);
    request.end(payload);
  });
}

test("platform writes company A settings and logo; the public offer reflects them, expiry hides them, B is untouched", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const storage = createMediaStorage({ ...process.env, ...secrets });
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const adminIds = [randomUUID(), randomUUID()];
  const adminHost = [`settings-e2e-a-${orgA}.example.test`, `settings-e2e-b-${orgB}.example.test`];
  const publicHost = [`settings-pub-a-${orgA}.example.test`, `settings-pub-b-${orgB}.example.test`];
  const platformHost = `settings-e2e-platform-${randomUUID()}.example.test`;
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  let ownedSuperadmin: string | null = null;
  const orgs = { organizationId: { in: [orgA, orgB] } };
  try {
    for (const [index, id] of [orgA, orgB].entries()) {
      await db.organization.create({ data: { id, slug: `settings-e2e-${id}`, name: `E2E ${index}`,
        firstAdminRegisteredAt: new Date(Date.now() - 86_400_000) } });
      await db.serviceAccess.create({ data: { organizationId: id,
        paidThrough: new Date(`${new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`) } });
      await db.hostMapping.createMany({ data: [
        { hostname: adminHost[index], area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" },
        { hostname: publicHost[index], area: "COMPANY_PUBLIC", organizationId: id, status: "ACTIVE" }] });
      await db.user.create({ data: { id: adminIds[index], name: `E2E admin ${index}`, role: "ADMIN_FIRMY",
        organizationId: id, email: `settings-e2e-${adminIds[index]}@example.test`, emailVerified: true,
        twoFactorEnabled: true } });
      sessions.push(await verifiedFixtureSession(db, adminIds[index]));
    }
    await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const superId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, superId);
    else {
      ownedSuperadmin = superId;
      await db.user.create({ data: { id: superId, name: "Settings E2E operator", role: "SUPERADMIN_AUTERVA",
        email: `settings-e2e-op-${superId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    }
    const superSession = await verifiedFixtureSession(db, superId);
    sessions.push(superSession);

    // Visitor contexts (no cookies): nothing is published yet, B has its own distinct settings.
    const before = await call(port, publicHost[0], "GET", "/api/public/settings/");
    expect(before.status).toBe(200);
    expect(before.headers["cache-control"]).toBe("no-store");
    expect(before.json.contact.phone).toBeNull();

    // Direct API as company admin A: denied, nothing changes.
    const denied = await call(port, adminHost[0], "PATCH", "/api/admin/settings/",
      { cookie: sessions[0].cookie, json: { phone: "+48 111 222 333", seo: { title: "x" } } });
    expect(denied.status).toBe(403);
    expect((await call(port, adminHost[0], "POST", `/api/platform/companies/${orgA}/public-media/logo/`,
      { cookie: sessions[0].cookie, bytes: Buffer.from("x"), type: "image/png", key: randomUUID() })).status).toBe(404);

    // Superadmin writes A in a separate context.
    const platformPath = `/api/platform/companies/${orgA}/settings/`;
    const write = await call(port, platformHost, "PATCH", platformPath, { cookie: superSession.cookie,
      json: { group: "contact", expectedVersion: 0, eventKey: randomUUID(),
        fields: { phone: "+48 600 700 800", email: "biuro@example.test", contactChannel: "PHONE" } } });
    expect(write.status).toBe(200);
    expect(write.json.version).toBe(1);
    const stale = await call(port, platformHost, "PATCH", platformPath, { cookie: superSession.cookie,
      json: { group: "seo", expectedVersion: 0, eventKey: randomUUID(), fields: { seoTitle: "Tytuł" } } });
    expect(stale.status).toBe(409);
    expect((await call(port, platformHost, "PATCH", platformPath, { cookie: superSession.cookie,
      json: { group: "display", expectedVersion: 1, eventKey: randomUUID(), fields: { showPrices: true } } })).status).toBe(200);

    // Logo upload streams through the built server (outside Proxy) and a media worker commits it.
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: "#224466" } }).png().toBuffer();
    const unauthenticated = await call(port, platformHost, "POST", `/api/platform/companies/${orgA}/public-media/logo/`,
      { bytes: png, type: "image/png", key: randomUUID() });
    expect(unauthenticated.status).toBe(403);
    const accepted = await call(port, platformHost, "POST", `/api/platform/companies/${orgA}/public-media/logo/`,
      { cookie: superSession.cookie, bytes: png, type: "image/png", key: randomUUID() });
    expect(accepted.status).toBe(202);
    const claim = await claimNextJob(db, new Date(), 90_000, false, "MEDIA_PROCESS");
    expect(claim).not.toBeNull();
    expect(await processMediaClaim(db, storage, claim!)).toBe(true);

    // The visitor of A sees the update at once; B and the admin projections stay separate.
    const after = await call(port, publicHost[0], "GET", "/api/public/settings/");
    expect(after.json).toMatchObject({ contact: { phone: "+48 600 700 800", email: "biuro@example.test", channel: "PHONE" },
      display: { showPrices: true } });
    expect(after.json.media).toHaveLength(1);
    const mediaUrl = after.json.media[0].urls.large as string;
    const image = await call(port, publicHost[0], "GET", mediaUrl);
    expect(image.status).toBe(200);
    expect(image.headers["content-type"]).toBe("image/webp");
    expect((await call(port, publicHost[1], "GET", mediaUrl)).status).toBe(404);
    const bPublic = await call(port, publicHost[1], "GET", "/api/public/settings/");
    expect(bPublic.json.contact.phone).toBeNull();
    expect(bPublic.json.media).toEqual([]);
    expect(JSON.stringify(after.json)).not.toMatch(/operator|organizationId|storageKey|private\//);
    const adminRead = await call(port, adminHost[0], "GET", "/api/admin/settings/", { cookie: sessions[0].cookie });
    expect(adminRead.json.settings.contact.phone).toBe("+48 600 700 800");
    expect(adminRead.json.media).toHaveLength(1);
    expect((await call(port, adminHost[1], "GET", "/api/admin/settings/", { cookie: sessions[1].cookie })).json.settings.contact.phone)
      .toBeNull();

    // Shorten A's period: public settings and media vanish immediately; private access and allowed writes remain.
    await db.serviceAccess.update({ where: { organizationId: orgA },
      data: { paidThrough: new Date(`${new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)}T00:00:00.000Z`) } });
    expect((await call(port, publicHost[0], "GET", "/api/public/settings/")).status).toBe(404);
    expect((await call(port, publicHost[0], "GET", mediaUrl)).status).toBe(404);
    expect((await call(port, adminHost[0], "GET", "/api/admin/settings/", { cookie: sessions[0].cookie })).status).toBe(200);
    expect((await call(port, platformHost, "PATCH", platformPath, { cookie: superSession.cookie,
      json: { group: "seo", expectedVersion: 2, eventKey: randomUUID(), fields: { seoTitle: "Po wygaśnięciu" } } })).status).toBe(200);
    expect((await call(port, publicHost[1], "GET", "/api/public/settings/")).status).toBe(200);
    expect(await db.auditLog.count({ where: { organizationId: orgB } })).toBe(0);
  } finally {
    for (const upload of await db.imageUpload.findMany({ where: orgs }))
      for (const key of [upload.stagingKey, upload.rawKey, `${upload.rawKey}/large.webp`, `${upload.rawKey}/thumb.webp`])
        await removeObject(storage, key).catch(() => {});
    storage.client.destroy();
    await db.job.deleteMany({ where: orgs });
    await db.auditLog.deleteMany({ where: orgs });
    await db.publicMedia.deleteMany({ where: orgs });
    await db.imageUpload.deleteMany({ where: orgs });
    await db.siteSettings.deleteMany({ where: orgs });
    await db.serviceAccess.deleteMany({ where: orgs });
    for (const session of sessions) await session.dispose();
    await db.user.deleteMany({ where: { id: { in: [...adminIds, ...(ownedSuperadmin ? [ownedSuperadmin] : [])] } } });
    await db.hostMapping.deleteMany({ where: { OR: [orgs, { hostname: platformHost }] } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  }
});
