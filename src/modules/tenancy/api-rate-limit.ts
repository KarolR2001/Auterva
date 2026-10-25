import type { PrismaClient } from "../../generated/prisma/client";
import { takeRateLimit, type LimitResult } from "../auth/rate-limit";

export type RateLimitedActor = { actorId: string; organizationId: string | null };

export async function takeAuthenticatedApiLimit(
  db: PrismaClient,
  actor: RateLimitedActor,
  operation: "read" | "write",
  now = new Date(),
): Promise<LimitResult> {
  const scope = actor.organizationId ?? "platform";
  return takeRateLimit(db, [{
    key: `api:${operation}:${actor.actorId}:${scope}`,
    limit: operation === "read" ? 120 : 60,
    windowMs: 60_000,
  }], now);
}

export function apiRateLimitResponse(retryAfter: number): Response {
  return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: {
    "Retry-After": String(retryAfter), "Cache-Control": "no-store",
  } });
}
