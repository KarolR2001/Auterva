import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "@playwright/test";
import { FIXTURE } from "../fixture-ids";
import { createPrismaClient } from "../../src/lib/prisma";
import { verifiedFixtureSession } from "../../tests/fixtures/verified-session";

/**
 * Lab measurement of the pages for #340 (NFR-PERF-003): LCP, CLS, total blocking time (the lab stand-in for INP), JS
 * transferred and requests per page, on the local fixture behind the trusted ingress (production build).
 * Usage: BETTER_AUTH_SECRET/DATABASE_URL from .env, then
 *   pnpm exec tsx scripts/perf/web-vitals-lab.ts <ingress-port> <output.json> [runs=3]
 * Mobile profile: 390x844, 4x CPU slowdown, 1.6 Mbit/s down, 150 ms RTT. Desktop: 1440x900, no throttling.
 * Fixture only: it reads nothing but the seeded fixture host names and creates one short-lived session of the fixture admin.
 */
const [portArg, outPath, runsArg] = process.argv.slice(2);
const port = Number(portArg);
if (!Number.isInteger(port) || !outPath) throw new Error("Usage: web-vitals-lab.ts <ingress-port> <output.json> [runs]");
const runs = Number(runsArg ?? "3");
const publicHost = "company-a.localhost";
const adminHost = "admin.company-a.localhost";
const pages: { name: string; host: string; path: string; area: "public" | "panel" }[] = [
  { name: "public home", host: publicHost, path: "/", area: "public" },
  { name: "public catalog", host: publicHost, path: "/pojazdy/", area: "public" },
  { name: "public vehicle", host: publicHost, path: "/pojazdy/bus-9/", area: "public" },
  { name: "public contact", host: publicHost, path: "/kontakt/", area: "public" },
  { name: "panel dashboard", host: adminHost, path: "/admin/", area: "panel" },
  { name: "panel fleet", host: adminHost, path: "/admin/pojazdy/", area: "panel" },
  { name: "panel calendar", host: adminHost, path: "/admin/kalendarz/", area: "panel" },
  { name: "panel chat", host: adminHost, path: "/admin/czat/", area: "panel" },
];
const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] : null;

const db = createPrismaClient(process.env.DATABASE_URL ?? "");
const session = await verifiedFixtureSession(db, FIXTURE.users[0]);
const browser = await chromium.launch({ args: [`--host-resolver-rules=MAP *.localhost 127.0.0.1`] });
const results: Record<string, Record<string, unknown>> = {};
try {
  for (const profile of ["mobile", "desktop"] as const) {
    for (const target of pages) {
      const samples: { lcp: number | null; cls: number; tbt: number; jsKb: number; jsRawKb: number; requests: number; status: number; lcpElement: string }[] = [];
      for (let run = 0; run < runs; run += 1) {
        const context = await browser.newContext(profile === "mobile"
          ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true } : { viewport: { width: 1440, height: 900 } });
        if (target.area === "panel") {
          const [name, value] = session.cookie.split(/=(.*)/s);
          await context.addCookies([{ name, value, domain: target.host, path: "/", httpOnly: true, sameSite: "Lax" }]);
        }
        const page = await context.newPage();
        if (profile === "mobile") {
          const cdp = await context.newCDPSession(page);
          await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
          await cdp.send("Network.enable");
          await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
        }
        await page.addInitScript(() => {
          const w = window as unknown as { __v: { lcp: number | null; cls: number; tbt: number; el: string } };
          w.__v = { lcp: null, cls: 0, tbt: 0, el: "" };
          new PerformanceObserver((list) => {
            const e = list.getEntries(); w.__v.lcp = e[e.length - 1].startTime;
            const node = (e[e.length - 1] as unknown as { element?: Element }).element;
            w.__v.el = node ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}` : "";
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver((list) => { for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) if (!e.hadRecentInput) w.__v.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
          new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.duration > 50) w.__v.tbt += e.duration - 50; }).observe({ type: "longtask", buffered: true });
        });
        let requests = 0;
        page.on("response", () => { requests += 1; });
        const response = await page.goto(`http://${target.host}:${port}${target.path}`, { waitUntil: "load", timeout: 60_000 });
        await page.waitForTimeout(2500);
        const v = await page.evaluate(() => {
          const scripts = performance.getEntriesByType("resource").filter((e) => /\.js(?:\?|$)/.test(e.name)) as PerformanceResourceTiming[];
          return { ...(window as unknown as { __v: { lcp: number | null; cls: number; tbt: number; el: string } }).__v,
            transfer: scripts.reduce((sum, e) => sum + e.transferSize, 0), raw: scripts.reduce((sum, e) => sum + e.decodedBodySize, 0) };
        });
        samples.push({ lcp: v.lcp, cls: v.cls, tbt: v.tbt, lcpElement: v.el, jsKb: Math.round(v.transfer / 1024), jsRawKb: Math.round(v.raw / 1024), requests, status: response?.status() ?? 0 });
        await context.close();
      }
      results[`${profile} / ${target.name}`] = {
        status: samples[0].status, runs: samples.length,
        lcpMs: median(samples.flatMap((s) => s.lcp === null ? [] : [Math.round(s.lcp)])),
        cls: median(samples.map((s) => Math.round(s.cls * 1000) / 1000)),
        tbtMs: median(samples.map((s) => Math.round(s.tbt))),
        jsTransferKb: median(samples.map((s) => s.jsKb)), jsRawKb: median(samples.map((s) => s.jsRawKb)), lcpElement: samples[0].lcpElement,
        requests: median(samples.map((s) => s.requests)),
      };
      process.stdout.write(`${profile} / ${target.name}: ${JSON.stringify(results[`${profile} / ${target.name}`])}\n`);
    }
  }
} finally {
  await browser.close();
  await session.dispose();
  await db.$disconnect();
}
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(results, null, 2));
