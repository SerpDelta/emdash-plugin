import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import {
  buildConnectUrl,
  parseCallbackTokens,
  getValidToken,
  type TokenPayload,
} from "./lib/oauth.js";
import {
  getProperties,
  syncDateRange,
} from "./lib/gsc-client.js";
import {
  detectMovements,
  ALERT_THRESHOLD,
  type Snapshot,
  type Movement,
} from "./lib/movements.js";
import {
  propertySelector,
  dashboard,
  topMoversWidget,
} from "./lib/admin-blocks.js";

// --- Helpers ---

function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function randomState(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function getTokens(ctx: PluginContext): Promise<TokenPayload | null> {
  return ctx.kv.get<TokenPayload>("tokens");
}

async function saveTokens(ctx: PluginContext, tokens: TokenPayload): Promise<void> {
  await ctx.kv.set("tokens", tokens);
}

async function getSiteUrl(ctx: PluginContext): Promise<string | null> {
  return ctx.kv.get<string>("siteUrl");
}

async function loadSnapshots(ctx: PluginContext, siteUrl: string): Promise<Snapshot[]> {
  const result = await ctx.storage.snapshots.query({
    where: { siteUrl },
    orderBy: { date: "desc" },
    limit: 5000,
  });
  return result.items.map((i: { data: Snapshot }) => i.data);
}

async function loadMovements(ctx: PluginContext, siteUrl: string): Promise<Movement[]> {
  const result = await ctx.storage.movements.query({
    where: { siteUrl },
    orderBy: { date: "desc" },
    limit: 100,
  });
  return result.items.map((i: { data: Movement }) => i.data);
}

async function loadTrackedItems(ctx: PluginContext, siteUrl: string): Promise<Set<string>> {
  const result = await ctx.storage.tracked_items.query({
    where: { siteUrl },
    limit: 200,
  });
  return new Set(
    result.items.map((i: { data: { kind: string; value: string } }) => `${i.data.kind}:${i.data.value}`),
  );
}

function getCallbackUrl(requestUrl: string, pluginId: string): string {
  const url = new URL(requestUrl);
  return `${url.origin}/_emdash/api/plugins/${pluginId}/callback`;
}

// --- Plugin Definition ---

export default definePlugin({
  hooks: {
    "plugin:install": {
      handler: async (_event: unknown, ctx: PluginContext) => {
        ctx.log.info("SerpDelta plugin installed");
      },
    },
  },

  routes: {
    // --- OAuth (via serpdelta.com proxy) ---

    connect: {
      public: true,
      handler: async (routeCtx: { request: Request }, ctx: PluginContext) => {
        const callbackUrl = getCallbackUrl(routeCtx.request.url, "serpdelta");
        const state = randomState();
        await ctx.kv.set("oauth_state", state, { ttl: 600 });
        const connectUrl = buildConnectUrl(callbackUrl, state);

        return new Response(null, {
          status: 302,
          headers: { Location: connectUrl },
        });
      },
    },

    callback: {
      public: true,
      handler: async (routeCtx: { request: Request }, ctx: PluginContext) => {
        const url = new URL(routeCtx.request.url);

        // Check for errors
        const error = url.searchParams.get("error");
        if (error) {
          return new Response(`OAuth error: ${error}`, { status: 400 });
        }

        // Parse tokens from serpdelta.com redirect
        const result = parseCallbackTokens(url);
        if (!result) {
          return new Response("Missing tokens in callback", { status: 400 });
        }

        // Validate state
        const savedState = await ctx.kv.get<string>("oauth_state");
        if (result.state !== savedState) {
          return new Response("Invalid state — possible CSRF", { status: 403 });
        }
        await ctx.kv.delete("oauth_state");

        // Store tokens
        await saveTokens(ctx, result.tokens);
        await ctx.kv.set("connected", true);
        ctx.log.info("Google account connected via serpdelta.com proxy");

        // Redirect to admin page
        const adminUrl = new URL(routeCtx.request.url);
        return new Response(null, {
          status: 302,
          headers: { Location: `${adminUrl.origin}/_emdash/admin/plugins/serpdelta/serpdelta` },
        });
      },
    },

    // --- GSC Data ---

    properties: {
      handler: async (_routeCtx: unknown, ctx: PluginContext) => {
        const tokens = await getTokens(ctx);
        if (!tokens) return { error: "Not connected" };

        const accessToken = await getValidToken(
          tokens,
          ctx.http.fetch.bind(ctx.http),
          (updated) => saveTokens(ctx, updated),
        );

        const props = await getProperties(accessToken, ctx.http.fetch.bind(ctx.http));
        return { properties: props };
      },
    },

    sync: {
      handler: async (_routeCtx: unknown, ctx: PluginContext) => {
        const tokens = await getTokens(ctx);
        const siteUrl = await getSiteUrl(ctx);
        if (!tokens || !siteUrl) {
          return { error: "Not connected or no property selected" };
        }

        const accessToken = await getValidToken(
          tokens,
          ctx.http.fetch.bind(ctx.http),
          (updated) => saveTokens(ctx, updated),
        );

        const startDate = dateStr(20);
        const endDate = dateStr(3);

        ctx.log.info(`Syncing ${siteUrl}: ${startDate} to ${endDate}`);

        const { pages, queries } = await syncDateRange(
          accessToken, siteUrl, startDate, endDate,
          ctx.http.fetch.bind(ctx.http), 500,
        );

        let stored = 0;
        for (const row of pages) {
          const id = `${siteUrl}|page|${row.key}|${row.date}`;
          await ctx.storage.snapshots.put(id, {
            siteUrl, date: row.date, type: "page",
            key: row.key, clicks: row.clicks,
            impressions: row.impressions, ctr: row.ctr,
            position: row.position,
          } satisfies Snapshot);
          stored++;
        }
        for (const row of queries) {
          const id = `${siteUrl}|query|${row.key}|${row.date}`;
          await ctx.storage.snapshots.put(id, {
            siteUrl, date: row.date, type: "query",
            key: row.key, clicks: row.clicks,
            impressions: row.impressions, ctr: row.ctr,
            position: row.position,
          } satisfies Snapshot);
          stored++;
        }

        const allSnapshots = await loadSnapshots(ctx, siteUrl);
        const tracked = await loadTrackedItems(ctx, siteUrl);
        const movements = detectMovements(allSnapshots, siteUrl, tracked);

        const today = dateStr(3);
        for (const m of movements) {
          const id = `${siteUrl}|${m.kind}|${m.value}|${today}`;
          await ctx.storage.movements.put(id, m);
        }

        await ctx.kv.set("lastSync", new Date().toISOString().slice(0, 16).replace("T", " "));

        ctx.log.info(`Sync complete: ${stored} snapshots, ${movements.length} movements`);

        return {
          success: true,
          snapshots: stored,
          movements: movements.length,
          alerts: movements.filter((m) => m.score >= ALERT_THRESHOLD).length,
        };
      },
    },

    // --- Tracked Items ---

    tracked: {
      handler: async (routeCtx: { request: Request; input: Record<string, unknown> }, ctx: PluginContext) => {
        const siteUrl = await getSiteUrl(ctx);
        if (!siteUrl) return { error: "No property selected" };

        const method = routeCtx.request.method;
        const input = routeCtx.input as { kind?: string; value?: string; id?: string };

        if (method === "DELETE" && input.id) {
          await ctx.storage.tracked_items.delete(input.id);
          return { success: true };
        }

        if (method === "POST" && input.kind && input.value) {
          const id = `${siteUrl}|${input.kind}|${input.value}`;
          await ctx.storage.tracked_items.put(id, {
            siteUrl,
            kind: input.kind,
            value: input.value,
            createdAt: new Date().toISOString(),
          });
          return { success: true, id };
        }

        const items = await ctx.storage.tracked_items.query({
          where: { siteUrl },
          limit: 200,
        });
        return { items: items.items.map((i: { id: string; data: Record<string, unknown> }) => ({ id: i.id, ...i.data })) };
      },
    },

    // --- Admin UI ---

    admin: {
      handler: async (routeCtx: { request: Request; input: Record<string, unknown> }, ctx: PluginContext) => {
        const interaction = routeCtx.input as {
          type: string;
          page?: string;
          action_id?: string;
          values?: Record<string, string>;
        };

        // --- Widget ---
        if (interaction.type === "widget_load") {
          const siteUrl = await getSiteUrl(ctx);
          if (!siteUrl) {
            return { blocks: [{ type: "context", text: "Connect GSC in SerpDelta settings." }] };
          }
          const movements = await loadMovements(ctx, siteUrl);
          return topMoversWidget(movements);
        }

        // --- Admin Page ---
        if (interaction.type === "page_load" && interaction.page === "/serpdelta") {
          return await renderAdminPage(routeCtx, ctx);
        }

        // --- Actions ---
        if (interaction.type === "block_action" || interaction.type === "form_submit") {
          return await handleAction(routeCtx, ctx, interaction);
        }

        return { blocks: [] };
      },
    },
  },
});

// --- Admin Page Renderer ---

async function renderAdminPage(
  routeCtx: { request: Request },
  ctx: PluginContext,
): Promise<Record<string, unknown>> {
  const connected = await ctx.kv.get<boolean>("connected");

  // Step 1: Not connected — show Connect link
  if (!connected) {
    const origin = new URL(routeCtx.request.url).origin;
    const connectRoute = `${origin}/_emdash/api/plugins/serpdelta/connect`;

    return {
      blocks: [
        { type: "header", text: "SerpDelta" },
        {
          type: "section",
          text: "Track what matters. Ignore the noise.\n\nConnect your Google Search Console to see ranking changes, top movers, and movement data for your pages and queries.",
        },
        { type: "divider" },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: "Connect Google Account",
              action_id: "start_oauth",
              style: "primary",
            },
          ],
        },
        {
          type: "context",
          text: `Or open directly: ${connectRoute}`,
        },
      ],
    };
  }

  // Step 2: Connected but no property selected — show property picker
  const siteUrl = await getSiteUrl(ctx);
  if (!siteUrl) {
    try {
      const tokens = await getTokens(ctx);
      if (!tokens) throw new Error("No tokens");

      const accessToken = await getValidToken(
        tokens,
        ctx.http.fetch.bind(ctx.http),
        (updated) => saveTokens(ctx, updated),
      );

      const props = await getProperties(accessToken, ctx.http.fetch.bind(ctx.http));
      return propertySelector(props);
    } catch (err) {
      return {
        blocks: [
          { type: "header", text: "SerpDelta" },
          {
            type: "section",
            text: `Failed to load properties: ${err}`,
          },
          {
            type: "actions",
            elements: [
              { type: "button", label: "Retry", action_id: "retry_properties", style: "primary" },
              { type: "button", label: "Disconnect", action_id: "disconnect", style: "danger" },
            ],
          },
        ],
      };
    }
  }

  // Step 3: Full dashboard
  const lastSync = await ctx.kv.get<string>("lastSync");
  const snapshots = await loadSnapshots(ctx, siteUrl);
  const movements = await loadMovements(ctx, siteUrl);
  const tracked = await loadTrackedItems(ctx, siteUrl);

  return dashboard(siteUrl, lastSync, movements, snapshots, tracked.size);
}

