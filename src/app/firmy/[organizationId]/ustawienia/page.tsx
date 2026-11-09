import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { denyPanel } from "@/components/panel/deny-panel";
import { PanelShell } from "@/components/panel/panel-shell";
import { SettingsForm } from "@/components/settings/settings-form";
import { SettingsNav } from "@/components/settings/settings-nav";
import { parseSection, type SettingsSnapshot } from "@/components/settings/settings-model";
import settingsStyles from "@/components/settings/settings.module.css";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { getCompanySettings } from "@/modules/settings/read";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Superadmin acts in the context of the chosen company under their own identity; the write goes to the
// platform endpoint, which authorizes again. Host and URL never replace that check.
export default async function CompanySettingsPage({ params, searchParams }: {
  params: Promise<{ organizationId: string }>;
  searchParams: Promise<{ sekcja?: string | string[] }>;
}) {
  const { organizationId } = await params;
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "PLATFORM" || area.organizationId !== null || !uuid.test(organizationId)) notFound();
  const actor = await requireAuthorizedActor(prisma, auth, incoming, { area: "PLATFORM", organizationId: null });
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "PLATFORM", organizationId: null });
  const snapshot = await getCompanySettings(prisma, organizationId, "platform");
  if (!snapshot) notFound();
  const company = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const section = parseSection((await searchParams).sekcja);
  const base = `/firmy/${encodeURIComponent(organizationId)}/ustawienia`;
  return (
    <PanelShell
      area="platform"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title="Ustawienia firmy"
      currentPath={base}
      companyContext={{ id: organizationId, name: company?.name ?? "Firma" }}
    >
      <div className={settingsStyles.layout}>
        <SettingsNav base={base} current={section} />
        <SettingsForm key={section} snapshot={snapshot as unknown as SettingsSnapshot} section={section} />
      </div>
    </PanelShell>
  );
}
