# Node 24 runs TypeScript directly (type stripping) — no build step. Pinned exact tag.
FROM node:24.19.0-alpine3.24

# Above WORKDIR so dev's `.:/app` bind mount can't shadow them; a volume at /app/node_modules
# instead leaves a root-owned dir in the checkout (the daemon creates mount destinations as root).
# Dev deps kept so typecheck/test run in-image.
COPY package.json package-lock.json .npmrc /deps/
RUN cd /deps && npm ci && mv node_modules /node_modules && rm -rf /deps

# The barrel as a package, so a plugin folder can own a package.json. Linked, not copied — it
# re-exports source under /app.
RUN mkdir -p /node_modules/@plainpages && ln -s /app/plugin-api /node_modules/@plainpages/plugin-api

WORKDIR /app
COPY . .

# The host uid running a lockfile edit has no home here, so npm's cache would land in unwritable /.
ENV npm_config_cache=/tmp/.npm
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.ts"]
