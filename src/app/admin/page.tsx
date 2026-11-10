import { Dashboard } from "@/components/admin/dashboard";
import { CompanyPanelPage } from "./company-panel";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  return CompanyPanelPage({
    currentPath: "/admin",
    children: ({ companyName }) => <Dashboard title={`Panel · ${companyName}`} />,
  });
}
