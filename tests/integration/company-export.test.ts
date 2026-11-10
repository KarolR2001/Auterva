import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Client } from "pg";
import { afterAll, beforeAll, beforeEach, expect, test } from "vitest";
import { FIXTURE } from "../../scripts/fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import * as adminList from "../../src/app/api/admin/export/route";
import * as adminOne from "../../src/app/api/admin/export/[exportId]/route";
import * as adminDownload from "../../src/app/api/admin/export/[exportId]/download/route";
import * as platformList from "../../src/app/api/platform/companies/[organizationId]/export/route";
import * as platformOne from "../../src/app/api/platform/companies/[organizationId]/export/[exportId]/route";
import * as platformDownload from "../../src/app/api/platform/companies/[organizationId]/export/[exportId]/download/route";
import { EXPORT_COMPANY_DATA_PURPOSE } from "../../src/modules/auth/reauth-proof";
import { deleteArtifact, companyExportKey, getArtifact, decryptArtifact } from "../../src/modules/company-export/artifact";
import { EXPORT_DAILY_LIMIT, EXPORT_TTL_MS } from "../../src/modules/company-export/service";
import { EXPORT_JOB_KIND, EXPORT_LEASE_MS, processCompanyExportClaim, sweepCompanyExports } from "../../src/modules/company-export/worker";
import { claimNextJob } from "../../src/modules/jobs/queue";
import { quarantineRestoredState } from "../../src/modules/backup/restore";
import { createMediaStorage } from "../../src/modules/media/storage";
import { ensureControlledFixtureAccess } from "../fixtures/verified-session";

// #328 (D-40): company data export on PostgreSQL and the S3 fixture. Companies A/B, archived C (inside the 30-day window)
// and D (outside it); admins A/B/C and the superadmin. Files are read back from the encrypted object, never from the build.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- parsed fixture responses are asserted structurally
type Json = Record<string, any>;
const secrets = Object.fromEntries(readFileSync(join(process.cwd(), ".local/fixture-9/secrets.env"), "utf8")
  .trim().split("\n").map((line) => { const at = line.indexOf("="); return [line.slice(0, at), line.slice(at + 1)]; }));
const previousEnv = { id: process.env.S3_ACCESS_KEY_ID, secret: process.env.S3_SECRET_ACCESS_KEY };
process.env.S3_ACCESS_KEY_ID = secrets.S3_ACCESS_KEY_ID;
process.env.S3_SECRET_ACCESS_KEY = secrets.S3_SECRET_ACCESS_KEY;
const storage = createMediaStorage({ ...process.env, ...secrets });
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const key = companyExportKey();
const secret = getServerEnv().BETTER_AUTH_SECRET;
const [orgA, orgB, orgC, orgD] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
const orgs = [orgA, orgB, orgC, orgD];
const adminIds = orgs.map(() => randomUUID());
const adminHosts = orgs.map((id) => `export-admin-${id}.example.test`);
const platformHost = `export-platform-${randomUUID()}.example.test`;
const superId = FIXTURE.users[2];
const sessionIds: string[] = [];
type Session = { id: string; cookie: string };
let adminSession: Session[] = [];
let superSession: Session;
const vehicleA = randomUUID();
const vehicleB = randomUUID();
const DAY = 86_400_000;

async function session(userId: string): Promise<Session> {
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  await db.session.create({ data: { id, userId, token, expiresAt: new Date(Date.now() + 3_600_000), mfaVerifiedAt: new Date() } });
  sessionIds.push(id);
  return { id, cookie: `better-auth.session_token=${token}.${createHmac("sha256", secret).update(token).digest("base64")}` };
}
async function proofFor(userId: string, sessionId: string, purpose = EXPORT_COMPANY_DATA_PURPOSE, expiresAt = new Date(Date.now() + 300_000)) {
  const proof = randomBytes(32).toString("hex");
  await db.verification.create({ data: { id: randomUUID(),
    identifier: `auterva:mfa:${createHmac("sha256", secret).update(`reauth:${proof}`).digest("hex")}`,
    value: JSON.stringify({ userId, sessionId, purpose }), expiresAt } });
  return proof;
}
const ctx = (organizationId: string, exportId?: string) => ({ params: Promise.resolve({ organizationId, exportId: exportId ?? "" }) });
const idCtx = (exportId: string) => ({ params: Promise.resolve({ exportId }) });
function req(host: string, path: string, cookie: string, init: { method?: "GET" | "POST"; body?: object; origin?: string | null } = {}) {
  return new Request(`https://${host}${path}`, { method: init.method ?? "GET", headers: { host, cookie,
    ...(init.body ? { "content-type": "application/json" } : {}),
    ...(init.method === "POST" && init.origin !== null ? { origin: init.origin ?? `https://${host}` } : {}) },
  body: init.body ? JSON.stringify(init.body) : undefined });
}
async function json(response: Response) { return { status: response.status, body: await response.json() as Json, headers: response.headers }; }

