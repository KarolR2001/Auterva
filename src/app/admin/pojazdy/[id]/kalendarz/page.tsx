import { notFound } from "next/navigation";
import { VehicleCalendar } from "@/components/admin/vehicle-calendar";
import { availabilityToday } from "@/modules/availability/dates";
import { CompanyPanelPage } from "../../../company-panel";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AdminVehicleCalendarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!uuid.test(id)) notFound();
  return CompanyPanelPage({
    currentPath: `/admin/pojazdy/${id}`,
    title: "Kalendarz pojazdu",
    children: ({ companyName }) => <VehicleCalendar vehicleId={id} today={availabilityToday()} title={`Kalendarz pojazdu · ${companyName}`} />,
  });
}
