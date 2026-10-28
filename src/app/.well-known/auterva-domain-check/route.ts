import { prisma } from "@/lib/prisma";
import { routeContext } from "@/modules/observability/route-context";
import { routingProof } from "@/modules/domains/proof";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";

export const dynamic = "force-dynamic";

const neutral = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

/** Routing probe for custom hosts: returns only a hash bound to this host and its challenge token. */
export const GET = routeContext(async (request: Request) => {
  const parsed = parseHostAuthority(request.headers.get("host") ?? "");
  if (!parsed) return neutral();
  const domain = await prisma.customDomain.findFirst({ where: { hostMapping: { kind: "CUSTOM",
    hostname: { equals: parsed.hostname, mode: "insensitive" } } },
    select: { verificationToken: true, hostMapping: { select: { hostname: true } } } });
  if (!domain || domain.hostMapping.hostname.toLowerCase() !== parsed.hostname) return neutral();
  return Response.json({ proof: routingProof(parsed.hostname, domain.verificationToken) },
    { headers: { "Cache-Control": "no-store" } });
});