type Who = { kind: "admin"; index: number } | { kind: "super"; org: string };
async function ask(who: Who, op: "request" | "list" | "one" | "download", options: { exportId?: string; proof?: string | null;
  idempotencyKey?: string; cookie?: string; host?: string; extra?: object } = {}) {
  const sessionRow = who.kind === "admin" ? adminSession[who.index] : superSession;
  const userId = who.kind === "admin" ? adminIds[who.index] : superId;
  const host = options.host ?? (who.kind === "admin" ? adminHosts[who.index] : platformHost);
  const cookie = options.cookie ?? sessionRow.cookie;
  const base = who.kind === "admin" ? "/api/admin/export" : `/api/platform/companies/${who.org}/export`;
  const target = op === "request" || op === "list" ? base : `${base}/${options.exportId}`;
  const path = op === "download" ? `${target}/download` : target;
  if (op === "request") {
    const proof = options.proof === undefined ? await proofFor(userId, sessionRow.id) : options.proof;
    const request = req(host, path, cookie, { method: "POST", body: { ...(proof ? { proof } : {}),
      idempotencyKey: options.idempotencyKey ?? randomUUID(), ...options.extra } });
    return who.kind === "admin" ? adminList.POST(request) : platformList.POST(request, ctx(who.org));
  }
  const request = req(host, path, cookie);
  if (who.kind === "admin") return op === "list" ? adminList.GET(request) : op === "one" ? adminOne.GET(request, idCtx(options.exportId!))
    : adminDownload.GET(request, idCtx(options.exportId!));
  const c = ctx(who.org, options.exportId);
  return op === "list" ? platformList.GET(request, c) : op === "one" ? platformOne.GET(request, c) : platformDownload.GET(request, c);
}
/** Runs the queued job like the worker does. */
async function runJob(organizationId: string) {
  const claim = await claimNextJob(db, new Date(Date.now() + 1000), EXPORT_LEASE_MS, false, EXPORT_JOB_KIND);
  if (!claim) throw new Error("No export job was queued");
  const job = await db.job.findUniqueOrThrow({ where: { id: claim.id } });
  expect(job.organizationId).toBe(organizationId);
  return { claim, ready: await processCompanyExportClaim(db, storage, claim, key) };
}
async function exportReady(who: Who, organizationId: string) {
  const created = await json(await ask(who, "request"));
  expect(created.status).toBe(202);
  expect((await runJob(organizationId)).ready).toBe(true);
  return created.body.export.id as string;
}
function unzip(buffer: Buffer): Record<string, Buffer> {
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const total = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);
  const files: Record<string, Buffer> = {};
  for (let i = 0; i < total; i++) {
    const method = buffer.readUInt16LE(at + 10);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString();
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const packed = buffer.subarray(start, start + size);
    files[name] = method === 8 ? inflateRawSync(packed) : packed;
    at += 46 + nameLength;
  }
  return files;
}
function limiterHash(value: string) { return createHmac("sha256", secret).update(value).digest("hex"); }
async function storedFiles(exportId: string) {
  const row = await db.companyExport.findUniqueOrThrow({ where: { id: exportId } });
  const bytes = await getArtifact(storage, row.artifactKey);
  return { row, bytes, files: unzip(decryptArtifact(bytes, key, row.artifactKey, row.digest)) };
}

beforeAll(async () => {
  await ensureControlledFixtureAccess(db);
  await db.organization.createMany({ data: orgs.map((id, index) => ({ id, slug: `export-${id}`, name: `Export ${"ABCD"[index]}`,
    firstAdminRegisteredAt: new Date(Date.now() - DAY),
    archivedAt: index === 2 ? new Date(Date.now() - 5 * DAY) : index === 3 ? new Date(Date.now() - 31 * DAY) : null })) });
  await db.hostMapping.createMany({ data: [
    ...orgs.map((organizationId, index) => ({ hostname: adminHosts[index], area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" })),
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" }] });
  await db.user.createMany({ data: orgs.map((organizationId, index) => ({ id: adminIds[index], name: `Export admin ${index}`,
    email: `export-${adminIds[index]}@example.test`, role: "ADMIN_FIRMY", organizationId, emailVerified: true, twoFactorEnabled: true })) });
  adminSession = [];
  for (const id of adminIds) adminSession.push(await session(id));
  superSession = await session(superId);
  // A: everything an export may and may not contain. B carries its own markers that must never appear in A's file.
  await db.siteSettings.create({ data: { organizationId: orgA, publicName: "Firma A publiczna", phone: "+48 111 222 333",
    privacyText: "Polityka A", operatorNote: "SECRET-OPERATOR-NOTE-A" } });
  await db.serviceAccess.create({ data: { organizationId: orgA, paidThrough: new Date("2020-01-31"), trialGranted: true,
    trialStartedAt: new Date("2019-12-01T10:00:00Z"), trialEndsAt: new Date("2019-12-15T10:00:00Z"), periodVersion: 7 } });
  await db.vehicle.create({ data: { id: vehicleA, organizationId: orgA, slug: "auto-a", name: "=HYPERLINK(\"http://evil\")", brand: "+cmd", model: "Model; A",
    status: "PUBLISHED", description: "-2+3\nlinia", price: "199.50", priceUnit: "DAY", availableFrom: new Date("2026-03-01"), availableTo: new Date("2026-12-31") } });
  await db.vehicleFeature.create({ data: { organizationId: orgA, vehicleId: vehicleA, code: "AC", value: "@dual" } });
  await db.vehicleImage.createMany({ data: [
    { id: randomUUID(), organizationId: orgA, vehicleId: vehicleA, storageKey: `export-test/${randomUUID()}`, mime: "image/webp", width: 800, height: 600, bytes: 1234,
      alt: "Zdjęcie A", position: 0, isCover: true, status: "READY" },
    { id: randomUUID(), organizationId: orgA, vehicleId: vehicleA, storageKey: `export-test/${randomUUID()}`, mime: "image/webp", width: 800, height: 600, bytes: 99,
      position: 1, status: "DELETED" }] });
  await db.availabilityBlock.create({ data: { organizationId: orgA, vehicleId: vehicleA, from: new Date("2026-07-01"), to: new Date("2026-07-01"),
    type: "MAINTENANCE", reference: "REF-A-123", internalNote: "Notatka wewnętrzna A", version: 3 } });
  await db.conversation.create({ data: { organizationId: orgA } });
  await db.siteSettings.create({ data: { organizationId: orgB, publicName: "FIRMA-B-MARKER", operatorNote: "SECRET-OPERATOR-NOTE-B" } });
  await db.vehicle.create({ data: { id: vehicleB, organizationId: orgB, slug: "auto-b", name: "VEHICLE-B-MARKER", status: "PUBLISHED" } });
  await db.availabilityBlock.create({ data: { organizationId: orgB, vehicleId: vehicleB, from: new Date("2026-08-01"), to: new Date("2026-08-02"),
    reference: "REF-B-MARKER", internalNote: "NOTE-B-MARKER" } });
  const conversation = await db.conversation.findUniqueOrThrow({ where: { organizationId: orgA } });
  await db.chatMessage.create({ data: { organizationId: orgA, conversationId: conversation.id, senderId: adminIds[0],
    clientMessageId: randomUUID(), seq: 1, body: "CHAT-MESSAGE-MUST-NOT-EXPORT" } });
});

beforeEach(async () => {
  const keys = [`api:read:${superId}:platform`, `api:write:${superId}:platform`,
    ...orgs.flatMap((org, index) => [`api:read:${adminIds[index]}:${org}`, `api:write:${adminIds[index]}:${org}`])];
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys.map(limiterHash) } } });
  const rows = await db.companyExport.findMany({ where: { organizationId: { in: orgs } }, select: { artifactKey: true } });
  for (const row of rows) await deleteArtifact(storage, row.artifactKey).catch(() => undefined);
  await db.companyExport.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.job.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgs }, entityType: "CompanyExport" } });
});

