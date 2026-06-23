# Playwright runner — browsers preinstalled, pinned to match @playwright/test in e2e-tests/.
# Built/run via e2e-tests/compose.visual.yml; targets the `web` service over the network.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /e2e-tests

COPY e2e-tests/package.json e2e-tests/package-lock.json ./
RUN npm ci

COPY e2e-tests/ ./

CMD ["npx", "playwright", "test"]
