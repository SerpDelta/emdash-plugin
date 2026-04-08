import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import {
  listProperties,
  listKeywords,
  listPages,
  listAlerts,
  SerpDeltaApiError,
  type Property,
} from "./lib/api-client.js";
import {
  noTokenScreen,
  propertySelector,
  dashboard,
  topMoversWidget,
} from "./lib/admin-blocks.js";

// --- Types ---

interface AdminInteraction {
  type: string;
  page?: string;
  action_id?: string;
  block_id?: string;
  values?: Record<string, unknown>;
  value?: unknown;
}

type BlockResponse = {
  blocks: Array<Record<string, unknown>>;
  toast?: { message: string; type: "success" | "error" | "info" };
};

// --- Helpers ---

async function getToken(ctx: PluginContext): Promise<string | null> {
  const val = await ctx.kv.get("settings:apiToken");
  return typeof val === "string" ? val : null;
}

async function getPropertyId(ctx: PluginContext): Promise<number | null> {
  const val = await ctx.kv.get("propertyId");
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }
  return null;
}

async function loadProperty(
  propertyId: number,
  token: string,
  ctx: PluginContext,
): Promise<Property | null> {
  const props = await listProperties(token, ctx.http.fetch.bind(ctx.http));
  return props.find((p) => p.id === propertyId) || null;
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
    admin: {
      handler: async (
        routeCtx: { request: Request; input: Record<string, unknown> },
        ctx: PluginContext,
      ): Promise<BlockResponse> => {
        const interaction = (routeCtx.input || {}) as AdminInteraction;

        ctx.log.info(`[serpdelta] interaction: type=${interaction.type} page=${interaction.page ?? "-"} action=${interaction.action_id ?? "-"}`);

        try {
          // Widget page_load: page starts with "widget:"
          if (interaction.type === "page_load" && interaction.page?.startsWith("widget:")) {
            return await renderWidget(ctx);
          }

          // Admin page page_load
          if (interaction.type === "page_load") {
            return await renderAdminPage(ctx);
          }

          // Button clicks and form submits
          if (interaction.type === "block_action" || interaction.type === "form_submit") {
            return await handleAction(ctx, interaction);
          }

          return fallbackScreen(`Unknown interaction type: ${interaction.type}`);
        } catch (err) {
          ctx.log.error(`[serpdelta] handler error: ${err instanceof Error ? err.message : String(err)}`);
          return errorScreen(err);
        }
      },
    },
  },
});

// --- Renderers ---

