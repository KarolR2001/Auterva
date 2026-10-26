import { domainHandlers } from "../handlers";

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return domainHandlers.verify(request, (await context.params).organizationId);
}
