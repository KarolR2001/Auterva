import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { afterAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import WebSocket from "ws";
import { POST as authPost } from "../../src/app/api/auth/[...all]/route";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { startRealtimeServer } from "../../src/modules/chat/realtime";
import { resolveRealtimeTenant } from "../../src/modules/chat/resolve-tenant";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const auth = createAuth(db, true);
const organizations = [randomUUID(), randomUUID()];

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
  const wsHeaders = new Headers({ cookie: unprovenCookie, origin: process.env.BETTER_AUTH_URL ?? "", host: "127.0.0.1:3312" });
  expect(await resolveRealtimeTenant(db, auth, wsHeaders, new URL(process.env.BETTER_AUTH_URL ?? "").origin, "127.0.0.1:3312")).toBeNull();

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
  expect(await resolveRealtimeTenant(db, auth, wsHeaders, new URL(process.env.BETTER_AUTH_URL ?? "").origin, "127.0.0.1:3312")).toBeNull();
  expect((await db.session.findUnique({ where: { id: unprovenSession.session.id } }))?.mfaVerifiedAt).toBeNull();
  return cookies(response.headers);
}

function connect(port: number, organizationId: string, cookie: string, host?: string) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?organizationId=${organizationId}`, { headers: { cookie, origin: process.env.BETTER_AUTH_URL ?? "", ...(host ? { host } : {}) } });
  return socket;
}

async function nextMessage(socket: WebSocket) {
  const [raw] = await once(socket, "message");
  return JSON.parse(raw.toString()) as { type: string; message?: { id: string; body: string }; messages?: { id: string; body: string }[] };
}

test("persisted send is deduplicated after reconnect and isolated from another company", async () => {
  await db.organization.createMany({ data: organizations.map((id) => ({ id, slug: `ws-${id}` })) });
  const cookieA = await fixtureSession(organizations[0]);
  const cookieB = await fixtureSession(organizations[1]);
  const server = await startRealtimeServer(db, (headers, expectedHost) => resolveRealtimeTenant(db, auth, headers, new URL(process.env.BETTER_AUTH_URL ?? "").origin, expectedHost));
  try {
    const first = connect(server.port, organizations[0], cookieA);
    await once(first, "open");
    const id = randomUUID();
    const ack = nextMessage(first);
    first.send(JSON.stringify({ type: "send", clientMessageId: id, body: "Wiadomość fixture" }));
    const saved = await ack;
    expect(saved.type).toBe("sent");
    expect(saved.message?.body).toBe("Wiadomość fixture");
    first.close();
    await once(first, "close");

    const reconnected = connect(server.port, organizations[0], cookieA);
    await once(reconnected, "open");
    const history = nextMessage(reconnected);
    reconnected.send(JSON.stringify({ type: "resume" }));
    expect((await history).messages).toEqual([expect.objectContaining({ id: saved.message?.id, body: "Wiadomość fixture" })]);
    const duplicate = nextMessage(reconnected);
    reconnected.send(JSON.stringify({ type: "send", clientMessageId: id, body: "Wiadomość fixture" }));
    expect((await duplicate).message?.id).toBe(saved.message?.id);
    reconnected.close();
    await once(reconnected, "close");

    const b = connect(server.port, organizations[1], cookieB);
    await once(b, "open");
    const otherHistory = nextMessage(b);
    b.send(JSON.stringify({ type: "resume" }));
    expect((await otherHistory).messages).toEqual([]);
    b.close();
    await once(b, "close");

    const forbidden = connect(server.port, organizations[1], cookieA);
    await expect(once(forbidden, "open")).rejects.toThrow();
    const wrongHost = connect(server.port, organizations[0], cookieA, "wrong.example.test");
    await expect(once(wrongHost, "open")).rejects.toThrow();
    const idleB = connect(server.port, organizations[1], cookieB);
    await once(idleB, "open");
    const idleClosed = once(idleB, "close");
    await db.organization.update({ where: { id: organizations[1] }, data: { archivedAt: new Date() } });
    await idleClosed;
    const archived = connect(server.port, organizations[1], cookieB);
    await expect(once(archived, "open")).rejects.toThrow();
    await db.organization.update({ where: { id: organizations[1] }, data: { archivedAt: null } });
    const revoked = connect(server.port, organizations[0], cookieA);
    await once(revoked, "open");
    const sessionA = await auth.api.getSession({ headers: new Headers({ cookie: cookieA }) });
    if (!sessionA) throw new Error("Expected fixture session");
    const closed = once(revoked, "close");
    const origin = new URL(process.env.BETTER_AUTH_URL ?? "").origin;
    const signedOut = await authPost(new Request(`${origin}/api/auth/sign-out`, {
      method: "POST", headers: { host: new URL(origin).host, origin, cookie: cookieA },
    }));
    expect(signedOut.status).toBe(200);
    await closed;
    expect(await db.session.findUnique({ where: { id: sessionA.session.id } })).toBeNull();
    expect(await db.chatMessage.count({ where: { organizationId: organizations[0] } })).toBe(1);
  } finally {
    await server.close();
  }
}, 15_000);

afterAll(async () => {
  await db.session.deleteMany({ where: { user: { organizationId: { in: organizations } } } });
  await db.user.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.chatMessage.deleteMany({ where: { organizationId: { in: organizations } } });
  await db.organization.deleteMany({ where: { id: { in: organizations } } });
  await db.$disconnect();
});
