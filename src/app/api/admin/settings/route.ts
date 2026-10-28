import { routeContext } from "@/modules/observability/route-context";
import { readAdminSettings, refuseAdminSettingsWrite } from "@/modules/settings/http";

export const runtime = "nodejs";
export const GET = routeContext(readAdminSettings);
export const PATCH = routeContext(refuseAdminSettingsWrite);
