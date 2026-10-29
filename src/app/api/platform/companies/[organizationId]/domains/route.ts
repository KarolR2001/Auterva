import { routeContext } from "@/modules/observability/route-context";
import { domainHandlers } from "./handlers";

type Context = { params: Promise<{ organizationId: string }> };

async function handleGET(request: Request, context: Context) {
  return domainHandlers.get(request, (await context.params).organizationId);
}
async function handlePUT(request: Request, context: Context) {
  return domainHandlers.put(request, (await context.params).organizationId);
}
async function handleDELETE(request: Request, context: Context) {
  return domainHandlers.remove(request, (await context.params).organizationId);
}

export const GET = routeContext(handleGET);
export const PUT = routeContext(handlePUT);
export const DELETE = routeContext(handleDELETE);
