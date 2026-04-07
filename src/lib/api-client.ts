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
  constructor(message: string, public status: number) {
    super(message);
  }
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
    throw new SerpDeltaApiError(`API ${res.status}: ${text}`, res.status);
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
