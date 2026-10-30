import type { Metadata } from "next";
import { VehicleList } from "@/components/admin/vehicle-list";
import { requireCompanyAdminPage } from "../guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Pojazdy" };

export default async function AdminVehiclesPage() {
  await requireCompanyAdminPage();
  return <main><VehicleList /></main>;
}
