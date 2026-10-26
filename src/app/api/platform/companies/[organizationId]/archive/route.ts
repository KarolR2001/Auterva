import { companyArchiveRoute } from "@/modules/organizations/archive-http";

export function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  return companyArchiveRoute(request, context, "archive");
}
