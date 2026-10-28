import { liveResponse } from "@/modules/observability/ops-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return liveResponse();
}
