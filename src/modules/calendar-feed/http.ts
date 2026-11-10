import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { InvalidCharactersError } from "@/lib/text-policy";
import { actor, body, only, response, uuid } from "@/modules/fleet/http";
import { reportInternalError, transientDbResponse } from "@/modules/observability/http-observe";
import { createFeedToken, feedPath, listFeedTokens, revokeFeedToken, rotateFeedToken } from "./tokens";

type Area = "COMPANY_ADMIN" | "PLATFORM";

function failure(error: unknown, requestId: string) {
  if (error instanceof InvalidCharactersError) return response({ code: "INVALID_INPUT", fieldErrors: error.fieldErrors }, 400, requestId);
  const code = error instanceof Error ? error.message : "";
  if (code === "FEED_INVALID_INPUT") return response({ code: "INVALID_INPUT" }, 400, requestId);
  if (code === "FEED_NOT_FOUND") return response({ code: "NOT_FOUND" }, 404, requestId);
  if (code === "FEED_LIMIT_REACHED") return response({ code, message: "Osiągnięto limit aktywnych linków kalendarza." }, 409, requestId);
  if (code === "FEED_FORBIDDEN" || code === "Audit actor is not authorized") return response({ code: "FORBIDDEN" }, 403, requestId);
  const busy = transientDbResponse(error, requestId, "calendar-feed.manage");
  if (busy) return busy;
  return response({ code: "INTERNAL_ERROR" }, 500, reportInternalError(error, requestId, "calendar-feed.manage"));
}

function operation(access: Awaited<ReturnType<typeof actor>>, requestId: string) {
  return { actorId: access.context!.actorId, sessionId: access.context!.sessionId,
    organizationId: access.organizationId!, requestId };
}

/** The secret and the URL appear only in this one response; they are not stored and cannot be read again. */
function withSecret(request: Request, issued: { secret: string } & Record<string, unknown>) {
  const { secret, ...rest } = issued;
  const path = feedPath(secret);
  const url = new URL(request.url);
  const host = request.headers.get("host") ?? url.host;
  return { ...rest, token: secret, path, url: `${url.protocol}//${host}${path}` };
}

export async function listFeeds(request: Request, area: Area, targetOrganizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, targetOrganizationId, false, requestId);
    if (access.error) return access.error;
    return response(await listFeedTokens(prisma, access.organizationId!), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function addFeed(request: Request, area: Area, targetOrganizationId?: string) {
  const requestId = randomUUID();
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const parsed = await body(request);
    if (!parsed || !only(parsed, ["label"])) return response({ code: "INVALID_INPUT" }, 400, requestId);
    const issued = await createFeedToken(prisma, { ...operation(access, requestId), label: parsed.label });
    return response(withSecret(request, issued), 201, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function rotateFeed(request: Request, area: Area, tokenId: string, targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(tokenId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    const issued = await rotateFeedToken(prisma, { ...operation(access, requestId), tokenId });
    return response(withSecret(request, issued), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}

export async function removeFeed(request: Request, area: Area, tokenId: string, targetOrganizationId?: string) {
  const requestId = randomUUID();
  if (!uuid.test(tokenId)) return response({ code: "INVALID_ID" }, 400, requestId);
  try {
    const access = await actor(request, area, targetOrganizationId, true, requestId);
    if (access.error) return access.error;
    return response(await revokeFeedToken(prisma, { ...operation(access, requestId), tokenId }), 200, requestId);
  } catch (error) { return failure(error, requestId); }
}