afterAll(async () => {
  const rows = await db.companyExport.findMany({ where: { organizationId: { in: orgs } }, select: { artifactKey: true } });
  for (const row of rows) await deleteArtifact(storage, row.artifactKey).catch(() => undefined);
  await db.verification.deleteMany({ where: { OR: [...adminIds, superId].map((id) => ({ value: { contains: `"userId":"${id}"` } })) } });
  await db.companyExport.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.job.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.chatMessage.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.conversation.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.availabilityBlock.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.vehicleImage.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.vehicleFeature.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.vehicle.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.siteSettings.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
  await db.session.deleteMany({ where: { id: { in: sessionIds } } });
  await db.user.deleteMany({ where: { id: { in: adminIds } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [...adminHosts, platformHost] } } });
  await db.organization.deleteMany({ where: { id: { in: orgs } } });
  if (previousEnv.id === undefined) delete process.env.S3_ACCESS_KEY_ID; else process.env.S3_ACCESS_KEY_ID = previousEnv.id;
  if (previousEnv.secret === undefined) delete process.env.S3_SECRET_ACCESS_KEY; else process.env.S3_SECRET_ACCESS_KEY = previousEnv.secret;
  storage.client.destroy();
  await db.$disconnect();
});

test("reauth: no proof, a foreign purpose, an expired proof, another session's proof and a reused proof all refuse and write nothing", async () => {
  const me = adminSession[0];
  const bad = [
    await ask({ kind: "admin", index: 0 }, "request", { proof: null }),
    await ask({ kind: "admin", index: 0 }, "request", { proof: await proofFor(adminIds[0], me.id, "end-sessions") }),
    await ask({ kind: "admin", index: 0 }, "request", { proof: await proofFor(adminIds[0], me.id, EXPORT_COMPANY_DATA_PURPOSE, new Date(Date.now() - 1000)) }),
    await ask({ kind: "admin", index: 0 }, "request", { proof: await proofFor(adminIds[0], adminSession[1].id) }),
    await ask({ kind: "admin", index: 0 }, "request", { proof: await proofFor(adminIds[1], me.id) }),
  ];
  expect(bad.slice(1).map((response) => response.status)).toEqual([401, 401, 401, 401]);
  expect(bad[0].status).toBe(400); // proof is a required field
  expect(await db.companyExport.count({ where: { organizationId: orgA } })).toBe(0);
  expect(await db.job.count({ where: { organizationId: orgA } })).toBe(0);
  const proof = await proofFor(adminIds[0], me.id);
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof })).status).toBe(202);
  await db.companyExport.deleteMany({ where: { organizationId: orgA } });
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof })).status).toBe(401); // single use
  // A rule that refuses (here: one export already running) does not burn the proof.
  const fresh = await proofFor(adminIds[0], me.id);
  expect((await ask({ kind: "admin", index: 0 }, "request")).status).toBe(202);
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof: fresh })).status).toBe(409);
  expect(await db.verification.count({ where: { value: { contains: `"purpose":"${EXPORT_COMPANY_DATA_PURPOSE}"` },
    identifier: `auterva:mfa:${createHmac("sha256", secret).update(`reauth:${fresh}`).digest("hex")}` } })).toBe(1);
});

