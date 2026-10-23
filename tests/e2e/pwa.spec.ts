import { readFile, writeFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("admin service worker stores only static assets and leaves an unsaved form during update", async ({ page }) => {
  const response = await page.goto("/admin/");
  expect(response?.headers()["cache-control"]).toContain("no-store");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
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
