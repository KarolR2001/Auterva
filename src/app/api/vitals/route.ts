import { routeContext } from "@/modules/observability/route-context";
import { postVitals } from "@/modules/observability/web-vitals-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Write only: aggregated into auterva_web_vital_* metrics, nothing is stored per request (#340).
export const POST = routeContext(postVitals);
