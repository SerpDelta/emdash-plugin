import { definePlugin } from "emdash";
import type { PluginContext } from "emdash";

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
      handler: async (routeCtx: { input: Record<string, unknown> }, ctx: PluginContext) => {
        const interaction = routeCtx.input as { type: string; page?: string; action_id?: string };

        if (interaction.type === "page_load" && interaction.page === "/serpdelta") {
          const connected = await ctx.kv.get<boolean>("connected");

          if (!connected) {
            return {
              blocks: [
                { type: "header", text: "SerpDelta" },
                {
                  type: "section",
                  text: "Track what matters. Ignore the noise.\n\nConnect your Google Search Console to see ranking changes, top movers, and movement data for your pages and queries — right here in EmDash.",
                },
                { type: "divider" },
                {
                  type: "stats",
                  stats: [
                    { label: "Status", value: "Not connected" },
                    { label: "Version", value: "0.1.0" },
                  ],
                },
                { type: "divider" },
                {
                  type: "context",
                  text: "SerpDelta v0.1.0 — GSC integration coming in the next release. Visit serpdelta.com for the full standalone app.",
                },
              ],
            };
          }

          return {
            blocks: [
              { type: "header", text: "SerpDelta" },
              {
                type: "stats",
                stats: [
                  { label: "Status", value: "Connected" },
                  { label: "Last Sync", value: "—" },
                  { label: "Tracked Items", value: "0" },
                ],
              },
              { type: "divider" },
              {
                type: "context",
                text: "GSC sync and movement tracking coming in the next release.",
              },
            ],
          };
        }

        // Widget: Top Movers
        if (interaction.type === "widget_load") {
          return {
            blocks: [
              {
                type: "context",
                text: "Connect Google Search Console to see top movers.",
              },
            ],
          };
        }

        return { blocks: [] };
      },
    },
  },
});
