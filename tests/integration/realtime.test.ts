import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { POST as authPost } from "../../src/app/api/auth/[...all]/route";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { createRealtimeAuthority } from "../../src/modules/chat/resolve-tenant";
import { refusedStatus, TestSocket } from "../fixtures/realtime-client";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const auth = createAuth(db, true);
const authority = createRealtimeAuthority(db, auth);
const organizations: string[] = [randomUUID(), randomUUID()];
const adminHosts = [`ws-a-${randomUUID()}.example.test`, `ws-b-${randomUUID()}.example.test`];
function adminOrigin(organizationId: string) {
  const index = organizations.indexOf(organizationId);
  if (index < 0) throw new Error("Unknown fixture organization");
  return `https://${adminHosts[index]}`;
}

function cookies(headers: Headers) {
  return headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
}

async function fixtureSession(organizationId: string) {
  const email = `ws-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  const registered = await auth.api.signUpEmail({ body: { name: "Fixture", email, password }, returnHeaders: true });
  await db.user.update({ where: { id: registered.response.user.id }, data: { organizationId, role: "ADMIN_FIRMY", emailVerified: true } });
  const enrolled = await auth.api.enableTwoFactor({ body: { password, method: "totp" }, headers: new Headers({ cookie: cookies(registered.headers) }) });
  if (enrolled.method !== "totp") throw new Error("Expected TOTP enrollment");
  const totp = OTPAuth.URI.parse(enrolled.totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
  await auth.api.verifyTOTP({ body: { code: totp.generate() }, headers: new Headers({ cookie: cookies(registered.headers) }) });

  const firstSignIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  expect(firstSignIn.response).toHaveProperty("twoFactorRedirect", true);
  const firstFactor = await auth.api.verifyTOTP({
    body: { code: totp.generate(), trustDevice: false },
    headers: new Headers({ cookie: cookies(firstSignIn.headers) }),
    returnHeaders: true,
  });
  const unprovenCookie = cookies(firstFactor.headers);
  const unprovenSession = await auth.api.getSession({ headers: new Headers({ cookie: unprovenCookie }) });
  if (!unprovenSession) throw new Error("Expected valid first session after TOTP");
  expect((await db.user.findUnique({ where: { id: unprovenSession.user.id } }))?.twoFactorEnabled).toBe(true);
  expect((await db.session.findUnique({ where: { id: unprovenSession.session.id } }))?.mfaVerifiedAt).toBeNull();
  const wsHeaders = new Headers({ cookie: unprovenCookie, origin: adminOrigin(organizationId), host: "127.0.0.1:3312" });
  expect(await authority.authorize(wsHeaders, organizationId)).toBeNull();

  const signIn = await auth.api.signInEmail({ body: { email, password }, returnHeaders: true });
  expect(signIn.response).toHaveProperty("twoFactorRedirect", true);
  const url = `${process.env.BETTER_AUTH_URL}/api/auth/two-factor/verify-totp`;
  const request = new Request(url, {
    method: "POST",
    headers: { host: new URL(url).host, origin: new URL(url).origin, cookie: cookies(signIn.headers), "content-type": "application/json" },
    body: JSON.stringify({ code: totp.generate(), trustDevice: false }),
  });
  process.env.AUTERVA_AUTH_PROBE = "1";
  const response = await authPost(request);
  expect(response.status).toBe(200);
  expect(await authority.authorize(wsHeaders, organizationId)).toBeNull();
  expect((await db.session.findUnique({ where: { id: unprovenSession.session.id } }))?.mfaVerifiedAt).toBeNull();
  return cookies(response.headers);
}

test("real login with TOTP: only the MFA-proven session connects; sign-out closes the connection and is final", async () => {
  await db.organization.createMany({ data: organizations.map((id) => ({ id, slug: `ws-${id}` })) });
  await db.hostMapping.createMany({ data: organizations.map((id, index) => ({ hostname: adminHosts[index], area: "COMPANY_ADMIN", organizationId: id, status: "ACTIVE" })) });
  const cookieA = await fixtureSession(organizations[0]);
  const cookieB = await fixtureSession(organizations[1]);
  const server = await startRealtimeServer({ db, databaseUrl: process.env.DATABASE_URL ?? "", authority,
    config: { host: "127.0.0.1", port: 0, allowedHosts: new Set() } });
  try {
    const first = await TestSocket.open(server.port, organizations[0], { cookie: cookieA, origin: adminOrigin(organizations[0]) });
    await first.takeType("ready");
    first.send({ type: "send", clientMessageId: randomUUID(), body: "Wiadomość fixture" });
    expect((await first.takeType("sent")).message.body).toBe("Wiadomość fixture");
    first.ws.close();
    await first.closed;

    // B sees nothing of A, and A's session is no key to B.
    const b = await TestSocket.open(server.port, organizations[1], { cookie: cookieB, origin: adminOrigin(organizations[1]) });
    expect((await b.takeType("ready")).conversationId).toBeNull();
    b.ws.close();
    expect(await refusedStatus(server.port, organizations[1], { cookie: cookieA, origin: adminOrigin(organizations[1]) })).toBe(403);
    expect(await refusedStatus(server.port, organizations[0], { cookie: cookieA, origin: adminOrigin(organizations[0]), host: "wrong.example.test" })).toBe(403);

    const revoked = await TestSocket.open(server.port, organizations[0], { cookie: cookieA, origin: adminOrigin(organizations[0]) });
    await revoked.takeType("ready");
    const sessionA = await auth.api.getSession({ headers: new Headers({ cookie: cookieA }) });
    if (!sessionA) throw new Error("Expected fixture session");
    const origin = new URL(process.env.BETTER_AUTH_URL ?? "").origin;
    const signedOut = await authPost(new Request(`${origin}/api/auth/sign-out`, {
      method: "POST", headers: { host: new URL(origin).host, origin, cookie: cookieA },
    }));
    expect(signedOut.status).toBe(200);
    expect(await revoked.waitClose(4_000)).toBe(4401);
    expect(await db.session.findUnique({ where: { id: sessionA.session.id } })).toBeNull();
    expect(await refusedStatus(server.port, organizations[0], { cookie: cookieA, origin: adminOrigin(organizations[0]) })).toBe(403);
    expect(await db.chatMessage.count({ where: { organizationId: organizations[0] } })).toBe(1);
  } finally {
    await server.close();
  }
}, 20_000);

afterAll(async () => {
  const organizationId = { in: organizations };
  await db.session.deleteMany({ where: { user: { organizationId } } });
  await db.conversationReadCursor.deleteMany({ where: { organizationId } });
  await db.chatMessage.deleteMany({ where: { organizationId } });
  await db.conversation.deleteMany({ where: { organizationId } });
  await db.user.deleteMany({ where: { organizationId } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: adminHosts } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});
