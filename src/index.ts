import type { PluginDescriptor } from "emdash";

export function serpdeltaPlugin(): PluginDescriptor {
  return {
    id: "serpdelta",
    version: "0.1.0",
    format: "standard",
    entrypoint: "@serpdelta/emdash-plugin/sandbox",
    capabilities: ["network:fetch"],
    allowedHosts: [
      "accounts.google.com",
      "oauth2.googleapis.com",
      "www.googleapis.com",
      "searchconsole.googleapis.com",
    ],
    storage: {
      connections: {
        indexes: ["siteUrl", "createdAt"],
      },
      snapshots: {
        indexes: ["siteUrl", "date", "type"],
      },
      movements: {
        indexes: ["siteUrl", "date", "kind"],
      },
      tracked_items: {
        indexes: ["siteUrl", "kind", "value"],
      },
    },
    adminPages: [
      { path: "/serpdelta", label: "SerpDelta", icon: "chart" },
    ],
    adminWidgets: [
      { id: "serpdelta-movers", title: "Top Movers", size: "half" },
    ],
  };
}
