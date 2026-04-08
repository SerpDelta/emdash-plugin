/**
 * Block Kit builders for the admin dashboard.
 */

import type { Property, RankingItem, AlertItem } from "./api-client.js";

type Block = Record<string, unknown>;
type BlockResponse = {
  blocks: Block[];
  toast?: { message: string; type: "success" | "error" | "info" };
};

// --- No Token Setup Screen ---

export function noTokenScreen(): BlockResponse {
  return {
    blocks: [
      { type: "header", text: "SerpDelta" },
      {
        type: "section",
        text: "Track what matters. Ignore the noise.",
      },
      {
        type: "section",
        text: "Connect SerpDelta to see ranking changes, top movers, and movement data for your pages and queries — right inside EmDash.",
      },
      { type: "divider" },
      { type: "header", text: "Connect" },
      {
        type: "section",
        text: "1. Sign in at serpdelta.com",
      },
      {
        type: "section",
        text: "2. Go to Settings → API Tokens and generate a new token",
      },
      {
        type: "section",
        text: "3. Paste the token below and click Save",
      },
      {
        type: "form",
        fields: [
          {
            type: "secret_input",
            action_id: "api_token",
            label: "SerpDelta API Token",
            placeholder: "sd_...",
          },
        ],
        submit: { label: "Save Token", action_id: "save_token" },
      },
    ],
  };
}

// --- Property Selector ---

export function propertySelector(properties: Property[]): BlockResponse {
  if (properties.length === 0) {
    return {
      blocks: [
        { type: "header", text: "SerpDelta" },
        {
          type: "section",
          text: "No properties found. Connect a Google Search Console property at serpdelta.com first, then refresh this page.",
        },
        {
          type: "actions",
          elements: [
            { type: "button", label: "Refresh", action_id: "refresh", style: "primary" },
          ],
        },
      ],
    };
  }

  return {
    blocks: [
      { type: "header", text: "SerpDelta — Select Property" },
      {
        type: "section",
        text: "Choose which property to display in this EmDash install.",
      },
      {
        type: "form",
        block_id: "property_select",
        fields: [
          {
            type: "select",
            action_id: "property_id",
            label: "Property",
            options: properties.map((p) => ({
              label: `${p.domain}${p.is_pro ? " (Pro)" : ""}`,
              value: String(p.id),
            })),
          },
        ],
        submit: { label: "Select Property", action_id: "select_property" },
      },
    ],
  };
}

// --- Dashboard ---

export function dashboard(
  property: Property,
  topPages: RankingItem[],
  topKeywords: RankingItem[],
  alerts: AlertItem[],
): BlockResponse {
  const blocks: Block[] = [
    { type: "header", text: "SerpDelta" },
  ];

  // Stats row
  const totalClicks = topPages.reduce((s, p) => s + p.clicks, 0);
  const totalImpressions = topPages.reduce((s, p) => s + p.impressions, 0);
  const avgPosition = topPages.length > 0
    ? (topPages.reduce((s, p) => s + p.position, 0) / topPages.length).toFixed(1)
    : "—";

  blocks.push({
    type: "stats",
    stats: [
      { label: "Property", value: property.domain },
      { label: "Clicks", value: formatNumber(totalClicks) },
      { label: "Impressions", value: formatNumber(totalImpressions) },
      { label: "Avg Position", value: avgPosition },
      { label: "Active Alerts", value: String(alerts.filter((a) => !a.is_read).length) },
    ],
  });

  blocks.push({
    type: "actions",
    elements: [
      { type: "button", label: "Refresh", action_id: "refresh", style: "primary" },
      { type: "button", label: "Change Property", action_id: "change_property" },
      { type: "button", label: "Disconnect", action_id: "disconnect", style: "danger" },
    ],
  });

  blocks.push({ type: "divider" });

  // Recent Alerts
  if (alerts.length > 0) {
    blocks.push({ type: "header", text: "Recent Alerts" });
    blocks.push({
      type: "table",
      columns: [
        { key: "type", label: "Type" },
        { key: "value", label: "Item" },
        { key: "delta", label: "Change" },
        { key: "position", label: "Position" },
        { key: "score", label: "Score" },
      ],
      rows: alerts.slice(0, 15).map((a) => ({
        type: a.type === "page" ? "Page" : "Query",
        value: truncate(a.value, 50),
        delta: `${a.delta > 0 ? "+" : ""}${a.delta}`,
        position: String(a.position),
        score: String(a.score),
      })),
    });
    blocks.push({ type: "divider" });
  }

  // Top Pages
  if (topPages.length > 0) {
    blocks.push({ type: "header", text: "Top Pages" });
    blocks.push({
      type: "table",
      columns: [
        { key: "value", label: "Page" },
        { key: "clicks", label: "Clicks" },
        { key: "impressions", label: "Impr." },
        { key: "position", label: "Position" },
      ],
      rows: topPages.slice(0, 10).map((p) => ({
        value: truncate(stripUrl(p.value), 50),
        clicks: formatNumber(p.clicks),
        impressions: formatNumber(p.impressions),
        position: String(p.position),
      })),
    });
    blocks.push({ type: "divider" });
  }

  // Top Keywords
  if (topKeywords.length > 0) {
    blocks.push({ type: "header", text: "Top Keywords" });
    blocks.push({
      type: "table",
      columns: [
        { key: "value", label: "Keyword" },
        { key: "clicks", label: "Clicks" },
        { key: "impressions", label: "Impr." },
        { key: "position", label: "Position" },
      ],
      rows: topKeywords.slice(0, 10).map((k) => ({
        value: truncate(k.value, 60),
        clicks: formatNumber(k.clicks),
        impressions: formatNumber(k.impressions),
        position: String(k.position),
      })),
    });
  }

  return { blocks };
}

// --- Top Movers Widget ---

export function topMoversWidget(alerts: AlertItem[]): BlockResponse {
  if (alerts.length === 0) {
    return {
      blocks: [{ type: "context", text: "No recent alerts. Visit serpdelta.com to sync." }],
    };
  }

  return {
    blocks: [
      {
        type: "table",
        columns: [
          { key: "value", label: "Item" },
          { key: "delta", label: "Change" },
        ],
        rows: alerts.slice(0, 5).map((a) => ({
          value: truncate(a.value, 40),
          delta: `${a.delta > 0 ? "+" : ""}${a.delta}`,
        })),
      },
    ],
  };
}

// --- Helpers ---

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function stripUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 3) + "...";
}
