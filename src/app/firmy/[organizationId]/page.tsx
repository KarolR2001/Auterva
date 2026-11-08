import { notFound } from "next/navigation";

import { PanelShell } from "@/components/panel/panel-shell";
import { CompanyCard } from "@/components/platform/company-card";
import { requirePlatformPage } from "@/components/platform/platform-gate";
import { prisma } from "@/lib/prisma";
import { getPlatformCompany } from "@/modules/organizations/read";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ zapisano?: string | string[] }>;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CompanyPage({ params, searchParams }: Props) {
  // A malformed address is the neutral 404 before any session check: it says nothing about accounts.
  const { organizationId } = await params;
  if (!uuid.test(organizationId)) notFound();
  const actor = await requirePlatformPage();
  const company = await getPlatformCompany(prisma, organizationId);
  if (!company) notFound();
  const saved = (await searchParams).zapisano === "1";
  return (
    <PanelShell
      area="platform"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title={company.name ?? "Firma"}
      currentPath="/firmy"
    >
      <CompanyCard initial={JSON.parse(JSON.stringify(company))} justSaved={saved} />
    </PanelShell>
  );
}
