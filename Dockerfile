FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM deps AS builder

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3010 \
  MC_AUTH_MODE=local-single-user \
  MC_DATA_DIR=/var/lib/hiverunner/data \
  MC_WORKSPACE_ROOT=/var/lib/hiverunner/workspaces \
  OPENCLAW_DIR=/var/lib/hiverunner/openclaw \
  OPENCLAW_WORKSPACE_ROOT=/var/lib/hiverunner/openclaw/workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /var/lib/hiverunner/data /var/lib/hiverunner/workspaces /var/lib/hiverunner/openclaw/workspace \
  && chown -R node:node /var/lib/hiverunner /app

COPY --from=builder --chown=node:node /app /app

USER node

EXPOSE 3010
VOLUME ["/var/lib/hiverunner"]

ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]
