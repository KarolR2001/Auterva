import { type VitalDevice, type VitalPayload, rateVital } from "@/lib/web-vitals";
import { metrics, names } from "./metrics";

// Buckets follow the web.dev thresholds (good/poor) so a quantile of the histogram maps to a rating.
const lcpBuckets = [0.5, 1, 1.5, 2, 2.5, 3, 4, 6, 10];
const inpBuckets = [0.05, 0.1, 0.2, 0.35, 0.5, 1, 2];
const clsBuckets = [0.01, 0.05, 0.1, 0.15, 0.25, 0.5, 1];

/**
 * Aggregates one validated report into the `auterva_*` metrics. Only the metric, the route pattern, the device
 * class and the rating are kept; the single value is added to a histogram and the report itself is discarded, so
 * there is no raw event, address, identifier or URL to store.
 */
export function recordVitals(payload: VitalPayload): void {
  for (const { name, value, route } of payload.metrics) {
    const labels = { route, device: payload.device };
    if (name === "LCP") metrics.observe(names.vitalLcp, "Largest Contentful Paint by route pattern", value / 1000, labels, lcpBuckets);
    else if (name === "INP") metrics.observe(names.vitalInp, "Interaction to Next Paint by route pattern", value / 1000, labels, inpBuckets);
    else metrics.observe(names.vitalCls, "Cumulative Layout Shift by route pattern", value, labels, clsBuckets);
    metrics.inc(names.vitalsReports, "Web Vitals values received by metric, device and rating",
      { metric: name, device: payload.device, rating: rateVital(name, value) });
  }
}

export const countVitalsRefusal = (outcome: "invalid" | "rate_limited" | "forbidden") =>
  metrics.inc(names.vitalsReports, "Web Vitals values received by metric, device and rating", { metric: "none", device: "none", rating: outcome });

export type { VitalDevice };
