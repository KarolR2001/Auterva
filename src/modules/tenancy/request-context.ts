import type { PrismaClient } from "../../generated/prisma/client";
import type { auth } from "../../lib/auth";
import { requireAuthorizedActor } from "../auth/authorization";
import { currentLogContext } from "../observability/log";
import { resolveHostMapping } from "./host-registry";

export type RequestArea = {
  area: "MARKETING" | "PLATFORM" | "COMPANY_ADMIN" | "COMPANY_PUBLIC";
  organizationId: string | null;
};

export type ActorContext = {
  actorId: string;
  role: "SUPERADMIN_AUTERVA" | "ADMIN_FIRMY";
  organizationId: string;
  sessionId: string;
};

export async function resolveRequestArea(db: PrismaClient, authority: string | null): Promise<RequestArea | null> {
  if (!authority) return null;
  const mapping = await resolveHostMapping(db, authority);
  return mapping ? { area: mapping.area, organizationId: mapping.organizationId } : null;
}

type Actor = { userId: string; role: string; organizationId: string | null; sessionId: string };

export async function selectActorOrganization(
  db: PrismaClient,
  area: RequestArea,
  actor: Actor,
  targetOrganizationId: string | null,
): Promise<ActorContext | null> {
  if (area.area === "COMPANY_ADMIN") {
    if (actor.role !== "ADMIN_FIRMY" || !area.organizationId || actor.organizationId !== area.organizationId
      || targetOrganizationId !== area.organizationId) return null;
    return { actorId: actor.userId, role: "ADMIN_FIRMY", organizationId: area.organizationId, sessionId: actor.sessionId };
  }
  if (area.area !== "PLATFORM" || actor.role !== "SUPERADMIN_AUTERVA" || actor.organizationId !== null || !targetOrganizationId) return null;
  const company = await db.organization.findUnique({ where: { id: targetOrganizationId }, select: { id: true } });
  if (company) currentLogContext().organizationId = company.id; // superadmin acting in this company's context (#58)
  return company ? { actorId: actor.userId, role: "SUPERADMIN_AUTERVA", organizationId: company.id, sessionId: actor.sessionId } : null;
}

// A domain use case takes this context, never a tenant id supplied by a caller.
// The host and the session are rechecked here even if Proxy already routed the page.
export async function requireRequestContext(
  db: PrismaClient,
  instance: typeof auth,
  headers: Headers,
  targetOrganizationId: string,
): Promise<ActorContext | null> {
  const area = await resolveRequestArea(db, headers.get("host"));
  if (!area || (area.area !== "PLATFORM" && area.area !== "COMPANY_ADMIN")) return null;
  const actor = await requireAuthorizedActor(db, instance, headers, { area: area.area, organizationId: area.organizationId });
  return actor ? selectActorOrganization(db, area, actor, targetOrganizationId) : null;
}
