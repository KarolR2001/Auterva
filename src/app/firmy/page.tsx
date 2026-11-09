import { PanelShell } from "@/components/panel/panel-shell";
import { CompanyListView } from "@/components/platform/company-list";
import { requirePlatformPage } from "@/components/platform/platform-gate";

export const dynamic = "force-dynamic";

// Same gate as `/` and `/firmy/{id}/` (#14/#15): no session goes to the platform login, any other denial is a 404.
export default async function CompaniesPage() {
  const actor = await requirePlatformPage();
  return (
    <PanelShell area="platform" accessState="allowed" expectedSessionId={actor.sessionId} title="Firmy" currentPath="/firmy">
      <CompanyListView />
    </PanelShell>
  );
}
