# Playwright runner — browsers preinstalled, pinned to match @playwright/test in e2e-tests/.
# Built/run via e2e-tests/compose.visual.yml; targets the `web` service over the network.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

WORKDIR /e2e-tests

COPY e2e-tests/package.json e2e-tests/package-lock.json ./
RUN npm ci

COPY e2e-tests/ ./

# Runs as the invoking `--user` so artifacts land owned by them, not root — that uid has no home
# here, so point everything that wants one at /tmp (npm's cache, and the browsers' profile dirs).
ENV HOME=/tmp
ENV npm_config_cache=/tmp/.npm

CMD ["npx", "playwright", "test"]
