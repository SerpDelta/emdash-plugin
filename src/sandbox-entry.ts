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

// --- Helpers ---

async function getToken(ctx: PluginContext): Promise<string | null> {
  return ctx.kv.get<string>("settings:apiToken");
}

async function getPropertyId(ctx: PluginContext): Promise<number | null> {
  return ctx.kv.get<number>("propertyId");
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
      ) => {
        const interaction = routeCtx.input as {
          type: string;
          page?: string;
          action_id?: string;
          values?: Record<string, string>;
        };

        // --- Widget ---
        if (interaction.type === "widget_load") {
          return await renderWidget(ctx);
        }

        // --- Admin Page ---
        if (interaction.type === "page_load") {
          return await renderAdminPage(ctx);
        }

        // --- Actions ---
        if (interaction.type === "block_action" || interaction.type === "form_submit") {
          return await handleAction(ctx, interaction);
        }

        return { blocks: [] };
      },
    },
  },
});

// --- Renderers ---

async function renderAdminPage(ctx: PluginContext): Promise<Record<string, unknown>> {
  const token = await getToken(ctx);

  // Step 1: No token — show setup instructions
  if (!token) {
    return noTokenScreen();
  }

  // Step 2: Have token but no property selected — show picker
  const propertyId = await getPropertyId(ctx);

  if (!propertyId) {
    try {
      const props = await listProperties(token, ctx.http.fetch.bind(ctx.http));
      return propertySelector(props);
    } catch (err) {
      return errorScreen(err);
    }
  }

  // Step 3: Full dashboard
  try {
    const property = await loadProperty(propertyId, token, ctx);
    if (!property) {
      // Property no longer accessible — clear and show picker
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

    const fetchFn = ctx.http.fetch.bind(ctx.http);
    const [pagesResult, keywordsResult, alerts] = await Promise.all([
      listPages(propertyId, token, fetchFn, { limit: 10 }),
      listKeywords(propertyId, token, fetchFn, { limit: 10 }),
      listAlerts(propertyId, token, fetchFn, 15),
    ]);

    return dashboard(property, pagesResult.data, keywordsResult.data, alerts);
  } catch (err) {
    return errorScreen(err);
  }
}

async function renderWidget(ctx: PluginContext): Promise<Record<string, unknown>> {
  const token = await getToken(ctx);
  const propertyId = await getPropertyId(ctx);

  if (!token || !propertyId) {
    return { blocks: [{ type: "context", text: "Connect SerpDelta in plugin settings." }] };
  }

  try {
    const alerts = await listAlerts(propertyId, token, ctx.http.fetch.bind(ctx.http), 5);
    return topMoversWidget(alerts);
  } catch {
    return { blocks: [{ type: "context", text: "Could not load alerts." }] };
  }
}

function errorScreen(err: unknown): Record<string, unknown> {
  let message = "An error occurred";
  if (err instanceof SerpDeltaApiError) {
    if (err.status === 401) {
      message = "Invalid API token. Generate a new one at serpdelta.com → Settings → API Tokens.";
    } else if (err.status === 403) {
      message = "Account inactive. Contact support.";
    } else if (err.status === 404) {
      message = "No data available. Connect a property at serpdelta.com first.";
    } else {
      message = `API error: ${err.message}`;
    }
  } else if (err instanceof Error) {
    message = err.message;
  }

  return {
    blocks: [
      { type: "header", text: "SerpDelta" },
      {
        type: "section",
        text: message,
      },
      {
        type: "actions",
        elements: [
          { type: "button", label: "Retry", action_id: "refresh", style: "primary" },
        ],
      },
    ],
  };
}

// --- Action Handlers ---

async function handleAction(
  ctx: PluginContext,
  interaction: {
    action_id?: string;
    values?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const actionId = interaction.action_id;

  if (actionId === "refresh") {
    return await renderAdminPage(ctx);
  }

  // Save API token
  if (actionId === "save_token" && interaction.values) {
    const token = interaction.values.api_token;
    if (!token || typeof token !== "string" || !token.startsWith("sd_")) {
      return {
        ...(await renderAdminPage(ctx)),
        toast: { message: "Invalid token — should start with sd_", type: "error" },
      };
    }
    await ctx.kv.set("settings:apiToken", token);
    ctx.log.info("API token saved");
    return {
      ...(await renderAdminPage(ctx)),
      toast: { message: "Token saved — select a property", type: "success" },
    };
  }

  if (actionId === "select_property" && interaction.values) {
    const raw = interaction.values.property_id;
    const id = typeof raw === "string" ? parseInt(raw, 10) : typeof raw === "number" ? raw : NaN;
    if (!id || isNaN(id)) {
      return { blocks: [], toast: { message: "Select a property", type: "error" } };
    }
    await ctx.kv.set("propertyId", id);
    ctx.log.info(`Property selected: ${id}`);
    return {
      ...(await renderAdminPage(ctx)),
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
    return {
      ...(await renderAdminPage(ctx)),
      toast: { message: "Disconnected from SerpDelta", type: "info" },
    };
  }

  return { blocks: [] };
}
