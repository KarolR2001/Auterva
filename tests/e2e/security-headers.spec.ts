import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { expect, test } from "@playwright/test";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../fixtures/verified-session";

type Reply = { status: number; headers: IncomingHttpHeaders; text: string };

function send(port: number, host: string, path: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: options.method ?? "GET",
      headers: { Host: host, ...options.headers } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: raw }));
    });
    request.on("error", reject);
    request.end(options.body);
  });
}

const header = (reply: Reply, name: string) => String(reply.headers[name] ?? "");

function expectHardened(reply: Reply) {
  expect(header(reply, "x-content-type-options")).toBe("nosniff");
  expect(header(reply, "referrer-policy")).toBe("no-referrer");
  expect(header(reply, "x-frame-options")).toBe("DENY");
  expect(header(reply, "cross-origin-opener-policy")).toBe("same-origin");
  expect(header(reply, "permissions-policy")).toContain("camera=()");
  // The production build is what this project runs; browsers ignore HSTS over this plain-HTTP loopback.
  expect(header(reply, "strict-transport-security")).toBe("max-age=31536000");
}

test("built ingress: security headers, nonce CSP, CSRF from a sibling host and bounded bodies (#57)", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = Number(new URL(baseURL).port);
  const organizationId = randomUUID();
  const userId = randomUUID();
  const host = { marketing: `sec-e2e-marketing-${organizationId}.example.test`, admin: `sec-e2e-admin-${organizationId}.example.test`,
    publicSite: `sec-e2e-public-${organizationId}.example.test`, platform: `sec-e2e-platform-${organizationId}.example.test` };
  const origin = (name: keyof typeof host) => `http://${host[name]}:${port}`;
  const authority = (name: keyof typeof host) => `${host[name]}:${port}`;
  let session: Awaited<ReturnType<typeof verifiedFixtureSession>> | undefined;
  try {
    await db.organization.create({ data: { id: organizationId, slug: `sec-e2e-${organizationId}` } });
    await db.user.create({ data: { id: userId, name: "Security E2E admin", role: "ADMIN_FIRMY", organizationId,
      email: `sec-e2e-${userId}@example.test`, emailVerified: true, twoFactorEnabled: true } });
    await db.hostMapping.createMany({ data: [
      { hostname: host.marketing, area: "MARKETING", status: "ACTIVE" },
      { hostname: host.admin, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" },
      { hostname: host.publicSite, area: "COMPANY_PUBLIC", organizationId, status: "ACTIVE" },
      { hostname: host.platform, area: "PLATFORM", status: "ACTIVE" },
    ] });
    session = await verifiedFixtureSession(db, userId);
    const cookie = { cookie: session.cookie };

    // HTML document: per-request nonce, no inline script allowance, same-host socket only, no framing.
    const first = await send(port, authority("marketing"), "/");
    const second = await send(port, authority("marketing"), "/");
    expect(first.status).toBe(200);
    expectHardened(first);
    const csp = header(first, "content-security-policy");
    const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain(`connect-src 'self' wss://${authority("marketing")}`);
    expect(header(second, "content-security-policy")).not.toContain(`'nonce-${nonce}'`);
    // Every script of the document carries the nonce of this very response; none is inline without it.
    for (const tag of first.text.match(/<script\b[^>]*>/g) ?? []) expect(tag).toContain(`nonce="${nonce}"`);

    // Data endpoints load nothing; error and unknown-host answers stay hardened too.
    const api = await send(port, authority("publicSite"), "/api/public/offer/");
    expectHardened(api);
    expect(header(api, "content-security-policy")).toBe("default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    expectHardened(await send(port, `unknown-${organizationId}.example.test:${port}`, "/"));
    expectHardened(await send(port, authority("admin"), "/api/admin/vehicles/"));
    // The invitation page must not leak its token through the referrer.
    expect(header(await send(port, authority("admin"), `/api/auth/invitation/${"A".repeat(43)}/`), "referrer-policy")).toBe("no-referrer");

    // TEST-MVP-02/09: nothing private for an anonymous visitor, and no admin surface on a public host.
    for (const [name, path] of [["admin", "/admin/"], ["admin", "/api/admin/vehicles/"], ["platform", "/"],
      ["platform", "/api/platform/companies/"], ["publicSite", "/admin/"], ["publicSite", "/api/admin/vehicles/"],
      ["publicSite", "/api/platform/companies/"], ["marketing", "/api/admin/vehicles/"]] as const) {
      const denied = await send(port, authority(name), path);
      expect([401, 403, 404], `${name} ${path}`).toContain(denied.status);
      expect(denied.text, `${name} ${path}`).not.toMatch(/Panel Auterva|Platforma Auterva|\bvehicles\b|\"items\"/);
      expect(header(denied, "cache-control"), `${name} ${path}`).toMatch(/no-store|private/);
    }

    // TEST-MVP-34: a mutation from a sibling subdomain of the same registrable domain is refused by Origin,
    // with a perfectly valid admin session; SameSite is not the only control.
    const create = JSON.stringify({ fields: { name: "CSRF probe" } });
    for (const forged of [origin("publicSite"), origin("platform"), origin("marketing"), `http://evil.${host.admin.split(".").slice(1).join(".")}:${port}`,
      "null", `http://${host.admin}.evil.test:${port}`]) {
      const refused = await send(port, authority("admin"), "/api/admin/vehicles/", { method: "POST",
        headers: { ...cookie, origin: forged, "content-type": "application/json" }, body: create });
      expect(refused.status, forged).toBe(403);
    }
    expect(await db.vehicle.count({ where: { organizationId } })).toBe(0);
    const missingOrigin = await send(port, authority("admin"), "/api/admin/vehicles/", { method: "POST",
      headers: { ...cookie, "content-type": "application/json" }, body: create });
    expect(missingOrigin.status).toBe(403);

    // Bounded bodies: a 100 KB JSON is refused before any write, authenticated or not.
    const huge = JSON.stringify({ fields: { name: "x", description: "y".repeat(100_000) } });
    const tooLarge = await send(port, authority("admin"), "/api/admin/vehicles/", { method: "POST",
      headers: { ...cookie, origin: origin("admin"), "content-type": "application/json" }, body: huge });
    expect(tooLarge.status).toBe(400);
    expect(await db.vehicle.count({ where: { organizationId } })).toBe(0);
    const authBody = JSON.stringify({ email: "x@example.test", password: "z".repeat(40_000) });
    const authLarge = await send(port, authority("admin"), "/api/auth/sign-in/email/", { method: "POST",
      headers: { origin: origin("admin"), "content-type": "application/json" }, body: authBody });
    expect(authLarge.status).toBe(413);
  } finally {
    if (session) await session.dispose();
    await db.vehicle.deleteMany({ where: { organizationId } });
    await db.auditLog.deleteMany({ where: { organizationId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.hostMapping.deleteMany({ where: { OR: [{ organizationId }, { hostname: host.marketing }, { hostname: host.platform }] } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
});

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

// "Sekret w kliencie": nothing the browser can download carries a server secret or a server-only variable name.
test("the built client bundle and the service worker contain no server secret (#57)", () => {
  const secretsFile = ".local/fixture-9/secrets.env";
  const fromFile = existsSync(secretsFile) ? readFileSync(secretsFile, "utf8").trim().split("\n").map((line) => line.slice(line.indexOf("=") + 1)) : [];
  const values = [process.env.BETTER_AUTH_SECRET, process.env.MAIL_PAYLOAD_KEY, process.env.DATABASE_URL, ...fromFile]
    .filter((value): value is string => !!value && value.length >= 12);
  expect(values.length).toBeGreaterThan(2);
  const names = ["BETTER_AUTH_SECRET", "MAIL_PAYLOAD_KEY", "DATABASE_URL", "S3_SECRET", "SECRET_ACCESS_KEY", "RESEND_API_KEY", "BOOTSTRAP_TEST_DATABASE_URL"];
  const roots = [".next/static", "public"].filter((root) => existsSync(root));
  const files = roots.flatMap((root) => filesUnder(root)).filter((file) => /\.(js|css|html|json|map|txt|webmanifest)$/.test(file));
  expect(files.length).toBeGreaterThan(5);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const value of values) expect(text.includes(value), `secret value in ${file}`).toBe(false);
    for (const name of names) expect(text.includes(name), `${name} in ${file}`).toBe(false);
  }
  // Only NEXT_PUBLIC_ variables may be inlined; none exists today.
  const inlined = new Set(files.flatMap((file) => readFileSync(file, "utf8").match(/NEXT_PUBLIC_[A-Z0-9_]+/g) ?? []));
  expect([...inlined]).toEqual([]);
});

// TEST-MVP-32 in a real browser: the page runs its own nonce-tagged scripts, and injected script does not run.
test("a real browser runs only nonce-tagged scripts and reports no CSP violation for the page itself (#57)", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const hostname = `sec-e2e-browser-${randomUUID()}.localhost`;
  try {
    await db.hostMapping.create({ data: { hostname, area: "MARKETING", status: "ACTIVE" } });
    const violations: string[] = [];
    await page.addInitScript(() => {
      (window as unknown as { __violations: string[] }).__violations = [];
      document.addEventListener("securitypolicyviolation", (event) =>
        (window as unknown as { __violations: string[] }).__violations.push(`${event.violatedDirective} ${event.blockedURI}`));
    });
    page.on("console", (message) => { if (/content security policy/i.test(message.text())) violations.push(message.text()); });
    const response = await page.goto(`http://${hostname}:${port}/`);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.querySelectorAll("script[nonce]").length)).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations)).toEqual([]);
    // Injected markup carrying an inline handler does not run it (no unsafe-inline). CDP evaluation itself is exempt
    // from CSP, so eval is covered by the policy text in the header test, not here.
    await page.evaluate(() => {
      document.body.insertAdjacentHTML("beforeend", "<img src=x onerror=\"window.__xss = 'handler'\">");
    });
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss)).toBeUndefined();
    const reported = await page.evaluate(() => (window as unknown as { __violations: string[] }).__violations);
    expect(reported.some((entry) => entry.startsWith("script-src"))).toBe(true);
  } finally {
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.$disconnect();
  }
});

