import { PlatformFleetCalendar } from "@/components/platform/company-fleet";
import { availabilityToday } from "@/modules/availability/dates";
import { PlatformCompanyPage } from "../company-page";

export const dynamic = "force-dynamic";

export default async function CompanyFleetCalendarPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return PlatformCompanyPage({
    organizationId, currentPath: "/firmy", title: "Kalendarz floty",
    children: ({ name }) => <PlatformFleetCalendar key={organizationId} organizationId={organizationId} today={availabilityToday()} title={`Kalendarz floty · ${name}`} />,
  });
}
