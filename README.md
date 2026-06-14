# Plainpages

A minimal **Node.js 24 + TypeScript** web backend that serves server-rendered HTML
(via **EJS** templates), CSS, and static files.

Priorities: **simplicity, few dependencies, strict TypeScript type checking.**
Development and deployment are **entirely Docker / Docker Compose based — no other
tooling is required** (no local Node, npm, or `tsc`).

The only runtime dependency is `ejs`. Node 24 runs the TypeScript sources directly
(type stripping), so there is **no build step** and no compiled output.

## Requirements

- Docker
- Docker Compose

That's it. Do not install or run Node/npm on the host — use the commands below.

## Development

```bash
docker compose up            # http://localhost:3000, live reload via `node --watch`
```

`docker compose up` merges `compose.override.yml`, which mounts the source
and restarts the server on change.

## Type check & tests

```bash
docker compose run --rm web npm run typecheck   # strict tsc --noEmit
docker compose run --rm web npm test            # node --test
```

## Production / deployment

```bash
docker compose -f compose.yml up --build -d   # base config only, no source mount
```

## Layout

```
src/server.ts   Entry point — starts the HTTP server (reads PORT, default 3000)
src/app.ts      Request routing + EJS rendering
src/static.ts   Static file serving with path-traversal protection
views/          EJS templates (index, 404, partials/)
public/         Static assets served under /public/ (css/, favicon, robots.txt)
```

## Extending

- **New page:** add a route in `src/app.ts` and a template in `views/`.
- **Static asset:** drop it in `public/`; it is served at `/public/<path>`.
- **New dependency:** `docker compose run --rm web npm install <pkg>` (updates
  `package.json` + `package-lock.json`), then rebuild with `docker compose build`.
  Keep dependencies minimal — prefer the Node standard library.

All versions are pinned to **exact, human-readable semantic versions** (no ranges,
no digests): deps via `.npmrc` (`save-exact=true`) and the committed lockfile
(`npm ci`), and the Node base image by tag in the `Dockerfile`
(e.g. `node:24.16.0-alpine3.24`).

`html-css-foundation/` holds the raw HTML/CSS design reference; it is not served and
is meant to be converted into EJS templates and `public/` assets over time.
