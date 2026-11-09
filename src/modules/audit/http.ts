import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { actor, response } from "@/modules/fleet/http";
import { reportInternalError } from "@/modules/observability/http-observe";
import { AuditReadInputError, auditReadActions, auditReadActorRoles, auditReadEntityTypes, decodeAuditCursor, isValidAuditInstant,
  readAuditPage } from "./read";

const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/)
  .refine(isValidAuditInstant).transform((value) => new Date(value));
const reference = z.string().min(1).max(128).regex(/^[A-Za-z0-9:._-]+$/);
// Allowlist of query keys; the company is never a filter, it comes from the host or the path.
const query = z.strictObject({
  limit: z.string().regex(/^\d{1,3}$/).transform(Number).pipe(z.number().int().min(1).max(100)).optional(),
  cursor: z.string().min(1).max(128).optional(),
  from: instant.optional(),
  to: instant.optional(),
  actorRole: z.enum(auditReadActorRoles).optional(),
  actorId: reference.optional(),
  action: z.string().refine((value) => auditReadActions.includes(value)).optional(),
  entityType: z.string().refine((value) => auditReadEntityTypes.includes(value)).optional(),
  entityId: reference.optional(),
});

function parse(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) throw new AuditReadInputError();
  const parsed = query.safeParse(Object.fromEntries(params));
  if (!parsed.success) throw new AuditReadInputError();
  const { limit, cursor, ...filters } = parsed.data;
  return { limit: limit ?? 50, cursor: cursor === undefined ? undefined : decodeAuditCursor(cursor), filters };
}

async function read(request: Request, area: "COMPANY_ADMIN" | "PLATFORM", organizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, organizationId, false, requestId);
    if (access.error) return access.error;
    const input = parse(request);
    return response(await readAuditPage(prisma, { actorId: access.context!.actorId,
      sessionId: access.context!.sessionId, organizationId: access.organizationId!, ...input }), 200, requestId);
  } catch (error) {
    if (error instanceof AuditReadInputError) return response({ code: "INVALID_INPUT" }, 400, requestId);
    const code = error instanceof Error ? error.message : "";
    if (code === "Audit actor is not authorized" || code === "Audit tenant mismatch")
      return response({ code: "FORBIDDEN" }, 403, requestId);
    return response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "audit"));
  }
}

/** Company admin: own company's audit only (ADM-17); the host decides the company. */
export function readAdminAudit(request: Request) {
  return read(request, "COMPANY_ADMIN");
}

/** Superadmin: audit of the company explicitly chosen in the path, archived companies included. */
export function readPlatformAudit(request: Request, organizationId: string) {
  return read(request, "PLATFORM", organizationId);
}
