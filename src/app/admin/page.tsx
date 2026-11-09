import { PwaRegistration } from "./pwa-registration";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { denyPanel } from "@/components/panel/deny-panel";
import { auth } from "@/lib/auth";
import { findConversation } from "@/modules/chat/service";
import { readState } from "@/modules/chat/read-state";
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
  if (!actor) return denyPanel(prisma, auth, incoming, {
      area: "COMPANY_ADMIN",
      organizationId: area.organizationId,
    });
  const organization = await prisma.organization.findUnique({
    where: { id: actor.organizationId },
    select: { name: true },
  });
  if (!organization) notFound();
  // Only a count is read here; showing the dashboard never moves the read cursor (C-F127).
  const unreadChat = await findConversation(prisma, { actorId: actor.actorId, sessionId: actor.sessionId, organizationId: actor.organizationId })
    .then(({ conversationId }) => readState(prisma, { actorId: actor.actorId, role: "ADMIN_FIRMY", organizationId: actor.organizationId }, conversationId))
    .then((state) => state.unread > 0)
    .catch(() => false);

  return (
    <PanelShell
      area="company"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title={organization.name ?? "Panel firmy"}
      currentPath="/admin"
      unreadChat={unreadChat}
    >
      <p>Panel jest w przygotowaniu.</p>
      <PwaRegistration />
    </PanelShell>
  );
}
