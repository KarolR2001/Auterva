import { routeContext } from "@/modules/observability/route-context";
import { prisma } from "@/lib/prisma";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { takeRateLimit } from "@/modules/auth/rate-limit";
import { activateCompanyInvitation } from "@/modules/invitations/activate";
import { inspectCompanyInvitation } from "@/modules/invitations/issue";
import { onboardingRequestId, onboardingResponse } from "@/modules/organizations/http";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { MAX_AUTH_BODY_BYTES, readJsonBody } from "@/modules/tenancy/json-body";
import { resolveRequestArea } from "@/modules/tenancy/request-context";
import { reportInternalError } from "@/modules/observability/http-observe";

const bodySchema = z.object({ password: z.string().min(12).max(256) }).strict();

function sameOrigin(request: Request, authority: string): boolean {
  const host = parseHostAuthority(authority);
  const raw = request.headers.get("origin");
  if (!host || !raw) return false;
  try {
    const origin = new URL(raw);
    const supplied = parseHostAuthority(origin.host);
    return origin.origin === raw && origin.protocol === new URL(request.url).protocol
      && supplied?.hostname === host.hostname && supplied.port === host.port;
  } catch { return false; }
}

async function handleGET(request: Request, context: { params: Promise<{ token: string }> }) {
  const requestId = onboardingRequestId();
  const respond = (body: object, status: number, retryAfter?: number) => {
    const response = onboardingResponse(body, status, requestId, retryAfter);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  const authority = request.headers.get("host");
  const area = await resolveRequestArea(prisma, authority);
  const host = authority && parseHostAuthority(authority);
  if (area?.area !== "COMPANY_ADMIN" || !host || !area.organizationId)
    return respond({ code: "NOT_FOUND" }, 404);
  try {
    let sourceIp: string;
    try { sourceIp = trustedClientAddress(currentTrustedClientAddress()); }
    catch { return respond({ code: "INGRESS_NOT_CONFIGURED" }, 503); }
    // #57: the token inspection is anonymous and touches the database; a mail scanner opens a link a few times,
    // a script does not. One budget per source address, separate from the activation budget.
    const limit = await takeRateLimit(prisma, [{ key: `inspect:ip:${sourceIp}`, limit: 60, windowMs: 60_000 }]);
    if (!limit.allowed) return respond({ code: "RATE_LIMITED" }, 429, limit.retryAfter);
    const { token } = await context.params;
    const invitation = await inspectCompanyInvitation(prisma, { token, hostname: host.hostname, now: new Date() });
    return respond(invitation?.organizationId === area.organizationId
      ? invitation : { code: "NOT_FOUND" }, invitation?.organizationId === area.organizationId ? 200 : 404);
  } catch (error) {
    reportInternalError(error, requestId, "invitation");
    return respond({ code: "INTERNAL_ERROR" }, 500);
  }
}

async function handlePOST(request: Request, context: { params: Promise<{ token: string }> }) {
  const requestId = randomUUID();
  const respond = (body: object, status: number, retryAfter?: number) => {
    const response = onboardingResponse(body, status, requestId, retryAfter);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  try {
    const authority = request.headers.get("host");
    const area = await resolveRequestArea(prisma, authority);
    const host = authority && parseHostAuthority(authority);
    if (area?.area !== "COMPANY_ADMIN" || !host || !area.organizationId) return respond({ code: "NOT_FOUND" }, 404);
    if (!sameOrigin(request, authority!)) return respond({ code: "FORBIDDEN" }, 403);
    let sourceIp: string;
    try { sourceIp = trustedClientAddress(currentTrustedClientAddress()); }
    catch { return respond({ code: "INGRESS_NOT_CONFIGURED" }, 503); }
    const { token } = await context.params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return respond({ code: "NOT_FOUND" }, 404);
    const tokenKey = createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(token).digest("hex");
    const limit = await takeRateLimit(prisma, [
      { key: `activate:token:${tokenKey}`, limit: 5, windowMs: 15 * 60_000 },
      { key: `activate:ip:${sourceIp}`, limit: 20, windowMs: 15 * 60_000 },
    ]);
    if (!limit.allowed) return respond({ code: "RATE_LIMITED" }, 429, limit.retryAfter);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))
      return respond({ code: "INVALID_REQUEST" }, 400);
    const body = (await readJsonBody(request, MAX_AUTH_BODY_BYTES)) ?? null;
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return respond({ code: "INVALID_REQUEST" }, 400);
    const activated = await activateCompanyInvitation(prisma, { token, hostname: host.hostname,
      password: parsed.data.password, requestId });
    return activated?.organizationId === area.organizationId
      ? respond(activated, 200) : respond({ code: "NOT_FOUND" }, 404);
  } catch (error) {
    reportInternalError(error, requestId, "invitation");
    return respond({ code: "INTERNAL_ERROR" }, 500);
  }
}

export const GET = routeContext(handleGET);
export const POST = routeContext(handlePOST);
