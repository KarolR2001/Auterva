// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { ROUTE_PATTERNS, isRoutePattern, normalizeRoute, parseVitalPayload, rateVital } from "../../src/lib/web-vitals";
import { inpFrom, measurementAllowed, startVitals } from "../../src/components/vitals/web-vitals-reporter";
import { bodyLimitForPath } from "../../src/modules/tenancy/json-body";

test.each([
  ["/", "/"], ["/pojazdy/", "/pojazdy"], ["/pojazdy/bus-9-osobowy-123/", "/pojazdy/[slug]"], ["/kontakt", "/kontakt"],
  ["/admin/", "/admin"], ["/admin/pojazdy/4b1c7c64-0000-4000-8000-000000000001/kalendarz/", "/admin/pojazdy/[id]/kalendarz"],
  ["/admin/pojazdy/nowy", "/admin/pojazdy/nowy"], ["/admin/zaproszenie/SECRETTOKEN", "/admin/zaproszenie/[token]"],
  ["/admin/reset-hasla/SECRETTOKEN", "/admin/reset-hasla/[token]"], ["/reset-hasla/SECRETTOKEN", "/reset-hasla/[token]"],
  ["/firmy/nowa", "/firmy/nowa"], ["/firmy/org-1/pojazdy/nowy", "/firmy/[id]/pojazdy/nowy"],
  ["/firmy/org-1/pojazdy/veh-1/kalendarz", "/firmy/[id]/pojazdy/[id]/kalendarz"],
  ["/pojazdy/a/b", "other"], ["/nieznana", "other"], ["/admin/zaproszenie", "other"],
  ["/pojazdy?from=2026-12-01&token=x#a", "/pojazdy"], ["/pojazdy/bus?email=a@b.pl", "/pojazdy/[slug]"],
] as const)("route %s -> %s", (path, pattern) => {
  expect(normalizeRoute(path)).toBe(pattern);
});

test("normalised routes never contain a dynamic value and always belong to the closed list", () => {
  const secrets = ["jan.kowalski@example.com", "SECRETTOKEN-0123456789", "4b1c7c64-0000-4000-8000-000000000001", "moj-sekretny-slug"];
  for (const secret of secrets) {
    for (const prefix of ["/pojazdy/", "/admin/pojazdy/", "/firmy/", "/reset-hasla/", "/admin/zaproszenie/", "/admin/reset-hasla/", "/xyz/"]) {
      for (const suffix of ["", "/", "/kalendarz", "/pojazdy/" + secret]) {
        const route = normalizeRoute(`${prefix}${secret}${suffix}`);
        expect(route).not.toContain(secret);
        expect(isRoutePattern(route)).toBe(true);
      }
    }
  }
  expect(ROUTE_PATTERNS.every((pattern) => pattern.length <= 64)).toBe(true);
});

const valid = { device: "mobile", metrics: [{ name: "LCP", value: 1800, route: "/pojazdy/[slug]" }, { name: "CLS", value: 0.04, route: "/" }] };

test("accepts a well-formed payload", () => {
  expect(parseVitalPayload(valid)).toEqual(valid);
});

test.each([
  ["unknown top-level key (identifier)", { ...valid, accountId: "x" }],
  ["unknown item key (url)", { device: "mobile", metrics: [{ name: "LCP", value: 1, route: "/", url: "https://a/b?token=1" }] }],
  ["raw URL as route", { device: "mobile", metrics: [{ name: "LCP", value: 1, route: "/pojazdy/moj-slug" }] }],
  ["route with query", { device: "mobile", metrics: [{ name: "LCP", value: 1, route: "/pojazdy?token=1" }] }],
  ["unknown metric", { device: "mobile", metrics: [{ name: "FID", value: 1, route: "/" }] }],
  ["duplicate metric", { device: "mobile", metrics: [{ name: "LCP", value: 1, route: "/" }, { name: "LCP", value: 2, route: "/" }] }],
  ["negative value", { device: "mobile", metrics: [{ name: "LCP", value: -1, route: "/" }] }],
  ["huge value", { device: "mobile", metrics: [{ name: "CLS", value: 11, route: "/" }] }],
  ["string value", { device: "mobile", metrics: [{ name: "LCP", value: "12", route: "/" }] }],
  ["NaN-like value", { device: "mobile", metrics: [{ name: "LCP", value: Number.POSITIVE_INFINITY, route: "/" }] }],
  ["unknown device", { device: "tv", metrics: [{ name: "LCP", value: 1, route: "/" }] }],
  ["empty list", { device: "mobile", metrics: [] }],
  ["too many items", { device: "mobile", metrics: Array.from({ length: 4 }, () => ({ name: "LCP", value: 1, route: "/" })) }],
  ["array body", []], ["null", null], ["string", "x"],
])("refuses %s", (_label, body) => {
  expect(parseVitalPayload(body)).toBeNull();
});

