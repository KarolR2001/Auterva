import { PlatformVehicleList } from "@/components/platform/company-fleet";
import { PlatformCompanyPage } from "../company-page";

export const dynamic = "force-dynamic";

export default async function CompanyVehiclesPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return PlatformCompanyPage({
    organizationId, currentPath: "/firmy", title: "Flota firmy",
    children: ({ name }) => <PlatformVehicleList key={organizationId} organizationId={organizationId} title={`Flota · ${name}`} />,
  });
}
