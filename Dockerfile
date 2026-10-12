# The hosted app in one container: web app, match data, quote relay and the house agents behind
# one address. The settlement watcher and the indexer run elsewhere (see deploy/README.md).
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

ENV NODE_ENV=production
CMD ["deploy/start.sh"]
