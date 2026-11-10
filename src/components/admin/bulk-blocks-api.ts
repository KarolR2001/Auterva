import type { BlockTypeCode } from "./calendar-api";
import type { PanelContext } from "./fleet-api";

// Client of the bulk block API (#215, docs/contracts/availability-nearest-and-bulk-blocks.md §2.1): one definition for up
// to 50 vehicles, or a copy of one block to other vehicles on the same dates. The body is strict; the server decides.

export type OnConflict = "ABORT" | "SKIP";
export type RejectionCode = "BLOCK_OVERLAP" | "BLOCK_OUTSIDE_ACTIVITY" | "BLOCK_VEHICLE_ARCHIVED" | "BLOCK_DATA_INVALID";
export type Rejection = { vehicleId: string; code: RejectionCode | string;
  conflict?: { id: string; from: string; to: string; type: BlockTypeCode | string; version: number } };
export type Saved = { vehicleId: string; blockId: string; version: number };

export type BulkCreateBody = { vehicleIds: string[]; fields: { from: string; to: string; type: BlockTypeCode; reference?: string; internalNote?: string };
  onConflict: OnConflict; dryRun: boolean; idempotencyKey?: string };
export type BulkCopyBody = { sourceBlockId: string; targetVehicleIds: string[]; copyNote: boolean;
  onConflict: OnConflict; dryRun: boolean; idempotencyKey?: string };

/**
 * What one call ended with. `uncertain` (5xx or lost connection) can follow a commit, so it is never a failure or a
 * success: the screen offers the same request again under the same idempotency key.
 */
export type BulkAnswer =
  | { kind: "preview"; onConflict: OnConflict; wouldSave: string[]; rejected: Rejection[] }
  | { kind: "saved"; status: 200 | 201; saved: Saved[]; rejected: Rejection[] }
  | { kind: "aborted"; rejected: Rejection[] }
  | { kind: "error"; status: number; code: string; retryAfter?: number; fieldErrors?: Record<string, string> }
  | { kind: "uncertain"; status: number };

const list = <T>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : []);

/** Reads one response of `blocks/bulk` or `blocks/copy` into a {@link BulkAnswer}; pure, so it is tested without a server. */
export function readBulkAnswer(status: number, body: Record<string, unknown>, retryAfter?: number): BulkAnswer {
  if (status === 0 || status >= 500) return { kind: "uncertain", status };
  if (status === 200 && body.dryRun === true) {
    return { kind: "preview", onConflict: body.onConflict === "SKIP" ? "SKIP" : "ABORT",
      wouldSave: list<{ vehicleId: string }>(body.wouldSave).map((entry) => entry.vehicleId), rejected: list<Rejection>(body.rejected) };
  }
  if ((status === 200 || status === 201) && Array.isArray(body.saved)) {
    return { kind: "saved", status, saved: list<Saved>(body.saved), rejected: list<Rejection>(body.rejected) };
  }
  if (status === 409 && body.code === "BULK_CONFLICTS") return { kind: "aborted", rejected: list<Rejection>(body.rejected) };
  // A 2xx without the expected lists cannot be read as a success: the outcome is unknown.
  if (status >= 200 && status < 300) return { kind: "uncertain", status };
  const fieldErrors = body.fieldErrors && typeof body.fieldErrors === "object" ? body.fieldErrors as Record<string, string> : undefined;
  return { kind: "error", status, code: typeof body.code === "string" ? body.code : "UNKNOWN",
    ...(retryAfter && retryAfter > 0 ? { retryAfter } : {}), ...(fieldErrors ? { fieldErrors } : {}) };
}

async function send(url: string, body: BulkCreateBody | BulkCopyBody): Promise<BulkAnswer> {
  let response: Response;
  try {
    response = await fetch(url, { method: "POST", cache: "no-store", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch { return { kind: "uncertain", status: 0 }; }
  const parsed = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!parsed && response.ok) return { kind: "uncertain", status: response.status };
  return readBulkAnswer(response.status, parsed ?? {}, Number(response.headers.get("Retry-After")) || undefined);
}

export const bulkCreateBlocks = (context: PanelContext, body: BulkCreateBody) => send(`${context.apiBase}/blocks/bulk/`, body);
export const bulkCopyBlock = (context: PanelContext, body: BulkCopyBody) => send(`${context.apiBase}/blocks/copy/`, body);
