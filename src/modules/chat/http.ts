import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { actor, body, only, response, uuid } from "@/modules/fleet/http";
import { takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { resolveRequestArea } from "@/modules/tenancy/request-context";
import { ChatError } from "./errors";
import { findConversation, listMessages, listPlatformConversations, openConversation, sendMessage,
  type ChatScope } from "./service";
import { reportInternalError } from "@/modules/observability/http-observe";

type Area = "COMPANY_ADMIN" | "PLATFORM";
const MAX_BODY_BYTES = 65_536;

/** Codes only: no message text, cursor, session or SQL ever reaches the response or the logs. */
function failure(error: unknown, requestId: string) {
  if (error instanceof ChatError) {
    switch (error.code) {
      case "CHAT_INVALID_INPUT": return response({ code: "INVALID_INPUT" }, 400, requestId);
      case "CHAT_INVALID_CURSOR": return response({ code: "INVALID_CURSOR" }, 400, requestId);
      case "CHAT_NOT_FOUND": return response({ code: "NOT_FOUND" }, 404, requestId);
      case "CHAT_FORBIDDEN": return response({ code: "FORBIDDEN" }, 403, requestId);
      case "CHAT_INVALID_MESSAGE":
        return response({ code: "INVALID_MESSAGE", message: "Wiadomość jest pusta albo zawiera niedozwolone znaki." }, 400, requestId);
      case "MESSAGE_TOO_LONG":
        return response({ code: "MESSAGE_TOO_LONG", message: "Wiadomość może mieć najwyżej 4 000 znaków." }, 422, requestId);
      case "CLIENT_MESSAGE_ID_CONFLICT": return response({ code: "CLIENT_MESSAGE_ID_CONFLICT" }, 409, requestId);
      case "CHAT_ORGANIZATION_ARCHIVED": return response({ code: "CHAT_ORGANIZATION_ARCHIVED" }, 409, requestId);
      case "RATE_LIMITED": return response({ code: "RATE_LIMITED" }, 429, requestId, error.retryAfter ?? 1);
    }
  }
  return response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "chat"));
}

async function access(request: Request, area: Area, target: string | undefined, mutation: boolean, requestId: string) {
  const result = await actor(request, area, target, mutation, requestId);
  if (result.error) return { error: result.error };
  const scope: ChatScope = { actorId: result.context!.actorId, sessionId: result.context!.sessionId,
    organizationId: result.organizationId! };
  return { scope };
}

function query(request: Request, allowed: string[]): URLSearchParams | null {
  const params = new URL(request.url).searchParams;
  const keys = [...params.keys()];
  return keys.every((key) => allowed.includes(key)) && keys.length === new Set(keys).size ? params : null;
}

function pageSize(raw: string | null): number | undefined | null {
  if (raw === null) return undefined;
  return /^[1-9]\d{0,2}$/.test(raw) ? Number(raw) : null;
}

/** GET never creates anything: it reports the existing `conversationId` or null. */
export async function getConversation(request: Request, area: Area, target?: string) {
  const requestId = randomUUID();
  try {
    const result = await access(request, area, target, false, requestId);
    if (result.error) return result.error;
    if (!query(request, [])) return response({ code: "INVALID_INPUT" }, 400, requestId);
    return response(await findConversation(prisma, result.scope), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

/** Idempotent open/create for exactly the host's company (admin) or the addressed company (superadmin). */
export async function postConversation(request: Request, area: Area, target?: string) {
  const requestId = randomUUID();
  try {
    const result = await access(request, area, target, true, requestId);
    if (result.error) return result.error;
    const opened = await openConversation(prisma, result.scope);
    return response(opened, opened.created ? 201 : 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function getMessages(request: Request, area: Area, target?: string) {
  const requestId = randomUUID();
  try {
    const result = await access(request, area, target, false, requestId);
    if (result.error) return result.error;
    const params = query(request, ["limit", "before", "after", "conversationId"]);
    const limit = params ? pageSize(params.get("limit")) : null;
    if (!params || limit === null) return response({ code: "INVALID_INPUT" }, 400, requestId);
    return response(await listMessages(prisma, result.scope, { limit,
      before: params.get("before") ?? undefined, after: params.get("after") ?? undefined,
      conversationId: params.get("conversationId") ?? undefined }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function postMessage(request: Request, area: Area, target?: string) {
  const requestId = randomUUID();
  try {
    const result = await access(request, area, target, true, requestId);
    if (result.error) return result.error;
    if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) {
      return response({ code: "MESSAGE_TOO_LONG" }, 422, requestId);
    }
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["clientMessageId", "body", "conversationId"])
      || typeof parsed.clientMessageId !== "string" || !uuid.test(parsed.clientMessageId)
      || typeof parsed.body !== "string"
      || !(parsed.conversationId === undefined || (typeof parsed.conversationId === "string" && uuid.test(parsed.conversationId)))) {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    const sent = await sendMessage(prisma, result.scope, { clientMessageId: parsed.clientMessageId,
      body: parsed.body, conversationId: parsed.conversationId });
    return response({ message: sent.message, conversationId: sent.conversationId, deduplicated: sent.deduplicated },
      sent.deduplicated ? 200 : 201, requestId);
  } catch (error) { return failure(error, requestId); }
}

/** Superadmin inbox: the platform host, a real SUPERADMIN session with MFA, no company in the path. */
export async function getPlatformConversations(request: Request) {
  const requestId = randomUUID();
  try {
    const area = await resolveRequestArea(prisma, request.headers.get("host"));
    if (area?.area !== "PLATFORM" || area.organizationId !== null) return response({ code: "NOT_FOUND" }, 404, requestId);
    const session = await requireAuthorizedActor(prisma, auth, request.headers, { area: "PLATFORM", organizationId: null });
    if (!session || session.role !== "SUPERADMIN_AUTERVA" || session.organizationId !== null) {
      return response({ code: "FORBIDDEN" }, 403, requestId);
    }
    const limitResult = await takeAuthenticatedApiLimit(prisma, { actorId: session.userId, organizationId: null }, "read");
    if (!limitResult.allowed) return response({ code: "RATE_LIMITED" }, 429, requestId, limitResult.retryAfter);
    const params = query(request, ["limit", "cursor", "includeArchived"]);
    const limit = params ? pageSize(params.get("limit")) : null;
    const archived = params?.get("includeArchived") ?? null;
    if (!params || limit === null || !(archived === null || archived === "true" || archived === "false")) {
      return response({ code: "INVALID_INPUT" }, 400, requestId);
    }
    return response(await listPlatformConversations(prisma, { actorId: session.userId, sessionId: session.sessionId },
      { limit, cursor: params.get("cursor") ?? undefined, includeArchived: archived === "true" }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}
