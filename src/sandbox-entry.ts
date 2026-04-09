import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";
import {
  blocks as b,
  elements as e,
  validateBlocks,
} from "@emdash-cms/blocks/server";
import type { BlockResponse } from "@emdash-cms/blocks/server";
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

/**
 * Pulls a `typeof fetch`-compatible function out of the plugin context.
 *
 * ctx.http is typed as possibly undefined but is guaranteed present because
 * the plugin declares `capabilities: ["network:fetch"]`. Its fetch method
 * has a narrower signature (string URL only) than the global fetch, so we
 * cast through `unknown` — the api-client passes plain string URLs anyway.
 */
function pluginFetch(ctx: PluginContext): typeof fetch {
  if (!ctx.http) {
    throw new Error(
      "ctx.http unavailable — plugin must declare 'network:fetch' capability",
    );
  }
  // Bind the method so callers can store and reuse the function reference.
  return ctx.http.fetch.bind(ctx.http) as unknown as typeof fetch;
}

/**
 * Runtime guard for BlockResponses. Catches field-name drift between this
 * plugin and @emdash-cms/blocks before bad JSON reaches the admin React
 * renderer (where a malformed block crashes the tanstack CatchBoundary
 * with a useless "Something went wrong!" message). Throwing here routes
 * through the handler's outer try/catch → errorScreen() → a real message
 * the user can act on.
 */
function assertValidBlocks(
  response: BlockResponse,
  ctx: PluginContext,
  label: string,
): BlockResponse {
  const result = validateBlocks(response.blocks);
  if (!result.valid) {
    const summary = result.errors
      .slice(0, 5)
      .map((err) => `${err.path}: ${err.message}`)
      .join("; ");
    ctx.log.error(`[serpdelta] ${label} produced invalid blocks: ${summary}`);
    throw new Error(`Invalid block shape in ${label} — ${summary}`);
  }
  return response;
}

// --- Types ---

interface AdminInteraction {
  type: string;
  page?: string;
  action_id?: string;
  block_id?: string;
  values?: Record<string, unknown>;
  value?: unknown;
}

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

async function getCachedProperty(ctx: PluginContext): Promise<Property | null> {
  const val = await ctx.kv.get("selectedProperty");
  if (val && typeof val === "object" && "id" in val && "domain" in val) {
    return val as Property;
  }
  return null;
}

async function cacheProperty(ctx: PluginContext, property: Property): Promise<void> {
  await ctx.kv.set("selectedProperty", property);
  await ctx.kv.set("propertyId", property.id);
}

