import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CalendarFeeds } from "@/components/calendar-feed/calendar-feeds";
import { adminFeedContext } from "@/components/calendar-feed/feed-api";
import { denyPanel } from "@/components/panel/deny-panel";
import { PanelShell } from "@/components/panel/panel-shell";
import { SettingsNav } from "@/components/settings/settings-nav";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

// ADM-22 (#355, D-49): the company admin manages the private iCal addresses. The page only authorizes; the list is read
// by the client from the API, and an address exists only in the answer of create or rotate (never in server props).
export default async function AdminExternalCalendarPage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId) notFound();
  const actor = await requireRequestContext(prisma, auth, incoming, area.organizationId);
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "COMPANY_ADMIN", organizationId: area.organizationId });
  return (
    <PanelShell
      area="company"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title="Ustawienia"
      currentPath="/admin/ustawienia/kalendarz-zewnetrzny"
    >
      <CalendarFeeds
        context={adminFeedContext}
        trail="Ustawienia / Kalendarz zewnętrzny"
        nav={<SettingsNav base="/admin/ustawienia" current="kalendarz" />}
      />
    </PanelShell>
  );
}
