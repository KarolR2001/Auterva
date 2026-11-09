import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LegalPage } from "@/components/public/legal-page";
import { loadLegal } from "@/modules/public-offer/contact-data";
import { loadHome, requestHost } from "@/modules/public-offer/page-data";
import { toNextMetadata } from "@/modules/public-offer/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const host = await requestHost();
  if (!host) return {};
  const legal = await loadLegal(host, "privacy");
  return legal ? toNextMetadata(legal.seo) : { robots: { index: false, follow: false } };
}

export default async function Page() {
  const host = await requestHost();
  if (!host) notFound();
  const legal = await loadLegal(host, "privacy");
  const home = legal ? await loadHome(host) : null;
  if (!legal || !home) notFound();
  return <LegalPage legal={legal} brand={{ name: home.company.name, logo: home.company.logo }} contact={home.contact} />;
}
