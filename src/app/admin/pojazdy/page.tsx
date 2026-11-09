import { VehicleList } from "@/components/admin/vehicle-list";
import { CompanyPanelPage } from "../company-panel";

export const dynamic = "force-dynamic";

export default async function AdminVehiclesPage() {
  return CompanyPanelPage({
    currentPath: "/admin/pojazdy",
    title: "Pojazdy",
    children: ({ companyName }) => <VehicleList title={`Pojazdy · ${companyName}`} />,
  });
}
