import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewHome } from "@/components/platform/company-preview";
import { prisma } from "@/lib/prisma";
import { getPreviewHome, previewBase } from "@/modules/preview/read";
import { resolveCompanyPublicVisibility } from "@/modules/service-period/public";
import { PlatformCompanyPage } from "../company-page";

export const dynamic = "force-dynamic";
// The preview is private: no crawler, no canonical; the Proxy adds X-Robots-Tag for the platform host as well.
export const metadata: Metadata = { robots: { index: false, follow: false, nocache: true } };

export default async function CompanyPreviewPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  return PlatformCompanyPage({
    organizationId, currentPath: "/firmy", title: "Podgląd strony firmy",
    children: async ({ name }) => {
      const [home, visible] = await Promise.all([
        getPreviewHome(prisma, organizationId, previewBase("PLATFORM", organizationId)),
        resolveCompanyPublicVisibility(prisma, organizationId, new Date()),
      ]);
      if (!home) notFound();
      return <PreviewHome home={home} company={name} organizationId={organizationId} publicNow={visible !== null} />;
    },
  });
}
