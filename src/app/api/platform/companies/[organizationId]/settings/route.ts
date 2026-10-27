import { readPlatformSettings, writePlatformSettings } from "@/modules/settings/http";

export const runtime = "nodejs";
type Context = { params: Promise<{ organizationId: string }> };
export async function GET(request: Request, context: Context) {
  return readPlatformSettings(request, (await context.params).organizationId);
}
export async function PATCH(request: Request, context: Context) {
  return writePlatformSettings(request, (await context.params).organizationId);
}
