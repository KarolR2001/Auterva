import { createHmac, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

function fromIpv6(port: number, host: string, email: string) {
  const data = JSON.stringify({ email, password: "Wrong fixture password 9384!" });
  return new Promise<number>((resolve, reject) => {
    const request = httpRequest({ hostname: "::1", port, localAddress: "::1", path: "/api/auth/sign-in/email/", method: "POST", headers: {
      Host: host, Origin: `http://${host}`, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data),
      "X-Forwarded-For": "203.0.113.51", "CF-Connecting-IP": "203.0.113.52",
    } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode ?? 0));
    });
    request.on("error", reject);
    request.end(data);
  });
}

function onHost(port: number, host: string, path: string, options: { method?: string; cookie?: string; origin?: string; body?: unknown } = {}) {
  const data = options.body === undefined ? null : JSON.stringify(options.body);
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET", headers: {
      Host: host, ...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(options.origin ? { Origin: options.origin } : {}),
      ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}),
    } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end(data ?? undefined);
  });
}

async function clearLocalIpEvents(db: ReturnType<typeof createPrismaClient>) {
  const secret = process.env.BETTER_AUTH_SECRET ?? "";
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: ["127.0.0.1", "::1"].map((address) =>
    createHmac("sha256", secret).update(`auth:ip:${address}`).digest("hex")) } } });
}

test("built auth uses socket ingress for MFA; spoofed headers cannot merge two client counters", async ({ request, baseURL }) => {
  test.setTimeout(90_000);
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  await clearLocalIpEvents(db);
  const fixtureAuth = createAuth(db, true, baseURL);
  const company = randomUUID();
  const hostname = new URL(baseURL).hostname;
  const host = new URL(baseURL).host;
  const email = `trusted-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  await db.organization.create({ data: { id: company, slug: `trusted-${company}` } });
  await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  try {
    const registered = await fixtureAuth.api.signUpEmail({ body: { name: "Fixture", email, password } });
    await db.user.update({ where: { id: registered.user.id }, data: { organizationId: company, role: "ADMIN_FIRMY", emailVerified: true } });

    expect((await request.get("/admin/")).status()).toBe(404);

    const first = await request.post("/api/auth/sign-in/email/", { headers: { origin: baseURL, "x-forwarded-for": "203.0.113.61" }, data: { email, password } });
    expect(first.status()).toBe(200);
    expect((await request.get("/admin/")).status()).toBe(404);
    const enrollment = await request.post("/api/auth/two-factor/enable/", { headers: { origin: baseURL }, data: { password, method: "totp" } });
    expect(enrollment.status()).toBe(200);
    const setup = await enrollment.json() as { totpURI: string };
    const totp = OTPAuth.URI.parse(setup.totpURI);
    if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
    const confirmed = await request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate(), trustDevice: false } });
    expect(confirmed.status()).toBe(200);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(200);
    expect((await request.get("/admin/")).status()).toBe(200);
    const sisterOrigin = await request.post("/api/auth/sign-out/", { headers: { origin: `http://sister.${hostname}` } });
    expect(sisterOrigin.status()).toBe(403);
    expect(sisterOrigin.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(200);

    const readKey = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
      .update(`api:read:${registered.user.id}:${company}`).digest("hex");
    await db.rateLimitEvent.deleteMany({ where: { keyHash: readKey } });
    for (let index = 0; index < 120; index++) {
      expect((await request.get("/api/auth/get-session/")).status()).toBe(200);
    }
    const limitedRead = await request.get("/api/auth/get-session/");
    expect(limitedRead.status()).toBe(429);
    expect(Number(limitedRead.headers()["retry-after"])).toBeGreaterThan(0);
    expect(limitedRead.headers()["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    const writeKey = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "")
      .update(`api:write:${registered.user.id}:${company}`).digest("hex");
    await db.rateLimitEvent.deleteMany({ where: { keyHash: writeKey } });
    for (let index = 0; index < 60; index++) {
      expect((await request.post("/api/auth/mfa/rotate-backup-codes/", { headers: { origin: baseURL }, data: { proof: "bad", password: "bad" } })).status()).toBe(401);
    }
    const limitedWrite = await request.post("/api/auth/mfa/rotate-backup-codes/", { headers: { origin: baseURL }, data: { proof: "bad", password: "bad" } });
    expect(limitedWrite.status()).toBe(429);
    expect(Number(limitedWrite.headers()["retry-after"])).toBeGreaterThan(0);

    const secret = process.env.BETTER_AUTH_SECRET ?? "";
    const hash = (address: string) => createHmac("sha256", secret).update(`auth:ip:${address}`).digest("hex");
    const [beforeV4, beforeV6] = await Promise.all([
      db.rateLimitEvent.count({ where: { keyHash: hash("127.0.0.1") } }),
      db.rateLimitEvent.count({ where: { keyHash: hash("::1") } }),
    ]);
    const wrongA = `wrong-v4-${randomUUID()}@example.test`;
    const wrongB = `wrong-v6-${randomUUID()}@example.test`;
    expect((await request.post("/api/auth/sign-in/email/", { headers: { origin: baseURL, "x-forwarded-for": "203.0.113.51" }, data: { email: wrongA, password } })).status()).toBe(401);
    expect(await fromIpv6(Number(new URL(baseURL).port), host, wrongB)).toBe(401);
    expect(await db.rateLimitEvent.count({ where: { keyHash: hash("127.0.0.1") } })).toBeGreaterThan(beforeV4);
    expect(await db.rateLimitEvent.count({ where: { keyHash: hash("::1") } })).toBeGreaterThan(beforeV6);
  } finally {
    await clearLocalIpEvents(db);
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: ["read", "write"].map((operation) =>
      createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update(`api:${operation}:${user.id}:${company}`).digest("hex")) } } });
    if (user) await db.verification.deleteMany({ where: { value: { contains: `"userId":"${user.id}"` } } });
    await db.user.deleteMany({ where: { email } });
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.organization.delete({ where: { id: company } });
    await db.$disconnect();
  }
});

