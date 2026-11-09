import { VehicleList } from "@/components/admin/vehicle-list";
import { PanelShell } from "@/components/panel/panel-shell";
import { requireCompanyAdminPage } from "../guard";

export const dynamic = "force-dynamic";

export default async function AdminVehiclesPage() {
  const { sessionId, companyName, unreadChat } = await requireCompanyAdminPage();
  return (
    <PanelShell area="company" accessState="allowed" expectedSessionId={sessionId} title="Pojazdy" currentPath="/admin/pojazdy" unreadChat={unreadChat}>
      <VehicleList title={`Pojazdy · ${companyName}`} />
    </PanelShell>
  );
}
