import { ServiceStatusCard } from "@/components/panel/service-status";
import { CompanyPanelPage } from "../company-panel";

export const dynamic = "force-dynamic";

export default async function ServicePage() {
  return CompanyPanelPage({
    currentPath: "/admin/usluga",
    children: <ServiceStatusCard />,
  });
}
