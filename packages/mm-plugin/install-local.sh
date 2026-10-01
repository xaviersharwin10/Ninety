#!/usr/bin/env bash
# Builds the plugin and installs it into your local mm CLI.
#
# It installs a packed tarball rather than this directory: mm resolves a plugin's imports from its
# real path, and this directory's node_modules holds its own dev copy of @metamask/agent-wallet,
# which would load a second CLI next to the running one. Installed from a tarball, npm copies the
# package into mm's data directory, where @metamask/agent-wallet resolves to the running CLI.
set -euo pipefail
cd "$(dirname "$0")"
pnpm build
out="$(mktemp -d)"
npm pack --silent --pack-destination "$out" >/dev/null
mm config set experimentalPlugins true >/dev/null
mm config set experimentalAllowUnverifiedInstalls true >/dev/null
mm plugins uninstall ninety-mm-plugin >/dev/null 2>&1 || true
mm plugins install "file:$(ls "$out"/*.tgz)" --accept-permissions
rm -rf "$out"
echo "Installed. Try: mm ninety matches"
