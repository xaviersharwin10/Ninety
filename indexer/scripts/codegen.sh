#!/usr/bin/env bash
# `envio codegen`'s own first pass only scaffolds `generated/` (a package with its own,
# non-workspace dependency tree) -- it can't compile it yet, since npm needs to install that
# package's own deps first, and `generated/package.json`'s peer dependencies conflict as shipped
# (react@18 required by @rescript/react vs react-dom@19's own peer requirement), so a plain
# `npm install` inside `generated/` fails on ERESOLVE. Neither problem is specific to this
# environment -- reproduced identically from a clean `rm -rf generated`. `--legacy-peer-deps`
# resolves it the same way one would for any other genuinely-conflicting peer set.
set -euo pipefail
cd "$(dirname "$0")/.."

npx envio codegen || true
(cd generated && npm install --legacy-peer-deps --no-audit --no-fund)
npx envio codegen
