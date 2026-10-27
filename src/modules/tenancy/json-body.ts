// One bounded JSON reader for every HTTP entry that is not an image upload (those have their own limits in
// media/stream.ts). A declared length above the limit is refused before reading, and a chunked body without
// a length is counted while it streams, so no handler ever buffers an attacker-chosen amount of JSON.

export const MAX_JSON_BODY_BYTES = 64 * 1024;
/** Auth bodies are a few short strings; a smaller bound applies to the unauthenticated gateway. */
export const MAX_AUTH_BODY_BYTES = 16 * 1024;
/**
 * Routes whose valid data can exceed 64 KiB, with the limit worked out from the field limits at 3 bytes per UTF-16
 * unit (BMP characters such as Polish letters or euro signs; a JSON escape is at most 2 bytes per unit):
 * - settings: availabilityNotice 1 000 + privacyText 20 000 + termsText 20 000 = 41 000 units = 123 000 B, plus two
 *   links of 2 048 ASCII characters and the envelope = about 127.6 kB, so 128 KiB;
 * - vehicle form: description 20 000 + shortDescription 500 + 100 features of 80 + 500 + the short fields
 *   (about 80 100 units = 240 300 B) plus the envelope = about 246 kB, so 256 KiB.
 * Keep `proxyClientMaxBodySize` in next.config.mjs above the largest of these.
 */
export const MAX_SETTINGS_BODY_BYTES = 128 * 1024;
export const MAX_VEHICLE_BODY_BYTES = 256 * 1024;

/** The body limit of a path that passes through Proxy and a JSON handler. */
export function bodyLimitForPath(pathname: string): number {
  const path = pathname.replace(/\/$/, "");
  if (path === "/api/auth" || path.startsWith("/api/auth/")) return MAX_AUTH_BODY_BYTES;
  if (/^\/api\/platform\/companies\/[^/]+\/settings$/.test(path)) return MAX_SETTINGS_BODY_BYTES;
  if (/^\/api\/(?:admin|platform\/companies\/[^/]+)\/vehicles(?:\/[^/]+)?$/.test(path)) return MAX_VEHICLE_BODY_BYTES;
  return MAX_JSON_BODY_BYTES;
}

function declaredLength(request: Request): number | null | "invalid" {
  const stated = request.headers.get("content-length");
  if (stated === null) return null;
  return /^\d{1,15}$/.test(stated) ? Number(stated) : "invalid";
}

/** Reads at most `maxBytes`; returns null when the body is larger, so the caller can refuse it. */
async function readBounded(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = declaredLength(request);
  if (declared === "invalid" || (declared !== null && declared > maxBytes)) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  return joined;
}

function limitOf(request: Request): number {
  try { return bodyLimitForPath(new URL(request.url).pathname); } catch { return MAX_JSON_BODY_BYTES; }
}

/** True when the body (declared or streamed, read from a clone) is larger than `maxBytes`. */
export async function bodyExceeds(request: Request, maxBytes: number): Promise<boolean> {
  return (await readBounded(request.clone(), maxBytes)) === null;
}

/**
 * Parses an `application/json` body. Returns `undefined` for a wrong content type, an oversized body,
 * invalid UTF-8 or invalid JSON, so callers keep their existing single "invalid input" branch.
 */
export async function readJsonBody(request: Request, maxBytes = limitOf(request)): Promise<unknown> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return undefined;
  try {
    const bytes = await readBounded(request, maxBytes);
    if (!bytes) return undefined;
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return undefined; }
}

/** JSON object body or null; arrays, scalars and null are not objects. */
export async function readJsonObject(request: Request, maxBytes = limitOf(request)): Promise<Record<string, unknown> | null> {
  const value = await readJsonBody(request, maxBytes);
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
