/**
 * Google Search Console API client.
 * Uses fetch (ctx.http.fetch in EmDash) — no SDK dependencies.
 */

const GSC_API_BASE = "https://www.googleapis.com/webmasters/v3";
const SEARCHCONSOLE_API_BASE = "https://searchconsole.googleapis.com/webmasters/v3";

export interface GSCProperty {
  siteUrl: string;
  permissionLevel: string;
}

export interface AnalyticsRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;      // Percentage (0-100)
  position: number;  // Rounded to 2 decimals
}

export interface DailyRow {
  date: string;
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface GSCAnalyticsResponse {
  rows?: Array<{
    keys: string[];
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
  }>;
}

interface GSCSitesResponse {
  siteEntry?: Array<{
    siteUrl: string;
    permissionLevel: string;
  }>;
}

function round(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

export async function getProperties(
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<GSCProperty[]> {
  const res = await fetchFn(`${GSC_API_BASE}/sites`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`GSC getProperties failed: ${res.status}`);
  }

  const data = (await res.json()) as GSCSitesResponse;
  return (data.siteEntry || []).map((s) => ({
    siteUrl: s.siteUrl,
    permissionLevel: s.permissionLevel,
  }));
}

export async function getSearchAnalytics(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  dimensions: string[],
  fetchFn: typeof fetch,
  rowLimit = 500,
): Promise<AnalyticsRow[] | DailyRow[]> {
  const body = {
    startDate,
    endDate,
    dimensions,
    rowLimit,
    type: "web",
  };

  const encodedUrl = encodeURIComponent(siteUrl);
  const res = await fetchFn(
    `${SEARCHCONSOLE_API_BASE}/sites/${encodedUrl}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC analytics failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as GSCAnalyticsResponse;
  if (!data.rows) return [];

  // If dimensions include 'date', return DailyRow[]
  const dateIdx = dimensions.indexOf("date");
  const keyDim = dimensions.find((d) => d !== "date");
  const keyIdx = keyDim ? dimensions.indexOf(keyDim) : -1;

  if (dateIdx >= 0 && keyIdx >= 0) {
    return data.rows.map((r) => ({
      date: r.keys[dateIdx],
      key: r.keys[keyIdx],
      clicks: Math.floor(r.clicks),
      impressions: Math.floor(r.impressions),
      ctr: round(r.ctr * 100, 4),
      position: round(r.position, 2),
    }));
  }

  // Single dimension — return AnalyticsRow[]
  return data.rows.map((r) => ({
    key: r.keys[0],
    clicks: Math.floor(r.clicks),
    impressions: Math.floor(r.impressions),
    ctr: round(r.ctr * 100, 4),
    position: round(r.position, 2),
  }));
}

/** Fetch pages and queries for a date range, returns daily rows */
export async function syncDateRange(
  accessToken: string,
  siteUrl: string,
  startDate: string,
  endDate: string,
  fetchFn: typeof fetch,
  rowLimit = 500,
): Promise<{ pages: DailyRow[]; queries: DailyRow[] }> {
  const pages = (await getSearchAnalytics(
    accessToken, siteUrl, startDate, endDate,
    ["date", "page"], fetchFn, rowLimit,
  )) as DailyRow[];

  const queries = (await getSearchAnalytics(
    accessToken, siteUrl, startDate, endDate,
    ["date", "query"], fetchFn, rowLimit,
  )) as DailyRow[];

  return { pages, queries };
}