test("request guards: Origin, unknown fields, invalid idempotency key, another company's host and the platform host for an admin", async () => {
  const me = adminSession[0];
  const proof = await proofFor(adminIds[0], me.id);
  const noOrigin = req(adminHosts[0], "/api/admin/export", me.cookie, { method: "POST", origin: null, body: { proof, idempotencyKey: randomUUID() } });
  expect((await adminList.POST(noOrigin)).status).toBe(403);
  expect((await adminList.POST(req(adminHosts[0], "/api/admin/export", me.cookie, { method: "POST", origin: "https://evil.example.test",
    body: { proof, idempotencyKey: randomUUID() } }))).status).toBe(403);
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof, extra: { organizationId: orgB } })).status).toBe(400);
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof, idempotencyKey: "not-a-uuid" })).status).toBe(400);
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof, host: adminHosts[1] })).status).toBe(403); // A's session on B's host
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof, host: platformHost })).status).toBe(404); // admin route is not served there
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof, cookie: "better-auth.session_token=forged.forged" })).status).toBe(403);
  expect(await db.companyExport.count({ where: { organizationId: { in: orgs } } })).toBe(0);
  // The proof survived all refusals.
  expect((await ask({ kind: "admin", index: 0 }, "request", { proof })).status).toBe(202);
});