async function loadProperty(
  propertyId: number,
  token: string,
  ctx: PluginContext,
): Promise<Property | null> {
  const props = await listProperties(token, pluginFetch(ctx));
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
        const interaction = (routeCtx.input || {}) as unknown as AdminInteraction;

        ctx.log.info(`[serpdelta] interaction: type=${interaction.type} page=${interaction.page ?? "-"} action=${interaction.action_id ?? "-"}`);

        try {
          let response: BlockResponse;

          // Widget page_load: page starts with "widget:"
          if (interaction.type === "page_load" && interaction.page?.startsWith("widget:")) {
            response = await renderWidget(ctx);
          } else if (interaction.type === "page_load") {
            response = await renderAdminPage(ctx);
          } else if (interaction.type === "block_action" || interaction.type === "form_submit") {
            response = await handleAction(ctx, interaction);
          } else {
            response = fallbackScreen(`Unknown interaction type: ${interaction.type}`);
          }

          return assertValidBlocks(response, ctx, `interaction:${interaction.type}`);
        } catch (err) {
          ctx.log.error(`[serpdelta] handler error: ${err instanceof Error ? err.message : String(err)}`);
          // errorScreen is built from the same typed builders so we trust it;
          // no point re-validating (and if it's broken, we want the raw error
          // rather than an infinite validation loop).
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
      const props = await listProperties(token, pluginFetch(ctx));
      ctx.log.info(`[serpdelta] got ${props.length} properties`);
      return propertySelector(props);
    } catch (err) {
      ctx.log.error(`[serpdelta] listProperties failed: ${err instanceof Error ? err.message : String(err)}`);
      return errorScreen(err);
    }
  }

  // Fast path: cached property + parallel data fetch (3 calls, no serial lookup)
  try {
    const cached = await getCachedProperty(ctx);
    const fetchFn = pluginFetch(ctx);

    if (cached && cached.id === propertyId) {
      ctx.log.info(`[serpdelta] using cached property ${cached.domain}`);
      const [pagesResult, keywordsResult, alerts] = await Promise.all([
        listPages(propertyId, token, fetchFn, { limit: 10 }),
        listKeywords(propertyId, token, fetchFn, { limit: 10 }),
        listAlerts(propertyId, token, fetchFn, 15),
      ]);
      ctx.log.info(`[serpdelta] rendered dashboard: ${pagesResult.data?.length ?? 0}p/${keywordsResult.data?.length ?? 0}k/${alerts?.length ?? 0}a`);
      return dashboard(
        cached,
        pagesResult?.data ?? [],
        keywordsResult?.data ?? [],
        alerts ?? [],
      );
    }

    // Slow path: no cached property, fetch list + data in parallel, then pick
    ctx.log.info(`[serpdelta] no cache, parallel fetch for property ${propertyId}`);
    const [props, pagesResult, keywordsResult, alerts] = await Promise.all([
      listProperties(token, fetchFn),
      listPages(propertyId, token, fetchFn, { limit: 10 }),
      listKeywords(propertyId, token, fetchFn, { limit: 10 }),
      listAlerts(propertyId, token, fetchFn, 15),
    ]);

    const property = props.find((p) => p.id === propertyId) ?? null;
    if (!property) {
      await ctx.kv.delete("propertyId");
      await ctx.kv.delete("selectedProperty");
      return {
        blocks: [
          b.header("SerpDelta"),
          b.section("Selected property is no longer accessible. Please choose another."),
          b.actions([
            e.button("change_property", "Choose Property", { style: "primary" }),
          ]),
        ],
      };
    }

    // Populate cache for next render
    await cacheProperty(ctx, property);

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
    return { blocks: [b.context("Connect SerpDelta in plugin settings.")] };
  }

  try {
    const alerts = await listAlerts(propertyId, token, pluginFetch(ctx), 5);
    return topMoversWidget(alerts ?? []);
  } catch {
    return { blocks: [b.context("Could not load alerts.")] };
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
      b.header("SerpDelta"),
      b.section(message),
      b.actions([
        e.button("refresh", "Retry", { style: "primary" }),
        e.button("disconnect", "Disconnect", { style: "danger" }),
      ]),
    ],
  };
}

function fallbackScreen(msg: string): BlockResponse {
  return {
    blocks: [
      b.header("SerpDelta"),
      b.section(msg),
      b.actions([e.button("refresh", "Refresh", { style: "primary" })]),
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

    // Cache the full Property object so subsequent page loads can skip listProperties
    try {
      const token = await getToken(ctx);
      if (token) {
        const props = await listProperties(token, pluginFetch(ctx));
        const property = props.find((p) => p.id === id);
        if (property) {
          await cacheProperty(ctx, property);
          ctx.log.info(`[serpdelta] property selected & cached: ${property.domain}`);
        } else {
          await ctx.kv.set("propertyId", id);
          ctx.log.warn(`[serpdelta] property ${id} selected but not found in list`);
        }
      } else {
        await ctx.kv.set("propertyId", id);
      }
    } catch (err) {
      ctx.log.error(`[serpdelta] property cache failed: ${err instanceof Error ? err.message : String(err)}`);
      await ctx.kv.set("propertyId", id);
    }

    const base = await renderAdminPage(ctx);
    return {
      ...base,
      toast: { message: "Property selected", type: "success" },
    };
  }

  if (actionId === "change_property") {
    await ctx.kv.delete("propertyId");
    await ctx.kv.delete("selectedProperty");
    return await renderAdminPage(ctx);
  }

  if (actionId === "disconnect") {
    await ctx.kv.delete("propertyId");
    await ctx.kv.delete("selectedProperty");
    await ctx.kv.delete("settings:apiToken");
    const base = await renderAdminPage(ctx);
    return {
      ...base,
      toast: { message: "Disconnected", type: "info" },
    };
  }

  return fallbackScreen(`Unknown action: ${actionId ?? "(none)"}`);
}
