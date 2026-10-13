#!/usr/bin/env bash
# Starts the hosted app. If any process exits, the whole container exits, so the host restarts it
# rather than serving a half-working app.
#
# NINETY_ROLE picks what runs here:
#   all      (default) the proxy, the backend process and the web app, behind one address
#   backend  match data, the quote relay and the agents
#   web      the web app and the settlement watcher; needs BACKEND_URL, the public address of the backend service
# Two services of one role each suit hosts whose free instances are too small for everything.
set -euo pipefail
cd /app

role="${NINETY_ROLE:-all}"
# One indexer address serves both names the code reads.
export INDEXER_URL="${INDEXER_URL:-${NEXT_PUBLIC_INDEXER_URL:-}}"
export NEXT_PUBLIC_INDEXER_URL="${NEXT_PUBLIC_INDEXER_URL:-$INDEXER_URL}"

start_backend() {
  export MATCH_DATA_PORT=8082 QUOTE_RELAY_PORT=8081
  NODE_OPTIONS="--max-old-space-size=$1" packages/agents/node_modules/.bin/tsx deploy/backend.mts &
}
start_web() {
  (cd web && NODE_OPTIONS="--max-old-space-size=$1" node_modules/.bin/next start -H 127.0.0.1 -p 3000) &
}

# Settles markets as they close. Needs the Chainlink CLI's login session, base64 of ~/.cre/cre.yaml,
# in CRE_SESSION_B64; without it the app runs but nothing settles. $1 is where match data answers.
start_watcher() {
  if [ -z "${CRE_SESSION_B64:-}" ]; then
    echo "CRE_SESSION_B64 not set: the settlement watcher is not running" >&2
    return
  fi
  mkdir -p "$HOME/.cre"
  echo "$CRE_SESSION_B64" | base64 -d > "$HOME/.cre/cre.yaml"
  chmod 600 "$HOME/.cre/cre.yaml"
  (cd cre/watcher && SETTLEMENT_MATCH_DATA_URL="$1" bun settlement-watcher.ts) &
}

case "$role" in
  all)
    export MATCH_DATA_URL=http://127.0.0.1:8082 QUOTE_RELAY_WS_URL=ws://127.0.0.1:8081
    export AGENTS_NUDGE_URL=http://127.0.0.1:8083
    caddy run --config deploy/Caddyfile --adapter caddyfile &
    start_backend 140
    start_web 220
    start_watcher http://127.0.0.1:8082
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
    export AGENTS_NUDGE_URL="$BACKEND_URL/nudge"
    caddy run --config deploy/Caddyfile.web --adapter caddyfile &
    start_web 220
    start_watcher "$BACKEND_URL/md"
    ;;
  *)
    echo "unknown NINETY_ROLE: $role" >&2
    exit 1
    ;;
esac

wait -n
exit 1
