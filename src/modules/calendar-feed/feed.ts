import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env";
import type { PrismaClient } from "@/generated/prisma/client";
import { addLocalDays, availabilityToday, localDate, sqlDate } from "@/modules/availability/dates";
import { FEED_TOKEN_PATTERN, hashFeedToken } from "./tokens";
import { renderFeed, unavailableRanges, type FeedVehicle } from "./ics";

export const FEED_WINDOW_DAYS = 365;
const LAST_USED_GRANULARITY_MS = 3_600_000;

export type FeedAccess = { tokenId: string; organizationId: string; scope: "FLEET" | "VEHICLES" };

/**
 * Resolves the secret to a live token, or null for every refusal (unknown, malformed, revoked, expired, creator no
 * longer an active administrator of the company, archived company). The reason is never distinguishable. An expired
 * service period is deliberately NOT a refusal (E13): the panel keeps working and so does its feed.
 */
export async function resolveFeedToken(db: PrismaClient, secret: string, now: Date): Promise<FeedAccess | null> {
  if (!FEED_TOKEN_PATTERN.test(secret)) return null;
  const hash = hashFeedToken(secret);
  const row = await db.calendarFeedToken.findUnique({ where: { tokenHash: hash }, select: { id: true, tokenHash: true,
    organizationId: true, expiresAt: true, revokedAt: true, scope: true,
    createdBy: { select: { role: true, organizationId: true, disabledAt: true, emailVerified: true } },
    organization: { select: { archivedAt: true } } } });
  if (!row || row.tokenHash.length !== hash.length
    || !timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(hash))) return null;
  const creator = row.createdBy;
  if (row.revokedAt || row.expiresAt <= now || row.organization.archivedAt || creator.role !== "ADMIN_FIRMY"
    || creator.organizationId !== row.organizationId || creator.disabledAt || !creator.emailVerified) return null;
  return { tokenId: row.id, organizationId: row.organizationId, scope: row.scope === "VEHICLES" ? "VEHICLES" : "FLEET" };
}

/** Records the last use at most once an hour (no IP address, no per-request write). */
export async function touchFeedToken(db: PrismaClient, tokenId: string, now: Date) {
  await db.calendarFeedToken.updateMany({ where: { id: tokenId, OR: [{ lastUsedAt: null },
    { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_GRANULARITY_MS) } }] }, data: { lastUsedAt: now } });
}

/**
 * Published vehicles of the company only (D-47: draft, unpublished and archived are excluded; vehicles without any activity period are skipped), read
 * from one RepeatableRead snapshot at request time: nothing is cached. Only dates leave the database for blocks:
 * type, reference, note and block id are never selected. With `scopeTokenId` (#366, scope VEHICLES) only the vehicles
 * selected for that token count; when none of them is published any more the calendar is empty, never the whole fleet.
 */
export async function buildFeed(db: PrismaClient, organizationId: string, now: Date, scopeTokenId?: string | null) {
  const windowFrom = availabilityToday(now);
  const windowTo = addLocalDays(windowFrom, FEED_WINDOW_DAYS);
  const selected = scopeTokenId ? { feedScopes: { some: { organizationId, tokenId: scopeTokenId } } } : {};
  const [vehicles, blocks] = await db.$transaction([
    db.vehicle.findMany({ where: { organizationId, status: "PUBLISHED", availableFrom: { not: null }, ...selected },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { id: true, name: true, availableFrom: true, availableTo: true } }),
    db.availabilityBlock.findMany({ where: { organizationId, from: { lte: sqlDate(windowTo) }, to: { gte: sqlDate(windowFrom) },
      ...(scopeTokenId ? { vehicle: selected } : {}) },
      select: { vehicleId: true, from: true, to: true } }),
  ], { isolationLevel: "RepeatableRead" });
  const byVehicle = new Map<string, { from: string; to: string }[]>();
  for (const block of blocks) {
    const list = byVehicle.get(block.vehicleId) ?? [];
    list.push({ from: localDate(block.from), to: localDate(block.to) });
    byVehicle.set(block.vehicleId, list);
  }
  const feedVehicles: FeedVehicle[] = vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.name,
    ranges: unavailableRanges({ windowFrom, windowTo, availableFrom: vehicle.availableFrom ? localDate(vehicle.availableFrom) : null,
      availableTo: vehicle.availableTo ? localDate(vehicle.availableTo) : null, blocks: byVehicle.get(vehicle.id) ?? [] }) }));
  return renderFeed({ organizationId, vehicles: feedVehicles, now,
    secret: getServerEnv().BETTER_AUTH_SECRET });
}
