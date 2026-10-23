import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, test } from "vitest";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { GET, POST } from "../../src/app/api/auth/[...all]/route";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const instance = createAuth(db, true);
const organizationId = randomUUID();
const hostname = `admin-${randomUUID()}.example.test`;
const publicHost = `public-${randomUUID()}.example.test`;
const platformHost = `platform-${randomUUID()}.example.test`;
const email = `http-${randomUUID()}@example.test`;
const password = "Fixture password 9384!";

beforeAll(async () => {
  await db.organization.create({ data: { id: organizationId, slug: `http-${organizationId}` } });
  await db.hostMapping.createMany({ data: [
    { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
    { hostname: publicHost, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" },
    { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" },
  ] });
  const registered = await instance.api.signUpEmail({ body: { name: "HTTP fixture", email, password } });
  await db.user.update({ where: { id: registered.user.id }, data: { role: "ADMIN_FIRMY", organizationId, emailVerified: true } });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email } });
  await db.hostMapping.deleteMany({ where: { hostname: { in: [hostname, publicHost, platformHost] } } });
  await db.organization.deleteMany({ where: { id: organizationId } });
  await db.$disconnect();
});

function request(host: string, path: string, body?: object, cookie?: string) {
  const origin = `https://${host}`;
  return new Request(`${origin}/api/auth/${path}`, {
    method: body ? "POST" : "GET",
    headers: { host, origin, ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

test("auth HTTP accepts only an active admin host and closes signup/public/other-host entries", async () => {
  const previous = process.env.AUTERVA_AUTH_PROBE;
  delete process.env.AUTERVA_AUTH_PROBE;
  try {
    expect((await POST(request(publicHost, "sign-in/email", { email, password }))).status).toBe(404);
    expect((await POST(request(hostname, "sign-up/email", { name: "X", email, password }))).status).toBe(404);
    expect((await POST(request(hostname, "two-factor/disable", { password }))).status).toBe(404);
    const wrong = request(hostname, "sign-in/email", { email, password });
    wrong.headers.set("host", publicHost);
    expect((await POST(wrong)).status).toBe(404);
    const login = await POST(request(hostname, "sign-in/email", { email, password }));
    expect(login.status).toBe(200);
    const cookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
    expect(cookie).toContain("session_token");
    const limited = await GET(request(hostname, "get-session", undefined, cookie));
    expect(limited.status).toBe(401);
  } finally {
    if (previous === undefined) delete process.env.AUTERVA_AUTH_PROBE;
    else process.env.AUTERVA_AUTH_PROBE = previous;
  }
});

test("a valid company password on the platform host leaves no issued session", async () => {
  const before = await db.session.count({ where: { user: { email } } });
  const response = await POST(request(platformHost, "sign-in/email", { email, password }));
  expect(response.status).toBe(401);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await db.session.count({ where: { user: { email } } })).toBe(before);
});

test("MFA enrollment session is limited to the user's own admin host", async () => {
  const login = await POST(request(hostname, "sign-in/email", { email, password }));
  expect(login.status).toBe(200);
  const cookie = login.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  const wrong = await POST(request(platformHost, "two-factor/enable", { password, method: "totp" }, cookie));
  expect(wrong.status).toBe(401);
  expect(await db.twoFactor.count({ where: { user: { email } } })).toBe(0);
  const own = await POST(request(hostname, "two-factor/enable", { password, method: "totp" }, cookie));
  expect(own.status).toBe(200);
  const enrollment = await own.json() as { totpURI: string; backupCodes?: string[] };
  expect(enrollment.backupCodes).toBeUndefined();
  const totp = OTPAuth.URI.parse(enrollment.totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Missing enrollment TOTP");
  const verified = await POST(request(hostname, "two-factor/verify-totp", { code: totp.generate(), trustDevice: false }, cookie));
  expect(verified.status).toBe(200);
  const result = await verified.json() as { backupCodes?: string[] };
  expect(result.backupCodes).toHaveLength(10);
  const fullCookie = verified.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request(hostname, "get-session", undefined, fullCookie))).status).toBe(200);

  const nextLogin = await POST(request(hostname, "sign-in/email", { email, password }));
  expect(nextLogin.status).toBe(200);
  expect((await nextLogin.json() as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(true);
  const challengeCookie = nextLogin.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect(challengeCookie).toContain("two_factor");
  expect((await POST(request(platformHost, "two-factor/verify-totp", { code: totp.generate() }, challengeCookie))).status).toBe(401);
  const completed = await POST(request(hostname, "two-factor/verify-totp", { code: totp.generate() }, challengeCookie));
  expect(completed.status).toBe(200);
  const completeCookie = completed.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; ");
  expect((await GET(request(hostname, "get-session", undefined, completeCookie))).status).toBe(200);
});
