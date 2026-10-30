import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { resolveAuthHost } from "@/modules/auth/authorization";

import type { AuthArea } from "./auth-destination";

// Page-level host check: the route policy in the proxy is not authorization, so every
// server entry repeats it and answers 404 for another role's host.
export async function requireAreaHost(area: AuthArea) {
  const incoming = new Headers(await headers());
  const scope = await resolveAuthHost(prisma, incoming.get("host"));
  if (
    !scope ||
    (area === "company"
      ? scope.area !== "COMPANY_ADMIN" || !scope.organizationId
      : scope.area !== "PLATFORM" || scope.organizationId !== null)
  )
    notFound();
  return { incoming, scope };
}
