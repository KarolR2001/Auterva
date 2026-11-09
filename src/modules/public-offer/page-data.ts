import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { availabilityToday } from "@/modules/availability/dates";
import { getPublicAvailability, getPublicCalendar } from "@/modules/availability/read";
import { parseAvailabilityRange, type AvailabilityRange } from "@/modules/availability/dates";
import { getPublicHome, getPublicSiteState, getPublicVehicle, listPublicVehicles } from "./read";

/**
 * Server-side loaders of the public pages (#41). They call the #40 read functions directly (no HTTP, no API budget),
 * and each of them passes the central gate on every call. `cache` only deduplicates one render pass
 * (generateMetadata + page); nothing is kept between requests, so a disabled company is cut on the next request.
 */
export const requestHost = cache(async (): Promise<string | null> => (await headers()).get("host"));

export const loadHome = cache(async (host: string) => getPublicHome(prisma, host));
export const loadCatalog = cache(async (host: string, query: string) => listPublicVehicles(prisma, host, new URLSearchParams(query)));
export const loadSiteState = cache(async (host: string) => getPublicSiteState(prisma, host));

/** Today in Europe/Warsaw as a LocalDate, the lower bound of every date input. */
export const todayWarsaw = () => availabilityToday();

export const loadVehicle = cache(async (host: string, slug: string) => getPublicVehicle(prisma, host, slug));

/** A range from the URL, or the reason it cannot be used. Today is Warsaw; ends are inclusive; one day is valid. */
export function readRange(from: string | undefined, to: string | undefined):
  { kind: "NONE" } | { kind: "OK"; range: AvailabilityRange } | { kind: "INVALID"; reason: "PAST_DATE" | "INVALID" } {
  if (from === undefined && to === undefined) return { kind: "NONE" };
  if (from === undefined || to === undefined) return { kind: "INVALID", reason: "INVALID" };
  let range: AvailabilityRange;
  try { range = parseAvailabilityRange(from, to); } catch { return { kind: "INVALID", reason: "INVALID" }; }
  return range.from < todayWarsaw() ? { kind: "INVALID", reason: "PAST_DATE" } : { kind: "OK", range };
}

/** Fresh reads (never cached across requests): the gate and the blocks are read again on every call. */
export const loadAvailability = (host: string, slug: string, range: AvailabilityRange) =>
  getPublicAvailability(prisma, host, slug, range);
export const loadCalendar = (host: string, slug: string, range: AvailabilityRange) =>
  getPublicCalendar(prisma, host, slug, range);
