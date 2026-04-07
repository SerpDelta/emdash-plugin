# SerpDelta for EmDash

Display your SerpDelta data inside [EmDash CMS](https://github.com/emdash-cms/emdash) — top movers, page rankings, keyword performance, and recent alerts, right in the admin.

## Status

v0.2.0 — functional MVP. The plugin is a thin client to the [SerpDelta](https://serpdelta.com) API. All Google Search Console syncing, movement detection, and scoring happen on serpdelta.com — the plugin just fetches and displays the data.

## How It Works

1. You sign up at [serpdelta.com](https://serpdelta.com) and connect your Google Search Console
2. SerpDelta syncs your ranking data daily
3. You generate an API token in SerpDelta settings
4. You paste the token into the EmDash plugin settings
5. The plugin fetches your data from the SerpDelta API and renders it in EmDash admin

No OAuth in the plugin. No GSC API calls from EmDash. No data duplication.

## Install

### 1. Add the package to your EmDash project

```bash
pnpm add git+ssh://git@github.com:SerpDelta/emdash-plugin.git
```

Or via npm:

```bash
npm install git+https://github.com/SerpDelta/emdash-plugin.git
```

### 2. Register in `astro.config.mjs`

```typescript
import { serpdeltaPlugin } from "@serpdelta/emdash-plugin";

export default defineConfig({
  integrations: [
    emdash({
      // ... your existing emdash config
      plugins: [serpdeltaPlugin()],
    }),
  ],
});
```

### 3. Build & deploy your EmDash site

```bash
pnpm build
pnpm run deploy
```

### 4. Get a SerpDelta API token

1. Sign in at [serpdelta.com](https://serpdelta.com)
2. Go to **Settings → API Tokens**
3. Click **Create Token**
4. Copy the token (shown once — `sd_xxxxxxxxxx...`)

### 5. Paste it into the plugin settings

In your EmDash admin:

1. Open **Plugins → SerpDelta → Settings** (gear icon)
2. Paste the token into the **SerpDelta API Token** field
3. Save

### 6. Use it

1. Open **SerpDelta** in the admin sidebar
2. Pick a property from the dropdown
3. View your dashboard: clicks, impressions, top pages, top keywords, recent alerts

## Features

- **Dashboard** — Clicks, impressions, average position, active alerts
- **Top Pages** — Best-performing pages with click and position data
- **Top Keywords** — Best-ranking queries
- **Recent Alerts** — Significant ranking changes flagged by SerpDelta
- **Top Movers Widget** — Compact dashboard widget showing recent changes

## Architecture

```
src/
  index.ts                 # Plugin descriptor (id, capabilities, allowedHosts)
  sandbox-entry.ts         # Runtime: settings, hooks, admin route
  lib/
    api-client.ts          # SerpDelta API client (fetch-based)
    admin-blocks.ts        # Block Kit JSON builders
```

### Plugin Descriptor

- **ID:** `serpdelta`
- **Format:** `standard`
- **Capabilities:** `network:fetch`
- **Allowed hosts:** `serpdelta.com`
- **Storage:** None (state in `ctx.kv`)
- **Settings schema:** Single secret field — `apiToken`

### Runtime

- **Setting storage:** `ctx.kv.get("settings:apiToken")`
- **Property selection storage:** `ctx.kv.get("propertyId")`
- **API base:** `https://serpdelta.com/api/v1`
- **Auth:** `Bearer sd_xxx...`

## Constraints

- **Trusted mode only** — installed via `astro.config.mjs`, not via marketplace UI
- **Standard plugin format** — no React, no direct DB access, Block Kit UI
- **Network access** — only `serpdelta.com`, declared in `allowedHosts`
- **No local data storage** — all state pulled from API on each render

## Development

```bash
# Validate
npx emdash plugin validate --dir .

# Bundle
npx emdash plugin bundle --dir .
# Output: dist/serpdelta-0.2.0.tar.gz
```

## Roadmap

- [ ] Polish: error handling, loading states, refresh button
- [ ] Per-content GSC stats via `content:afterSave` hook
- [ ] Scheduled refresh via `cron:schedule` capability
- [ ] Sandboxed mode evaluation for marketplace publishing

## Links

- [SerpDelta](https://serpdelta.com) — the SaaS product this plugin connects to
- [EmDash CMS](https://github.com/emdash-cms/emdash) — the CMS this plugin runs in
- [Plugin source](https://github.com/SerpDelta/emdash-plugin)

## License

MIT
