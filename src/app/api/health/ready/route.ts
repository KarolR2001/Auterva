import { prisma } from "@/lib/prisma";
import { readyResponse, webReadiness } from "@/modules/observability/ops-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return readyResponse(request, () => webReadiness(prisma));
}
