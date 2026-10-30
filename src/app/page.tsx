import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { MarketingPage } from "@/components/marketing/marketing-page";
import { auth } from "@/lib/auth";
import { marketingContact } from "@/modules/marketing/content";
import { marketingMetadata } from "@/modules/marketing/metadata";
import { prisma } from "@/lib/prisma";
import { PanelShell } from "@/components/panel/panel-shell";
import { CompanyListView } from "@/components/platform/company-list";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolvePublicVisibility } from "@/modules/service-period/public";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host");
  return (await resolveRequestArea(prisma, host))?.area === "MARKETING"
    ? marketingMetadata(host)
    : {};
}

export default async function HomePage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area === "MARKETING")
    return <MarketingPage contact={marketingContact} />;
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
          <CompanyListView />
        </PanelShell>
      );
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
