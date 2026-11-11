import type { FeedItem, FeedList, IssuedFeed } from "./feed-model";

/** Result of a call; `code` is the stable error code of the API, never a message for display. */
export type FeedResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; retryAfter?: number };

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
    return { ok: false, status: response.status, code: typeof body.code === "string" ? body.code : "UNKNOWN",
      ...(retry > 0 ? { retryAfter: retry } : {}) };
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

export const createFeed = (context: FeedContext, label: string) => issue(`${context.apiBase}/`, { label: label.trim() });
export const rotateFeed = (context: FeedContext, id: string) => issue(`${context.apiBase}/${encodeURIComponent(id)}/rotate/`, {});

export const revokeFeed = (context: FeedContext, id: string) =>
  call<FeedItem>(`${context.apiBase}/${encodeURIComponent(id)}/`, { method: "DELETE" });
