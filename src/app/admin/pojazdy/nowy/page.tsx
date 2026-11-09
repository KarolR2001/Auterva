import { VehicleForm } from "@/components/admin/vehicle-form";
import { PanelShell } from "@/components/panel/panel-shell";
import { requireCompanyAdminPage } from "../../guard";

export const dynamic = "force-dynamic";

export default async function AdminNewVehiclePage() {
  const { sessionId, companyName } = await requireCompanyAdminPage();
  return (
    <PanelShell area="company" accessState="allowed" expectedSessionId={sessionId} title="Nowy pojazd" currentPath="/admin/pojazdy/nowy">
      <VehicleForm title={`Nowy pojazd · ${companyName}`} />
    </PanelShell>
  );
}
