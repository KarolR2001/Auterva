import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getPublicContact, getPublicLegal, type LegalKind } from "./read";

/**
 * Loaders of the contact and legal pages (#44). Like the #41 loaders they call the #40 read functions directly and
 * pass the central gate on every call; `cache` only deduplicates one render pass (generateMetadata + page).
 */
export const loadContact = cache(async (host: string, vehicle: string | null, from: string | null, to: string | null) =>
  getPublicContact(prisma, host, { vehicleSlug: vehicle, from, to }));

export const loadLegal = cache(async (host: string, kind: LegalKind) => getPublicLegal(prisma, host, kind));
