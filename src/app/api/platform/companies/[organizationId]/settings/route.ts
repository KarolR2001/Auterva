import { routeContext } from "@/modules/observability/route-context";
import { readPlatformSettings, writePlatformSettings } from "@/modules/settings/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
async function handleGET(request: Request, context: Context) {
  return readPlatformSettings(request, (await context.params).organizationId);
}
async function handlePATCH(request: Request, context: Context) {
  return writePlatformSettings(request, (await context.params).organizationId);
}

export const GET = routeContext(handleGET);
export const PATCH = routeContext(handlePATCH);
