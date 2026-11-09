import { PlatformVehicleForm } from "@/components/platform/company-fleet";
import { PlatformCompanyPage } from "../../company-page";

export const dynamic = "force-dynamic";

export default async function CompanyNewVehiclePage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return PlatformCompanyPage({
    organizationId, currentPath: "/firmy", title: "Nowy pojazd",
    children: ({ name }) => <PlatformVehicleForm key={organizationId} organizationId={organizationId} title={`Nowy pojazd · ${name}`} />,
  });
}
