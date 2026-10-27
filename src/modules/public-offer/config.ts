/**
 * Single source of the public-offer traffic budgets (WYMAGANIA §limity ruchu; adjustable after the load test).
 * Public media variants have their own budget: a vehicle gallery is up to 30 images x 2 variants and the
 * responses are `no-store`, so sharing the settings bucket (120/min/IP) returned 429 behind a NAT.
 * 600/min/IP covers about ten full galleries per minute from one address; lower it only with load evidence.
 */
export type TrafficBudget = { limit: number; windowMs: number };
export type PublicTrafficLimits = { offerRead: TrafficBudget; media: TrafficBudget };

const defaults: PublicTrafficLimits = {
  offerRead: { limit: 120, windowMs: 60_000 },
  media: { limit: 600, windowMs: 60_000 },
};

const warned = new Set<string>();

// A bad value must not turn every public read into a 500: fall back to the default and say so once.
function positive(name: string, raw: string | undefined, fallback: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > max) {
    if (!warned.has(name)) { warned.add(name); console.error(`Invalid ${name}; the default ${fallback} is used`); }
    return fallback;
  }
  return value;
}

export function readPublicTrafficLimits(env: Record<string, string | undefined> = process.env): PublicTrafficLimits {
  return {
    offerRead: { limit: positive("AUTERVA_PUBLIC_OFFER_RATE_LIMIT", env.AUTERVA_PUBLIC_OFFER_RATE_LIMIT, defaults.offerRead.limit, 10_000),
      windowMs: defaults.offerRead.windowMs },
    media: { limit: positive("AUTERVA_PUBLIC_MEDIA_RATE_LIMIT", env.AUTERVA_PUBLIC_MEDIA_RATE_LIMIT, defaults.media.limit, 10_000),
      windowMs: defaults.media.windowMs },
  };
}

export const catalogPageSize = { default: 12, max: 50 } as const;
export const sitemapVehicleCap = 5000;
