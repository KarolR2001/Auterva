import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { expect, test } from "@playwright/test";
import { createPrismaClient } from "../../src/lib/prisma";

/** Raw request with an explicit Host header and no JavaScript, like a crawler. */
function fetchRaw(port: number, host: string, path: string) {
  return new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }>((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method: "GET", agent: false, headers: { Host: host, Connection: "close" } }, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { raw += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, headers: response.headers, text: raw }));
    });
    request.on("error", reject);
    request.end();
  });
}

test("MKT-01 onepage: server HTML, SEO, robots/sitemap, CSP and keyboard (#45)", async ({ baseURL, page }) => {
  if (!baseURL) throw new Error("Missing trusted ingress URL");
  const port = Number(new URL(baseURL).port);
  const db = createPrismaClient(process.env.DATABASE_URL ?? "");
  const id = randomUUID().slice(0, 8);
  const hostname = `mkt-e2e-${id}.localhost`;
  const authority = `${hostname}:${port}`;
  try {
    await db.hostMapping.create({ data: { hostname, area: "MARKETING", status: "ACTIVE" } });

    // Without JavaScript: content, one h1, canonical, description, indexable.
    const raw = await fetchRaw(port, authority, "/");
    expect(raw.status).toBe(200);
    expect(raw.text).toContain("<h1");
    expect(raw.text.match(/<h1[ >]/g)).toHaveLength(1);
    expect(raw.text).toContain("Flota online. Terminy pod kontrolą.");
    expect(raw.text).toContain("Kontakt jeszcze nieaktywny");
    expect(raw.text).toContain(`<link rel="canonical" href="http://${authority}/"`);
    expect(raw.text).toMatch(/<title>Auterva — strona i panel dla wypożyczalni pojazdów<\/title>/);
    expect(raw.text).toContain("Pokaż flotę i dostępne terminy na stronie swojej wypożyczalni.");
    expect(raw.text).not.toMatch(/noindex/i);
    // No placeholder contact wired, no purchase/registration flow.
    expect(raw.text).not.toMatch(/tel:|mailto:|wa\.me|000 000 000|example\.invalid/);
    expect(raw.text).not.toMatch(/<form|cennik|checkout|zarejestruj/i);

    const robots = await fetchRaw(port, authority, "/robots.txt");
    expect(robots.status).toBe(200);
    expect(robots.text).toContain(`Sitemap: http://${authority}/sitemap.xml`);
    const sitemap = await fetchRaw(port, authority, "/sitemap.xml");
    expect(sitemap.status).toBe(200);
    expect(sitemap.text).toContain(`<loc>http://${authority}/</loc>`);

    // Browser: no CSP violation or console error, anchors work, keyboard reaches every control.
    const problems: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
    page.on("pageerror", (error) => problems.push(String(error)));
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => { (window as unknown as { __csp: string[] }).__csp = [...((window as unknown as { __csp?: string[] }).__csp ?? []), event.violatedDirective]; });
    });
    for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 1024 }]) {
      await page.setViewportSize(size);
      await page.goto(`http://${authority}/`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Flota online. Terminy pod kontrolą.");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(page.getByRole("link", { name: "Zadzwoń do Autervy" }).first()).toHaveAttribute("href", "#kontakt");
      await expect(page.getByText("Przykładowy widok strony firmy")).toBeVisible();
      await expect(page.getByText("Przykładowy widok panelu", { exact: true })).toBeVisible();
    }

    await page.setViewportSize({ width: 1440, height: 1024 });
    await page.goto(`http://${authority}/`);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Przejdź do treści" })).toBeFocused();
    await page.keyboard.press("Enter");
    const nav = page.getByRole("navigation", { name: "Sekcje strony" });
    await nav.getByRole("link", { name: "Jak to działa" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#jak-to-dziala$/);
    await expect(page.getByRole("heading", { level: 2, name: /Od prezentacji do gotowej strony/ })).toBeInViewport();
    await nav.getByRole("link", { name: "Kontakt" }).focus();
    await expect(nav.getByRole("link", { name: "Kontakt" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { level: 2, name: /Porozmawiajmy/ })).toBeInViewport();

    const violations = await page.evaluate(() => (window as unknown as { __csp?: string[] }).__csp ?? []);
    expect(violations).toEqual([]);
    expect(problems).toEqual([]);

    // Images are served (static assets are reachable on the marketing host).
    const image = await page.locator("picture img").first().evaluate((node) => (node as HTMLImageElement).currentSrc);
    expect((await page.request.get(image)).status()).toBe(200);
  } finally {
    await db.hostMapping.deleteMany({ where: { hostname } });
    await db.$disconnect();
  }
});
