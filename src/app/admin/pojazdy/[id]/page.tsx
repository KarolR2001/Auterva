import { notFound } from "next/navigation";
import { VehicleForm } from "@/components/admin/vehicle-form";
import { PanelShell } from "@/components/panel/panel-shell";
import { requireCompanyAdminPage } from "../../guard";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdminEditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { sessionId, companyName } = await requireCompanyAdminPage();
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  return (
    <PanelShell area="company" accessState="allowed" expectedSessionId={sessionId} title="Edycja pojazdu" currentPath={`/admin/pojazdy/${id}`}>
      <VehicleForm vehicleId={id} title={`Edycja pojazdu · ${companyName}`} />
    </PanelShell>
  );
}
