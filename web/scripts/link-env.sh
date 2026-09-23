#!/usr/bin/env bash
# The one .env lives at the monorepo root (README's "Running locally" step). Next.js only
# auto-loads .env files from its own project directory, so this symlinks it in as .env.local --
# the well-established way to get Next's own env loader (rather than custom, timing-sensitive
# code in next.config.ts) to pick up a parent directory's .env. Not committed (see .gitignore);
# recreated here on every dev/build so a fresh clone just works.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -f ../.env ] && [ ! -e .env.local ]; then
  ln -s ../.env .env.local
fi
