import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { denyPanel } from "@/components/panel/deny-panel";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { resolveRequestArea } from "@/modules/tenancy/request-context";

// Server gate of the platform pages: host, role, account state and MFA proof are checked on every request.
// The superadmin acts as themselves; a company context never borrows another actor.
export async function requirePlatformPage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "PLATFORM" || area.organizationId !== null) notFound();
  const scope = { area: "PLATFORM", organizationId: null } as const;
  const actor = await requireAuthorizedActor(prisma, auth, incoming, scope);
  if (!actor) return denyPanel(prisma, auth, incoming, scope);
  return actor;
}
