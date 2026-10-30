import { Dashboard } from "@/components/admin/dashboard";
import { PwaRegistration } from "./pwa-registration";
import { requireCompanyAdminPage } from "./guard";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  await requireCompanyAdminPage();
  return <main><Dashboard title="Panel Auterva" /><PwaRegistration /></main>;
}
