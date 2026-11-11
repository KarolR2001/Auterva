import { readFile, writeFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import * as OTPAuth from "otpauth";
import { createAuth } from "../../src/lib/auth";
import { createPrismaClient } from "../../src/lib/prisma";

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const company = randomUUID();
const vehicleId = randomUUID();
const email = `bulkdirty-${randomUUID()}@example.test`;
const password = "Fixture password 9384!";
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
  await db.organization.create({ data: { id: company, slug: `bulkdirty-${company}` } });
  await db.hostMapping.create({ data: { hostname: new URL(baseURL).hostname, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  await db.vehicle.create({ data: { id: vehicleId, organizationId: company, slug: `bd-${vehicleId}`, name: "Auto Zbiorcze", status: "PUBLISHED", availableFrom: new Date("2020-01-01"), sortOrder: 1 } });
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
  if (baseURL) await db.hostMapping.deleteMany({ where: { hostname: { in: [new URL(baseURL).hostname] } } });
  await db.vehicle.deleteMany({ where: { organizationId: company } });
  await db.organization.deleteMany({ where: { id: company } });
  await db.$disconnect();
});

// #378: the bulk block view registers its draft with the panel shell, so a PWA update, navigation, breadcrumb, Back and tab close ask first.
test("a filled bulk block form survives a PWA update, a nav link, the breadcrumb, Back and tab close until the user confirms", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  if (!baseURL) throw new Error("Missing PWA fixture URL");
  await signIn(page, baseURL);
  await controlledAdminPage(page);
  await page.goto("/admin/kalendarz/");
  await page.getByRole("button", { name: "Blokada zbiorcza" }).click();
  await expect(page).toHaveURL(/zbiorcza=1/);
  await page.getByRole("checkbox", { name: /Auto Zbiorcze/ }).check();
  await page.getByLabel(/^Od/).fill("2031-05-10");
  await page.getByLabel(/^Numer odniesienia/).fill("SRV-378");
  const stays = async () => {
    await expect(page.getByRole("dialog", { name: "Niezapisane zmiany" })).toBeVisible();
    await page.getByRole("button", { name: "Zostań" }).click();
    await expect(page.getByRole("dialog", { name: "Niezapisane zmiany" })).toBeHidden();
    await expect(page).toHaveURL(/zbiorcza=1/);
    await expect(page.getByLabel(/^Numer odniesienia/)).toHaveValue("SRV-378");
    await expect(page.getByRole("checkbox", { name: /Auto Zbiorcze/ })).toBeChecked();
  };
  const file = new URL("../../public/sw.js", import.meta.url);
  const original = await readFile(file);
  try {
    await writeFile(file, Buffer.concat([original, Buffer.from("\n// update fixture 378\n")]));
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration("/admin/"))?.update(); });
    await page.getByRole("button", { name: "Odśwież teraz" }).click();
    await stays();
  } finally {
    await writeFile(file, original);
  }
  await page.getByRole("navigation", { name: "Nawigacja panelu" }).getByRole("link", { name: "Ustawienia" }).click();
  await stays();
  await page.getByRole("navigation", { name: "Ścieżka" }).getByRole("link", { name: "Kalendarz floty" }).click();
  await stays();
  await page.goBack();
  await stays();
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  // Discarding on Back leaves the view without the draft.
  await page.goBack();
  await page.getByRole("button", { name: "Odrzuć zmiany" }).click();
  await expect(page).not.toHaveURL(/zbiorcza=1/);
  await expect(page.getByRole("button", { name: "Blokada zbiorcza" })).toBeVisible();
});
