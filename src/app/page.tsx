import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PanelShell } from "@/components/panel/panel-shell";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area === "MARKETING")
    return (
      <main>
        <h1>Auterva</h1>
      </main>
    );
  if (area?.area === "PLATFORM" && area.organizationId === null) {
    const actor = await requireAuthorizedActor(prisma, auth, incoming, {
      area: "PLATFORM",
      organizationId: null,
    });
    if (actor)
      return (
        <PanelShell
          area="platform"
          accessState="allowed"
          expectedSessionId={actor.sessionId}
          title="Firmy"
          currentPath="/"
        >
          <p>Panel jest w przygotowaniu.</p>
        </PanelShell>
      );
  }
  // A host mapping alone cannot publish content; the public visibility use case follows separately.
  notFound();
}
