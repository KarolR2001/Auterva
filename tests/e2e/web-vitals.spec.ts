import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";

// #340: the page reports Web Vitals once, when it is hidden, as route patterns and three numbers; the real endpoint
// accepts it (204, no-store) and nothing in the payload identifies the visitor, the URL or the host.
test("a page sends one privacy-preserving Web Vitals report to its own endpoint", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const hostname = `vitals-e2e-${randomUUID().slice(0, 8)}.localhost`;
  try {
    await db.hostMapping.create({ data: { hostname, area: "MARKETING", status: "ACTIVE" } });
    // Playwright cannot read a Blob beacon body; with sendBeacon refused the reporter's keepalive fetch carries the same JSON.
    await page.addInitScript(() => { navigator.sendBeacon = () => false; });
    await page.goto(`http://${hostname}:${port}/?utm_source=secret-campaign&token=SECRETTOKEN#section`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.waitForTimeout(500);
    const requested = page.waitForRequest((request) => request.url().includes("/api/vitals/"));
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const request = await requested;
    expect(request.method()).toBe("POST");
    const payload = request.postDataJSON() as { device: string; metrics: { name: string; value: number; route: string }[] };
    expect(payload.device).toBe("desktop");
    expect(payload.metrics.length).toBeGreaterThan(0);
    for (const metric of payload.metrics) {
      expect(["LCP", "INP", "CLS"]).toContain(metric.name);
      expect(metric.route).toBe("/");
    }
    const text = JSON.stringify(payload);
    for (const secret of ["secret-campaign", "SECRETTOKEN", "section", hostname, "http", "?"]) expect(text).not.toContain(secret);
    const response = await request.response();
    expect(response?.status()).toBe(204);
    expect(response?.headers()["cache-control"]).toBe("no-store");
  } finally {
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.$disconnect();
  }
});
