import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalPage } from "@/components/public/legal-page";
import { documentAvailable } from "@/modules/public-offer/contact-presentation";
import { loadLegal } from "@/modules/public-offer/contact-data";
import { loadHome, requestHost } from "@/modules/public-offer/page-data";
import { toNextMetadata } from "@/modules/public-offer/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const host = await requestHost();
  if (!host) return {};
  const legal = await loadLegal(host, "terms");
  return legal && documentAvailable(legal) ? toNextMetadata(legal.seo) : { robots: { index: false, follow: false } };
}

export default async function Page() {
  const host = await requestHost();
  if (!host) notFound();
  const legal = await loadLegal(host, "terms");
  // Terms are optional (FR-PUB-042): without a text or link the screen does not exist (PUB-07).
  if (!legal || !documentAvailable(legal)) notFound();
  const home = await loadHome(host);
  if (!home) notFound();
  return <LegalPage legal={legal} brand={{ name: home.company.name, logo: home.company.logo }} contact={home.contact} />;
}
