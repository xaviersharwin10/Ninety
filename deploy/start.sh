#!/usr/bin/env bash
# Starts the hosted app. If any process exits, the whole container exits, so the host restarts it
# rather than serving a half-working app.
#
# NINETY_ROLE picks what runs here:
#   all      (default) the proxy, the backend process and the web app, behind one address
#   backend  match data, the quote relay and the agents
#   web      the web app; needs BACKEND_URL, the public address of the backend service
# Two services of one role each suit hosts whose free instances are too small for everything.
set -euo pipefail
cd /app

role="${NINETY_ROLE:-all}"

start_backend() {
  export MATCH_DATA_PORT=8082 QUOTE_RELAY_PORT=8081
  NODE_OPTIONS="--max-old-space-size=$1" packages/agents/node_modules/.bin/tsx deploy/backend.mts &
}
start_web() {
  (cd web && NODE_OPTIONS="--max-old-space-size=$1" node_modules/.bin/next start -H 127.0.0.1 -p 3000) &
}

case "$role" in
  all)
    export MATCH_DATA_URL=http://127.0.0.1:8082 QUOTE_RELAY_WS_URL=ws://127.0.0.1:8081
    caddy run --config deploy/Caddyfile --adapter caddyfile &
    start_backend 140
    start_web 220
    ;;
  backend)
    export MATCH_DATA_URL=http://127.0.0.1:8082 QUOTE_RELAY_WS_URL=ws://127.0.0.1:8081
    caddy run --config deploy/Caddyfile --adapter caddyfile &
    start_backend 320
    ;;
  web)
    : "${BACKEND_URL:?BACKEND_URL must be the public address of the backend service}"
    BACKEND_URL="${BACKEND_URL%/}"
    export BACKEND_URL MATCH_DATA_URL="$BACKEND_URL/md"
    export QUOTE_RELAY_WS_URL="${BACKEND_URL/#http/ws}/relay"
    caddy run --config deploy/Caddyfile.web --adapter caddyfile &
    start_web 320
    ;;
  *)
    echo "unknown NINETY_ROLE: $role" >&2
    exit 1
    ;;
esac

wait -n
exit 1
