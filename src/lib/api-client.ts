/**
 * SerpDelta API client.
 * Calls serpdelta.com API endpoints with bearer token auth.
 */

const API_BASE = "https://serpdelta.com/api/v1";

export interface Property {
  id: number;
  domain: string;
  site_url: string;
  is_pro: boolean;
  is_monitored: boolean;
  last_synced_at: string | null;
}

export interface RankingItem {
  value: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
  status: string;
  delta_position: number | null;
  delta_clicks: number | null;
  is_low_confidence: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

export interface AlertItem {
  type: "page" | "query";
  value: string;
  classification: string;
  direction: "up" | "down";
  position: number;
  old_position: number;
  delta: number;
  clicks: number;
  impressions: number;
  score: number;
  score_label: string;
  is_read: boolean;
  period_start: string | null;
  period_end: string | null;
  created_at: string;
}

export interface RankingDetail {
  data: RankingItem & { data_points: number };
  history: Array<{
    date: string;
    position: number;
    clicks: number;
    impressions: number;
    ctr: number;
  }>;
}

export class SerpDeltaApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public referenceId?: string,
  ) {
    super(message);
  }
}

/**
 * Summarize an error response body into something an end user can read.
 *
 * The SerpDelta API returns three kinds of error bodies:
 *   1. JSON error shape `{ error: { code, message } }` (happy path — use the message)
 *   2. Pretty HTML error pages for unexpected 500s (contain an ERR-XXXXXXXX reference)
 *   3. Plain text for unusual cases (auth failures, proxy errors)
 *
 * Before this helper existed, the raw body was dumped into the plugin's
 * errorScreen, which rendered 5KB of raw HTML inside the admin. Now we
 * extract the useful bits: a short message + an optional reference ID
 * the user can quote to support.
 */
function summarizeErrorBody(
  body: string,
  contentType: string | null,
): { message: string; referenceId?: string } {
  // Try JSON first (API's structured error shape)
  if (contentType?.includes("application/json") || body.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(body);
      const msg = parsed?.error?.message ?? parsed?.message;
      if (typeof msg === "string" && msg.length > 0) {
        return { message: msg.slice(0, 200) };
      }
    } catch {
      // fall through to HTML/text handling
    }
  }

  // HTML error page (pretty 500 from the SaaS)
  if (contentType?.includes("text/html") || /<!doctype html|<html/i.test(body)) {
    // Extract the error reference if present (format: ERR-XXXXXXXX)
    const refMatch = body.match(/ERR-[A-F0-9]{8}/i);
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    const h1Match = body.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    const short =
      h1Match?.[1]?.trim() ??
      titleMatch?.[1]?.replace(/\s*-\s*SerpDelta\s*$/i, "").trim() ??
      "upstream error page";
    return {
      message: short,
      ...(refMatch && { referenceId: refMatch[0] }),
    };
  }

  // Plain text fallback — truncate aggressively
  const trimmed = body.trim().slice(0, 200);
  return { message: trimmed || "(empty response body)" };
}

async function call<T>(
  path: string,
  token: string,
  fetchFn: typeof fetch,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchFn(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    const { message, referenceId } = summarizeErrorBody(
      text,
      res.headers.get("content-type"),
    );
    throw new SerpDeltaApiError(message, res.status, referenceId);
  }

  return (await res.json()) as T;
}

export async function listProperties(
  token: string,
  fetchFn: typeof fetch,
): Promise<Property[]> {
  const result = await call<{ data: Property[] }>("/properties", token, fetchFn);
  return result.data;
}

export async function listKeywords(
  propertyId: number,
  token: string,
  fetchFn: typeof fetch,
  opts?: { tracked?: boolean; status?: string; limit?: number },
): Promise<{ data: RankingItem[]; meta: { total: number; limit: number; offset: number } }> {
  const params = new URLSearchParams();
  if (opts?.tracked) params.set("tracked", "1");
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return call(
    `/properties/${propertyId}/keywords${qs ? "?" + qs : ""}`,
    token,
    fetchFn,
  );
}

export async function listPages(
  propertyId: number,
  token: string,
  fetchFn: typeof fetch,
  opts?: { tracked?: boolean; status?: string; limit?: number },
): Promise<{ data: RankingItem[]; meta: { total: number; limit: number; offset: number } }> {
  const params = new URLSearchParams();
  if (opts?.tracked) params.set("tracked", "1");
  if (opts?.status) params.set("status", opts.status);
  if (opts?.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  return call(
    `/properties/${propertyId}/pages${qs ? "?" + qs : ""}`,
    token,
    fetchFn,
  );
}

export async function listAlerts(
  propertyId: number,
  token: string,
  fetchFn: typeof fetch,
  limit = 50,
): Promise<AlertItem[]> {
  const result = await call<{ data: AlertItem[] }>(
    `/properties/${propertyId}/alerts?limit=${limit}`,
    token,
    fetchFn,
  );
  return result.data;
}
