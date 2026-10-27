import { liveResponse } from "@/modules/observability/ops-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Compatibility alias (Dockerfile consumers, render.yaml, e2e): the original `{ "status": "ok" }` contract stays,
// and it stays a liveness check that does not depend on the database. New probes use /api/health/live and /ready.
export async function GET() {
  return Response.json({ ...(await liveResponse().json()), status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
