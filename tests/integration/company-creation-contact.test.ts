import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";
import { POST as postCompany } from "../../src/app/api/platform/companies/route";

// D-41 (#334): optional contact/address at company creation, same rules as the settings groups.
const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const marker = randomUUID();
const platformHost = `platform-contact-${marker}.example.test`;
const ids: string[] = [];
let actorId: string;
let createdActor = false;
let session: Awaited<ReturnType<typeof verifiedFixtureSession>>;
const previous = { admin: process.env.AUTERVA_ADMIN_BASE_DOMAIN, public: process.env.AUTERVA_PUBLIC_BASE_DOMAIN };

beforeAll(async () => {
  process.env.AUTERVA_ADMIN_BASE_DOMAIN = "sites.example.test";
  process.env.AUTERVA_PUBLIC_BASE_DOMAIN = "public.example.test";
  const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
  actorId = existing?.id ?? randomUUID();
  if (existing) await ensureControlledSuperadminMfa(db, actorId);
  else {
    await db.user.create({ data: { id: actorId, name: "Contact operator", email: `operator-${marker}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    createdActor = true;
  }
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  session = await verifiedFixtureSession(db, actorId);
});

afterAll(async () => {
  for (const [key, value] of [["AUTERVA_ADMIN_BASE_DOMAIN", previous.admin], ["AUTERVA_PUBLIC_BASE_DOMAIN", previous.public]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await db.siteSettings.deleteMany({ where: { organizationId: { in: ids } } });
  await db.auditLog.deleteMany({ where: { organizationId: { in: ids } } });
  await db.operationReceipt.deleteMany({ where: { organizationId: { in: ids } } });
  await db.serviceAccess.deleteMany({ where: { organizationId: { in: ids } } });
  await db.user.deleteMany({ where: { organizationId: { in: ids } } });
  await db.hostMapping.deleteMany({ where: { organizationId: { in: ids } } });
  await db.organization.deleteMany({ where: { id: { in: ids } } });
  if (session) await session.dispose();
  await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
  if (createdActor) await db.user.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
});

const post = (body: object) => postCompany(new Request("http://127.0.0.1:3339/api/platform/companies", {
  method: "POST", headers: { host: platformHost, origin: `http://${platformHost}`,
    cookie: session.cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));
const base = (tag: string) => ({ name: `Contact ${tag}`, slug: `ct-${tag}-${marker.slice(0, 6)}`,
  adminEmail: `ct-${tag}-${marker}@example.test`, trialGranted: true, paidThrough: null,
  idempotencyKey: randomUUID() });
const created = async (response: Response) => {
  expect(response.status).toBe(200);
  const result = await response.json() as { organizationId: string };
  ids.push(result.organizationId);
  return result;
};

test("contact and address are saved to settings in the creation transaction, with audit and idempotency", async () => {
  const body = { ...base("full"), phone: " +48 600 100 200 ", email: " Biuro@Example.TEST ",
    addressLine: "Długa 1", postalCode: "00-001", city: "Warszawa", country: "Polska" };
  const first = await created(await post(body));
  const settings = await db.siteSettings.findUniqueOrThrow({ where: { organizationId: first.organizationId } });
  expect(settings).toMatchObject({ phone: "+48 600 100 200", email: "biuro@example.test", addressLine: "Długa 1",
    postalCode: "00-001", city: "Warszawa", country: "Polska", version: 1, contactChannel: null });
  // Not published and no invitation issued.
  expect(await db.invitation.count({ where: { organizationId: first.organizationId } })).toBe(0);
  expect(await db.organization.findUniqueOrThrow({ where: { id: first.organizationId } }))
    .toMatchObject({ firstAdminRegisteredAt: null });
  // Retry: same key and data returns the same result and does not duplicate anything.
  const again = await created(await post(body));
  expect(again).toEqual(first);
  expect(await db.siteSettings.count({ where: { organizationId: first.organizationId } })).toBe(1);
  expect(await db.operationReceipt.count({ where: { organizationId: first.organizationId, operation: "CREATE_COMPANY" } })).toBe(1);
  // Same key, other contact data: idempotency conflict, settings untouched.
  const conflict = await post({ ...body, phone: "+48 600 100 201" });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({ code: "COMPANY_IDEMPOTENCY_CONFLICT" });
  expect((await db.siteSettings.findUniqueOrThrow({ where: { organizationId: first.organizationId } })).phone)
    .toBe("+48 600 100 200");
  // Audit: company creation plus settings change, field names only (no private values).
  const audits = await db.auditLog.findMany({ where: { organizationId: first.organizationId }, orderBy: { createdAt: "asc" } });
  expect(audits.map((row) => row.action).sort()).toEqual(["COMPANY_CREATED", "SETTINGS_CHANGED"]);
  const settingsAudit = audits.find((row) => row.action === "SETTINGS_CHANGED")!;
  expect(settingsAudit.actorId).toBe(actorId);
  expect(settingsAudit.safeChanges).toMatchObject({ changedFields: expect.arrayContaining(
    ["phone", "email", "addressLine", "postalCode", "city", "country", "version"]) });
  const serialized = JSON.stringify(audits);
  for (const secret of ["600 100 200", "biuro@example.test", "Długa 1", "Warszawa"]) expect(serialized).not.toContain(secret);
});

test("without contact fields (or with empty ones) no settings row is created", async () => {
  const none = await created(await post(base("none")));
  expect(await db.siteSettings.count({ where: { organizationId: none.organizationId } })).toBe(0);
  expect((await db.auditLog.findMany({ where: { organizationId: none.organizationId } })).map((row) => row.action))
    .toEqual(["COMPANY_CREATED"]);
  const empty = await created(await post({ ...base("empty"), phone: "", email: "  ", city: "" }));
  expect(await db.siteSettings.count({ where: { organizationId: empty.organizationId } })).toBe(0);
});

test("invalid contact fields return 400 with fieldErrors and write nothing", async () => {
  const body = { ...base("bad"), phone: "abc", email: "not-an-email", city: "<b>x</b>", postalCode: "x".repeat(40) };
  const before = await db.operationReceipt.count({ where: { actorId, operation: "CREATE_COMPANY" } });
  const response = await post(body);
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ code: "INVALID_INPUT", fieldErrors: { phone: "INVALID_PHONE",
    email: "INVALID_EMAIL", city: "MARKUP_NOT_ALLOWED", postalCode: "TOO_LONG" } });
  expect(await db.organization.count({ where: { slug: body.slug } })).toBe(0);
  expect(await db.operationReceipt.count({ where: { actorId, operation: "CREATE_COMPANY" } })).toBe(before);
  expect((await post({ ...base("type"), phone: 123 })).status).toBe(400);
  expect((await post({ ...base("unk"), whatsapp: "+48 600 100 200" })).status).toBe(400);
});

test("contact data is isolated per company", async () => {
  const a = await created(await post({ ...base("isoa"), phone: "+48 111 111 111" }));
  const b = await created(await post({ ...base("isob"), phone: "+48 222 222 222" }));
  expect((await db.siteSettings.findUniqueOrThrow({ where: { organizationId: a.organizationId } })).phone).toBe("+48 111 111 111");
  expect((await db.siteSettings.findUniqueOrThrow({ where: { organizationId: b.organizationId } })).phone).toBe("+48 222 222 222");
});
