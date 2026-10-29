import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PanelShell } from "@/components/panel/panel-shell";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolvePublicVisibility } from "@/modules/service-period/public";
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
    redirect("/login");
  }
  if (
    area?.area === "COMPANY_PUBLIC" &&
    incoming.get("host") &&
    (await resolvePublicVisibility(prisma, incoming.get("host")!))
  ) {
    return (
      <main>
        <h1>Oferta firmy</h1>
        <p>Oferta jest w przygotowaniu.</p>
      </main>
    );
  }
  notFound();
}
