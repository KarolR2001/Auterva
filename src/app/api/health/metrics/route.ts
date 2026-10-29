import { prisma } from "@/lib/prisma";
import { metricsResponse, publishReadinessGauges, webReadiness } from "@/modules/observability/ops-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Token-protected (OPS_METRICS_TOKEN); without a token the endpoint answers 404. Never public, never cached.
export function GET(request: Request) {
  return metricsResponse(request, async () => { publishReadinessGauges(await webReadiness(prisma)); });
}
