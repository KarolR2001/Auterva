import { AuditLog } from "@/components/audit/audit-log";
import { PlatformCompanyPage } from "../company-page";

export const dynamic = "force-dynamic";

// The superadmin reads the log of the company chosen in the path (archived included) as themselves.
export default async function CompanyAuditPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return PlatformCompanyPage({
    organizationId, currentPath: "/firmy", title: "Dziennik zmian firmy",
    children: ({ name }) => <AuditLog key={organizationId} apiBase={`/api/platform/companies/${organizationId}`} title={`Dziennik zmian · ${name}`} />,
  });
}
