import type { Metadata } from "next";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { publicOrigin } from "@/modules/public-offer/seo";
import { marketingMeta } from "./content";

/** Title, description and canonical of the marketing onepage; the canonical origin comes from the already resolved MARKETING host. */
export function marketingMetadata(authority: string | null): Metadata {
  const host = authority ? parseHostAuthority(authority) : null;
  const canonical = host ? `${publicOrigin(host.hostname, host.port)}/` : undefined;
  return {
    title: marketingMeta.title,
    description: marketingMeta.description,
    ...(canonical ? { alternates: { canonical }, openGraph: { title: marketingMeta.title, description: marketingMeta.description, url: canonical, type: "website", locale: "pl_PL" } } : {}),
    robots: { index: true, follow: true },
  };
}
