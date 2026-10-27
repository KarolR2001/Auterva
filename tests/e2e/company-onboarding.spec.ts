import { randomUUID } from "node:crypto";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";
import { decryptMailPayload } from "../../src/modules/jobs/outbox";
import { parseMailPayloadKey } from "../../src/modules/jobs/config";
import { ensureControlledSuperadminMfa, verifiedFixtureSession } from "../fixtures/verified-session";

function onHost(port: number, host: string, path: string, method: string, cookie?: string, body?: object,
  origin = `http://${host}`): Promise<{ status: number; body: Record<string, string>; headers: IncomingHttpHeaders }> {
  const data = body === undefined ? null : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers: {
      Host: host, ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: origin } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
    } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => {
        try { resolve({ status: response.statusCode ?? 0,
          body: raw && response.headers["content-type"]?.includes("application/json")
            ? JSON.parse(raw) as Record<string, string> : {}, headers: response.headers }); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end(data ?? undefined);
  });
}

test("built ingress preregisters once and activates the bound invitation without full MFA", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const marker = randomUUID();
  const slug = `onboarding-${marker.slice(0, 8)}`;
  const email = `onboarding-${marker}@example.test`;
  const platformHost = `platform-onboarding-${marker}.example.test`;
  const adminHost = `${slug}.sites.example.test`;
  const port = Number(new URL(baseURL).port);
  let organizationId: string | null = null;
  let ownedSuperadmin: string | null = null;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | null = null;
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  try {
    const existing = await db.user.findFirst({ where: { role: "SUPERADMIN_AUTERVA" }, select: { id: true } });
    const actorId = existing?.id ?? randomUUID();
    if (existing) await ensureControlledSuperadminMfa(db, actorId);
    else {
      ownedSuperadmin = actorId;
      await db.user.create({ data: { id: actorId, name: "Onboarding HTTP operator",
        email: `onboarding-operator-${marker}@example.test`, emailVerified: true, twoFactorEnabled: true,
        role: "SUPERADMIN_AUTERVA" } });
    }
    session = await verifiedFixtureSession(db, actorId);
    const create = { name: "Onboarding HTTP company", slug, adminEmail: email,
      trialGranted: true, paidThrough: null, idempotencyKey: randomUUID() };
    expect((await onHost(port, platformHost, "/api/platform/companies/", "POST", session.cookie, create,
      "http://other.example.test")).status).toBe(403);
    const first = await onHost(port, platformHost, "/api/platform/companies/", "POST", session.cookie, create);
    expect(first.status).toBe(200);
    organizationId = first.body.organizationId;
    expect(first.headers["cache-control"]).toBe("no-store");
    expect((await onHost(port, platformHost, "/api/platform/companies/", "POST", session.cookie, create)).body)
      .toEqual(first.body);
    const invitePath = `/api/platform/companies/${organizationId}/invitations/`;
    expect((await onHost(port, platformHost, invitePath, "POST", session.cookie,
      { idempotencyKey: randomUUID() })).status).toBe(409);
    await db.hostMapping.update({ where: { hostname: adminHost }, data: { status: "ACTIVE" } });
    const issued = await onHost(port, platformHost, invitePath, "POST", session.cookie,
      { idempotencyKey: randomUUID() });
    expect(issued.status).toBe(201);
    const mailKey = parseMailPayloadKey(process.env.MAIL_PAYLOAD_KEY);
    const job = await db.job.findFirstOrThrow({ where: { organizationId,
      dedupeKey: `MAIL_INVITATION:${issued.body.invitationId}` } });
    const token = decryptMailPayload(job.payload, mailKey).url.split("/").at(-1)!;
    const getPath = `/api/auth/invitation/${token}/`;
    expect((await onHost(port, platformHost, getPath, "GET")).status).toBe(404);
    expect((await onHost(port, adminHost, getPath, "GET")).status).toBe(200);
    expect((await onHost(port, adminHost, getPath, "GET")).status).toBe(200);
    expect((await db.invitation.findUniqueOrThrow({ where: { id: issued.body.invitationId } })).usedAt).toBeNull();
    expect((await db.organization.findUniqueOrThrow({ where: { id: organizationId } })).firstAdminRegisteredAt).toBeNull();
    const activationPassword = "Onboarding password 9912!";
    expect((await onHost(port, platformHost, getPath, "POST", undefined,
      { password: activationPassword })).status).toBe(404);
    expect((await onHost(port, adminHost, getPath, "POST", undefined,
      { password: activationPassword }, "http://sibling.example.test")).status).toBe(403);
    const activated = await onHost(port, adminHost, getPath, "POST", undefined,
      { password: activationPassword });
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ organizationId, siteState: "DOMAIN_PENDING",
      signInRequired: true });
    expect(activated.headers["set-cookie"]).toBeUndefined();
    expect((await onHost(port, adminHost, getPath, "POST", undefined,
      { password: "Different password 9922!" })).status).toBe(200);
    const company = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const access = await db.serviceAccess.findUniqueOrThrow({ where: { organizationId } });
    expect(company.firstAdminRegisteredAt).not.toBeNull();
    expect(access.trialStartedAt).toEqual(company.firstAdminRegisteredAt);
    expect((access.trialEndsAt?.getTime() ?? NaN) - company.firstAdminRegisteredAt!.getTime())
      .toBe(336 * 60 * 60_000);
    expect(access.periodVersion).toBe(1);
    expect(await db.auditLog.count({ where: { organizationId, action: "INVITATION_ACCEPTED" } })).toBe(1);
    const login = await onHost(port, adminHost, "/api/auth/sign-in/email/", "POST", undefined,
      { email, password: activationPassword });
    expect(login.status).toBe(200);
    expect(login.headers["set-cookie"]).toBeDefined();
    expect(await db.auditLog.count({ where: { organizationId, action: "AUTH_LOGIN_COMPLETED" } })).toBe(0);
  } finally {
    if (organizationId) {
      await db.job.deleteMany({ where: { organizationId } });
      await db.invitation.deleteMany({ where: { organizationId } });
      await db.auditLog.deleteMany({ where: { organizationId } });
      await db.operationReceipt.deleteMany({ where: { organizationId } });
      await db.reminderIntent.deleteMany({ where: { organizationId } });
      await db.reminderPlan.deleteMany({ where: { organizationId } });
      await db.serviceAccess.deleteMany({ where: { organizationId } });
      await db.user.deleteMany({ where: { organizationId } });
      await db.hostMapping.deleteMany({ where: { organizationId } });
      await db.organization.delete({ where: { id: organizationId } });
    }
    if (session) await session.dispose();
    await db.hostMapping.deleteMany({ where: { hostname: platformHost } });
    if (ownedSuperadmin) await db.user.deleteMany({ where: { id: ownedSuperadmin } });
    await db.$disconnect();
  }
});
