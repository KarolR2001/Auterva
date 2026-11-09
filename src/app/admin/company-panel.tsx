import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { denyPanel } from "@/components/panel/deny-panel";
import { ServiceStatusProvider } from "@/components/panel/service-status";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getServiceStatus } from "@/modules/reminders/read";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

/**
 * Server frame of a company panel page: authorizes the actor for the host's company, reads the
 * service status on the server (private, uncached) and hands it to the client frame.
 */
export async function CompanyPanelPage({ currentPath, children }: { currentPath: string; children: ReactNode }) {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId) notFound();
  const actor = await requireRequestContext(prisma, auth, incoming, area.organizationId);
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "COMPANY_ADMIN", organizationId: area.organizationId });
  const [organization, status, publicHost] = await Promise.all([
    prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
    getServiceStatus(prisma, actor.organizationId, new Date()),
    prisma.hostMapping.findFirst({ where: { organizationId: actor.organizationId, area: "COMPANY_PUBLIC", status: "ACTIVE" }, select: { hostname: true } }),
  ]);
  if (!organization || !status) notFound();
  return (
    <ServiceStatusProvider area="company" initial={status} publicHost={publicHost?.hostname ?? null}
      expectedSessionId={actor.sessionId} title={organization.name ?? "Panel firmy"} currentPath={currentPath}>
      {children}
    </ServiceStatusProvider>
  );
}