test("admin exports own company: encrypted file, ZIP of JSON and CSV, scope allowlist, no foreign or forbidden data, audit without content", async () => {
  const key1 = randomUUID();
  const created = await json(await ask({ kind: "admin", index: 0 }, "request", { idempotencyKey: key1 }));
  expect(created.status).toBe(202);
  expect(created.headers.get("Cache-Control")).toBe("no-store");
  expect(created.body.export).toMatchObject({ status: "PENDING", requestedByRole: "ADMIN_FIRMY", context: null });
  const id = created.body.export.id as string;
  expect(JSON.stringify(created.body)).not.toMatch(/artifactKey|digest|company-exports/);
  expect((await json(await ask({ kind: "admin", index: 0 }, "download", { exportId: id }))).status).toBe(409); // not ready yet
  // Retry with the same key replays the row: no second export or job, and it needs no new proof.
  const replay = await json(await ask({ kind: "admin", index: 0 }, "request", { idempotencyKey: key1, proof: null }));
  expect(replay.status).toBe(400);
  const again = await json(await ask({ kind: "admin", index: 0 }, "request", { idempotencyKey: key1, proof: "0".repeat(64) }));
  expect(again.status).toBe(200);
  expect(again.body.export.id).toBe(id);
  expect(await db.companyExport.count({ where: { organizationId: orgA } })).toBe(1);
  expect(await db.job.count({ where: { organizationId: orgA, kind: EXPORT_JOB_KIND } })).toBe(1);
  const second = await json(await ask({ kind: "admin", index: 0 }, "request"));
  expect(second.status).toBe(409);
  expect(second.body).toEqual({ code: "EXPORT_ALREADY_ACTIVE", exportId: id });
  expect((await runJob(orgA)).ready).toBe(true);

  const status = await json(await ask({ kind: "admin", index: 0 }, "one", { exportId: id }));
  expect(status.body.export).toMatchObject({ status: "READY", counts: { vehicles: 1, vehicleImages: 1, blocks: 1, hosts: 0 } });
  expect(new Date(status.body.export.expiresAt).getTime() - new Date(status.body.export.completedAt).getTime()).toBe(EXPORT_TTL_MS);
  const listed = await json(await ask({ kind: "admin", index: 0 }, "list"));
  expect(listed.body.items.map((item: Json) => item.id)).toEqual([id]);
  expect(listed.body.limits).toMatchObject({ canRequest: true, inProgress: false, requestsLeftToday: 2, archiveWindowEndsAt: null });

  // The stored object is ciphertext bound to its own key.
  const stored = await storedFiles(id);
  expect(stored.bytes.subarray(0, 4).toString()).toBe("AUR1");
  expect(stored.bytes.includes(Buffer.from("PK\x03\x04"))).toBe(false);
  expect(stored.bytes.includes(Buffer.from("REF-A-123"))).toBe(false);
  expect(() => decryptArtifact(stored.bytes, randomBytes(32), stored.row.artifactKey, stored.row.digest)).toThrow();
  expect(() => decryptArtifact(stored.bytes, key, `company-exports/${orgB}/${id}.bin`, stored.row.digest)).toThrow();
  expect(stored.row.artifactKey).toBe(`company-exports/${orgA}/${id}.bin`);

  const download = await adminDownload.GET(req(adminHosts[0], `/api/admin/export/${id}/download`, adminSession[0].cookie), idCtx(id));
  expect(download.status).toBe(200);
  expect(download.headers.get("Content-Type")).toBe("application/zip");
  expect(download.headers.get("Cache-Control")).toBe("private, no-store");
  expect(download.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(download.headers.get("Content-Disposition")).toMatch(/^attachment; filename="auterva-export-\d{8}\.zip"$/);
  const files = unzip(Buffer.from(await download.arrayBuffer()));
  expect(Object.keys(files).sort()).toEqual(["blocks.csv", "blocks.json", "company.json", "manifest.json", "vehicles.csv", "vehicles.json"]);
  const manifest = JSON.parse(files["manifest.json"].toString());
  expect(manifest).toMatchObject({ schemaVersion: 1, exportId: id, counts: { vehicles: 1, blocks: 1 } });
  for (const entry of manifest.files) expect(createHash("sha256").update(files[entry.name]).digest("hex")).toBe(entry.sha256);
  const company = JSON.parse(files["company.json"].toString());
  expect(company.company).toEqual({ id: orgA, slug: `export-${orgA}`, name: "Export A" });
  expect(company.settings).toMatchObject({ publicName: "Firma A publiczna", phone: "+48 111 222 333", privacyText: "Polityka A" });
  expect(company.servicePeriod).toEqual({ paidThrough: "2020-01-31", trialStartedAt: "2019-12-01T10:00:00.000Z", trialEndsAt: "2019-12-15T10:00:00.000Z" });
  expect(company.admin).toEqual([expect.objectContaining({ role: "ADMIN_FIRMY", mfaEnabled: true, email: expect.stringContaining("@example.test") })]);
  const vehicles = JSON.parse(files["vehicles.json"].toString()).vehicles;
  expect(vehicles).toHaveLength(1);
  expect(vehicles[0]).toMatchObject({ slug: "auto-a", price: "199.5", activeFrom: "2026-03-01", activeTo: "2026-12-31",
    features: [{ code: "AC", value: "@dual" }], images: [{ position: 0, cover: true, alt: "Zdjęcie A", bytes: 1234, status: "READY" }] });
  const blocks = JSON.parse(files["blocks.json"].toString()).blocks;
  expect(blocks).toEqual([expect.objectContaining({ vehicleId: vehicleA, from: "2026-07-01", to: "2026-07-01", type: "MAINTENANCE",
    reference: "REF-A-123", internalNote: "Notatka wewnętrzna A", version: 3 })]);
  // Nothing outside the scope: no other company, no platform note, chat, credentials, tokens, storage keys, period internals.
  const everything = Object.values(files).map((file) => file.toString()).join("\n");
  for (const forbidden of ["FIRMA-B-MARKER", "VEHICLE-B-MARKER", "REF-B-MARKER", "NOTE-B-MARKER", orgB, "SECRET-OPERATOR-NOTE", "operatorNote",
    "CHAT-MESSAGE-MUST-NOT-EXPORT", "export-test/", "storageKey", "periodVersion", "password", "token", "verificationToken", me().token]) {
    expect(everything, forbidden).not.toContain(forbidden);
  }
  // CSV: BOM, `;`, formulas neutralised, numbers untouched.
  const csv = files["vehicles.csv"].toString();
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  const lines = csv.slice(1).split("\r\n");
  expect(lines[0].split(";").slice(0, 3)).toEqual(["id", "slug", "name"]);
  expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
  expect(csv).toContain("'+cmd");
  expect(csv).toContain(`"Model; A"`);
  expect(csv).toContain(`"'-2+3\nlinia"`);
  expect(csv).toContain(";AC=@dual;");
  expect(csv).toContain(";199.5;");
  expect(files["blocks.csv"].toString()).toContain(";2026-07-01;2026-07-01;MAINTENANCE;MANUAL;REF-A-123;Notatka wewnętrzna A;3");
  // Audit: who, what, counts and digest only.
  const audit = await db.auditLog.findMany({ where: { organizationId: orgA, entityType: "CompanyExport" }, orderBy: { createdAt: "asc" } });
  expect(audit.map((row) => row.action)).toEqual(["EXPORT_REQUESTED", "EXPORT_READY", "EXPORT_DOWNLOADED"]);
  expect(audit.map((row) => row.actorRole)).toEqual(["ADMIN_FIRMY", "OPERATOR", "ADMIN_FIRMY"]);
  expect(audit[1].safeChanges).toEqual({ count: 2, evidenceDigest: stored.row.digest });
  expect(JSON.stringify(audit)).not.toMatch(/REF-A|Notatka|HYPERLINK|auterva-export/);
  expect(audit.every((row) => row.entityId === id)).toBe(true);
});

function me() { return { token: adminSession[0].cookie.split("=")[1].split(".")[0] }; }

test("isolation A/B: another company's admin, host and the superadmin of another company get 404 for the same export id", async () => {
  const id = await exportReady({ kind: "admin", index: 0 }, orgA);
  for (const op of ["one", "download"] as const) {
    expect((await ask({ kind: "admin", index: 1 }, op, { exportId: id })).status).toBe(404);
    expect((await ask({ kind: "super", org: orgB }, op, { exportId: id })).status).toBe(404);
    expect((await ask({ kind: "admin", index: 0 }, op, { exportId: id, host: adminHosts[1] })).status).toBe(403);
    expect((await ask({ kind: "admin", index: 0 }, op, { exportId: id, host: platformHost })).status).toBe(404);
    expect((await ask({ kind: "admin", index: 0 }, op, { exportId: randomUUID() })).status).toBe(404);
    expect((await ask({ kind: "admin", index: 0 }, op, { exportId: "not-a-uuid" })).status).toBe(404);
  }
  expect((await json(await ask({ kind: "admin", index: 1 }, "list"))).body.items).toEqual([]);
  expect((await json(await ask({ kind: "super", org: orgB }, "list"))).body.items).toEqual([]);
  // A cannot download after a session is gone, and the row of B is never reachable through A's id.
  const ownA = await json(await ask({ kind: "super", org: orgA }, "list"));
  expect(ownA.body.items.map((item: Json) => item.id)).toEqual([id]);
  expect((await ask({ kind: "admin", index: 0 }, "download", { exportId: id, cookie: "better-auth.session_token=x.y" })).status).toBe(403);
  const idB = await exportReady({ kind: "admin", index: 1 }, orgB);
  const filesB = (await storedFiles(idB)).files;
  expect(Object.values(filesB).map((file) => file.toString()).join("")).not.toContain("Firma A publiczna");
  expect(JSON.parse(filesB["vehicles.json"].toString()).vehicles.map((item: Json) => item.name)).toEqual(["VEHICLE-B-MARKER"]);
  // The job names a company; an export id of another company in its payload is skipped, never built.
  const idA2 = (await json(await ask({ kind: "admin", index: 0 }, "request"))).body.export.id as string;
  await db.job.updateMany({ where: { organizationId: orgA, kind: EXPORT_JOB_KIND }, data: { payload: { exportId: idB } } });
  expect((await runJob(orgA)).ready).toBe(false);
  expect(await db.job.count({ where: { organizationId: orgA, kind: EXPORT_JOB_KIND, status: "SKIPPED" } })).toBe(1);
  expect((await db.companyExport.findUniqueOrThrow({ where: { id: idA2 } })).status).toBe("PENDING");
});

test("the superadmin exports a chosen company as their own actor; the audit keeps the superadmin identity", async () => {
  const created = await json(await ask({ kind: "super", org: orgA }, "request"));
  expect(created.status).toBe(202);
  expect(created.body.export).toMatchObject({ requestedByRole: "SUPERADMIN_AUTERVA", context: null });
  expect((await runJob(orgA)).ready).toBe(true);
  const id = created.body.export.id as string;
  const download = await platformDownload.GET(req(platformHost, `/api/platform/companies/${orgA}/export/${id}/download`, superSession.cookie), ctx(orgA, id));
  expect(download.status).toBe(200);
  const audit = await db.auditLog.findMany({ where: { organizationId: orgA, entityType: "CompanyExport", action: { in: ["EXPORT_REQUESTED", "EXPORT_DOWNLOADED"] } } });
  expect(audit.map((row) => [row.actorId, row.actorRole]).sort()).toEqual([[superId, "SUPERADMIN_AUTERVA"], [superId, "SUPERADMIN_AUTERVA"]]);
  // The company's admin sees and can download the file of the same company (one admin per company, any admin of it).
  expect((await ask({ kind: "admin", index: 0 }, "download", { exportId: id })).status).toBe(200);
  // A company admin cannot use the platform route.
  expect((await ask({ kind: "super", org: orgA }, "list", { cookie: adminSession[0].cookie })).status).toBe(403);
  expect((await ask({ kind: "super", org: orgA }, "request", { cookie: adminSession[0].cookie, proof: await proofFor(adminIds[0], adminSession[0].id) })).status).toBe(403);
  expect((await ask({ kind: "super", org: "not-a-uuid" }, "list")).status).toBe(400);
});

test("limits: one export in progress, three requests per 24 hours with Retry-After, and the parallel race has one winner", async () => {
  const [first, second] = await Promise.all([ask({ kind: "admin", index: 0 }, "request"), ask({ kind: "admin", index: 0 }, "request")]);
  expect([first.status, second.status].sort()).toEqual([202, 409]);
  expect(await db.companyExport.count({ where: { organizationId: orgA } })).toBe(1);
  expect(await db.job.count({ where: { organizationId: orgA } })).toBe(1);
  expect((await runJob(orgA)).ready).toBe(true);
  expect((await ask({ kind: "admin", index: 0 }, "request")).status).toBe(202); // a finished export does not block a new one
  expect((await runJob(orgA)).ready).toBe(true);
  expect((await ask({ kind: "admin", index: 0 }, "request")).status).toBe(202);
  expect((await runJob(orgA)).ready).toBe(true);
  const refused = await json(await ask({ kind: "admin", index: 0 }, "request"));
  expect(refused.status).toBe(429);
  expect(refused.body.code).toBe("EXPORT_DAILY_LIMIT");
  expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(86_000);
  expect(EXPORT_DAILY_LIMIT).toBe(3);
  const listed = await json(await ask({ kind: "admin", index: 0 }, "list"));
  expect(listed.body.limits).toMatchObject({ canRequest: false, requestsLeftToday: 0 });
  expect(listed.body.limits.nextRequestAt).toBeTruthy();
  // The newest finished file replaced the older ones: only one READY row remains.
  expect(await db.companyExport.count({ where: { organizationId: orgA, status: "READY" } })).toBe(1);
  expect(await db.companyExport.count({ where: { organizationId: orgA, status: "EXPIRED" } })).toBe(2);
  // Another company is not affected by A's quota.
  expect((await ask({ kind: "admin", index: 1 }, "request")).status).toBe(202);
});

test("a request older than 24 hours stops counting; an abandoned pending export is failed and frees the slot", async () => {
  for (let i = 0; i < 3; i++) {
    await db.companyExport.create({ data: { organizationId: orgA, requestedById: adminIds[0], requestedByRole: "ADMIN_FIRMY", idempotencyKey: randomUUID(),
      artifactKey: `company-exports/${orgA}/${randomUUID()}.bin`, status: "DELETED", createdAt: new Date(Date.now() - 25 * 3_600_000 + i * 1000) } });
  }
  expect((await ask({ kind: "admin", index: 0 }, "request")).status).toBe(202);
  await db.companyExport.updateMany({ where: { organizationId: orgA, status: "PENDING" }, data: { createdAt: new Date(Date.now() - 40 * 60_000) } });
  await db.companyExport.deleteMany({ where: { organizationId: orgA, status: "DELETED" } });
  expect((await ask({ kind: "admin", index: 0 }, "request")).status).toBe(202);
  const rows = await db.companyExport.findMany({ where: { organizationId: orgA }, orderBy: { createdAt: "asc" } });
  expect(rows.map((row) => [row.status, row.errorCode])).toEqual([["FAILED", "EXPORT_TIMEOUT"], ["PENDING", null]]);
});

test("the term is enforced on the row: after expiry a download is refused even when the bytes exist, and the sweep removes them", async () => {
  const id = await exportReady({ kind: "admin", index: 0 }, orgA);
  const row = await db.companyExport.findUniqueOrThrow({ where: { id } });
  await db.companyExport.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  expect((await getArtifact(storage, row.artifactKey)).length).toBeGreaterThan(0);
  const refused = await json(await ask({ kind: "admin", index: 0 }, "download", { exportId: id }));
  expect(refused).toMatchObject({ status: 410, body: { code: "EXPORT_EXPIRED" } });
  expect((await json(await ask({ kind: "admin", index: 0 }, "one", { exportId: id }))).body.export.status).toBe("EXPIRED"); // before any sweep
  expect(await sweepCompanyExports(db, storage, new Date())).toBeGreaterThanOrEqual(1);
  expect(await sweepCompanyExports(db, storage, new Date())).toBe(0); // repeated sweep has nothing left
  const after = await db.companyExport.findUniqueOrThrow({ where: { id } });
  expect(after).toMatchObject({ status: "DELETED" });
  expect(after.deletedAt).not.toBeNull();
  expect(after.storageCleanedAt).not.toBeNull();
  await expect(getArtifact(storage, row.artifactKey)).rejects.toBeTruthy();
  expect((await json(await ask({ kind: "admin", index: 0 }, "download", { exportId: id }))).status).toBe(410);
  const expired = await db.auditLog.count({ where: { organizationId: orgA, action: "EXPORT_EXPIRED", entityId: id } });
  expect(expired).toBe(1);
  expect((await json(await ask({ kind: "admin", index: 0 }, "one", { exportId: id }))).body.export.status).toBe("EXPIRED");
});

test("sweep: an abandoned pending export is failed, its job closed, late bytes under its key are collected and nothing stays after DELETED", async () => {
  const stale = await json(await ask({ kind: "admin", index: 0 }, "request"));
  await db.companyExport.update({ where: { id: stale.body.export.id }, data: { createdAt: new Date(Date.now() - 40 * 60_000) } });
  const staleRow = await db.companyExport.findUniqueOrThrow({ where: { id: stale.body.export.id } });
  // A late writer left bytes under the row's key.
  const { encryptArtifact, putArtifact } = await import("../../src/modules/company-export/artifact");
  await putArtifact(storage, staleRow.artifactKey, encryptArtifact(Buffer.from("late"), key, staleRow.artifactKey).bytes);
  await sweepCompanyExports(db, storage, new Date());
  await sweepCompanyExports(db, storage, new Date());
  expect(await db.companyExport.findUniqueOrThrow({ where: { id: staleRow.id } })).toMatchObject({ status: "DELETED", errorCode: "EXPORT_TIMEOUT" });
  await expect(getArtifact(storage, staleRow.artifactKey)).rejects.toBeTruthy();
  expect((await db.job.findFirstOrThrow({ where: { organizationId: orgA, kind: EXPORT_JOB_KIND } })).status).toBe("FAILED");
  expect((await json(await ask({ kind: "admin", index: 0 }, "one", { exportId: staleRow.id }))).body.export).toMatchObject({ status: "FAILED", errorCode: "EXPORT_TIMEOUT" });
});

test("service period: an expired paid period or trial does not block the admin's export (E13)", async () => {
  expect((await db.serviceAccess.findUniqueOrThrow({ where: { organizationId: orgA } })).paidThrough?.toISOString().slice(0, 10)).toBe("2020-01-31");
  expect((await ask({ kind: "admin", index: 0 }, "request")).status).toBe(202);
});

test("archive: the admin gets nothing, the superadmin may export for 30 days after archiving and the audit says so, later it is refused (E8)", async () => {
  for (const op of ["list", "request"] as const) expect((await ask({ kind: "admin", index: 2 }, op)).status).toBe(403);
  expect((await ask({ kind: "admin", index: 3 }, "list")).status).toBe(403);
  const listed = await json(await ask({ kind: "super", org: orgC }, "list"));
  expect(listed.status).toBe(200);
  expect(listed.body.limits.canRequest).toBe(true);
  expect(new Date(listed.body.limits.archiveWindowEndsAt).getTime()).toBeGreaterThan(Date.now() + 24 * DAY);
  const created = await json(await ask({ kind: "super", org: orgC }, "request"));
  expect(created.status).toBe(202);
  expect(created.body.export.context).toBe("ARCHIVED_COMPANY");
  expect((await runJob(orgC)).ready).toBe(true);
  const id = created.body.export.id as string;
  expect((await ask({ kind: "super", org: orgC }, "download", { exportId: id })).status).toBe(200);
  expect((await ask({ kind: "admin", index: 2 }, "download", { exportId: id })).status).toBe(403);
  const audit = await db.auditLog.findMany({ where: { organizationId: orgC, entityType: "CompanyExport", action: { in: ["EXPORT_REQUESTED", "EXPORT_DOWNLOADED"] } } });
  expect(audit).toHaveLength(2);
  for (const row of audit) expect(row.safeChanges).toMatchObject({ context: "ARCHIVED_COMPANY" });
  // 31 days after archiving: refused, nothing written, proof kept.
  const late = await json(await ask({ kind: "super", org: orgD }, "request"));
  expect(late).toMatchObject({ status: 409, body: { code: "EXPORT_ARCHIVE_WINDOW_ELAPSED" } });
  expect(await db.companyExport.count({ where: { organizationId: orgD } })).toBe(0);
  expect((await json(await ask({ kind: "super", org: orgD }, "list"))).body.limits.canRequest).toBe(false);
});

test("an admin whose company is archived while the job waits gets a failed export and no file", async () => {
  const id = (await json(await ask({ kind: "admin", index: 1 }, "request"))).body.export.id as string;
  await db.organization.update({ where: { id: orgB }, data: { archivedAt: new Date() } });
  try {
    expect((await runJob(orgB)).ready).toBe(false);
  } finally { await db.organization.update({ where: { id: orgB }, data: { archivedAt: null } }); }
  const row = await db.companyExport.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ status: "FAILED", errorCode: "EXPORT_COMPANY_ARCHIVED" });
  await expect(getArtifact(storage, row.artifactKey)).rejects.toBeTruthy();
  expect(await db.auditLog.count({ where: { organizationId: orgB, action: "EXPORT_FAILED", entityId: id } })).toBe(1);
  expect((await json(await ask({ kind: "admin", index: 1 }, "download", { exportId: id }))).status).toBe(410);
});

