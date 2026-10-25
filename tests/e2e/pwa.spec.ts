import { readFile, writeFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const company = randomUUID();
const email = `pwa-${randomUUID()}@example.test`;
const password = "Fixture password 9384!";

test.beforeAll(async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  await db.organization.create({ data: { id: company, slug: `pwa-${company}` } });
  await db.hostMapping.create({ data: { hostname: new URL(baseURL).hostname, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  const registered = await createAuth(db, true, baseURL).api.signUpEmail({ body: { name: "PWA fixture", email, password } });
  await db.user.update({ where: { id: registered.user.id }, data: { organizationId: company, role: "ADMIN_FIRMY", emailVerified: true } });
});

test.afterAll(async ({ baseURL }) => {
  const ipKey = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update("auth:ip:127.0.0.1").digest("hex");
  await db.rateLimitEvent.deleteMany({ where: { keyHash: ipKey } });
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) await db.verification.deleteMany({ where: { value: { contains: `"userId":"${user.id}"` } } });
  await db.user.deleteMany({ where: { email } });
  if (baseURL) await db.hostMapping.deleteMany({ where: { hostname: new URL(baseURL).hostname } });
  await db.organization.deleteMany({ where: { id: company } });
  await db.$disconnect();
});

test("admin service worker stores only static assets and leaves an unsaved form during update", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  expect((await page.request.post("/api/auth/sign-in/email/", { headers: { origin: baseURL }, data: { email, password } })).status()).toBe(200);
  const enrollment = await page.request.post("/api/auth/two-factor/enable/", { headers: { origin: baseURL }, data: { password, method: "totp" } });
  expect(enrollment.status()).toBe(200);
  const totp = OTPAuth.URI.parse((await enrollment.json() as { totpURI: string }).totpURI);
  if (!(totp instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
  expect((await page.request.post("/api/auth/two-factor/verify-totp/", { headers: { origin: baseURL }, data: { code: totp.generate(), trustDevice: false } })).status()).toBe(200);
  const response = await page.goto("/admin/");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe(new URL("/admin/", page.url()).href);
  await page.reload();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });

  await page.evaluate(() => {
    const input = document.createElement("input");
    input.setAttribute("aria-label", "Fixture draft");
    input.value = "unsaved fixture draft";
    document.body.append(input);
  });
  await page.evaluate(async () => {
    await fetch("/admin/", { cache: "no-store" });
    await fetch("/api/health/", { cache: "no-store" });
  });
  const entries = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      urls.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
    }
    return urls;
  });
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((path) => path.startsWith("/_next/static/"))).toBe(true);

  const file = new URL("../../public/sw.js", import.meta.url);
  const original = await readFile(file);
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from("\n// update fixture\n")]));
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/admin/");
      if (!registration) throw new Error("Admin worker was not registered");
      await registration.update();
    });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration("/admin/"))?.waiting))).toBe(true);
    await expect(page.getByRole("textbox", { name: "Fixture draft" })).toHaveValue("unsaved fixture draft");
  } finally {
    await writeFile(file, original);
  }
});
