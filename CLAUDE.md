# SerpDelta EmDash Plugin

> A standalone TypeScript project that lives inside the SerpDelta workspace but is **gitignored** from the parent repo. Has its own git remote: `SerpDelta/emdash-plugin` on GitHub.

## What this is

A thin EmDash CMS plugin that displays SerpDelta data inside an EmDash admin UI. Acts as a client to the existing serpdelta.com API — does NOT do OAuth, sync GSC, or compute movements itself.

## Critical context

**Read these before touching anything:**

- `/Applications/MAMP/htdocs/SerpDelta/documentation/emdash-plugin.md` — full architecture, status, decision history
- `README.md` (in this directory) — install + usage guide
- `src/sandbox-entry.ts` — the entire runtime, ~220 lines

## EmDash Block Kit gotchas (HARD-WON)

These cost hours to discover. Save them.

1. **Buttons use `label`, NOT `text`** — `{ type: "button", label: "Save", action_id: "save" }`. The `text` property is silently ignored.
2. **No external URL redirects** — buttons can't link out, only trigger `action_id`. No `url`/`href`/`redirect` properties.
3. **BlockResponse has NO `redirect` property** — only `{ blocks, toast? }`. Returning a redirect crashes the admin UI.
4. **`section` blocks don't render markdown links** — `[text](url)` shows as literal text.
5. **Plugin route Response objects get wrapped** — returning `new Response(null, { status: 302 })` from a plugin route gives `{"data":{}}`, not a redirect. Plugin routes are JSON RPC, not HTTP request handlers.
6. **Settings use `settingsSchema` + `ctx.kv` with `"settings:"` prefix** — descriptor declares schema, runtime reads via `ctx.kv.get("settings:foo")`.
7. **Sandboxed limits are 50ms CPU + 10 subrequests** — too tight for real work. Use trusted mode (config-based install in `astro.config.mjs`).

Verify against the actual TypeScript types in `node_modules/@emdash-cms/blocks/dist/validation-*.d.ts`. The markdown reference docs are not always accurate.

## Stack

- **Language:** TypeScript (strict mode)
- **Build:** `tsdown` (required by EmDash CLI bundler)
- **Runtime:** Cloudflare Workers (V8 isolate, no Node.js APIs in sandboxed mode)
- **Validate:** `npx emdash plugin validate --dir .`
- **Bundle:** `npx emdash plugin bundle --dir .`

## Architecture

```
src/
  index.ts                 # Plugin descriptor (build-time, side-effect-free)
  sandbox-entry.ts         # Plugin runtime (admin route handler)
  lib/
    api-client.ts          # SerpDelta API client (fetch-based)
    admin-blocks.ts        # Block Kit JSON builders
```

The runtime is a single `admin` route that switches on `interaction.type` (page_load, widget_load, block_action, form_submit). State lives in `ctx.kv` only — no plugin storage collections (since serpdelta.com holds all the actual data).

## API client details

- Base URL: `https://serpdelta.com/api/v1`
- Auth: `Authorization: Bearer sd_xxx...` (token from serpdelta.com Settings → API Tokens)
- Endpoints: `/properties`, `/properties/{id}/{keywords|pages|alerts}`
- All routes use `ctx.http.fetch.bind(ctx.http)` (NOT global `fetch`) — required for sandbox compatibility and `allowedHosts` enforcement

## Test bed

The plugin is installed in dashstro.com (`/Applications/MAMP/htdocs/dashstro-new/dashstro-com/`). When you make changes:

```bash
# In this directory: validate
npx emdash plugin validate --dir .

# Push changes to the plugin repo
git push origin main

# Then in dashstro
cd /Applications/MAMP/htdocs/dashstro-new/dashstro-com
pnpm update @serpdelta/emdash-plugin
pnpm build
pnpm run deploy
```

## Git remotes

- This directory: `git@github.com:SerpDelta/emdash-plugin.git` (separate from parent)
- Parent SerpDelta: `git@github.com:ben-spp/serpdelta.git` (gitignores `serpdelta-plugin/`)
- Dashstro test site: `git@github.com:ben-spp/dashstro.git`

**Always verify `git remote -v` before pushing.** Three repos, easy to push to the wrong one.

## LayerView (System Map)

This plugin has its own LayerView project. MCP tools are `mcp__layerview__*`. Project key: `serpdelta-plugin`. The map has structural truth and accumulated memory from past sessions — always query it before touching unfamiliar code.

### Before touching unfamiliar code

```
overview(project: "serpdelta-plugin")
node_context(project: "serpdelta-plugin", node_uid: "file:src/sandbox-entry.ts")
search(project: "serpdelta-plugin", q: "concept")
callers(project: "serpdelta-plugin", node: "file:src/lib/api-client.ts")
```

If memory exists for a file you're about to edit, **read it before editing**. Critical Block Kit gotchas are in the memory — don't repeat past mistakes.

### After meaningful changes

```
memory_write(
  project: "serpdelta-plugin",
  memories: [{
    node_uid: "file:src/sandbox-entry.ts",
    sections: {
      changes: "Why this changed and what's different",
      gotchas: "What will break if someone undoes this"
    }
  }]
)
```

### When you create new files worth tracking

```
register(project: "serpdelta-plugin", path: "src/lib/new-file.ts", type: "service", name: "NewService", description: "What it does")
link(project: "serpdelta-plugin", from_uid: "file:src/sandbox-entry.ts", to_uid: "file:src/lib/new-file.ts", type: "uses")
```

### Cross-project context

The plugin is a client to the SerpDelta Laravel API. When a change in this plugin requires a change in the API, switch context to the `serpdelta` LayerView project to find the relevant controllers/middleware.

**Node UID format:** `file:relative/path` (e.g. `file:src/sandbox-entry.ts`)
**Node types:** component, service, endpoint, page, data-store, config, job, utility
**Edge types:** uses, renders, routes-to, reads-from, extends
**Memory keys:** purpose, design, gotchas, context, changes
