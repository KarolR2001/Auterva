import { headers } from "next/headers";

import { PanelFeedback } from "@/components/panel/panel-states";
import { PanelShell } from "@/components/panel/panel-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import {
  requireRequestContext,
  resolveRequestArea,
} from "@/modules/tenancy/request-context";

// #57: Next's built-in 404 page ships an inline <style> without a nonce, which the document CSP blocks.
// This neutral page uses no inline style and names no host, company or reason (TEST-MVP-10).
// #14 (ADM-20): only a session that the panel itself would serve (same host, role, company, MFA proof) sees the
// panel 404 inside the shell, with a way back to the start. Everyone else keeps the neutral page, so the answer
// reveals nothing about hosts, accounts or routes.
function Neutral() {
  return (
    <main>
      <h1>Nie znaleziono strony</h1>
    </main>
  );
}

async function panelNotFound() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area === "COMPANY_ADMIN" && area.organizationId) {
    const actor = await requireRequestContext(
      prisma,
      auth,
      incoming,
      area.organizationId,
    );
    if (!actor) return null;
    const organization = await prisma.organization.findUnique({
      where: { id: actor.organizationId },
      select: { name: true },
    });
    if (!organization) return null;
    return (
      <PanelShell
        area="company"
        accessState="allowed"
        expectedSessionId={actor.sessionId}
        title={organization.name ?? "Panel firmy"}
        currentPath="/admin/404"
      >
        <PanelFeedback kind="not-found" dashboardHref="/admin" headingLevel="h2" />
      </PanelShell>
    );
  }
  if (area?.area === "PLATFORM" && area.organizationId === null) {
    const actor = await requireAuthorizedActor(prisma, auth, incoming, {
      area: "PLATFORM",
      organizationId: null,
    });
    if (!actor) return null;
    return (
      <PanelShell
        area="platform"
        accessState="allowed"
        expectedSessionId={actor.sessionId}
        title="Firmy"
        currentPath="/404"
      >
        <PanelFeedback kind="not-found" dashboardHref="/" headingLevel="h2" />
      </PanelShell>
    );
  }
  return null;
}

export default async function NotFound() {
  const panel = await panelNotFound().catch(() => null);
  return panel ?? <Neutral />;
}
