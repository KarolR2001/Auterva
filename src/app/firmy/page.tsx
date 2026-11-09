import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { PanelShell } from "@/components/panel/panel-shell";
import { CompanyListView } from "@/components/platform/company-list";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "PLATFORM" || area.organizationId !== null) notFound();
  const actor = await requireAuthorizedActor(prisma, auth, incoming, { area: "PLATFORM", organizationId: null });
  if (!actor) notFound();
  return (
    <PanelShell area="platform" accessState="allowed" expectedSessionId={actor.sessionId} title="Firmy" currentPath="/firmy">
      <CompanyListView />
    </PanelShell>
  );
}
