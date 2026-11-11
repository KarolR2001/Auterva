import type { FeedItem, FeedList, FeedScopeVehicle, IssuedFeed } from "./feed-model";

/** Result of a call; `code` is the stable error code of the API, never a message for display. */
export type FeedResult<T> = { ok: true; data: T }
  | { ok: false; status: number; code: string; retryAfter?: number; fieldErrors?: Record<string, string> };

/**
 * Company host (`/api/admin/calendar-feeds`) or the superadmin in one company (`/api/platform/companies/{id}/...`).
 * The platform area has no create or rotate routes (405); the screen does not offer them there.
 */
export type FeedContext = { apiBase: string; canManage: boolean };
export const adminFeedContext: FeedContext = { apiBase: "/api/admin/calendar-feeds", canManage: true };
export const platformFeedContext = (organizationId: string): FeedContext =>
  ({ apiBase: `/api/platform/companies/${encodeURIComponent(organizationId)}/calendar-feeds`, canManage: false });

// Trailing slash: the app runs with trailingSlash, so the canonical path avoids a redirect (which would drop a POST).
async function call<T>(url: string, init?: RequestInit): Promise<FeedResult<T>> {
  try {
    const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin" });
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (response.ok) return { ok: true, data: body as T };
    const retry = Number(response.headers.get("Retry-After"));
    const fieldErrors = body.fieldErrors && typeof body.fieldErrors === "object" ? body.fieldErrors as Record<string, string> : undefined;
    return { ok: false, status: response.status, code: typeof body.code === "string" ? body.code : "UNKNOWN",
      ...(retry > 0 ? { retryAfter: retry } : {}), ...(fieldErrors ? { fieldErrors } : {}) };
  } catch {
    // The request may have reached the server; the caller treats status 0 as an unknown outcome.
    return { ok: false, status: 0, code: "NETWORK" };
  }
}

const json = { "Content-Type": "application/json" };

/** Only the fields the screen uses; the secret part of an answer is kept in `url` and never stored elsewhere. */
function issued(data: Record<string, unknown>): IssuedFeed | null {
  const { token: _token, path: _path, url, ...item } = data;
  void _token; void _path;
  return typeof url === "string" && typeof item.id === "string" ? { ...(item as FeedItem), url } : null;
}

export const listFeeds = (context: FeedContext) => call<FeedList>(`${context.apiBase}/`);

async function issue(url: string, body: Record<string, unknown>): Promise<FeedResult<IssuedFeed>> {
  const result = await call<Record<string, unknown>>(url, { method: "POST", headers: json, body: JSON.stringify(body) });
  if (!result.ok) return result;
  const value = issued(result.data);
  // A 2xx without an address still changed the server; it is resolved like an uncertain answer.
  return value ? { ok: true, data: value } : { ok: false, status: 502, code: "MALFORMED" };
}

/** `vehicleIds` only for the scope "Wybrane pojazdy"; without it the address covers the whole fleet (#366). */
export const createFeed = (context: FeedContext, label: string, vehicleIds?: string[] | null) =>
  issue(`${context.apiBase}/`, { label: label.trim(), ...(vehicleIds ? { vehicleIds: [...new Set(vehicleIds)] } : {}) });
export const rotateFeed = (context: FeedContext, id: string) => issue(`${context.apiBase}/${encodeURIComponent(id)}/rotate/`, {});

export const revokeFeed = (context: FeedContext, id: string) =>
  call<FeedItem>(`${context.apiBase}/${encodeURIComponent(id)}/`, { method: "DELETE" });

/**
 * Published vehicles of the company for the selection (#367): the fleet list of the company panel filtered by
 * PUBLISHED, read in pages of 100 as one list. Only the company admin creates a link, so only that host is read.
 */
export async function listPublishedVehicles(signal?: AbortSignal): Promise<FeedResult<FeedScopeVehicle[]>> {
  const items: FeedScopeVehicle[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await call<{ items?: unknown; total?: unknown; pageSize?: unknown }>(
      `/api/admin/vehicles/?status=PUBLISHED&sort=order&page=${page}&pageSize=100`, { signal });
    if (!result.ok) return result;
    const { items: rows, total, pageSize } = result.data;
    if (!Array.isArray(rows) || typeof total !== "number" || typeof pageSize !== "number") return { ok: false, status: 200, code: "MALFORMED" };
    for (const row of rows as { id?: unknown; name?: unknown; status?: unknown }[]) {
      if (typeof row.id === "string" && row.status === "PUBLISHED") items.push({ id: row.id, name: typeof row.name === "string" ? row.name : null });
    }
    if (rows.length === 0 || page * pageSize >= total) return { ok: true, data: items };
  }
  return { ok: true, data: items };
}
