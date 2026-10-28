import { routeContext } from "@/modules/observability/route-context";
import { serveSitemap } from "@/modules/public-offer/discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = routeContext(serveSitemap);
