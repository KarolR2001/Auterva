import { randomUUID } from "node:crypto";
import { MAX_VITAL_BODY_BYTES, parseVitalPayload } from "@/lib/web-vitals";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { readJsonObject } from "@/modules/tenancy/json-body";
import { withErrorRequestId } from "@/modules/tenancy/request-id";
import { reportInternalError } from "./http-observe";
import { countVitalsRefusal, recordVitals } from "./web-vitals";

// Pages send one report per page view (when it is hidden). Per address budget, in memory only: nothing about the
// sender is written to the database or the logs, and a restart simply forgets it.
export const VITALS_LIMIT = { limit: 30, windowMs: 60_000 } as const;
const maxTrackedAddresses = 5000;
const windows = new Map<string, { start: number; count: number }>();

export function takeVitalsBudget(address: string, now = Date.now()): { allowed: true } | { allowed: false; retryAfter: number } {
  const current = windows.get(address);
  if (!current || now - current.start >= VITALS_LIMIT.windowMs) {
    if (!current && windows.size >= maxTrackedAddresses) {
      for (const [key, value] of windows) if (now - value.start >= VITALS_LIMIT.windowMs) windows.delete(key);
      if (windows.size >= maxTrackedAddresses) return { allowed: false, retryAfter: Math.ceil(VITALS_LIMIT.windowMs / 1000) };
    }
    windows.set(address, { start: now, count: 1 });
    return { allowed: true };
  }
  if (current.count >= VITALS_LIMIT.limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.start + VITALS_LIMIT.windowMs - now) / 1000)) };
  current.count += 1;
  return { allowed: true };
}
export const resetVitalsBudget = () => windows.clear();

const base = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" };
const reply = (status: number, requestId: ReturnType<typeof randomUUID>, body?: object, extra: Record<string, string> = {}) =>
  withErrorRequestId(body ? Response.json(body, { status, headers: { ...base, ...extra } }) : new Response(null, { status, headers: { ...base, ...extra } }), requestId);

/** A browser sends Origin on POST; a value that is not this host is a cross-site write and is refused. */
function sameHost(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  if (origin === null) return true;
  try {
    const supplied = parseHostAuthority(new URL(origin).host);
    const actual = parseHostAuthority(request.headers.get("host") ?? "");
    return !!supplied && !!actual && supplied.hostname === actual.hostname && supplied.port === actual.port;
  } catch { return false; }
}

export async function postVitals(request: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    if (!sameHost(request)) { countVitalsRefusal("forbidden"); return reply(403, requestId, { code: "FORBIDDEN" }); }
    let address: string;
    try { address = trustedClientAddress(currentTrustedClientAddress()); }
    catch { return reply(503, requestId, { code: "TRUSTED_INGRESS_REQUIRED" }); }
    const budget = takeVitalsBudget(address);
    if (!budget.allowed) { countVitalsRefusal("rate_limited"); return reply(429, requestId, { code: "RATE_LIMITED" }, { "Retry-After": String(budget.retryAfter) }); }
    const payload = parseVitalPayload(await readJsonObject(request, MAX_VITAL_BODY_BYTES));
    if (!payload) { countVitalsRefusal("invalid"); return reply(400, requestId, { code: "INVALID_INPUT" }); }
    recordVitals(payload);
    return reply(204, requestId);
  } catch (error) {
    return reply(500, reportInternalError(error, requestId, "web-vitals"), { code: "INTERNAL_ERROR" });
  }
}
