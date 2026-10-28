import { timingSafeEqual } from "node:crypto";
import { HeadBucketCommand } from "@aws-sdk/client-s3";
import { createMediaStorage } from "@/modules/media/storage";
import { createCachedReadiness, livenessReport, readinessReport, type ReadinessDeps, type ReadinessReport } from "./health";
import { metrics } from "./metrics";

// Transport-independent handlers shared by the Next routes (web) and the small ops listener (workers, realtime).
// Access policy: liveness and bare readiness status are harmless; readiness details and metrics need the ops token.
// With no token configured the metrics endpoint does not exist (404), never an open endpoint.

const noStore = { "Cache-Control": "no-store" };

export function opsTokenFromEnv(env: Record<string, string | undefined> = process.env): string | null {
  const token = env.OPS_METRICS_TOKEN;
  return token && token.length >= 24 ? token : null;
}

export function bearerMatches(header: string | null, token: string | null): boolean {
  if (!token || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function liveResponse(): Response {
  return Response.json(livenessReport(), { headers: noStore });
}

export function publishReadinessGauges(report: ReadinessReport): void {
  for (const [check, result] of Object.entries(report.checks)) {
    metrics.set("auterva_ready_check", "1 when the readiness check passes", result.status === "ok" ? 1 : 0, { check });
  }
}

export async function readyResponse(request: Request, readiness: () => Promise<ReadinessReport>, token = opsTokenFromEnv()): Promise<Response> {
  const report = await readiness();
  publishReadinessGauges(report);
  const detailed = bearerMatches(request.headers.get("authorization"), token);
  // Reasons name dependencies and failure classes, never connection strings or messages; still token-gated.
  return Response.json(detailed ? report : { status: report.status }, { status: report.status === "ok" ? 200 : 503, headers: noStore });
}

export async function metricsResponse(request: Request, refresh?: () => Promise<void>, token = opsTokenFromEnv()): Promise<Response> {
  if (!token) return new Response(null, { status: 404, headers: noStore });
  if (!bearerMatches(request.headers.get("authorization"), token)) {
    return new Response(null, { status: 401, headers: { ...noStore, "WWW-Authenticate": "Bearer" } });
  }
  await refresh?.().catch(() => undefined);
  return new Response(metrics.render(), { headers: { ...noStore, "Content-Type": "text/plain; version=0.0.4; charset=utf-8" } });
}

// ---- web readiness dependencies (lazy: a missing S3 configuration is a failed check, not a crash) -------------

let storage: ReturnType<typeof createMediaStorage> | null | undefined;
export function storageProbeFromEnv(env: Record<string, string | undefined> = process.env): (() => Promise<void>) | undefined {
  if (storage === undefined) {
    try { storage = createMediaStorage(env); } catch { storage = null; }
  }
  const client = storage;
  if (!client) return undefined;
  return async () => { await client.client.send(new HeadBucketCommand({ Bucket: client.bucket }), { abortSignal: AbortSignal.timeout(3_000) }); };
}

const readinessTtl = () => { const ttl = Number(process.env.OPS_READY_TTL_MS ?? 3_000); return Number.isFinite(ttl) && ttl >= 0 && ttl <= 60_000 ? ttl : 3_000; };
let cachedWeb: (() => Promise<ReadinessReport>) | undefined;
export function webReadiness(db: ReadinessDeps["db"]): Promise<ReadinessReport> {
  cachedWeb ??= createCachedReadiness(() => readinessReport({ db, storageProbe: storageProbeFromEnv() }), readinessTtl());
  return cachedWeb();
}
