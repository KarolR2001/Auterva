import { PwaRegistration } from "./pwa-registration";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PanelShell } from "@/components/panel/panel-shell";
import {
  requireRequestContext,
  resolveRequestArea,
} from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId) notFound();
  const actor = await requireRequestContext(
    prisma,
    auth,
    incoming,
    area.organizationId,
  );
  if (!actor) notFound();
  const organization = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { name: true },
  });
  if (!organization) notFound();

  return (
    <PanelShell
      area="company"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title={organization.name ?? "Panel firmy"}
      currentPath="/admin"
    >
      <p>Panel jest w przygotowaniu.</p>
      <PwaRegistration />
    </PanelShell>
  );
}
