# The hosted app: web app, match data, quote relay, the house agents and the settlement watcher.
# deploy/start.sh runs all of it behind one address, or one half of it (NINETY_ROLE). The indexer
# runs elsewhere.

# The settlement workflow is compiled here, once. Compiling needs close to 1 GB; running the built
# binary needs about 160 MB, which a small instance has.
FROM oven/bun:1 AS settlement
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/* && mkdir /tmp/cre \
    && curl -fsSL https://github.com/smartcontractkit/cre-cli/releases/download/v1.35.0/cre_linux_amd64_ldd2-35.tar.gz \
       | tar -xz -C /tmp/cre \
    && install -m 755 "$(find /tmp/cre -type f -name 'cre*' | head -1)" /usr/local/bin/cre
WORKDIR /cre
COPY cre .
RUN (cd contracts && bun install --frozen-lockfile) \
    && (cd ninety-settlement && bun install --frozen-lockfile) \
    && (cd watcher && bun install --frozen-lockfile --production) \
    && cre workflow build ninety-settlement --target staging-settings --non-interactive \
       -o /cre/settlement.wasm \
    && rm -rf ninety-settlement/node_modules

FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate
COPY --from=caddy:2 /usr/bin/caddy /usr/bin/caddy
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/agents/package.json packages/agents/
COPY packages/match-data/package.json packages/match-data/
COPY packages/quote-relay/package.json packages/quote-relay/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile \
    --filter @ninety/web... --filter @ninety/agents... \
    --filter @ninety/match-data... --filter @ninety/quote-relay...

COPY packages/core packages/core
COPY packages/agents packages/agents
COPY packages/match-data packages/match-data
COPY packages/quote-relay packages/quote-relay
COPY web web

# NEXT_PUBLIC_* values are compiled into the browser bundle, so they're needed now, not at start.
COPY deploy/public.env web/.env.production
RUN pnpm --filter @ninety/web build \
    && rm -rf web/.next/cache /root/.cache /root/.local/share/pnpm/store
COPY deploy deploy

COPY --from=settlement /usr/local/bin/bun /usr/local/bin/cre /usr/local/bin/
COPY --from=settlement /cre cre
# The Chainlink CLI checks certificates against the system store, which the slim image lacks.
COPY --from=settlement /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
ENV CRE_WASM=/app/cre/settlement.wasm

ENV NODE_ENV=production
CMD ["deploy/start.sh"]
