import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { CalendarFeeds } from "@/components/calendar-feed/calendar-feeds";
import { platformFeedContext } from "@/components/calendar-feed/feed-api";
import { denyPanel } from "@/components/panel/deny-panel";
import { PurgeRunningNotice, purgeCompanyName, purgeNoticeState } from "@/components/platform/purge-running-notice";
import { PanelShell } from "@/components/panel/panel-shell";
import { SettingsNav } from "@/components/settings/settings-nav";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ADM-22 superadmin-context (#355, E12): the superadmin lists and revokes the company's addresses under their own
// identity; creating and rotating stay with the company admin (the platform API has no such routes).
export default async function CompanyExternalCalendarPage({ params }: { params: Promise<{ organizationId: string }> }) {
  const { organizationId } = await params;
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "PLATFORM" || area.organizationId !== null || !uuid.test(organizationId)) notFound();
  const actor = await requireAuthorizedActor(prisma, auth, incoming, { area: "PLATFORM", organizationId: null });
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "PLATFORM", organizationId: null });
  const company = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, purgeStartedAt: true, purgedAt: true } });
  if (!company) notFound();
  const purge = purgeNoticeState(company);
  const name = purgeCompanyName(purge, company.name);
  const base = `/firmy/${encodeURIComponent(organizationId)}/ustawienia`;
  return (
    <PanelShell
      area="platform"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title="Ustawienia firmy"
      currentPath={`${base}/kalendarz-zewnetrzny`}
      companyContext={{ id: organizationId, name }}
    >
      {purge ? <PurgeRunningNotice state={purge} /> : (
        <CalendarFeeds
          context={platformFeedContext(organizationId)}
          companyName={name}
          trail="Ustawienia firmy / Kalendarz zewnętrzny"
          nav={<SettingsNav base={base} current="kalendarz" />}
        />
      )}
    </PanelShell>
  );
}
