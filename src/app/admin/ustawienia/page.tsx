import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { denyPanel } from "@/components/panel/deny-panel";
import { PanelShell } from "@/components/panel/panel-shell";
import { SettingsNav } from "@/components/settings/settings-nav";
import { SettingsReadonly } from "@/components/settings/settings-readonly";
import { parseSection, type SettingsSnapshot } from "@/components/settings/settings-model";
import settingsStyles from "@/components/settings/settings.module.css";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCompanySettings } from "@/modules/settings/read";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

// D-01: the company admin reads the settings of the own company; only the superadmin writes them.
export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ sekcja?: string | string[] }> }) {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId) notFound();
  const actor = await requireRequestContext(prisma, auth, incoming, area.organizationId);
  if (!actor) return denyPanel(prisma, auth, incoming, { area: "COMPANY_ADMIN", organizationId: area.organizationId });
  const snapshot = await getCompanySettings(prisma, actor.organizationId, "admin");
  if (!snapshot) notFound();
  const section = parseSection((await searchParams).sekcja);
  return (
    <PanelShell
      area="company"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title="Ustawienia"
      currentPath="/admin/ustawienia"
    >
      <div className={settingsStyles.layout}>
        <SettingsNav base="/admin/ustawienia" current={section} />
        <SettingsReadonly snapshot={snapshot as unknown as SettingsSnapshot} section={section} />
      </div>
    </PanelShell>
  );
}
