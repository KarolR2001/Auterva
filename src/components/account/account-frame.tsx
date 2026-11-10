import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { renderCompanyPanel } from "@/app/admin/company-panel";

import type { AuthArea } from "../auth/auth-destination";
import { PanelShell } from "../panel/panel-shell";

type Actor = { userId: string; sessionId: string; organizationId: string | null };

// PLT-10 and ADM-15 live inside the panel shell. The caller has already authorized the actor (host, role, full MFA
// session); an expired service period does not close the account, the company frame shows its own notice.
export async function renderAccountFrame(
  area: AuthArea,
  actor: Actor,
  currentPath: string,
  children: ReactNode,
) {
  if (area === "company") {
    if (!actor.organizationId) notFound();
    return renderCompanyPanel(
      { actorId: actor.userId, sessionId: actor.sessionId, organizationId: actor.organizationId },
      { currentPath, title: "Konto", children },
    );
  }
  return (
    <PanelShell area="platform" accessState="allowed" expectedSessionId={actor.sessionId}
      title="Konto superadmina" currentPath={currentPath}>
      {children}
    </PanelShell>
  );
}
