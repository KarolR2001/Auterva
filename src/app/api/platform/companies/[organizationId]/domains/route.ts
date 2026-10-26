import { domainHandlers } from "./handlers";

type Context = { params: Promise<{ organizationId: string }> };

export async function GET(request: Request, context: Context) {
  return domainHandlers.get(request, (await context.params).organizationId);
}
export async function PUT(request: Request, context: Context) {
  return domainHandlers.put(request, (await context.params).organizationId);
}
export async function DELETE(request: Request, context: Context) {
  return domainHandlers.remove(request, (await context.params).organizationId);
}
