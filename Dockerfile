# Node 24 runs TypeScript directly (type stripping) — no build step.
# Pinned to an exact, human-readable version (node / alpine).
FROM node:24.16.0-alpine3.24

WORKDIR /app

# Reproducible install from the committed lockfile. Dev deps (typescript, types)
# are kept so `npm run typecheck` / `npm test` work in the same image.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.ts"]
