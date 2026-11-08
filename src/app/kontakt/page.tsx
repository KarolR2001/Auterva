import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ContactPage } from "@/components/public/contact-page";
import { loadContact, loadLegal } from "@/modules/public-offer/contact-data";
import { contactContext, documentAvailable } from "@/modules/public-offer/contact-presentation";
import { loadHome, requestHost } from "@/modules/public-offer/page-data";
import { toNextMetadata } from "@/modules/public-offer/seo";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const host = await requestHost();
  if (!host) return {};
  const { vehicle, from, to } = contactContext(await searchParams);
  const contact = await loadContact(host, vehicle, from, to);
  // The page with a chosen vehicle or dates is a variant of /kontakt/: its canonical is the bare address (seo.canonical).
  return contact ? toNextMetadata(contact.seo) : { robots: { index: false, follow: false } };
}

export default async function Page({ searchParams }: Props) {
  const host = await requestHost();
  if (!host) notFound();
  const { vehicle, from, to } = contactContext(await searchParams);
  // The central gate runs inside each read: a disabled company is the same 404 as an unknown address (C-N057).
  const contact = await loadContact(host, vehicle, from, to);
  const home = contact ? await loadHome(host) : null;
  if (!contact || !home) notFound();
  const termsAvailable = documentAvailable(await loadLegal(host, "terms"));
  return <ContactPage contact={contact} termsAvailable={termsAvailable} brand={{ name: home.company.name, logo: home.company.logo }} header={home.contact} />;
}
