import { Dashboard } from "@/components/admin/dashboard";
import { CompanyPanelPage } from "./company-panel";
import { PwaRegistration } from "./pwa-registration";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  return CompanyPanelPage({
    currentPath: "/admin",
    children: ({ companyName }) => (
      <>
        <Dashboard title={`Panel · ${companyName}`} />
        <PwaRegistration />
      </>
    ),
  });
}