async function renderAdminPage(ctx: PluginContext): Promise<BlockResponse> {
  const token = await getToken(ctx);

  if (!token) {
    return noTokenScreen();
  }

  const propertyId = await getPropertyId(ctx);

  if (!propertyId) {
    try {
      ctx.log.info("[serpdelta] fetching properties list");
      const props = await listProperties(token, ctx.http.fetch.bind(ctx.http));
      ctx.log.info(`[serpdelta] got ${props.length} properties`);
      return propertySelector(props);
    } catch (err) {
      ctx.log.error(`[serpdelta] listProperties failed: ${err instanceof Error ? err.message : String(err)}`);
      return errorScreen(err);
    }
  }

  try {
    ctx.log.info(`[serpdelta] loading property ${propertyId}`);
    const property = await loadProperty(propertyId, token, ctx);
    if (!property) {
      await ctx.kv.delete("propertyId");
      return {
        blocks: [
          { type: "header", text: "SerpDelta" },
          {
            type: "section",
            text: "Selected property is no longer accessible. Please choose another.",
          },
          {
            type: "actions",
            elements: [
              { type: "button", label: "Choose Property", action_id: "change_property", style: "primary" },
            ],
          },
        ],
      };
    }

    ctx.log.info(`[serpdelta] fetching data for ${property.domain}`);
    const fetchFn = ctx.http.fetch.bind(ctx.http);
    const [pagesResult, keywordsResult, alerts] = await Promise.all([
      listPages(propertyId, token, fetchFn, { limit: 10 }),
      listKeywords(propertyId, token, fetchFn, { limit: 10 }),
      listAlerts(propertyId, token, fetchFn, 15),
    ]);

    ctx.log.info(`[serpdelta] rendering dashboard: ${pagesResult.data?.length ?? 0} pages, ${keywordsResult.data?.length ?? 0} keywords, ${alerts?.length ?? 0} alerts`);

    return dashboard(
      property,
      pagesResult?.data ?? [],
      keywordsResult?.data ?? [],
      alerts ?? [],
    );
  } catch (err) {
    ctx.log.error(`[serpdelta] dashboard fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    return errorScreen(err);
  }
}

async function renderWidget(ctx: PluginContext): Promise<BlockResponse> {
  const token = await getToken(ctx);
  const propertyId = await getPropertyId(ctx);

  if (!token || !propertyId) {
    return { blocks: [{ type: "context", text: "Connect SerpDelta in plugin settings." }] };
  }

  try {
    const alerts = await listAlerts(propertyId, token, ctx.http.fetch.bind(ctx.http), 5);
    return topMoversWidget(alerts ?? []);
  } catch {
    return { blocks: [{ type: "context", text: "Could not load alerts." }] };
  }
}

function errorScreen(err: unknown): BlockResponse {
  let message = "An error occurred";
  if (err instanceof SerpDeltaApiError) {
    if (err.status === 401) {
      message = "Invalid API token. Generate a new one at serpdelta.com and update plugin settings.";
    } else if (err.status === 403) {
      message = "Account inactive. Contact support.";
    } else if (err.status === 404) {
      message = "No data available. Connect a property at serpdelta.com first.";
    } else {
      message = `API error (${err.status}): ${err.message}`;
    }
  } else if (err instanceof Error) {
    message = err.message;
  } else if (typeof err === "string") {
    message = err;
  }

  return {
    blocks: [
      { type: "header", text: "SerpDelta" },
      { type: "section", text: message },
      {
        type: "actions",
        elements: [
          { type: "button", label: "Retry", action_id: "refresh", style: "primary" },
          { type: "button", label: "Disconnect", action_id: "disconnect", style: "danger" },
        ],
      },
    ],
  };
}

function fallbackScreen(msg: string): BlockResponse {
  return {
    blocks: [
      { type: "header", text: "SerpDelta" },
      { type: "section", text: msg },
      {
        type: "actions",
        elements: [
          { type: "button", label: "Refresh", action_id: "refresh", style: "primary" },
        ],
      },
    ],
  };
}

// --- Action Handlers ---

async function handleAction(
  ctx: PluginContext,
  interaction: AdminInteraction,
): Promise<BlockResponse> {
  const actionId = interaction.action_id;
  ctx.log.info(`[serpdelta] action: ${actionId}`);

  if (actionId === "refresh") {
    return await renderAdminPage(ctx);
  }

  if (actionId === "save_token") {
    const raw = interaction.values?.api_token;
    const token = typeof raw === "string" ? raw.trim() : "";
    if (!token || !token.startsWith("sd_")) {
      ctx.log.warn(`[serpdelta] invalid token attempt: ${token.slice(0, 4)}...`);
      const base = await renderAdminPage(ctx);
      return {
        ...base,
        toast: { message: "Invalid token — should start with sd_", type: "error" },
      };
    }
    await ctx.kv.set("settings:apiToken", token);
    ctx.log.info("[serpdelta] token saved");
    const base = await renderAdminPage(ctx);
    return {
      ...base,
      toast: { message: "Token saved", type: "success" },
    };
  }

  if (actionId === "select_property") {
    const raw = interaction.values?.property_id;
    const id =
      typeof raw === "string" ? parseInt(raw, 10)
      : typeof raw === "number" ? raw
      : NaN;
    if (!id || isNaN(id)) {
      const base = await renderAdminPage(ctx);
      return {
        ...base,
        toast: { message: "Please select a property", type: "error" },
      };
    }
    await ctx.kv.set("propertyId", id);
    ctx.log.info(`[serpdelta] property selected: ${id}`);
    const base = await renderAdminPage(ctx);
    return {
      ...base,
      toast: { message: "Property selected", type: "success" },
    };
  }

  if (actionId === "change_property") {
    await ctx.kv.delete("propertyId");
    return await renderAdminPage(ctx);
  }

  if (actionId === "disconnect") {
    await ctx.kv.delete("propertyId");
    await ctx.kv.delete("settings:apiToken");
    const base = await renderAdminPage(ctx);
    return {
      ...base,
      toast: { message: "Disconnected", type: "info" },
    };
  }

  return fallbackScreen(`Unknown action: ${actionId ?? "(none)"}`);
}
