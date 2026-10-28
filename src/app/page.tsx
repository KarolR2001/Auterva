import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PublicHome } from "@/components/public/public-home";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { loadHome, requestHost, todayWarsaw } from "@/modules/public-offer/page-data";
import { toNextMetadata } from "@/modules/public-offer/seo";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const host = await requestHost();
  const area = host ? await resolveRequestArea(prisma, host) : null;
  if (area?.area !== "COMPANY_PUBLIC" || !host) return {};
  const home = await loadHome(host);
  return home ? toNextMetadata(home.seo) : { robots: { index: false, follow: false } };
}

export default async function HomePage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area === "MARKETING") return <main><h1>Auterva</h1></main>;
  if (area?.area === "PLATFORM" && area.organizationId === null
    && await requireAuthorizedActor(prisma, auth, incoming, { area: "PLATFORM", organizationId: null })) {
    return <main><h1>Platforma Auterva</h1><p>Panel jest w przygotowaniu.</p></main>;
  }
  if (area?.area === "COMPANY_PUBLIC" && incoming.get("host")) {
    // The central gate runs inside the read on every request; a disabled company is the same 404 as an unknown host.
    const home = await loadHome(incoming.get("host")!);
    if (home) return <PublicHome home={home} today={todayWarsaw()} />;
  }
  notFound();
}
