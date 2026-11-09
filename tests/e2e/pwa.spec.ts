import { readFile, writeFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const company = randomUUID();
const email = `pwa-${randomUUID()}@example.test`;
const password = "Fixture password 9384!";
const foreign = { platform: `pwa-platform-${randomUUID()}.test`, publicSite: `pwa-public-${randomUUID()}.test` };
let totp: OTPAuth.TOTP | undefined;

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, origin: string) {
  const headers = { origin };
  if (!totp) {
    expect((await page.request.post("/api/auth/sign-in/email/", { headers, data: { email, password } })).status()).toBe(200);
    const enrollment = await page.request.post("/api/auth/two-factor/enable/", { headers, data: { password, method: "totp" } });
    expect(enrollment.status()).toBe(200);
    const parsed = OTPAuth.URI.parse((await enrollment.json() as { totpURI: string }).totpURI);
    if (!(parsed instanceof OTPAuth.TOTP)) throw new Error("Expected TOTP URI");
    totp = parsed;
  } else {
    expect((await page.request.post("/api/auth/sign-in/email/", { headers, data: { email, password } })).status()).toBe(200);
  }
  expect((await page.request.post("/api/auth/two-factor/verify-totp/", { headers, data: { code: totp.generate(), trustDevice: false } })).status()).toBe(200);
}

async function controlledAdminPage(page: Page) {
  await page.goto("/admin/");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test.beforeAll(async ({ baseURL }) => {
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  await db.organization.create({ data: { id: company, slug: `pwa-${company}` } });
  await db.hostMapping.create({ data: { hostname: new URL(baseURL).hostname, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  await db.hostMapping.createMany({ data: [
    { hostname: foreign.platform, area: "PLATFORM", status: "ACTIVE" },
    { hostname: foreign.publicSite, area: "COMPANY_PUBLIC", organizationId: company, status: "ACTIVE" },
  ] });
  const registered = await createAuth(db, true, baseURL).api.signUpEmail({ body: { name: "PWA fixture", email, password } });
  await db.user.update({ where: { id: registered.user.id }, data: { organizationId: company, role: "ADMIN_FIRMY", emailVerified: true } });
});

test.afterAll(async ({ baseURL }) => {
  const ipKey = createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "").update("auth:ip:127.0.0.1").digest("hex");
  await db.rateLimitEvent.deleteMany({ where: { keyHash: ipKey } });
  const user = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (user) await db.verification.deleteMany({ where: { value: { contains: `"userId":"${user.id}"` } } });
  await db.auditLog.deleteMany({ where: { organizationId: company } });
  await db.user.deleteMany({ where: { email } });
  if (baseURL) await db.hostMapping.deleteMany({ where: { hostname: { in: [new URL(baseURL).hostname, foreign.platform, foreign.publicSite] } } });
  await db.organization.deleteMany({ where: { id: company } });
  await db.$disconnect();
});

test("admin service worker stores only static assets and leaves an unsaved form during update", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  await signIn(page, baseURL);
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
  expect(entries.every((path) => path.startsWith("/_next/static/") || ["/admin/offline.html", "/admin/offline.css"].includes(path))).toBe(true);

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

test("only the company host serves the worker, manifest, icons and offline screen", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  const port = new URL(baseURL).port;
  const paths = ["/sw.js", "/admin/manifest.webmanifest", "/admin/offline.html", "/admin/icon-192.png"];
  for (const path of paths) expect((await page.request.get(path)).status(), `company host ${path}`).toBe(200);
  const manifest = await (await page.request.get("/admin/manifest.webmanifest")).json() as { start_url: string; scope: string; icons: { src: string }[] };
  expect([manifest.start_url, manifest.scope]).toEqual(["/admin/", "/admin/"]);
  for (const icon of manifest.icons) expect((await page.request.get(icon.src)).status(), icon.src).toBe(200);
  for (const host of [foreign.platform, foreign.publicSite]) {
    for (const path of paths) {
      const response = await page.request.get(`${baseURL}${path}`, { headers: { host: `${host}:${port}` } });
      expect(response.status(), `${host} ${path}`).toBe(404);
    }
    const root = await page.request.get(`${baseURL}/`, { headers: { host: `${host}:${port}` } });
    expect(await root.text()).not.toContain("manifest.webmanifest");
  }
});

test("offline shows a neutral screen, never replays a mutation and keeps private responses out of CacheStorage", async ({ page, context, baseURL }) => {
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  await signIn(page, baseURL);
  await controlledAdminPage(page);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  const mutations: string[] = [];
  page.on("request", (request) => { if (request.method() !== "GET") mutations.push(`${request.method()} ${new URL(request.url()).pathname}`); });
  await context.setOffline(true);
  await expect(page.getByText("Offline", { exact: true })).toBeVisible();
  const failed = await page.evaluate(async () => {
    try { await fetch("/api/admin/vehicles/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); return false; } catch { return true; }
  });
  expect(failed).toBe(true);
  await page.goto("/admin/usluga/");
  await expect(page.getByRole("heading", { name: "Brak połączenia" })).toBeVisible();
  await expect(page.getByText("nie zostaną wysłane automatycznie")).toBeVisible();
  await expect(page.getByRole("link", { name: "Spróbuj ponownie" })).toHaveAttribute("href", "/admin/");
  await expect(page.getByText(email)).toHaveCount(0);
  await context.setOffline(false);
  await page.waitForTimeout(1500);
  expect(mutations.filter((entry) => !entry.startsWith("POST /api/admin/vehicles"))).toEqual([]);
  expect(mutations.filter((entry) => entry.startsWith("POST /api/admin/vehicles")).length).toBeLessThanOrEqual(1);
  await page.getByRole("link", { name: "Spróbuj ponownie" }).click();
  await expect(page).toHaveURL(/\/admin\/$/);
  await expect(page.getByText("Online", { exact: true })).toBeVisible();
  const names = await page.evaluate(() => caches.keys());
  expect(names.every((name) => name.includes("precache"))).toBe(true);
});

test("a waiting update asks before it reloads a dirty form and sign-out removes non-static caches", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  await signIn(page, baseURL);
  await controlledAdminPage(page);
  await page.evaluate(() => caches.open("runtime-private-probe").then((cache) => cache.put("/admin/private-probe", new Response("secret"))));
  const file = new URL("../../public/sw.js", import.meta.url);
  const original = await readFile(file);
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from("\n// update fixture 2\n")]));
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration("/admin/"))?.update(); });
    await expect(page.getByRole("button", { name: "Odśwież teraz" })).toBeVisible();
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration("/admin/"))?.waiting))).toBe(true);
    await page.waitForTimeout(500);
    await expect(page.getByRole("button", { name: "Odśwież teraz" })).toBeVisible();
  } finally {
    await writeFile(file, original);
  }
  await page.getByRole("button", { name: "Menu użytkownika" }).click();
  await page.getByRole("button", { name: "Wyloguj" }).click();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).some((name) => !name.includes("precache")))).toBe(false);
});
