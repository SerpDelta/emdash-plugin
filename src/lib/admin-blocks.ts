/**
 * Block Kit builders for the admin dashboard.
 *
 * IMPORTANT: Always use the typed builders exported from
 * `@emdash-cms/blocks/server` (imported here as `b` and `e`). Hand-rolling
 * object literals defeats type-checking and lets field-name drift ship to
 * production — see the 2026-04-08 "stats.stats vs stats.items" incident.
 *
 * Every BlockResponse that leaves this file is additionally run through
 * `validateBlocks()` in sandbox-entry.ts so runtime shape drift fails loud
 * on the server instead of crashing the admin React renderer.
 */

import {
  blocks as b,
  elements as e,
  type Block,
  type BlockResponse,
} from "@emdash-cms/blocks/server";
import type { Property, RankingItem, AlertItem } from "./api-client.js";

// --- No Token Setup Screen ---

export function noTokenScreen(): BlockResponse {
  return {
    blocks: [
      b.header("SerpDelta"),
      b.section("Track what matters. Ignore the noise."),
      b.section(
        "Connect SerpDelta to see ranking changes, top movers, and movement data for your pages and queries — right inside EmDash.",
      ),
      b.divider(),
      b.header("Connect"),
      b.section("1. Sign in at serpdelta.com"),
      b.section("2. Go to Settings → API Tokens and generate a new token"),
      b.section("3. Paste the token below and click Save"),
      b.form({
        fields: [
          e.secretInput("api_token", "SerpDelta API Token", {
            placeholder: "sd_...",
          }),
        ],
        submit: { label: "Save Token", actionId: "save_token" },
      }),
    ],
  };
}

// --- Property Selector ---

export function propertySelector(properties: Property[]): BlockResponse {
  if (properties.length === 0) {
    return {
      blocks: [
        b.header("SerpDelta"),
        b.section(
          "No properties found. Connect a Google Search Console property at serpdelta.com first, then refresh this page.",
        ),
        b.actions([e.button("refresh", "Refresh", { style: "primary" })]),
      ],
    };
  }

  return {
    blocks: [
      b.header("SerpDelta — Select Property"),
      b.section("Choose which property to display in this EmDash install."),
      b.form({
        fields: [
          e.select(
            "property_id",
            "Property",
            properties.map((p) => ({
              label: `${p.domain}${p.is_pro ? " (Pro)" : ""}`,
              value: String(p.id),
            })),
          ),
        ],
        submit: { label: "Select Property", actionId: "select_property" },
      }),
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
  const safePages = Array.isArray(topPages) ? topPages : [];
  const safeKeywords = Array.isArray(topKeywords) ? topKeywords : [];
  const safeAlerts = Array.isArray(alerts) ? alerts : [];

  const totalClicks = safePages.reduce((s, p) => s + (p.clicks || 0), 0);
  const totalImpressions = safePages.reduce((s, p) => s + (p.impressions || 0), 0);
  const avgPosition = safePages.length > 0
    ? (safePages.reduce((s, p) => s + (p.position || 0), 0) / safePages.length).toFixed(1)
    : "—";

  const blocks: Block[] = [
    b.header("SerpDelta"),
    b.stats([
      { label: "Property", value: property.domain },
      { label: "Clicks", value: formatNumber(totalClicks) },
      { label: "Impressions", value: formatNumber(totalImpressions) },
      { label: "Avg Position", value: avgPosition },
      { label: "Alerts", value: String(safeAlerts.filter((a) => !a.is_read).length) },
    ]),
    b.actions([
      e.button("refresh", "Refresh", { style: "primary" }),
      e.button("change_property", "Change Property"),
      e.button("disconnect", "Disconnect", { style: "danger" }),
    ]),
    b.divider(),
  ];

  // Empty state
  if (safePages.length === 0 && safeKeywords.length === 0 && safeAlerts.length === 0) {
    blocks.push(
      b.section(
        "No ranking data yet. SerpDelta syncs daily from Google Search Console — check back after the next sync.",
      ),
    );
    return { blocks };
  }

  // Recent Alerts
  if (safeAlerts.length > 0) {
    blocks.push(b.header("Recent Alerts"));
    blocks.push(
      b.table({
        pageActionId: "alerts_table",
        columns: [
          { key: "type", label: "Type" },
          { key: "value", label: "Item" },
          { key: "delta", label: "Change" },
          { key: "position", label: "Position" },
          { key: "score", label: "Score" },
        ],
        rows: safeAlerts.slice(0, 15).map((a) => ({
          type: a.type === "page" ? "Page" : "Query",
          value: truncate(a.value, 50),
          delta: `${a.delta > 0 ? "+" : ""}${a.delta}`,
          position: String(a.position),
          score: String(a.score),
        })),
      }),
    );
    blocks.push(b.divider());
  }

  // Top Pages
  if (safePages.length > 0) {
    blocks.push(b.header("Top Pages"));
    blocks.push(
      b.table({
        pageActionId: "pages_table",
        columns: [
          { key: "value", label: "Page" },
          { key: "clicks", label: "Clicks" },
          { key: "impressions", label: "Impr." },
          { key: "position", label: "Position" },
        ],
        rows: safePages.slice(0, 10).map((p) => ({
          value: truncate(stripUrl(p.value), 50),
          clicks: formatNumber(p.clicks),
          impressions: formatNumber(p.impressions),
          position: String(p.position),
        })),
      }),
    );
    blocks.push(b.divider());
  }

  // Top Keywords
  if (safeKeywords.length > 0) {
    blocks.push(b.header("Top Keywords"));
    blocks.push(
      b.table({
        pageActionId: "keywords_table",
        columns: [
          { key: "value", label: "Keyword" },
          { key: "clicks", label: "Clicks" },
          { key: "impressions", label: "Impr." },
          { key: "position", label: "Position" },
        ],
        rows: safeKeywords.slice(0, 10).map((k) => ({
          value: truncate(k.value, 60),
          clicks: formatNumber(k.clicks),
          impressions: formatNumber(k.impressions),
          position: String(k.position),
        })),
      }),
    );
  }

  return { blocks };
}

// --- Top Movers Widget ---

export function topMoversWidget(alerts: AlertItem[]): BlockResponse {
  if (alerts.length === 0) {
    return {
      blocks: [b.context("No recent alerts. Visit serpdelta.com to sync.")],
    };
  }

  return {
    blocks: [
      b.table({
        pageActionId: "movers_table",
        columns: [
          { key: "value", label: "Item" },
          { key: "delta", label: "Change" },
        ],
        rows: alerts.slice(0, 5).map((a) => ({
          value: truncate(a.value, 40),
          delta: `${a.delta > 0 ? "+" : ""}${a.delta}`,
        })),
      }),
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
