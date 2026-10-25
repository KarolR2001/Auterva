import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area === "MARKETING") return <main><h1>Auterva</h1></main>;
  if (area?.area === "PLATFORM" && area.organizationId === null
    && await requireAuthorizedActor(prisma, auth, incoming, { area: "PLATFORM", organizationId: null })) {
    return <main><h1>Platforma Auterva</h1><p>Panel jest w przygotowaniu.</p></main>;
  }
  // A host mapping alone cannot publish content; the public visibility use case follows separately.
  notFound();
}
