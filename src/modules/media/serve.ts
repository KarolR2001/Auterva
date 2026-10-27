import type { PrismaClient } from "@/generated/prisma/client";
import { createMediaStorage, readLimited } from "./storage";

export type Variant = "large" | "thumb";
export const isVariant = (value: string): value is Variant => value === "large" || value === "thumb";

/** Storage key of one pre-generated variant; the raw object and its EXIF are never addressable. */
export function variantKey(variants: unknown, variant: Variant): string | null {
  if (!variants || typeof variants !== "object" || Array.isArray(variants)) return null;
  const key = (variants as Record<string, unknown>)[variant];
  return typeof key === "string" ? key : null;
}

/**
 * Public vehicle photo: only a READY image of a PUBLISHED vehicle of the company whose public gate the
 * caller has just passed. A foreign, draft, unpublished, archived or deleted image is indistinguishable
 * from a missing one.
 */
export async function resolvePublicVehicleImageKey(db: PrismaClient, organizationId: string,
  imageId: string, variant: Variant): Promise<string | null> {
  const image = await db.vehicleImage.findFirst({ where: { id: imageId, organizationId, status: "READY",
    vehicle: { status: "PUBLISHED" } }, select: { variants: true } });
  return variantKey(image?.variants, variant);
}

/** Private preview: any live (READY) image of a vehicle of the authorized company, whatever the vehicle state. */
export async function resolvePrivateVehicleImageKey(db: PrismaClient, organizationId: string,
  vehicleId: string, imageId: string, variant: Variant): Promise<string | null> {
  const image = await db.vehicleImage.findFirst({ where: { id: imageId, organizationId, vehicleId,
    status: "READY" }, select: { variants: true } });
  return variantKey(image?.variants, variant);
}

/**
 * Streams a stored variant through the application. The browser never receives a storage URL. The caller
 * chooses the cache policy: public variants are never stored (the gate must run on every request).
 */
export async function serveStoredVariant(key: string, requestId: string, cacheControl: string) {
  const notFound = () => Response.json({ code: "NOT_FOUND" }, { status: 404,
    headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } });
  const storage = createMediaStorage();
  try {
    // A cleanup race can remove the object after the gate; that is "not found", not a server fault.
    const bytes = await readLimited(storage, key).catch((error: unknown) => {
      if (error instanceof Error && ["NoSuchKey", "NotFound"].includes(error.name)) return null;
      throw error;
    });
    if (!bytes) return notFound();
    return new Response(new Uint8Array(bytes), { status: 200, headers: { "Content-Type": "image/webp",
      "Cache-Control": cacheControl, "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId } });
  } finally { storage.client.destroy(); }
}
