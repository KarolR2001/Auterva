import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ChatPanel } from "@/components/chat/chat-panel";
import { denyPanel } from "@/components/panel/deny-panel";
import { PanelShell } from "@/components/panel/panel-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findConversation } from "@/modules/chat/service";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

// The chat works after the service period ends (C-F125): no period check here, only host, role, company and account.
export default async function AdminChatPage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId) notFound();
  const actor = await requireRequestContext(prisma, auth, incoming, area.organizationId);
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "COMPANY_ADMIN", organizationId: area.organizationId });
  const found = await findConversation(prisma, { actorId: actor.actorId, sessionId: actor.sessionId, organizationId: actor.organizationId })
    .catch(() => null);
  if (!found) {
    return (
      <PanelShell area="company" accessState="allowed" expectedSessionId={actor.sessionId} title="Czat z Autervą" currentPath="/admin/czat">
        <p role="alert">Nie udało się wczytać rozmowy. Odśwież stronę albo spróbuj za chwilę: <a href="/admin/czat">Spróbuj ponownie</a>.</p>
      </PanelShell>
    );
  }
  const { conversationId } = found;
  // The company's own name signs its messages (TEN-11); read here, no new API.
  const organization = await prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } });
  const companyName = organization?.name?.trim() || "Twoja firma";
  return (
    <PanelShell
      area="company"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title="Czat z Autervą"
      currentPath="/admin/czat"
    >
      <ChatPanel
        accountId={actor.actorId}
        organizationId={actor.organizationId}
        conversationId={conversationId}
        apiBase="/api/admin/chat"
        peerLabel="Auterva"
        peerWith="Autervą"
        companyName={companyName}
        loginHref="/admin/login?returnTo=%2Fadmin%2Fczat"
      />
    </PanelShell>
  );
}
