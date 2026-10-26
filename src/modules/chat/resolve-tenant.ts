import type { PrismaClient } from "../../generated/prisma/client";
import type { auth } from "../../lib/auth";
import { requireAuthorizedActor } from "../auth/authorization";
import { resolveHostMapping } from "../tenancy/host-registry";

export async function resolveRealtimeTenant(db: PrismaClient, instance: typeof auth, headers: Headers, expectedHost: string) {
  if (headers.get("host") !== expectedHost) return null;
  const suppliedOrigin = headers.get("origin");
  let origin: URL;
  try {
    if (!suppliedOrigin) return null;
    origin = new URL(suppliedOrigin);
  } catch {
    return null;
  }
  if (origin.origin !== suppliedOrigin || !["http:", "https:"].includes(origin.protocol)
    || (process.env.NODE_ENV === "production" && origin.protocol !== "https:")) return null;
  const mapping = await resolveHostMapping(db, origin.host);
  if (mapping?.area !== "COMPANY_ADMIN" || !mapping.organizationId) return null;
  const actor = await requireAuthorizedActor(db, instance, headers, {
    area: "COMPANY_ADMIN", organizationId: mapping.organizationId,
  });
  return actor?.organizationId ?? null;
}
