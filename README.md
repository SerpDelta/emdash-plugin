# SerpDelta for EmDash

Google Search Console tracking plugin for [EmDash CMS](https://github.com/emdash-cms/emdash).

Connect GSC once, sync movement data, and surface ranking changes alongside your content — right inside EmDash.

## Status

Early development. v0.1.0 skeleton — namespace claimed, core integration coming soon.

## Planned Features

- Google Search Console OAuth connection
- Manual + scheduled sync of ranking data
- Movement detection (position, clicks, impressions)
- Top movers dashboard widget
- Tracked pages and queries
- Per-content GSC metrics

## Install

```bash
npm install @serpdelta/emdash-plugin
```

```typescript
// astro.config.mjs
import { serpdeltaPlugin } from "@serpdelta/emdash-plugin";

export default defineConfig({
  integrations: [
    emdash({
      plugins: [serpdeltaPlugin()],
    }),
  ],
});
```

## Links

- [SerpDelta](https://serpdelta.com) — standalone GSC tracking app
- [EmDash CMS](https://github.com/emdash-cms/emdash)

## License

MIT
