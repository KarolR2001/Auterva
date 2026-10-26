import { platformCompanyDetail } from "@/modules/organizations/read-http";

export async function GET(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await context.params;
  return platformCompanyDetail(request, organizationId);
}
