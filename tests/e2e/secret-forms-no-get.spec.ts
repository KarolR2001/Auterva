import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";

// #440: Enter before hydration / without JS must never put a secret in a URL or a GET request.
test.use({ javaScriptEnabled: false, launchOptions: { args: ["--host-resolver-rules=MAP *.example.test 127.0.0.1"] } });

const SENTINEL = "Sekret-440-ZAWARTOSC";

async function submitWithEnter(page: Page, url: string, label: RegExp) {
  const seen: { method: string; url: string }[] = [];
  const posts: number[] = [];
  page.on("response", (response) => { if (response.request().method() === "POST") posts.push(response.status()); });
  page.on("request", (request) => seen.push({ method: request.method(), url: request.url() }));
  await page.goto(url);
  const fields = page.locator("main input:not([type=hidden]):not([type=checkbox]):not([type=radio])");
  expect(await fields.count()).toBeGreaterThan(0);
  for (const index of Array.from({ length: await fields.count() }, (_, i) => i)) await fields.nth(index).fill(SENTINEL);
  await expect(page.getByRole("button", { name: label }).first()).toBeVisible();
  await fields.last().press("Enter");
  await page.waitForLoadState("load");
  // Body POST re-renders the same page: no redirect, no session, no fake success.
  expect(posts).toEqual([200]);
  expect(new URL(page.url()).pathname).toBe(new URL(url).pathname);
  expect(await fields.count()).toBeGreaterThan(0);
  expect(page.url()).not.toContain(SENTINEL);
  expect(decodeURIComponent(page.url())).not.toContain(SENTINEL);
  const leaked = seen.filter((request) => decodeURIComponent(request.url).includes(SENTINEL));
  expect(leaked).toEqual([]);
  expect(seen.filter((request) => request.method === "GET" && /[?&](password|email|code|current|next)=/.test(request.url))).toEqual([]);
}

test("login and reset forms in both panels never send a secret via GET without JavaScript", async ({ page, baseURL }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const port = new URL(baseURL).port;
  const company = randomUUID();
  const adminHost = `secret-form-admin-${company}.example.test`;
  const platformHost = `secret-form-platform-${company}.example.test`;
  await db.organization.create({ data: { id: company, slug: `secret-form-${company}` } });
  await db.hostMapping.create({ data: { hostname: adminHost, area: "COMPANY_ADMIN", organizationId: company, status: "ACTIVE" } });
  await db.hostMapping.create({ data: { hostname: platformHost, area: "PLATFORM", status: "ACTIVE" } });
  try {
    const admin = `http://${adminHost}:${port}`;
    const platform = `http://${platformHost}:${port}`;
    for (const [url, label] of [
      [`${admin}/admin/login/`, /Zaloguj się/],
      [`${admin}/admin/reset-hasla/`, /./],
      [`${platform}/login/`, /Zaloguj się/],
      [`${platform}/reset-hasla/`, /./],
    ] as const) await submitWithEnter(page, url, label);
  } finally {
    await db.hostMapping.deleteMany({ where: { hostname: { in: [adminHost, platformHost] } } });
    await db.organization.delete({ where: { id: company } });
    await db.$disconnect();
  }
});
