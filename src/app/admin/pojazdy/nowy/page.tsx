import { VehicleForm } from "@/components/admin/vehicle-form";
import { CompanyPanelPage } from "../../company-panel";

export const dynamic = "force-dynamic";

export default async function AdminNewVehiclePage() {
  return CompanyPanelPage({
    currentPath: "/admin/pojazdy/nowy",
    title: "Pojazdy",
    children: ({ companyName }) => <VehicleForm title={`Nowy pojazd · ${companyName}`} />,
  });
}
