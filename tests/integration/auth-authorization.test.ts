import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { requireAuthorizedActor, resolveAuthHost } from "../../src/modules/auth/authorization";
import { requireRequestContext } from "../../src/modules/tenancy/request-context";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const instance = createAuth(db, true);
const a = randomUUID();
const b = randomUUID();
const email = `auth-${randomUUID()}@example.test`;
const platformEmail = `platform-${randomUUID()}@example.test`;
const hosts = [`admin-a-${randomUUID()}.example.test`, `public-b-${randomUUID()}.example.test`, `platform-${randomUUID()}.example.test`, `admin-b-${randomUUID()}.example.test`];

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: a, slug: `auth-${a}` }, { id: b, slug: `auth-${b}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: hosts[0], area: "COMPANY_ADMIN", organizationId: a, status: "ACTIVE" },
    { hostname: hosts[1], area: "COMPANY_PUBLIC", organizationId: b, status: "ACTIVE" },
    { hostname: hosts[2], area: "PLATFORM", status: "ACTIVE" },
    { hostname: hosts[3], area: "COMPANY_ADMIN", organizationId: b, status: "ACTIVE" },
  ] });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: [email, platformEmail] } } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: hosts } } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
});

test("active authority selects the auth scope with the shared hostname normalization", async () => {
  expect(await resolveAuthHost(db, hosts[0])).toMatchObject({ area: "COMPANY_ADMIN", organizationId: a });
  expect(await resolveAuthHost(db, `${hosts[0]}.`)).toMatchObject({ area: "COMPANY_ADMIN", organizationId: a });
  expect(await resolveAuthHost(db, hosts[1])).toBeNull();
  expect(await resolveAuthHost(db, hosts[2])).toMatchObject({ area: "PLATFORM", organizationId: null });
  expect(await resolveAuthHost(db, `${hosts[3]},${hosts[0]}`)).toBeNull();
});

test("session is scoped to host, MFA proof and current archive state", async () => {
  const registration = await instance.api.signUpEmail({ body: { name: "Auth fixture", email, password: "Fixture password 9384!" }, returnHeaders: true });
  const userId = registration.response.user.id;
  const cookie = registration.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  const headers = new Headers({ cookie });
  await db.user.update({ where: { id: userId }, data: { role: "ADMIN_FIRMY", organizationId: a, twoFactorEnabled: true, emailVerified: true } });
  const scope = await resolveAuthHost(db, hosts[0]);
  expect(scope).not.toBeNull();
  if (!scope) throw new Error("Missing scope");
  expect(await requireAuthorizedActor(db, instance, headers, scope)).toBeNull();
  const session = await instance.api.getSession({ headers });
  if (!session) throw new Error("Missing session");
  await db.session.update({ where: { id: session.session.id }, data: { mfaVerifiedAt: new Date() } });
  expect(await requireAuthorizedActor(db, instance, headers, scope)).toMatchObject({ userId, organizationId: a, role: "ADMIN_FIRMY" });
  expect(await requireAuthorizedActor(db, instance, headers, { area: "COMPANY_ADMIN", organizationId: b })).toBeNull();
  expect(await requireAuthorizedActor(db, instance, headers, { area: "PLATFORM", organizationId: null })).toBeNull();
  expect(await requireRequestContext(db, instance, new Headers({ cookie, host: hosts[0] }), a)).toMatchObject({ actorId: userId, organizationId: a });
  expect(await requireRequestContext(db, instance, new Headers({ cookie, host: hosts[0] }), b)).toBeNull();
  expect(await requireRequestContext(db, instance, new Headers({ cookie, host: `${hosts[0]}.` }), a)).toMatchObject({ actorId: userId, organizationId: a });
  expect(await requireRequestContext(db, instance, new Headers({ cookie, host: hosts[3] }), b)).toBeNull();
  expect(await requireRequestContext(db, instance, new Headers({ cookie, host: hosts[1] }), b)).toBeNull();
  expect(await requireRequestContext(db, instance, new Headers({ cookie, host: hosts[2] }), a)).toBeNull();
  await db.organization.update({ where: { id: a }, data: { archivedAt: new Date() } });
  expect(await requireAuthorizedActor(db, instance, headers, scope)).toBeNull();
  await db.organization.update({ where: { id: a }, data: { archivedAt: null } });
});

test("a verified superadmin selects either existing company as the same actor", async () => {
  const registration = await instance.api.signUpEmail({ body: { name: "Platform fixture", email: platformEmail, password: "Fixture password 9384!" }, returnHeaders: true });
  const userId = registration.response.user.id;
  const cookie = registration.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  await db.user.update({ where: { id: userId }, data: { role: "SUPERADMIN_AUTERVA", twoFactorEnabled: true, emailVerified: true } });
  const session = await instance.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("Missing platform session");
  await db.session.update({ where: { id: session.session.id }, data: { mfaVerifiedAt: new Date() } });
  const headers = new Headers({ cookie, host: hosts[2] });
  expect(await requireRequestContext(db, instance, headers, a)).toMatchObject({ actorId: userId, role: "SUPERADMIN_AUTERVA", organizationId: a });
  expect(await requireRequestContext(db, instance, headers, b)).toMatchObject({ actorId: userId, role: "SUPERADMIN_AUTERVA", organizationId: b });
  expect(await requireRequestContext(db, instance, headers, randomUUID())).toBeNull();
  expect(await requireRequestContext(db, instance, new Headers({ cookie, host: hosts[0] }), a)).toBeNull();
});
