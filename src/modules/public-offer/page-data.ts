import { cache } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { availabilityToday } from "@/modules/availability/dates";
import { getPublicHome, getPublicSiteState, listPublicVehicles } from "./read";

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
