# Playwright runner — browsers preinstalled, pinned to match @playwright/test in e2e-tests/.
# Built/run via e2e-tests/compose.visual.yml; targets the `web` service over the network.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /e2e-tests

COPY e2e-tests/package.json e2e-tests/package-lock.json ./
RUN npm ci

COPY e2e-tests/ ./

# Runs as the invoking `--user` so artifacts land owned by them, not root — and an arbitrary uid has
# no passwd entry here, so its home would be the unwritable `/`. npm's cache follows HOME.
ENV HOME=/tmp

CMD ["npx", "playwright", "test"]