test("ratings follow the web.dev thresholds", () => {
  expect(rateVital("LCP", 2500)).toBe("good");
  expect(rateVital("LCP", 2501)).toBe("needs-improvement");
  expect(rateVital("INP", 501)).toBe("poor");
  expect(rateVital("CLS", 0.1)).toBe("good");
  expect(rateVital("CLS", 0.3)).toBe("poor");
});

test("the endpoint body limit is tiny", () => {
  expect(bodyLimitForPath("/api/vitals/")).toBe(1024);
});

test("INP is the longest interaction, ignoring the worst per 50 interactions", () => {
  expect(inpFrom(new Map())).toBeNull();
  expect(inpFrom(new Map([[1, 80], [2, 240], [3, 120]]))).toBe(240);
  const many = new Map(Array.from({ length: 50 }, (_, i) => [i + 1, i === 0 ? 900 : 100] as const));
  expect(inpFrom(many)).toBe(100);
});

// --- reporter -------------------------------------------------------------------------------------------------

type Entry = Record<string, unknown>;
class FakeObserver {
  static byType = new Map<string, FakeObserver>();
  constructor(private callback: (list: { getEntries: () => Entry[] }) => void) {}
  observe(options: { type: string }) { FakeObserver.byType.set(options.type, this); }
  disconnect() {}
  emit(entries: Entry[]) { this.callback({ getEntries: () => entries }); }
}

afterEach(() => { Reflect.deleteProperty(navigator, "doNotTrack"); vi.unstubAllGlobals(); FakeObserver.byType.clear(); window.history.replaceState(null, "", "/"); });

function hide() {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
}

test("the reporter sends one payload with route patterns and no URL, query, token or identifier", () => {
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  window.history.replaceState(null, "", "/pojazdy/moj-sekretny-slug/?email=jan%40example.com&token=SECRETTOKEN#frag");
  const send = vi.fn();
  const stop = startVitals(send);
  FakeObserver.byType.get("largest-contentful-paint")!.emit([{ startTime: 900 }, { startTime: 1830.4 }]);
  FakeObserver.byType.get("layout-shift")!.emit([{ startTime: 100, value: 0.03, hadRecentInput: false }, { startTime: 200, value: 0.5, hadRecentInput: true },
    { startTime: 300, value: 0.02, hadRecentInput: false }]);
  FakeObserver.byType.get("event")!.emit([{ interactionId: 7, duration: 96 }, { interactionId: 0, duration: 400 }]);
  hide();
  hide();
  expect(send).toHaveBeenCalledTimes(1);
  const payload = send.mock.calls[0][0];
  expect(payload).toEqual({ device: "desktop", metrics: [
    { name: "LCP", value: 1830, route: "/pojazdy/[slug]" }, { name: "INP", value: 96, route: "/pojazdy/[slug]" }, { name: "CLS", value: 0.05, route: "/pojazdy/[slug]" }] });
  const text = JSON.stringify(payload);
  for (const secret of ["moj-sekretny-slug", "jan", "SECRETTOKEN", "frag", "http", "?"]) expect(text).not.toContain(secret);
  expect(parseVitalPayload(payload)).not.toBeNull();
  stop();
});

test("the reporter measures nothing when Do Not Track or Global Privacy Control is set", () => {
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  expect(measurementAllowed({ doNotTrack: "1" } as Navigator)).toBe(false);
  expect(measurementAllowed({ doNotTrack: null, globalPrivacyControl: true } as unknown as Navigator)).toBe(false);
  expect(measurementAllowed({ doNotTrack: "0" } as Navigator)).toBe(true);
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
  const send = vi.fn();
  startVitals(send);
  expect(FakeObserver.byType.size).toBe(0);
  hide();
  expect(send).not.toHaveBeenCalled();
});

test("nothing is sent for a page that never painted", () => {
  vi.stubGlobal("PerformanceObserver", FakeObserver);
  const send = vi.fn();
  startVitals(send);
  hide();
  expect(send).not.toHaveBeenCalled();
});
