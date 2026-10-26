import { maxImageBytes } from "./storage";

const totalTimeoutMs = 15_000;
const idleTimeoutMs = 3_000;

/** Checked before any reservation or body read; throws MEDIA_INVALID_SIZE for a bad declared length. */
export function declaredUploadLength(request: Request): number | null {
  const stated = request.headers.get("content-length");
  if (stated === null) return null;
  if (!/^\d+$/.test(stated) || Number(stated) > maxImageBytes || Number(stated) < 1)
    throw new Error("MEDIA_INVALID_SIZE");
  return Number(stated);
}

export async function readUploadBody(request: Request): Promise<Buffer> {
  const stated = declaredUploadLength(request);
  if (!request.body) throw new Error("MEDIA_INVALID_SIZE");
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  const deadline = Date.now() + totalTimeoutMs;
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new Error("MEDIA_UPLOAD_ABORTED"));
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      if (request.signal.aborted) throw new Error("MEDIA_UPLOAD_ABORTED");
      const remaining = Math.min(idleTimeoutMs, deadline - Date.now());
      if (remaining <= 0) throw new Error("MEDIA_UPLOAD_TIMEOUT");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        reader.read(),
        aborted,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("MEDIA_UPLOAD_TIMEOUT")), remaining); }),
      ]).finally(() => { if (timer) clearTimeout(timer); });
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxImageBytes) throw new Error("MEDIA_INVALID_SIZE");
      chunks.push(Buffer.from(result.value));
    }
    if (total === 0 || (stated !== null && total !== stated)) throw new Error("MEDIA_INVALID_SIZE");
    return Buffer.concat(chunks, total);
  } catch (error) {
    // A stalled producer may never settle cancel(); do not hold the response open.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    request.signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
