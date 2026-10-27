// Vendor-neutral metrics: in-process registry rendered as Prometheus text exposition (also readable as JSON).
// Label values are normalised to a small closed alphabet so a request can never create unbounded or sensitive series.
// Nothing here carries organisation or user identifiers: those belong in logs, not in metric labels.

export type Labels = Record<string, string>;
export type Sample = { name: string; labels: Labels; value: number };
type Series = { labels: Labels; value: number };
type Histogram = { labels: Labels; buckets: number[]; counts: number[]; sum: number; count: number };

const defaultBuckets = [0.005, 0.025, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
const maxSeriesPerMetric = 200;

function labelValue(value: string): string {
  return /^[A-Za-z0-9_:./\-\[\]]{1,64}$/.test(value) ? value : "other";
}
function normalise(labels: Labels = {}): Labels {
  const out: Labels = {};
  for (const key of Object.keys(labels).sort()) {
    if (/^[a-z][a-z0-9_]{0,31}$/.test(key)) out[key] = labelValue(String(labels[key]));
  }
  return out;
}
const keyOf = (labels: Labels) => JSON.stringify(labels);

export class MetricsRegistry {
  private counters = new Map<string, { help: string; series: Map<string, Series> }>();
  private gauges = new Map<string, { help: string; series: Map<string, Series> }>();
  private histograms = new Map<string, { help: string; buckets: number[]; series: Map<string, Histogram> }>();

  inc(name: string, help: string, labels?: Labels, by = 1): void {
    this.bump(this.counters, name, help, labels, (series) => { series.value += by; });
  }
  set(name: string, help: string, value: number, labels?: Labels): void {
    if (!Number.isFinite(value)) return;
    this.bump(this.gauges, name, help, labels, (series) => { series.value = value; });
  }
  observe(name: string, help: string, seconds: number, labels?: Labels, buckets = defaultBuckets): void {
    if (!Number.isFinite(seconds) || seconds < 0) return;
    let metric = this.histograms.get(name);
    if (!metric) { metric = { help, buckets, series: new Map() }; this.histograms.set(name, metric); }
    const normalised = normalise(labels);
    const key = keyOf(normalised);
    let series = metric.series.get(key);
    if (!series) {
      if (metric.series.size >= maxSeriesPerMetric) return;
      series = { labels: normalised, buckets: metric.buckets, counts: metric.buckets.map(() => 0), sum: 0, count: 0 };
      metric.series.set(key, series);
    }
    metric.buckets.forEach((upper, index) => { if (seconds <= upper) series!.counts[index] += 1; });
    series.sum += seconds;
    series.count += 1;
  }
  /** Gauges rebuilt from scratch on every collection must not keep series that disappeared. */
  clearGauge(name: string): void { this.gauges.get(name)?.series.clear(); }

  private bump(map: Map<string, { help: string; series: Map<string, Series> }>, name: string, help: string,
    labels: Labels | undefined, apply: (series: Series) => void): void {
    let metric = map.get(name);
    if (!metric) { metric = { help, series: new Map() }; map.set(name, metric); }
    const normalised = normalise(labels);
    const key = keyOf(normalised);
    let series = metric.series.get(key);
    if (!series) {
      if (metric.series.size >= maxSeriesPerMetric) return;
      series = { labels: normalised, value: 0 };
      metric.series.set(key, series);
    }
    apply(series);
  }

  value(name: string, labels?: Labels): number {
    const key = keyOf(normalise(labels));
    return this.counters.get(name)?.series.get(key)?.value ?? this.gauges.get(name)?.series.get(key)?.value ?? 0;
  }
  /** Sum over every series whose labels contain the given subset. */
  sum(name: string, match: Labels = {}): number {
    const metric = this.counters.get(name) ?? this.gauges.get(name);
    if (!metric) return 0;
    let total = 0;
    for (const series of metric.series.values()) {
      if (Object.entries(match).every(([k, v]) => series.labels[k] === v)) total += series.value;
    }
    return total;
  }

  samples(): Sample[] {
    const out: Sample[] = [];
    for (const map of [this.counters, this.gauges]) {
      for (const [name, metric] of map) for (const series of metric.series.values()) out.push({ name, labels: series.labels, value: series.value });
    }
    return out;
  }

  reset(): void { this.counters.clear(); this.gauges.clear(); this.histograms.clear(); }

  render(): string {
    const lines: string[] = [];
    const fmt = (labels: Labels, extra: Labels = {}) => {
      const all = { ...labels, ...extra };
      const keys = Object.keys(all);
      return keys.length ? `{${keys.map((k) => `${k}="${all[k].replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}` : "";
    };
    for (const [type, map] of [["counter", this.counters], ["gauge", this.gauges]] as const) {
      for (const [name, metric] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} ${type}`);
        for (const series of metric.series.values()) lines.push(`${name}${fmt(series.labels)} ${series.value}`);
      }
    }
    for (const [name, metric] of [...this.histograms.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`# HELP ${name} ${metric.help}`, `# TYPE ${name} histogram`);
      for (const series of metric.series.values()) {
        series.buckets.forEach((upper, i) => lines.push(`${name}_bucket${fmt(series.labels, { le: String(upper) })} ${series.counts[i]}`));
        lines.push(`${name}_bucket${fmt(series.labels, { le: "+Inf" })} ${series.count}`,
          `${name}_sum${fmt(series.labels)} ${series.sum}`, `${name}_count${fmt(series.labels)} ${series.count}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}

// One registry per process, shared across Next's separate server bundles through globalThis.
const holder = globalThis as unknown as { __autervaMetrics?: MetricsRegistry };
export const metrics: MetricsRegistry = holder.__autervaMetrics ??= new MetricsRegistry();

export const names = {
  httpRequests: "auterva_http_requests_total",
  httpResponses: "auterva_http_responses_total",
  httpDuration: "auterva_http_request_duration_seconds",
  httpUnhandled: "auterva_http_unhandled_errors_total",
  dbProbe: "auterva_db_probe_total",
  dbProbeDuration: "auterva_db_probe_duration_seconds",
  dbPoolErrors: "auterva_db_pool_errors_total",
  login: "auterva_login_attempts_total",
  storage: "auterva_storage_requests_total",
  storageDuration: "auterva_storage_request_duration_seconds",
  mail: "auterva_mail_deliveries_total",
  workerHeartbeat: "auterva_worker_last_iteration_timestamp_seconds",
  workerIterations: "auterva_worker_iterations_total",
  wsConnections: "auterva_ws_connections",
  wsListenerHealthy: "auterva_ws_listener_healthy",
  alertsFiring: "auterva_alerts_firing",
  alertNotifications: "auterva_alert_notifications_total",
} as const;

export function sumSamples(samples: Sample[], name: string, match: Labels = {}): number {
  let total = 0;
  for (const sample of samples) {
    if (sample.name === name && Object.entries(match).every(([k, v]) => sample.labels[k] === v)) total += sample.value;
  }
  return total;
}
export function hasSample(samples: Sample[], name: string, match: Labels = {}): boolean {
  return samples.some((s) => s.name === name && Object.entries(match).every(([k, v]) => s.labels[k] === v));
}

/** Parses the text exposition produced by render() (counters and gauges; histogram lines are ignored). */
export function parseExposition(text: string, extra: Labels = {}): Sample[] {
  const out: Sample[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const match = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+(-?[0-9.eE+-]+|NaN|\+Inf)$/.exec(line);
    if (!match || /_(bucket|sum|count)$/.test(match[1])) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    const labels: Labels = { ...extra };
    for (const pair of (match[2] ?? "").matchAll(/([a-z][a-z0-9_]*)="((?:[^"\\]|\\.)*)"/g)) labels[pair[1]] = pair[2];
    out.push({ name: match[1], labels, value });
  }
  return out;
}
