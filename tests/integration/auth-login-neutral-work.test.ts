import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { createPrismaClient } from "../../src/lib/prisma";
import { getServerEnv } from "../../src/lib/env";
import { POST } from "../../src/app/api/auth/[...all]/route";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";

// Better Auth freezes NODE_ENV when its module loads; set this before imports
// so its real Origin and Fetch Metadata guards run in this test file.
const work = vi.hoisted(() => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTest = process.env.TEST;
  Reflect.set(process.env, "NODE_ENV", "development");
  process.env.TEST = "false";
  return { hashes: 0, verifies: 0,
    race: null as null | { userId: string; hash: string }, raceFired: false, raceHandlerStatus: 0,
    originalNodeEnv, originalTest };
});
vi.mock("better-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth")>();
  return { ...actual, betterAuth: (options: Parameters<typeof actual.betterAuth>[0]) => actual.betterAuth({
    ...options, emailAndPassword: { ...options.emailAndPassword,
      enabled: options.emailAndPassword?.enabled ?? true, password: {
      ...options.emailAndPassword?.password,
      hash: async (password: string) => { work.hashes++; return hashPassword(password); },
      verify: async (input: { hash: string; password: string }) => {
        work.verifies++; return verifyPassword(input);
      },
    } },
  }) };
});
vi.mock("better-auth/next-js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("better-auth/next-js")>();
  return { ...actual, toNextJsHandler: (instance: Parameters<typeof actual.toNextJsHandler>[0]) => {
    const handlers = actual.toNextJsHandler(instance);
    return { ...handlers, POST: async (request: Request) => {
      if (work.race && new URL(request.url).pathname === "/api/auth/sign-in/email") {
        const race = work.race;
        work.race = null;
        await db.account.create({ data: { id: randomUUID(), userId: race.userId,
          accountId: race.userId, providerId: "credential", password: race.hash } });
        work.raceFired = true;
      }
      const response = await handlers.POST(request);
      if (work.raceFired) work.raceHandlerStatus = response.status;
      return response;
    } };
  } };
});

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const a = randomUUID();
const b = randomUUID();
const userId = randomUUID();
const email = `login-work-${userId}@example.test`;
const missing = `missing-${userId}@example.test`;
const hostA = `login-work-a-${a}.example.test`;
const hostB = `login-work-b-${b}.example.test`;
const sourceIp = "10.233.14.52";

beforeAll(async () => {
  await db.organization.createMany({ data: [{ id: a, slug: `login-work-${a}` }, { id: b, slug: `login-work-${b}` }] });
  await db.hostMapping.createMany({ data: [
    { hostname: hostA, area: "COMPANY_ADMIN", organizationId: a, status: "ACTIVE" },
    { hostname: hostB, area: "COMPANY_ADMIN", organizationId: b, status: "ACTIVE" },
  ] });
  await db.user.create({ data: { id: userId, name: "Login work fixture", email,
    emailVerified: true, role: "ADMIN_FIRMY", organizationId: a, twoFactorEnabled: true } });
  await db.account.create({ data: { id: randomUUID(), userId, accountId: userId,
    providerId: "credential", password: await hashPassword("Correct fixture password 9384!") } });
  work.hashes = 0;
  work.verifies = 0;
});

afterAll(async () => {
  const secret = getServerEnv().BETTER_AUTH_SECRET;
  const keys = [`auth:account:${email}`, `auth:account:${missing}`, `auth:ip:${sourceIp}`]
    .map((key) => createHmac("sha256", secret).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostA, hostB] } } });
  await db.organization.deleteMany({ where: { id: { in: [a, b] } } });
  await db.$disconnect();
  if (work.originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", work.originalNodeEnv);
  if (work.originalTest === undefined) delete process.env.TEST;
  else process.env.TEST = work.originalTest;
});

function login(host: string, address: string, password: unknown = "Wrong fixture password 9384!") {
  return loginBody(host, { email: address, password });
}

