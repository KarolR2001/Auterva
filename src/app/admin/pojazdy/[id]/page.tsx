import { notFound } from "next/navigation";
import { VehicleForm } from "@/components/admin/vehicle-form";
import { CompanyPanelPage } from "../../company-panel";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdminEditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  return CompanyPanelPage({
    currentPath: `/admin/pojazdy/${id}`,
    requireVehicleId: id,
    title: "Pojazdy",
    children: ({ companyName }) => <VehicleForm vehicleId={id} title={`Edycja pojazdu · ${companyName}`} />,
  });
}
