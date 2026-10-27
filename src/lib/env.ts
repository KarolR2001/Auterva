import { z } from "zod";

/**
 * Per-actor budget of authenticated photo byte downloads (admin, platform and preview variants) per minute.
 * A gallery is up to 30 images x 2 variants = 60 requests, and a few previews per minute are normal, so 600/min
 * covers about ten full galleries; it is separate from the 120/min JSON read budget. Invalid value is a startup error.
 */
export const DEFAULT_AUTHENTICATED_MEDIA_RATE_LIMIT = 600;

const mediaLimit = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().regex(/^[1-9]\d{0,4}$/).refine((value) => Number(value) <= 10_000).transform(Number).optional(),
).transform((value) => value ?? DEFAULT_AUTHENTICATED_MEDIA_RATE_LIMIT);

const schema = z.object({
  AUTERVA_MEDIA_RATE_LIMIT: mediaLimit,
  DATABASE_URL: z.string().startsWith("postgresql://"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),
});

export function parseServerEnv(source: Record<string, string | undefined>) {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".")))].join(", ");
    throw new Error(`Invalid server configuration: ${fields}`);
  }
  return result.data;
}

export function getServerEnv() {
  return parseServerEnv(process.env);
}
