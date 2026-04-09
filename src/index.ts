import type { PluginDescriptor } from "emdash";

export function serpdeltaPlugin(): PluginDescriptor {
  return {
    id: "serpdelta",
    version: "0.2.3",
    format: "standard",
    entrypoint: "@serpdelta/emdash-plugin/sandbox",
    capabilities: ["network:fetch"],
    allowedHosts: [
      "serpdelta.com",
    ],
    storage: {},
    adminPages: [
      { path: "/serpdelta", label: "SerpDelta", icon: "chart" },
    ],
    adminWidgets: [
      { id: "serpdelta-movers", title: "Top Movers", size: "half" },
    ],
  };
}
