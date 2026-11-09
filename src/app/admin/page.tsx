import { Dashboard } from "@/components/admin/dashboard";
import { PanelShell } from "@/components/panel/panel-shell";
import { requireCompanyAdminPage } from "./guard";
import { PwaRegistration } from "./pwa-registration";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const { sessionId, companyName, unreadChat } = await requireCompanyAdminPage();
  return (
    <PanelShell area="company" accessState="allowed" expectedSessionId={sessionId} title={companyName} currentPath="/admin" unreadChat={unreadChat}>
      <Dashboard title={`Panel · ${companyName}`} />
      <PwaRegistration />
    </PanelShell>
  );
}
