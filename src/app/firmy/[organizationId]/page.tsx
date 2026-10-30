import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { PanelShell } from "@/components/panel/panel-shell";
import { CompanyCardView } from "@/components/platform/company-card";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function CompanyCardPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "PLATFORM" || area.organizationId !== null || !uuid.test(organizationId)) notFound();
  const actor = await requireAuthorizedActor(prisma, auth, incoming, { area: "PLATFORM", organizationId: null });
  if (!actor) notFound();
  return (
    <PanelShell
      area="platform"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title="Karta firmy"
      currentPath={`/firmy/${organizationId}`}
    >
      <CompanyCardView organizationId={organizationId} />
    </PanelShell>
  );
}
