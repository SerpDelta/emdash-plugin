# SerpDelta for EmDash

Google Search Console tracking plugin for [EmDash CMS](https://github.com/emdash-cms/emdash).

Connect GSC once, sync movement data, and surface ranking changes alongside your content — right inside EmDash.

## Status

v0.1.0 MVP — functional plugin with OAuth, sync, movement detection, and admin dashboard.

## Features

- Google OAuth 2.0 connection (offline access, token refresh)
- Property selector from available GSC sites
- Manual sync — pulls last 17 days of page + query data
- Movement detection engine with 4-component scoring (statistical, position, traffic, tracked)
- Admin dashboard with stats cards, clicks timeseries chart, and movement tables
- Top Movers dashboard widget
- Tracked items management (pages and queries)
- Full disconnect/reconnect flow

## Install

### 1. Add the package

From the plugin directory (local development):

```bash
# From your EmDash project root
npm install ../path/to/serpdelta-plugin
```

Or link for development:

```bash
cd serpdelta-plugin
npm link
cd ../your-emdash-site
npm link @serpdelta/emdash-plugin
```

### 2. Register in astro.config.mjs

```typescript
import { serpdeltaPlugin } from "@serpdelta/emdash-plugin";

export default defineConfig({
  integrations: [
    emdash({
      plugins: [serpdeltaPlugin()],  // Trusted mode — full resources
    }),
  ],
});
```

### 3. Deploy / restart dev server

```bash
npm run dev    # local
npm run build  # production
```

### 4. Configure in EmDash admin

1. Navigate to **SerpDelta** in the admin sidebar
2. Enter your Google OAuth Client ID and Client Secret
3. Click **Save & Connect**
4. Add the displayed callback URL to your Google Cloud Console as an authorized redirect URI
5. Click **Connect Google Account** and authorize
6. Select a property from the dropdown
7. Click **Sync Now**

## Google Cloud Setup

Before using the plugin, create OAuth credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project (or use an existing one)
3. Enable the **Google Search Console API**
4. Go to **Credentials** > **Create Credentials** > **OAuth client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `https://your-emdash-site.com/_emdash/api/plugins/serpdelta/callback`
7. Copy the Client ID and Client Secret into the plugin settings

## Architecture

```
src/
  index.ts              # Plugin descriptor — ID, storage, capabilities
  sandbox-entry.ts      # Runtime — routes, admin UI, sync orchestration
  lib/
    oauth.ts            # Google OAuth 2.0 (auth URL, code exchange, token refresh)
    gsc-client.ts       # GSC Search Analytics API client (fetch-based, no SDK)
    movements.ts        # Movement detection + 4-component significance scoring
    admin-blocks.ts     # Block Kit UI builders (dashboard, charts, tables, forms)
```

### Routes

| Route | Auth | Purpose |
|-------|------|---------|
| `connect` | Yes | Returns Google OAuth authorization URL |
| `callback` | Public | OAuth redirect handler, exchanges code for tokens |
| `properties` | Yes | Lists available GSC properties |
| `sync` | Yes | Pulls GSC data, stores snapshots, computes movements |
| `tracked` | Yes | CRUD for tracked pages/queries |
| `admin` | Yes | Block Kit admin page + widget rendering |

All routes exposed at: `/_emdash/api/plugins/serpdelta/<route>`

### Storage

| Collection | Purpose | Indexes |
|-----------|---------|---------|
| `snapshots` | Daily GSC rows (position, clicks, impressions) | siteUrl, date, type |
| `movements` | Computed position/traffic changes with scores | siteUrl, date, kind |
| `tracked_items` | User-selected pages/queries to monitor | siteUrl, kind, value |
| `connections` | Reserved for future multi-property support | siteUrl, createdAt |

### KV Keys

| Key | Value |
|-----|-------|
| `clientId` | Google OAuth Client ID |
| `clientSecret` | Google OAuth Client Secret |
| `tokens` | TokenPayload (access, refresh, expiry) |
| `connected` | Boolean — OAuth complete |
| `siteUrl` | Selected GSC property URL |
| `lastSync` | Timestamp of last successful sync |
| `oauth_state` | CSRF nonce (TTL: 600s) |

### Movement Scoring

Ported from SerpDelta's production AlertScorer. Four components summed:

1. **Statistical significance** (0-55 pts) — z-score of position change vs 21-day historical variance
2. **Position bracket** (0-30 pts) — larger deltas matter more in higher-ranking positions
3. **Traffic validation** (0-25 pts) — click change percentage corroborates position shift
4. **Tracked bonus** (+15 pts) — user explicitly marked this item as important

Alert threshold: score >= 50.

### Constraints

- **Standard plugin format** — no React, no direct DB, no Astro components
- **Block Kit UI only** — declarative JSON, no browser JS
- **`ctx.http.fetch()` only** — no direct `fetch()`, allowedHosts enforced
- **Plugin-scoped storage** — all data isolated to this plugin
- **Trusted mode recommended** — sandboxed limits (50ms CPU, 10 subrequests) are too tight for GSC sync

## Development

```bash
# Validate plugin structure
npx emdash plugin validate --dir .

# Bundle for distribution
npx emdash plugin bundle --dir .

# Output: dist/serpdelta-0.1.0.tar.gz
```

## Limitations (v0.1.0)

- Manual sync only (no scheduled/cron sync yet)
- Single property per install
- No email alerts or digests
- No historical import beyond 17 days
- Trusted mode only (not marketplace-publishable yet)

## Roadmap

- [ ] `cron:schedule` for automated daily sync
- [ ] Sandboxed mode with chunked sync (marketplace-publishable)
- [ ] Per-content GSC metrics via `content:afterSave` hook
- [ ] Multi-property support
- [ ] `email:send` for movement digest alerts

## Links

- [SerpDelta](https://serpdelta.com) — standalone GSC tracking app
- [EmDash CMS](https://github.com/emdash-cms/emdash)
- [Plugin Handoff Doc](../documentation/emdash-plugin-handoff.md) — full research and analysis

## License

MIT
