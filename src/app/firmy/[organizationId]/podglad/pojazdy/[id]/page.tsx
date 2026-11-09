import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewVehicle } from "@/components/platform/company-preview";
import { prisma } from "@/lib/prisma";
import { getPreviewVehicle, previewBase } from "@/modules/preview/read";
import { resolveCompanyPublicVisibility } from "@/modules/service-period/public";
import { PlatformCompanyPage } from "../../../company-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CompanyVehiclePreviewPage({ params }: { params: Promise<{ organizationId: string; id: string }> }) {
  const { organizationId, id } = await params;
  if (!uuid.test(id)) notFound();
  return PlatformCompanyPage({
    organizationId, currentPath: "/firmy", title: "Podgląd pojazdu",
    children: async ({ name }) => {
      const [data, visible] = await Promise.all([
        getPreviewVehicle(prisma, organizationId, id, previewBase("PLATFORM", organizationId)),
        resolveCompanyPublicVisibility(prisma, organizationId, new Date()),
      ]);
      // A vehicle of another company or an archived one is the same neutral 404 as a missing one.
      if (!data) notFound();
      return <PreviewVehicle data={data} company={name} organizationId={organizationId} publicNow={visible !== null} />;
    },
  });
}
