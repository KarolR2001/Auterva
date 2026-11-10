import { FleetCalendar } from "@/components/admin/fleet-calendar";
import { availabilityToday } from "@/modules/availability/dates";
import { CompanyPanelPage } from "../company-panel";

export const dynamic = "force-dynamic";

export default async function AdminFleetCalendarPage() {
  return CompanyPanelPage({
    currentPath: "/admin/kalendarz",
    title: "Kalendarz floty",
    children: ({ companyName }) => <FleetCalendar today={availabilityToday()} title={`Kalendarz floty · ${companyName}`} />,
  });
}
