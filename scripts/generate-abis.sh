#!/usr/bin/env bash
# Regenerates packages/core/src/abi/*.json from the compiled contracts. Run this after any change
# to a contract's public interface -- CI does not check that the checked-in ABIs are current, so
# it's on whoever changes a contract to re-run this before committing.
set -euo pipefail
cd "$(dirname "$0")/.."

CONTRACTS=(AgentRegistry AgentVault MarketManager BetRouter SettlementReceiver)

(cd contracts && forge build)

for c in "${CONTRACTS[@]}"; do
  (cd contracts && forge inspect "$c" abi --json) > "packages/core/src/abi/$c.json"
  echo "wrote packages/core/src/abi/$c.json"
done
