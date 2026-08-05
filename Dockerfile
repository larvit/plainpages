# Node 24 runs TypeScript directly (type stripping) — no build step. Pinned exact tag.
FROM node:24.19.0-alpine3.24

# Deps land at /node_modules, one level above WORKDIR: Node resolves upward, so dev's `.:/app`
# bind mount cannot shadow them. Mounting a volume at /app/node_modules instead has the daemon
# create that destination in the developer's own checkout, root-owned whatever user runs the
# container. Reproducible install from the lockfile; dev deps kept so typecheck/test run in-image.
COPY package.json package-lock.json .npmrc /deps/
RUN cd /deps && npm ci && mv node_modules /node_modules && rm -rf /deps

WORKDIR /app
COPY . .

# Lockfile edits run as the host user (README → Extending the core) so the rewritten files stay
# theirs; that uid has no home in this image, and npm's default cache would land in unwritable /.
ENV npm_config_cache=/tmp/.npm
ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.ts"]
