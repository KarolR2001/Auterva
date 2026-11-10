import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { denyPanel } from "@/components/panel/deny-panel";
import { requireVehicleInCompany } from "@/components/panel/require-vehicle";
import { ServiceStatusProvider } from "@/components/panel/service-status";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findConversation } from "@/modules/chat/service";
import { readState } from "@/modules/chat/read-state";
import { getServiceStatus } from "@/modules/reminders/read";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

/**
 * Server frame of a company panel page: authorizes the actor for the host's company, reads the
 * service status on the server (private, uncached) and hands it to the client frame.
 */
export async function CompanyPanelPage({ currentPath, title, requireVehicleId, children }: {
  currentPath: string;
  /** Heading of the shell; defaults to the company name. */
  title?: string;
  /** A page about one vehicle: a foreign or missing vehicle is the neutral 404 from the server (never a 200 with a message). */
  requireVehicleId?: string;
  /** The page content; a function receives the company name (for the document title) once the actor is authorized. */
  children: ReactNode | ((context: { companyName: string }) => ReactNode);
}) {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId) notFound();
  const actor = await requireRequestContext(prisma, auth, incoming, area.organizationId);
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "COMPANY_ADMIN", organizationId: area.organizationId });
  if (requireVehicleId) await requireVehicleInCompany(actor.organizationId, requireVehicleId);
  const [organization, status, publicHost] = await Promise.all([
    prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } }),
    getServiceStatus(prisma, actor.organizationId, new Date()),
    prisma.hostMapping.findFirst({ where: { organizationId: actor.organizationId, area: "COMPANY_PUBLIC", status: "ACTIVE" }, select: { hostname: true } }),
  ]);
  if (!organization || !status) notFound();
  // Only a count is read here; showing a page never moves the read cursor (C-F127).
  const unreadChat = await findConversation(prisma, { actorId: actor.actorId, sessionId: actor.sessionId, organizationId: actor.organizationId })
    .then(({ conversationId }) => readState(prisma, { actorId: actor.actorId, role: "ADMIN_FIRMY", organizationId: actor.organizationId }, conversationId))
    .then((state) => state.unread > 0)
    .catch(() => false);
  const companyName = organization.name ?? "Panel firmy";
  return (
    <ServiceStatusProvider area="company" initial={status} publicHost={publicHost?.hostname ?? null}
      expectedSessionId={actor.sessionId} title={title ?? companyName} currentPath={currentPath} unreadChat={unreadChat}>
      {typeof children === "function" ? children({ companyName }) : children}
    </ServiceStatusProvider>
  );
}