test("a tampered or swapped file is refused and never served", async () => {
  const id = await exportReady({ kind: "admin", index: 0 }, orgA);
  const row = await db.companyExport.findUniqueOrThrow({ where: { id } });
  const { putArtifact } = await import("../../src/modules/company-export/artifact");
  const bytes = await getArtifact(storage, row.artifactKey);
  const flipped = Buffer.from(bytes);
  flipped[flipped.length - 1] ^= 1;
  await putArtifact(storage, row.artifactKey, flipped);
  expect((await json(await ask({ kind: "admin", index: 0 }, "download", { exportId: id }))).status).toBe(503);
  // Bytes of another company's export under this key (valid digest recorded elsewhere) do not decrypt either.
  const idB = await exportReady({ kind: "admin", index: 1 }, orgB);
  const other = await db.companyExport.findUniqueOrThrow({ where: { id: idB } });
  await putArtifact(storage, row.artifactKey, await getArtifact(storage, other.artifactKey));
  expect((await json(await ask({ kind: "admin", index: 0 }, "download", { exportId: id }))).status).toBe(503);
  expect(await db.auditLog.count({ where: { organizationId: orgA, action: "EXPORT_DOWNLOADED" } })).toBe(0);
});

test("restore does not resurrect an export: open exports of the company expire, others keep theirs, bytes are swept", async () => {
  const idA = await exportReady({ kind: "admin", index: 0 }, orgA);
  const idB = await exportReady({ kind: "admin", index: 1 }, orgB);
  const pendingA = (await json(await ask({ kind: "admin", index: 0 }, "request"))).body.export.id as string;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const report = await quarantineRestoredState(client, { organizationId: orgA, now: new Date() });
    expect(report.companyExports).toBe(2);
  } finally { await client.end(); }
  // A restore revokes sessions (quarantine); sign in again.
  adminSession = [await session(adminIds[0]), await session(adminIds[1]), ...adminSession.slice(2)];
  superSession = await session(superId);
  expect((await json(await ask({ kind: "admin", index: 0 }, "download", { exportId: idA }))).status).toBe(410);
  expect((await json(await ask({ kind: "admin", index: 0 }, "one", { exportId: pendingA }))).body.export.status).toBe("EXPIRED");
  expect((await ask({ kind: "admin", index: 1 }, "download", { exportId: idB })).status).toBe(200); // company B untouched
  const rowA = await db.companyExport.findUniqueOrThrow({ where: { id: idA } });
  await sweepCompanyExports(db, storage, new Date());
  await expect(getArtifact(storage, rowA.artifactKey)).rejects.toBeTruthy();
  // The queued job of the restored company is skipped, not built.
  const claim = await claimNextJob(db, new Date(Date.now() + 1000), EXPORT_LEASE_MS, false, EXPORT_JOB_KIND);
  if (claim) expect(await processCompanyExportClaim(db, storage, claim, key)).toBe(false);
  expect((await db.companyExport.findUniqueOrThrow({ where: { id: pendingA } })).status).toBe("DELETED");
});

test("the media worker loop builds a queued export and later sweeps it after its term", async () => {
  const { runMediaWorkerLoop } = await import("../../src/modules/media/worker");
  const id = (await json(await ask({ kind: "admin", index: 0 }, "request"))).body.export.id as string;
  const controller = new AbortController();
  const loop = runMediaWorkerLoop(db, storage, controller.signal);
  try {
    for (let i = 0; i < 100; i++) {
      if ((await db.companyExport.findUniqueOrThrow({ where: { id } })).status === "READY") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect((await db.companyExport.findUniqueOrThrow({ where: { id } })).status).toBe("READY");
    await db.companyExport.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    for (let i = 0; i < 100; i++) {
      if ((await db.companyExport.findUniqueOrThrow({ where: { id } })).storageCleanedAt) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally { controller.abort(); await loop; }
  expect(await db.companyExport.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "DELETED" });
});
