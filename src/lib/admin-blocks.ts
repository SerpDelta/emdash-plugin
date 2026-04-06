/**
 * Block Kit builders for the admin dashboard.
 */

import type { Movement, Snapshot } from "./movements.js";

type Block = Record<string, unknown>;
type BlockResponse = { blocks: Block[]; toast?: { message: string; type: "success" | "error" | "info" } };

// --- Connect Screen ---

export function connectScreen(): BlockResponse {
  return {
    blocks: [
      { type: "header", text: "SerpDelta" },
      {
        type: "section",
        text: "Google OAuth credentials are not configured yet.",
      },
      { type: "divider" },
      {
        type: "section",
        text: "Go to the SerpDelta plugin settings page and enter your Google OAuth Client ID and Client Secret. You can create credentials at console.cloud.google.com — enable the Search Console API.",
      },
    ],
  };
}


// --- Property Selection ---

export function propertySelector(properties: Array<{ siteUrl: string; permissionLevel: string }>): BlockResponse {
  return {
    blocks: [
      { type: "header", text: "SerpDelta — Select Property" },
      {
        type: "section",
        text: "Choose which Google Search Console property to track.",
      },
      {
        type: "form",
        block_id: "property_select",
        fields: [
          {
            type: "select",
            action_id: "site_url",
            label: "Property",
            options: properties.map((p) => ({
              label: `${p.siteUrl} (${p.permissionLevel})`,
              value: p.siteUrl,
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
  siteUrl: string,
  lastSync: string | null,
  movements: Movement[],
  snapshots: Snapshot[],
  trackedCount: number,
): BlockResponse {
  const blocks: Block[] = [
    { type: "header", text: "SerpDelta" },
  ];

  // Stats row
  const topMovers = movements.filter((m) => m.score >= 50);
  const improving = movements.filter((m) => m.direction === "up").length;
  const declining = movements.filter((m) => m.direction === "down").length;

  blocks.push({
    type: "stats",
    stats: [
      { label: "Property", value: truncateUrl(siteUrl) },
      { label: "Last Sync", value: lastSync ?? "Never" },
      { label: "Alerts", value: String(topMovers.length), trend: topMovers.length > 0 ? `${topMovers.length} significant` : undefined },
      { label: "Tracked", value: String(trackedCount) },
    ],
  });

  // Sync button
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", text: "Sync Now", action_id: "trigger_sync", style: "primary" },
      { type: "button", text: "Change Property", action_id: "change_property" },
      { type: "button", text: "Disconnect", action_id: "disconnect", style: "danger", confirm: { title: "Disconnect?", text: "This will remove your GSC connection and stored data.", confirm: "Disconnect", deny: "Cancel" } },
    ],
  });

  blocks.push({ type: "divider" });

  // Position chart (timeseries) — aggregate daily clicks
  const chartData = buildClicksChart(snapshots, siteUrl);
  if (chartData.length > 0) {
    blocks.push({
      type: "chart",
      config: {
        chart_type: "timeseries",
        series: [
          {
            name: "Clicks",
            data: chartData,
            color: "#2563eb",
          },
        ],
        style: "line",
        gradient: true,
        height: 250,
        x_axis_name: "Date",
        y_axis_name: "Clicks",
      },
    });
    blocks.push({ type: "divider" });
  }

  // Top movers table
  if (movements.length > 0) {
    blocks.push({ type: "header", text: "Top Movers" });

    const moversUp = movements.filter((m) => m.direction === "up").slice(0, 15);
    const moversDown = movements.filter((m) => m.direction === "down").slice(0, 15);

    if (moversUp.length > 0) {
      blocks.push({
        type: "context",
        text: `${improving} improving, ${declining} declining`,
      });
      blocks.push(movementTable("Improving", moversUp));
    }
    if (moversDown.length > 0) {
      blocks.push(movementTable("Declining", moversDown));
    }
  } else {
    blocks.push({
      type: "context",
      text: "No movements detected yet. Run a sync to fetch data.",
    });
  }

  return { blocks };
}

// --- Widget ---

export function topMoversWidget(movements: Movement[]): BlockResponse {
  if (movements.length === 0) {
    return {
      blocks: [{ type: "context", text: "No movers yet. Sync your GSC data." }],
    };
  }

  const top5 = movements.slice(0, 5);
  return {
    blocks: [
      {
        type: "table",
        columns: [
          { key: "value", label: "Item" },
          { key: "delta", label: "Change" },
          { key: "direction", label: "", format: "badge" },
        ],
        rows: top5.map((m) => ({
          value: truncateValue(m.value, m.kind),
          delta: `${m.deltaPosition > 0 ? "+" : ""}${m.deltaPosition}`,
          direction: m.direction === "up" ? "Improved" : "Declined",
        })),
      },
    ],
  };
}

// --- Helpers ---

function movementTable(title: string, items: Movement[]): Block {
  return {
    type: "table",
    blockId: `movers-${title.toLowerCase()}`,
    columns: [
      { key: "type", label: "Type", format: "badge" },
      { key: "value", label: "Item" },
      { key: "position", label: "Position" },
      { key: "delta", label: "Change" },
      { key: "clicks", label: "Clicks" },
      { key: "score", label: "Score" },
    ],
    rows: items.map((m) => ({
      type: m.kind === "page" ? "Page" : "Query",
      value: truncateValue(m.value, m.kind),
      position: String(m.currentPosition),
      delta: `${m.deltaPosition > 0 ? "+" : ""}${m.deltaPosition}`,
      clicks: `${m.currentClicks} (${m.deltaClicks >= 0 ? "+" : ""}${m.deltaClicks})`,
      score: String(m.score),
    })),
  };
}

function buildClicksChart(
  snapshots: Snapshot[],
  siteUrl: string,
): Array<[number, number]> {
  // Aggregate clicks by date
  const byDate = new Map<string, number>();
  for (const s of snapshots) {
    if (s.siteUrl !== siteUrl) continue;
    byDate.set(s.date, (byDate.get(s.date) ?? 0) + s.clicks);
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, clicks]) => [new Date(date).getTime(), clicks]);
}

function truncateUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function truncateValue(value: string, kind: string): string {
  if (kind === "page") {
    try {
      const path = new URL(value).pathname;
      return path.length > 40 ? "..." + path.slice(-37) : path;
    } catch {
      return value.length > 40 ? "..." + value.slice(-37) : value;
    }
  }
  return value.length > 50 ? value.slice(0, 47) + "..." : value;
}
