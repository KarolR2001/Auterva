import { PublicPage } from "@/components/public/public-chrome";
import { NotFoundBlock, SiteUnavailable, UnknownHost } from "@/components/public/state-page";
import { prisma } from "@/lib/prisma";
import { loadHome, requestHost } from "@/modules/public-offer/page-data";
import { resolveHostMapping } from "@/modules/tenancy/host-registry";

// #57: Next's built-in 404 page ships an inline <style> without a nonce, which the document CSP blocks. This page
// uses no inline style. It never names a company or a reason for a disabled site (TEST-MVP-10, C-N057): the
// brand and contact appear only when the central gate lets the offer through (PUB-07); a public host that
// the gate refuses gets the neutral PUB-09, an unmapped address PUB-10 and every other area the plain page.
export default async function NotFound() {
  const host = await requestHost();
  const home = host ? await loadHome(host) : null;
  if (home) {
    return <PublicPage brand={{ name: home.company.name, logo: home.company.logo }} contact={home.contact}><NotFoundBlock /></PublicPage>;
  }
  const mapping = host ? await resolveHostMapping(prisma, host) : null;
  // The public states belong to the public site only. A panel, the platform or the marketing host keeps the plain
  // neutral page: "no active company site" would mislead there.
  if (mapping && mapping.area !== "COMPANY_PUBLIC") return <main><h1>Nie znaleziono strony</h1></main>;
  return <main>{mapping ? <SiteUnavailable /> : <UnknownHost />}</main>;
}
