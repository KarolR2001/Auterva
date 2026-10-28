import { expect, test } from "vitest";
import { MetricsRegistry, parseExposition, sumSamples } from "../../src/modules/observability/metrics";

test("label values are normalised so a request cannot create unbounded or sensitive series", () => {
  const registry = new MetricsRegistry();
  registry.inc("x_total", "x", { route: "ok_route" });
  registry.inc("x_total", "x", { route: "user@example.test /?q=secret" });
  registry.inc("x_total", "x", { route: "another weird value" });
  expect(registry.value("x_total", { route: "ok_route" })).toBe(1);
  expect(registry.value("x_total", { route: "other" })).toBe(2);
  expect(registry.render()).not.toContain("secret");
});

test("series per metric are capped", () => {
  const registry = new MetricsRegistry();
  for (let i = 0; i < 500; i++) registry.inc("c_total", "c", { id: `v${i}` });
  expect(registry.samples().filter((s) => s.name === "c_total")).toHaveLength(200);
});

test("text exposition round-trips counters and gauges and keeps histograms valid", () => {
  const registry = new MetricsRegistry();
  registry.inc("auterva_http_responses_total", "r", { class: "5xx" }, 3);
  registry.set("auterva_jobs", "j", 7, { kind: "MAIL_INVITATION", status: "PENDING" });
  registry.observe("auterva_db_probe_duration_seconds", "d", 0.03);
  const text = registry.render();
  expect(text).toContain("# TYPE auterva_http_responses_total counter");
  expect(text).toContain('auterva_db_probe_duration_seconds_bucket{le="+Inf"} 1');
  const parsed = parseExposition(text, { target: "web" });
  expect(sumSamples(parsed, "auterva_http_responses_total", { class: "5xx", target: "web" })).toBe(3);
  expect(sumSamples(parsed, "auterva_jobs", { kind: "MAIL_INVITATION" })).toBe(7);
  expect(parsed.some((s) => s.name.endsWith("_bucket"))).toBe(false);
});

test("a cleared gauge drops series that disappeared", () => {
  const registry = new MetricsRegistry();
  registry.set("g", "g", 1, { kind: "A" });
  registry.clearGauge("g");
  expect(registry.samples()).toEqual([]);
});
