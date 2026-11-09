import { PanelShell } from "@/components/panel/panel-shell";
import { NewCompanyForm } from "@/components/platform/new-company-form";
import { requirePlatformPage } from "@/components/platform/platform-gate";

export const dynamic = "force-dynamic";

export default async function NewCompanyPage() {
  const actor = await requirePlatformPage();
  return (
    <PanelShell
      area="platform"
      accessState="allowed"
      expectedSessionId={actor.sessionId}
      title="Dodaj firmę"
      currentPath="/firmy"
    >
      <NewCompanyForm
        adminBaseDomain={process.env.AUTERVA_ADMIN_BASE_DOMAIN ?? null}
        publicBaseDomain={process.env.AUTERVA_PUBLIC_BASE_DOMAIN ?? null}
      />
    </PanelShell>
  );
}
