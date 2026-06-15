# Node 24 runs TypeScript directly (type stripping) — no build step. Pinned exact tag.
FROM node:24.16.0-alpine3.24

WORKDIR /app

# Reproducible install from the lockfile. Dev deps kept so typecheck/test run in-image.
COPY package.json package-lock.json .npmrc ./
RUN npm ci

COPY . .

ENV PORT=3000
EXPOSE 3000
CMD ["node", "src/server.ts"]
