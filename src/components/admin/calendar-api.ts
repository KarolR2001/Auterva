import { addDays } from "@/modules/public-offer/presentation";
import type { ApiResult, PanelContext } from "./fleet-api";

export type BlockTypeCode = "RESERVED" | "MAINTENANCE" | "BLOCKED" | "OTHER";
/** A manual block as the private calendar returns it (reference and note exist only in the panel, never publicly). */
export type CalendarBlock = {
  id: string; from: string; to: string; type: BlockTypeCode; typeLabel: string; source: string;
  reference: string | null; internalNote: string | null; version: number;
};
export type CalendarRead = {
  vehicleId: string; availableFrom: string | null; availableTo: string | null;
  days: { date: string; available: boolean }[]; blocks: CalendarBlock[];
};
/** What the API accepts when saving a block (all text fields optional, null clears one). */
export type BlockFields = { from?: string; to?: string; type?: BlockTypeCode; reference?: string | null; internalNote?: string | null };
/** The existing entry the server names on BLOCK_OVERLAP. */
export type OverlapConflict = { id: string; from: string; to: string; type: BlockTypeCode; version: number };
export type BlockResult<T> = ApiResult<T> & { fieldErrors?: Record<string, string>; conflict?: OverlapConflict };

async function blockCall<T>(url: string, init?: RequestInit & { signal?: AbortSignal }): Promise<BlockResult<T>> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { ok: true, data: body as T };
    const retry = Number(response.headers.get("Retry-After"));
    const fieldErrors = body.fieldErrors && typeof body.fieldErrors === "object" ? body.fieldErrors as Record<string, string> : undefined;
    const conflict = body.conflict && typeof body.conflict === "object" ? body.conflict as OverlapConflict : undefined;
    return { ok: false, status: response.status, code: typeof body.code === "string" ? body.code : "UNKNOWN",
      ...(retry > 0 ? { retryAfter: retry } : {}), ...(fieldErrors ? { fieldErrors } : {}), ...(conflict ? { conflict } : {}) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    return { ok: false, status: 0, code: "NETWORK" };
  }
}

const json = { "Content-Type": "application/json" };

/** Day states and the company's own blocks of one vehicle for `from`..`to` (inclusive LocalDates, at most 365 days). */
export function readCalendar(context: PanelContext, vehicleId: string, from: string, to: string, signal?: AbortSignal) {
  return blockCall<CalendarRead>(`${context.apiBase}/vehicles/${vehicleId}/availability/?${new URLSearchParams({ from, to })}`, { signal });
}
export const createBlock = (context: PanelContext, vehicleId: string, fields: BlockFields) =>
  blockCall<CalendarBlock>(`${context.apiBase}/vehicles/${vehicleId}/blocks/`, { method: "POST", headers: json, body: JSON.stringify({ fields }) });
export const updateBlock = (context: PanelContext, vehicleId: string, blockId: string, expectedVersion: number, fields: BlockFields) =>
  blockCall<CalendarBlock>(`${context.apiBase}/vehicles/${vehicleId}/blocks/${blockId}/`,
    { method: "PATCH", headers: json, body: JSON.stringify({ expectedVersion, fields }) });
export const deleteBlock = (context: PanelContext, vehicleId: string, blockId: string, expectedVersion: number) =>
  blockCall<{ id: string; deleted: true }>(`${context.apiBase}/vehicles/${vehicleId}/blocks/${blockId}/`,
    { method: "DELETE", headers: json, body: JSON.stringify({ expectedVersion }) });

/** The list covers a year ahead (the API answers at most 365 days per read) and, on demand, the year before today. */
export const upcomingRange = (today: string) => ({ from: today, to: addDays(today, 364) });
export const historyRange = (today: string) => ({ from: addDays(today, -365), to: addDays(today, -1) });