test("platform root requires a verified superadmin session", async ({ request, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  await clearLocalIpEvents(db);
  const hostname = new URL(baseURL).hostname;
  const email = `platform-${randomUUID()}@example.test`;
  const password = "Fixture password 9384!";
  await db.hostMapping.create({ data: { hostname, area: "PLATFORM", status: "ACTIVE" } });
  try {
    const fixtureAuth = createAuth(db, true, baseURL);
    const registered = await fixtureAuth.api.signUpEmail({ body: { name: "Platform fixture", email, password } });
    await db.user.update({ where: { id: registered.user.id }, data: { role: "SUPERADMIN_AUTERVA", emailVerified: true } });
    expect((await request.get("/")).status()).toBe(404);
    expect((await request.post("/api/auth/sign-in/email/", { headers: { origin: baseURL }, data: { email, password } })).status()).toBe(200);
    const enrollment = await request.post("/api/auth/two-factor/enable/", { headers: { origin: baseURL }, data: { password, method: "totp" } });
    const totp = OTPAuth.URI.parse((await enrollment.json() as { totpURI: string }).totpURI);
    if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
    expect((await request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate() } })).status()).toBe(200);
    expect((await request.get("/api/auth/get-session/")).status()).toBe(200);
    expect((await request.get("/")).status()).toBe(200);
  } finally {
    await clearLocalIpEvents(db);
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (user) await db.verification.deleteMany({ where: { value: { contains: `"userId":"${user.id}"` } } });
    await db.user.deleteMany({ where: { email } });
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.$disconnect();
  }
});

test("one built ingress isolates two real company hosts, platform and public host", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const fixtureAuth = createAuth(db, true, baseURL);
  const port = Number(new URL(baseURL).port);
  const suffix = randomUUID();
  const hosts = {
    a: `admin-a-${suffix}.example.test`, b: `admin-b-${suffix}.example.test`,
    platform: `platform-${suffix}.example.test`, public: `public-${suffix}.example.test`,
  };
  const companies = [randomUUID(), randomUUID()];
  const emails = ["a", "b", "platform"].map((part) => `${part}-${suffix}@example.test`);
  const password = "Fixture password 9384!";
  await db.organization.createMany({ data: companies.map((id) => ({ id, slug: `host-${id}` })) });
  await db.hostMapping.createMany({ data: [
    { hostname: hosts.a, area: "COMPANY_ADMIN", organizationId: companies[0], status: "ACTIVE" },
    { hostname: hosts.b, area: "COMPANY_ADMIN", organizationId: companies[1], status: "ACTIVE" },
    { hostname: hosts.platform, area: "PLATFORM", status: "ACTIVE" },
    { hostname: hosts.public, area: "COMPANY_PUBLIC", organizationId: companies[0], status: "ACTIVE" },
  ] });
  try {
    const cookies: string[] = [];
    for (let index = 0; index < emails.length; index++) {
      const registered = await fixtureAuth.api.signUpEmail({ body: { name: "Host fixture", email: emails[index], password }, returnHeaders: true });
      const cookie = registered.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).join("; ");
      cookies.push(cookie);
      await db.user.update({ where: { id: registered.response.user.id }, data: {
        role: index === 2 ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY",
        organizationId: index === 2 ? null : companies[index], emailVerified: true,
      } });
    }
    for (const [host, email] of [[hosts.a, emails[0]], [hosts.b, emails[1]], [hosts.platform, emails[2]]] as const) {
      expect(await onHost(port, host, "/api/auth/sign-in/email/", {
        method: "POST", origin: `http://${host}`, body: { email, password },
      })).toMatchObject({ status: 200 });
    }
    expect((await onHost(port, hosts.public, "/api/auth/sign-in/email/", {
      method: "POST", origin: `http://${hosts.public}`, body: { email: emails[0], password },
    })).status).toBe(404);
    const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true, email: true } });
    for (const user of users) {
      await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
      await db.session.updateMany({ where: { userId: user.id }, data: { mfaVerifiedAt: new Date() } });
    }
    expect((await onHost(port, hosts.a, "/admin/", { cookie: cookies[0] })).status).toBe(200);
    expect((await onHost(port, `${hosts.a}.`, "/admin/", { cookie: cookies[0] })).status).toBe(200);
    expect((await onHost(port, hosts.b, "/admin/", { cookie: cookies[1] })).status).toBe(200);
    expect((await onHost(port, hosts.b, "/admin/", { cookie: cookies[0] })).status).toBe(404);
    expect((await onHost(port, hosts.public, "/admin/", { cookie: cookies[0] })).status).toBe(404);
    expect((await onHost(port, hosts.platform, "/", { cookie: cookies[2] })).status).toBe(200);
    expect((await onHost(port, hosts.platform, "/", { cookie: cookies[0] })).status).toBe(404);
    expect((await onHost(port, hosts.a, "/api/auth/get-session/", { cookie: cookies[1] })).status).toBe(401);
  } finally {
    await db.user.deleteMany({ where: { email: { in: emails } } });
    await db.hostMapping.deleteMany({ where: { hostname: { in: Object.values(hosts) } } });
    await db.organization.deleteMany({ where: { id: { in: companies } } });
    await db.$disconnect();
  }
});
