import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

type Reply = { status: number; body: Record<string, unknown>; headers: IncomingHttpHeaders };

function call(port: number, host: string, method: string, path: string, cookie = "", body?: unknown): Promise<Reply> {
  const data = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: {
      Host: host, Origin: `http://${host}`, ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
    } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        let parsed: Record<string, unknown> = {};
        try { parsed = raw && response.headers["content-type"]?.includes("application/json") ? JSON.parse(raw) : {}; }
        catch (error) { reject(error); return; }
        resolve({ status: response.statusCode ?? 0, body: parsed, headers: response.headers });
      });
    });
    request.on("error", reject);
    request.end(data);
  });
}

test("built app: archive logs the admin out and hides every public host; restore returns login only until unlock", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const auth = createAuth(db, true);
  const [orgA, orgB] = [randomUUID(), randomUUID()];
  const platformHost = `archive-e2e-platform-${randomUUID()}.example.test`;
  const adminHost = [`archive-e2e-a-${orgA}.example.test`, `archive-e2e-b-${orgB}.example.test`];
  // publicHosts[1] is an active custom domain; the alias redirects to it while the offer is visible.
  const publicHosts = [`archive-e2e-pub-${orgA}.example.test`, `www.archive-e2e-${orgA.slice(0, 8)}.klient.example.test`];
  const alias = `archive-e2e-alias-${orgA}.example.test`;
  const password = "Fixture password 9384!";
  const email = `archive-e2e-${randomUUID()}@example.test`;
  const userB = randomUUID();
  let ownedSuperadmin: string | null = null;
  const sessions: Awaited<ReturnType<typeof verifiedFixtureSession>>[] = [];
  const paidThrough = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const registered = new Date(Date.now() - 86_400_000);
  let adminId = "";
  try {
    await db.organization.createMany({ data: [orgA, orgB].map((id) => ({ id, slug: `archive-e2e-${id}`,
      firstAdminRegisteredAt: registered })) });
    await db.hostMapping.createMany({ data: [
      { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
      { hostname: adminHost[0], area: "COMPANY_ADMIN", organizationId: orgA, status: "ACTIVE" },
      { hostname: adminHost[1], area: "COMPANY_ADMIN", organizationId: orgB, status: "ACTIVE" },
      { hostname: publicHosts[0], area: "COMPANY_PUBLIC", organizationId: orgA, status: "ACTIVE" },
      { hostname: publicHosts[1], area: "COMPANY_PUBLIC", kind: "CUSTOM", organizationId: orgA, status: "ACTIVE" },
      { hostname: alias, area: "COMPANY_PUBLIC", organizationId: orgA, status: "ACTIVE", canonicalTarget: publicHosts[1] },
    ] });
    const custom = await db.hostMapping.findUniqueOrThrow({ where: { hostname: publicHosts[1] } });
    await db.customDomain.create({ data: { organizationId: orgA, hostMappingId: custom.id,
      verificationToken: `archive-token-${orgA}`, status: "ACTIVE", activatedAt: new Date(),
      ownershipVerifiedAt: new Date(), routingVerifiedAt: new Date(), tlsVerifiedAt: new Date() } });
    for (const id of [orgA, orgB]) await db.serviceAccess.create({ data: { organizationId: id, paidThrough: new Date(`${paidThrough}T00:00:00.000Z`),
      trialGranted: true, trialStartedAt: registered, trialEndsAt: new Date(registered.getTime() + 336 * 3_600_000) } });
    await db.organization.update({ where: { id: orgA }, data: { publicRequiresPaid: true } });
    const signedUp = await auth.api.signUpEmail({ body: { name: "Archive E2E admin", email, password } });
    adminId = signedUp.user.id;
    await db.user.update({ where: { id: adminId }, data: { role: "ADMIN_FIRMY", organizationId: orgA, emailVerified: true,
      twoFactorEnabled: true } });
    await db.user.create({ data: { id: userB, name: "Archive E2E B", email: `archive-e2e-${userB}@example.test`,
      emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: orgB } });
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const platformId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, platformId);
    else {
      ownedSuperadmin = platformId;
      await db.user.create({ data: { id: platformId, name: "Archive E2E operator", email: `archive-e2e-op-${platformId}@example.test`,
        emailVerified: true, twoFactorEnabled: true, role: "SUPERADMIN_AUTERVA" } });
    }
    const platform = await verifiedFixtureSession(db, platformId);
    const admin = await verifiedFixtureSession(db, adminId);
    const other = await verifiedFixtureSession(db, userB);
    sessions.push(platform, admin, other);
    const base = `/api/platform/companies/${orgA}`;

    // Before: the company is public, the admin has a session and may start a login.
    for (const host of publicHosts) expect((await call(port, host, "GET", "/")).status).toBe(200);
    expect((await call(port, alias, "GET", "/")).status).toBe(307);
    expect((await call(port, adminHost[0], "GET", "/api/auth/get-session/", admin.cookie)).status).toBe(200);
    const detail = await call(port, platformHost, "GET", `${base}/`, platform.cookie);
    expect(detail.status).toBe(200);
    const version = detail.body.organizationVersion as number;

    // Archive.
    const expectClosed = async () => {
      for (const host of publicHosts) expect((await call(port, host, "GET", "/")).status).toBe(404);
      const closedAlias = await call(port, alias, "GET", "/");
      expect(closedAlias.status).toBe(404);
      expect(closedAlias.headers.location).toBeUndefined();
      // The routing probe of the custom host stays a bare proof and never exposes company data.
      const probe = await call(port, publicHosts[1], "GET", "/.well-known/auterva-domain-check/");
      expect(Object.keys(probe.body)).toEqual(["proof"]);
    };
    const archived = await call(port, platformHost, "POST", `${base}/archive/`, platform.cookie,
      { expectedOrganizationVersion: version, eventKey: randomUUID() });
    expect(archived.status).toBe(200);
    expect(archived.body).toMatchObject({ version: version + 1, publicUnlockRequired: true, publicRequiresPaid: true });
    expect((await call(port, adminHost[0], "GET", "/api/auth/get-session/", admin.cookie)).status).toBe(401);
    const login = await call(port, adminHost[0], "POST", "/api/auth/sign-in/email/", "", { email, password });
    expect(login.status).toBe(401);
    expect(login.headers["set-cookie"]).toBeUndefined();
    await expectClosed();
    expect((await call(port, adminHost[1], "GET", "/api/auth/get-session/", other.cookie)).status).toBe(200);
    const seen = await call(port, platformHost, "GET", `${base}/`, platform.cookie);
    expect(seen.body).toMatchObject({ organizationVersion: version + 1 });
    expect(seen.body.archivedAt).not.toBeNull();
    const list = await call(port, platformHost, "GET", `/api/platform/companies/?includeArchived=true&search=${orgA}`, platform.cookie);
    expect((list.body.items as unknown[]).length).toBe(1);
    expect((await call(port, platformHost, "GET", `/api/platform/companies/?search=${orgA}`, platform.cookie)).body.items).toEqual([]);
    // Unlock is refused while archived.
    expect((await call(port, platformHost, "POST", `${base}/public-unlock/`, platform.cookie,
      { expectedOrganizationVersion: version + 1, eventKey: randomUUID() })).body.code).toBe("PERIOD_ARCHIVED");

    // Restore: login works again, but both public gates keep the pages hidden despite valid trial and payment.
    const restored = await call(port, platformHost, "POST", `${base}/restore/`, platform.cookie,
      { expectedOrganizationVersion: version + 1, eventKey: randomUUID() });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ archivedAt: null, version: version + 2, publicUnlockRequired: true });
    expect((await call(port, adminHost[0], "GET", "/api/auth/get-session/", admin.cookie)).status).toBe(401);
    const relogin = await call(port, adminHost[0], "POST", "/api/auth/sign-in/email/", "", { email, password });
    expect(relogin.status).toBe(200);
    await expectClosed();
    const unlocked = await call(port, platformHost, "POST", `${base}/public-unlock/`, platform.cookie,
      { expectedOrganizationVersion: version + 2, eventKey: randomUUID() });
    expect(unlocked.status).toBe(200);
    for (const host of publicHosts) expect((await call(port, host, "GET", "/")).status).toBe(200);
    expect((await call(port, alias, "GET", "/")).status).toBe(307);
    expect(await db.auditLog.count({ where: { organizationId: orgA, action: "COMPANY_ARCHIVED" } })).toBe(1);
  } finally {
    await db.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    await db.serviceAccess.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
    for (const session of sessions) await session.dispose();
    await db.session.deleteMany({ where: { userId: { in: [adminId, userB] } } });
    await db.verification.deleteMany({ where: { value: { contains: adminId || "none" } } });
    await db.user.deleteMany({ where: { id: { in: [adminId, userB].filter(Boolean) } } });
    if (ownedSuperadmin) await db.user.delete({ where: { id: ownedSuperadmin } });
    await db.customDomain.deleteMany({ where: { organizationId: orgA } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: [platformHost, ...adminHost, ...publicHosts, alias] } } });
    await db.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
    await db.$disconnect();
  }
});
