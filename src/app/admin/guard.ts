import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { denyPanel } from "@/components/panel/deny-panel";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { findConversation } from "@/modules/chat/service";
import { readState } from "@/modules/chat/read-state";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

/**
 * Every admin page checks host, session, role and company itself; the client components only render.
 * Denial follows #14: no session -> login, limited session -> MFA, anything else -> neutral 404.
 */
export async function requireCompanyAdminPage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId) notFound();
  const actor = await requireRequestContext(prisma, auth, incoming, area.organizationId);
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "COMPANY_ADMIN", organizationId: area.organizationId });
  const organization = await prisma.organization.findUnique({ where: { id: actor.organizationId }, select: { name: true } });
  if (!organization) notFound();
  // Only a count is read here; showing a page never moves the chat read cursor (C-F127).
  const unreadChat = await findConversation(prisma, { actorId: actor.actorId, sessionId: actor.sessionId, organizationId: actor.organizationId })
    .then(({ conversationId }) => readState(prisma, { actorId: actor.actorId, role: "ADMIN_FIRMY", organizationId: actor.organizationId }, conversationId))
    .then((state) => state.unread > 0)
    .catch(() => false);
  return { sessionId: actor.sessionId, companyName: organization.name ?? "Panel firmy", unreadChat };
}
