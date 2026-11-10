import { randomBytes } from "node:crypto";
import { beforeEach, expect, test } from "vitest";
import { runWithTrustedClientAddress } from "../../src/modules/ingress/client-address";
import { metrics, names } from "../../src/modules/observability/metrics";
import { VITALS_LIMIT, postVitals, resetVitalsBudget } from "../../src/modules/observability/web-vitals-http";

const address = () => `10.${randomBytes(3).join(".")}`;
const host = "vitals.example.test";
const post = (body: unknown, headers: Record<string, string> = {}, ip = address()) => runWithTrustedClientAddress(ip, () => postVitals(new Request(`https://${host}/api/vitals/`, {
  method: "POST", headers: { host, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) })));
const ok = { device: "mobile", metrics: [{ name: "LCP", value: 2100, route: "/pojazdy/[slug]" }, { name: "INP", value: 120, route: "/pojazdy/[slug]" },
  { name: "CLS", value: 0.03, route: "/pojazdy/[slug]" }] };

beforeEach(() => { resetVitalsBudget(); metrics.reset(); });

test("accepts a report: 204 no-store, aggregated into auterva_* metrics, nothing else kept", async () => {
  const response = await post(ok);
  expect(response.status).toBe(204);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.text()).toBe("");
  const text = metrics.render();
  expect(text).toContain('auterva_web_vital_lcp_seconds_count{device="mobile",route="/pojazdy/[slug]"} 1');
  expect(text).toContain('auterva_web_vital_inp_seconds_count{device="mobile",route="/pojazdy/[slug]"} 1');
  expect(text).toContain('auterva_web_vital_cls_count{device="mobile",route="/pojazdy/[slug]"} 1');
  expect(metrics.value(names.vitalsReports, { metric: "LCP", device: "mobile", rating: "good" })).toBe(1);
  // No label value other than the closed route/device/metric/rating alphabet reaches the registry.
  expect(text).not.toMatch(/\b(?:10\.\d+\.\d+\.\d+|vitals\.example\.test)\b/);
});

test.each([
  ["a URL with a token instead of a route pattern", { device: "mobile", metrics: [{ name: "LCP", value: 1, route: "/admin/zaproszenie/SECRET" }] }],
  ["an account identifier field", { device: "mobile", accountId: "u1", metrics: ok.metrics }],
  ["an unknown metric", { device: "mobile", metrics: [{ name: "TTFB", value: 1, route: "/" }] }],
  ["a negative value", { device: "mobile", metrics: [{ name: "CLS", value: -0.1, route: "/" }] }],
  ["not an object", "[1,2]"],
  ["not JSON", "{oops"],
])("refuses %s with 400 and records nothing", async (_label, body) => {
  const response = await post(body);
  expect(response.status).toBe(400);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(metrics.render()).not.toContain("auterva_web_vital_lcp");
  expect(metrics.value(names.vitalsReports, { metric: "none", device: "none", rating: "invalid" })).toBe(1);
});

test("refuses a body above the limit and a wrong content type", async () => {
  expect((await post(JSON.stringify({ ...ok, pad: "x".repeat(2000) }))).status).toBe(400);
  expect((await post(ok, { "content-type": "text/plain" })).status).toBe(400);
});

test("refuses a cross-site request", async () => {
  expect((await post(ok, { origin: "https://evil.example" })).status).toBe(403);
  expect((await post(ok, { "sec-fetch-site": "cross-site" })).status).toBe(403);
  expect((await post(ok, { origin: `https://${host}`, "sec-fetch-site": "same-origin" })).status).toBe(204);
  expect(metrics.render()).not.toContain("evil");
});

test("limits reports per address and then answers 429 with Retry-After", async () => {
  const ip = address();
  for (let index = 0; index < VITALS_LIMIT.limit; index += 1) expect((await post(ok, {}, ip)).status).toBe(204);
  const limited = await post(ok, {}, ip);
  expect(limited.status).toBe(429);
  expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(limited.headers.get("cache-control")).toBe("no-store");
  expect((await post(ok, {}, address())).status).toBe(204);
  expect(metrics.value(names.vitalsReports, { metric: "none", device: "none", rating: "rate_limited" })).toBe(1);
});