function loginBody(host: string, body: Record<string, unknown>, options: {
  query?: string; contentType?: string; crossNavigation?: boolean;
} = {}) {
  return runWithTrustedClientAddress(sourceIp, () => POST(new Request(
    `https://${host}/api/auth/sign-in/email${options.query ?? ""}`, {
    method: "POST", headers: { host, origin: `https://${host}`,
      "content-type": options.contentType ?? "application/json",
      ...(options.crossNavigation ? { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" } : {}) },
    body: JSON.stringify(body),
  })));
}

async function clearFixtureAttempts() {
  const secret = getServerEnv().BETTER_AUTH_SECRET;
  const keys = [`auth:account:${email}`, `auth:account:${missing}`, `auth:ip:${sourceIp}`]
    .map((key) => createHmac("sha256", secret).update(key).digest("hex"));
  await db.rateLimitEvent.deleteMany({ where: { keyHash: { in: keys } } });
}

test("unknown and wrong-scope login perform Better Auth KDF work after limiter without a session", async () => {
  const known = await login(hostA, email);
  expect(known.status).toBe(401);
  expect(known.headers.getSetCookie()).toEqual([]);
  expect(work.verifies).toBeGreaterThan(0);
  work.hashes = 0;
  work.verifies = 0;
  const absent = await login(hostA, missing);
  expect(absent.status).toBe(401);
  expect(absent.headers.getSetCookie()).toEqual([]);
  expect(work.hashes).toBeGreaterThan(0);
  work.hashes = 0;
  work.verifies = 0;
  const wrongScope = await login(hostB, email);
  expect(wrongScope.status).toBe(401);
  expect(wrongScope.headers.getSetCookie()).toEqual([]);
  expect(work.verifies).toBeGreaterThan(0);
});

test("supported email/password input still reaches the MFA challenge", async () => {
  await clearFixtureAttempts();
  const response = await login(hostA, email, "Correct fixture password 9384!");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ twoFactorRedirect: true });
});

test("malformed passwords take the same fast rejection path for known and missing accounts", async () => {
  for (const malformed of [null, 42, "x".repeat(257)]) {
    work.hashes = 0;
    work.verifies = 0;
    expect((await login(hostA, email, malformed)).status).toBe(401);
    expect(work.hashes).toBe(0);
    expect(work.verifies).toBe(0);
    work.hashes = 0;
    work.verifies = 0;
    expect((await login(hostA, missing, malformed)).status).toBe(401);
    expect(work.hashes).toBe(0);
    expect(work.verifies).toBe(0);
  }
});

test("unsupported sign-in options reject before KDF for known, absent and wrong-scope accounts", async () => {
  for (const options of [
    { rememberMe: "false" },
    { rememberMe: true },
    { callbackURL: 42 },
    { callbackURL: `https://${hostA}/admin/` },
    { callbackURL: "https://foreign.example.test/admin/" },
  ]) {
    await clearFixtureAttempts();
    for (const [host, address] of [[hostA, email], [hostA, missing], [hostB, email]]) {
      work.hashes = 0;
      work.verifies = 0;
      const response = await loginBody(host, { email: address, password: "Wrong fixture password 9384!", ...options });
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(work.hashes).toBe(0);
      expect(work.verifies).toBe(0);
    }
  }
});

test("Better Auth transport and CSRF guards run for every account state in development", async () => {
  for (const options of [
    { query: "?callbackURL=https%3A%2F%2Fforeign.example.test" },
    { contentType: "text/plain" },
    { crossNavigation: true },
  ]) {
    await clearFixtureAttempts();
    for (const [host, address] of [[hostA, email], [hostA, missing], [hostB, email]]) {
      work.hashes = 0;
      work.verifies = 0;
      const response = await loginBody(host, { email: address, password: "Wrong fixture password 9384!" }, options);
      expect(response.status).toBe(401);
      expect(response.headers.getSetCookie()).toEqual([]);
      expect(work.hashes).toBe(0);
      expect(work.verifies).toBe(0);
    }
  }
});

test("a credential appearing after the lookup cannot commit a session without its row lock", async () => {
  const raceUserId = randomUUID();
  const raceEmail = `login-race-${raceUserId}@example.test`;
  const correct = "Race fixture password 9384!";
  await db.user.create({ data: { id: raceUserId, name: "Race fixture", email: raceEmail,
    emailVerified: true, twoFactorEnabled: true, role: "ADMIN_FIRMY", organizationId: b } });
  try {
    work.raceFired = false;
    work.raceHandlerStatus = 0;
    work.race = { userId: raceUserId, hash: await hashPassword(correct) };
    const response = await login(hostB, raceEmail, correct);
    expect(work.raceFired).toBe(true);
    expect(work.raceHandlerStatus).toBe(200);
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
    expect(await db.session.count({ where: { userId: raceUserId } })).toBe(0);
    expect(await db.verification.count({ where: { value: { contains: raceUserId } } })).toBe(0);
  } finally {
    work.race = null;
    await db.user.delete({ where: { id: raceUserId } });
  }
});
