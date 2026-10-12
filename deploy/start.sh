#!/usr/bin/env bash
# Starts the hosted app: the proxy, the backend process and the web app. If any one of them exits,
# the whole container exits, so the host restarts it rather than serving a half-working app.
set -euo pipefail
cd /app

export MATCH_DATA_PORT=8082 QUOTE_RELAY_PORT=8081
export MATCH_DATA_URL=http://127.0.0.1:8082 QUOTE_RELAY_WS_URL=ws://127.0.0.1:8081

caddy run --config deploy/Caddyfile --adapter caddyfile &
NODE_OPTIONS=--max-old-space-size=140 packages/agents/node_modules/.bin/tsx deploy/backend.mts &
(cd web && NODE_OPTIONS=--max-old-space-size=220 node_modules/.bin/next start -H 127.0.0.1 -p 3000) &

wait -n
exit 1
