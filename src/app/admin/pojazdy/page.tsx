import { VehicleList } from "@/components/admin/vehicle-list";
import { requireCompanyAdminPage } from "../guard";

export const dynamic = "force-dynamic";

export default async function AdminVehiclesPage() {
  await requireCompanyAdminPage();
  return <main><VehicleList title="Pojazdy · Panel Auterva" /></main>;
}