// Session cookies: HttpOnly, SameSite, host-only. `Secure` follows the https base URL, so it is checked on staging (#90).
test("auth cookies are HttpOnly, SameSite and host-only, and the response is never cacheable (#57)", async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = Number(new URL(baseURL).port);
  const organizationId = randomUUID();
  const hostname = `sec-e2e-cookie-${organizationId}.example.test`;
  const email = `sec-cookie-${organizationId}@example.test`;
  const password = "Fixture password 9384!";
  try {
    await db.organization.create({ data: { id: organizationId, slug: `sec-cookie-${organizationId}`, firstAdminRegisteredAt: new Date() } });
    await db.hostMapping.create({ data: { hostname, area: "COMPANY_ADMIN", organizationId, status: "ACTIVE" } });
    const registered = await createAuth(db, true, baseURL).api.signUpEmail({ body: { name: "Cookie probe", email, password } });
    await db.user.update({ where: { id: registered.user.id }, data: { role: "ADMIN_FIRMY", organizationId, emailVerified: true } });
    const reply = await send(port, `${hostname}:${port}`, "/api/auth/sign-in/email/", { method: "POST",
      headers: { origin: `http://${hostname}:${port}`, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    expect(reply.status).toBe(200);
    expect(header(reply, "cache-control")).toBe("no-store");
    const cookies = ([] as string[]).concat(reply.headers["set-cookie"] ?? []);
    expect(cookies.length).toBeGreaterThan(0);
    for (const cookie of cookies) {
      expect(cookie, cookie.split("=")[0]).toMatch(/HttpOnly/i);
      expect(cookie, cookie.split("=")[0]).toMatch(/SameSite=(Lax|Strict)/i);
      expect(cookie, cookie.split("=")[0]).not.toMatch(/Domain=/i);
    }
    expect(reply.text).not.toMatch(/"token"/);
  } finally {
    await db.session.deleteMany({ where: { user: { email } } });
    await db.account.deleteMany({ where: { user: { email } } });
    await db.auditLog.deleteMany({ where: { organizationId } }).catch(() => {});
    await db.user.deleteMany({ where: { email } });
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.organization.deleteMany({ where: { id: organizationId } });
    await db.$disconnect();
  }
});
