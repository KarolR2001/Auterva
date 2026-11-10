import { AuditLog } from "@/components/audit/audit-log";
import { CompanyPanelPage } from "../company-panel";

export const dynamic = "force-dynamic";

// ADM-17: the company admin reads only the own company's log; the host decides the company.
export default async function AdminAuditPage() {
  return CompanyPanelPage({
    currentPath: "/admin/logi", title: "Dziennik zmian",
    children: <AuditLog apiBase="/api/admin" title="Dziennik zmian" />,
  });
}
