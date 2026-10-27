import { readAdminSettings, refuseAdminSettingsWrite } from "@/modules/settings/http";

export const runtime = "nodejs";
export const GET = readAdminSettings;
export const PATCH = refuseAdminSettingsWrite;