// --- Action Handlers ---

async function handleAction(
  routeCtx: { request: Request },
  ctx: PluginContext,
  interaction: {
    action_id?: string;
    values?: Record<string, string>;
  },
): Promise<Record<string, unknown>> {
  const actionId = interaction.action_id;

  // Start OAuth — show link to connect route (Block Kit can't redirect)
  if (actionId === "start_oauth") {
    const origin = new URL(routeCtx.request.url).origin;
    const connectRoute = `${origin}/_emdash/api/plugins/serpdelta/connect`;

    return {
      blocks: [
        { type: "header", text: "SerpDelta" },
        {
          type: "section",
          text: "Opening Google authorization...",
        },
        {
          type: "section",
          text: `If not redirected automatically, open this link:\n${connectRoute}`,
        },
      ],
    };
  }

  // Select property
  if (actionId === "select_property" && interaction.values) {
    const siteUrl = interaction.values.site_url;
    if (!siteUrl) {
      return { blocks: [], toast: { message: "Select a property", type: "error" } };
    }
    await ctx.kv.set("siteUrl", siteUrl);
    ctx.log.info(`Property selected: ${siteUrl}`);
    return {
      ...(await renderAdminPage(routeCtx, ctx)),
      toast: { message: `Connected to ${siteUrl}`, type: "success" },
    };
  }

  // Trigger sync
  if (actionId === "trigger_sync") {
    try {
      const tokens = await getTokens(ctx);
      const siteUrl = await getSiteUrl(ctx);
      if (!tokens || !siteUrl) {
        return { blocks: [], toast: { message: "Not fully configured", type: "error" } };
      }

      const accessToken = await getValidToken(
        tokens,
        ctx.http.fetch.bind(ctx.http),
        (updated) => saveTokens(ctx, updated),
      );

      const startDate = dateStr(20);
      const endDate = dateStr(3);

      const { pages, queries } = await syncDateRange(
        accessToken, siteUrl, startDate, endDate,
        ctx.http.fetch.bind(ctx.http), 500,
      );

      let stored = 0;
      for (const row of pages) {
        const id = `${siteUrl}|page|${row.key}|${row.date}`;
        await ctx.storage.snapshots.put(id, {
          siteUrl, date: row.date, type: "page",
          key: row.key, clicks: row.clicks,
          impressions: row.impressions, ctr: row.ctr,
          position: row.position,
        } satisfies Snapshot);
        stored++;
      }
      for (const row of queries) {
        const id = `${siteUrl}|query|${row.key}|${row.date}`;
        await ctx.storage.snapshots.put(id, {
          siteUrl, date: row.date, type: "query",
          key: row.key, clicks: row.clicks,
          impressions: row.impressions, ctr: row.ctr,
          position: row.position,
        } satisfies Snapshot);
        stored++;
      }

      const allSnapshots = await loadSnapshots(ctx, siteUrl);
      const tracked = await loadTrackedItems(ctx, siteUrl);
      const movements = detectMovements(allSnapshots, siteUrl, tracked);

      const today = dateStr(3);
      for (const m of movements) {
        const id = `${siteUrl}|${m.kind}|${m.value}|${today}`;
        await ctx.storage.movements.put(id, m);
      }

      await ctx.kv.set("lastSync", new Date().toISOString().slice(0, 16).replace("T", " "));
      const alerts = movements.filter((m) => m.score >= ALERT_THRESHOLD).length;

      return {
        ...(await renderAdminPage(routeCtx, ctx)),
        toast: { message: `Synced ${stored} rows, ${movements.length} movements, ${alerts} alerts`, type: "success" },
      };
    } catch (err) {
      ctx.log.error(`Sync failed: ${err}`);
      return {
        ...(await renderAdminPage(routeCtx, ctx)),
        toast: { message: `Sync failed: ${err}`, type: "error" },
      };
    }
  }

  // Change property
  if (actionId === "change_property" || actionId === "retry_properties") {
    await ctx.kv.delete("siteUrl");
    return await renderAdminPage(routeCtx, ctx);
  }

  // Disconnect
  if (actionId === "disconnect") {
    await ctx.kv.delete("connected");
    await ctx.kv.delete("tokens");
    await ctx.kv.delete("siteUrl");
    await ctx.kv.delete("lastSync");
    ctx.log.info("Disconnected");
    return {
      ...(await renderAdminPage(routeCtx, ctx)),
      toast: { message: "Disconnected from Google Search Console", type: "info" },
    };
  }

  return { blocks: [] };
}
