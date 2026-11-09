import { notFound } from "next/navigation";
import { PlatformVehicleCalendar } from "@/components/platform/company-fleet";
import { availabilityToday } from "@/modules/availability/dates";
import { PlatformCompanyPage } from "../../../company-page";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CompanyVehicleCalendarPage({ params }: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await params;
  if (!uuid.test(id)) notFound();
  return PlatformCompanyPage({
    organizationId, currentPath: "/firmy", title: "Kalendarz pojazdu",
    children: ({ name }) => <PlatformVehicleCalendar key={`${organizationId}:${id}`} organizationId={organizationId} vehicleId={id} today={availabilityToday()} title={`Kalendarz pojazdu · ${name}`} />,
  });
}
