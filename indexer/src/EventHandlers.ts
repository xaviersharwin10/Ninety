import { AgentRegistry, AgentVault, BetRouter, MarketManager } from "generated";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

// Envio decodes every Solidity integer width, including uint8 enum backings, as bigint.
function decodeSide(v: bigint): string {
  return v === 0n ? "Yes" : "No";
}

/** BetRouter.BetStatus: None=0, Open=1, Won=2, Lost=3, Voided=4. Bettor's perspective. */
function decodeBetStatus(v: bigint): string {
  switch (v) {
    case 1n:
      return "Open";
    case 2n:
      return "Won";
    case 3n:
      return "Lost";
    case 4n:
      return "Voided";
    default:
      return "None";
  }
}

/** MarketManager.Outcome: Unresolved=0, Yes=1, No=2, Void=3. */
function decodeOutcome(v: bigint): string {
  switch (v) {
    case 1n:
      return "Yes";
    case 2n:
      return "No";
    case 3n:
      return "Void";
    default:
      return "Unresolved";
  }
}

// ------------------------------------------------------------------
// AgentRegistry
// ------------------------------------------------------------------

// One AgentVault is deployed per agent at register() time -- its address is only known from this
// event, never fixed in config.yaml. See config.yaml's comment on the AgentVault contract entry.
AgentRegistry.AgentRegistered.contractRegister(({ event, context }) => {
  context.addAgentVault(event.params.vault);
});

AgentRegistry.AgentRegistered.handler(async ({ event, context }) => {
  const agentId = String(event.params.agentId);
  const vaultId = event.params.vault.toLowerCase();

  context.Vault.set({
    id: vaultId,
    agent_id: agentId,
    totalDeposited: 0n,
    totalWithdrawn: 0n,
    totalAssets: 0n,
    totalSupply: 0n,
    lockedLiability: 0n,
    realizedPnl: 0n,
    performanceFeeAssets: 0n,
    highWaterMark: 0n,
  });

  context.Agent.set({
    id: agentId,
    operator: event.params.operator.toLowerCase(),
    quoteSigner: event.params.quoteSigner.toLowerCase(),
    vault_id: vaultId,
    enabled: true,
    strategyCommit: event.params.strategyCommit,
    metadataURI: event.params.metadataURI,
    registeredAt: BigInt(event.block.timestamp),
    registeredAtBlock: BigInt(event.block.number),
    volume: 0n,
    betsWon: 0,
    betsLost: 0,
    betsVoided: 0,
  });
});

AgentRegistry.QuoteSignerUpdated.handler(async ({ event, context }) => {
  const agent = await context.Agent.get(String(event.params.agentId));
  if (!agent) return;
  context.Agent.set({ ...agent, quoteSigner: event.params.newSigner.toLowerCase() });
});

AgentRegistry.StrategyUpdated.handler(async ({ event, context }) => {
  const agent = await context.Agent.get(String(event.params.agentId));
  if (!agent) return;
  context.Agent.set({ ...agent, strategyCommit: event.params.newCommit });
});

AgentRegistry.AgentEnabledSet.handler(async ({ event, context }) => {
  const agent = await context.Agent.get(String(event.params.agentId));
  if (!agent) return;
  context.Agent.set({ ...agent, enabled: event.params.enabled });
});

AgentRegistry.MetadataUpdated.handler(async ({ event, context }) => {
  const agent = await context.Agent.get(String(event.params.agentId));
  if (!agent) return;
  context.Agent.set({ ...agent, metadataURI: event.params.metadataURI });
});

// ------------------------------------------------------------------
// AgentVault (dynamic: one contract per agent, all sharing this one handler file)
// ------------------------------------------------------------------

AgentVault.LiabilityLocked.handler(async ({ event, context }) => {
  const vaultId = event.srcAddress.toLowerCase();
  const vault = await context.Vault.get(vaultId);
  if (!vault) return; // AgentRegistered's handler always runs first; this guards test/replay gaps
  context.Vault.set({ ...vault, lockedLiability: event.params.lockedTotal });
});

AgentVault.LiabilitySettled.handler(async ({ event, context }) => {
  const vaultId = event.srcAddress.toLowerCase();
  const vault = await context.Vault.get(vaultId);
  if (!vault) return;

  const pnl = event.params.pnl;
  const newTotalAssets = vault.totalAssets + pnl;

  context.Vault.set({
    ...vault,
    lockedLiability: event.params.lockedTotal,
    totalAssets: newTotalAssets,
    realizedPnl: vault.realizedPnl + pnl,
  });

  context.VaultSnapshot.set({
    id: `${vaultId}-${event.block.number}-${event.logIndex}`,
    vault_id: vaultId,
    totalAssets: newTotalAssets,
    lockedLiability: event.params.lockedTotal,
    pnlDelta: pnl,
    timestamp: BigInt(event.block.timestamp),
    blockNumber: BigInt(event.block.number),
  });
});

AgentVault.PerformanceFeeAccrued.handler(async ({ event, context }) => {
  const vaultId = event.srcAddress.toLowerCase();
  const vault = await context.Vault.get(vaultId);
  if (!vault) return;
  context.Vault.set({
    ...vault,
    performanceFeeAssets: vault.performanceFeeAssets + event.params.feeAssets,
    highWaterMark: event.params.newHighWaterMark,
  });
});

AgentVault.Deposit.handler(async ({ event, context }) => {
  const vaultId = event.srcAddress.toLowerCase();
  const vault = await context.Vault.get(vaultId);
  if (!vault) return;
  // totalSupply is handled by the paired ERC-20 Transfer(0x0, owner, shares) mint event, not here.
  context.Vault.set({
    ...vault,
    totalDeposited: vault.totalDeposited + event.params.assets,
    totalAssets: vault.totalAssets + event.params.assets,
  });
});

AgentVault.Withdraw.handler(async ({ event, context }) => {
  const vaultId = event.srcAddress.toLowerCase();
  const vault = await context.Vault.get(vaultId);
  if (!vault) return;
  // totalSupply is handled by the paired ERC-20 Transfer(owner, 0x0, shares) burn event, not here.
  context.Vault.set({
    ...vault,
    totalWithdrawn: vault.totalWithdrawn + event.params.assets,
    totalAssets: vault.totalAssets - event.params.assets,
  });
});

AgentVault.Transfer.handler(async ({ event, context }) => {
  const vaultId = event.srcAddress.toLowerCase();
  const vault = await context.Vault.get(vaultId);
  if (!vault) return;

  const from = event.params.from.toLowerCase();
  const to = event.params.to.toLowerCase();
  const value = event.params.value;

  const isMint = from === ZERO_ADDRESS;
  const isBurn = to === ZERO_ADDRESS;

  if (isMint || isBurn) {
    context.Vault.set({
      ...vault,
      totalSupply: isMint ? vault.totalSupply + value : vault.totalSupply - value,
    });
  }

  if (!isMint) {
    const fromPositionId = `${vaultId}-${from}`;
    const fromPosition = await context.VaultPosition.get(fromPositionId);
    context.VaultPosition.set({
      id: fromPositionId,
      vault_id: vaultId,
      owner: from,
      shares: (fromPosition?.shares ?? 0n) - value,
    });
  }

  if (!isBurn) {
    const toPositionId = `${vaultId}-${to}`;
    const toPosition = await context.VaultPosition.get(toPositionId);
    context.VaultPosition.set({
      id: toPositionId,
      vault_id: vaultId,
      owner: to,
      shares: (toPosition?.shares ?? 0n) + value,
    });
  }
});

// ------------------------------------------------------------------
// MarketManager
// ------------------------------------------------------------------

MarketManager.MatchCreated.handler(async ({ event, context }) => {
  context.Match.set({
    id: String(event.params.matchId),
    sourceRef: event.params.sourceRef,
    kickoffTs: event.params.kickoffTs,
    metadataURI: event.params.metadataURI,
    createdAtBlock: BigInt(event.block.number),
  });
});

MarketManager.MarketOpened.handler(async ({ event, context }) => {
  context.Market.set({
    id: String(event.params.marketId),
    match_id: String(event.params.matchId),
    templateId: event.params.templateId,
    windowStart: BigInt(event.params.windowStart),
    windowEnd: BigInt(event.params.windowEnd),
    closesAt: event.params.closesAt,
    state: "Open",
    outcome: "Unresolved",
    qualifyingEventTs: 0n,
    openedAtBlock: BigInt(event.block.number),
  });
});

MarketManager.MarketSuspended.handler(async ({ event, context }) => {
  const market = await context.Market.get(String(event.params.marketId));
  if (!market) return;
  context.Market.set({ ...market, state: "Suspended" });
});

MarketManager.MarketResumed.handler(async ({ event, context }) => {
  const market = await context.Market.get(String(event.params.marketId));
  if (!market) return;
  context.Market.set({ ...market, state: "Open" });
});

MarketManager.MarketClosed.handler(async ({ event, context }) => {
  const market = await context.Market.get(String(event.params.marketId));
  if (!market) return;
  context.Market.set({ ...market, state: "Closed" });
});

MarketManager.MarketResolved.handler(async ({ event, context }) => {
  const market = await context.Market.get(String(event.params.marketId));
  if (!market) return;
  context.Market.set({
    ...market,
    state: "Resolved",
    outcome: decodeOutcome(event.params.outcome),
    qualifyingEventTs: event.params.qualifyingEventTs,
  });
});

MarketManager.MarketVoided.handler(async ({ event, context }) => {
  const market = await context.Market.get(String(event.params.marketId));
  if (!market) return;
  context.Market.set({ ...market, state: "Voided", outcome: "Void" });
});

// ------------------------------------------------------------------
// BetRouter
// ------------------------------------------------------------------

BetRouter.BetPlaced.handler(async ({ event, context }) => {
  const agentId = String(event.params.agentId);

  context.Bet.set({
    id: String(event.params.betId),
    market_id: String(event.params.marketId),
    bettor: event.params.bettor.toLowerCase(),
    agent_id: agentId,
    groupId: event.params.groupId,
    side: decodeSide(event.params.side),
    probBps: Number(event.params.probBps),
    stake: event.params.stake,
    payout: event.params.payout,
    status: "Open",
    placedAt: BigInt(event.block.timestamp),
    placedAtBlock: BigInt(event.block.number),
    settledAt: undefined,
    voidedBySniperRule: false,
    claimedAt: undefined,
    claimedAmount: undefined,
  });

  const agent = await context.Agent.get(agentId);
  if (agent) {
    context.Agent.set({ ...agent, volume: agent.volume + event.params.stake });
  }
});

BetRouter.BetSettled.handler(async ({ event, context }) => {
  const bet = await context.Bet.get(String(event.params.betId));
  if (!bet) return;

  const bettorStatus = decodeBetStatus(event.params.status);
  context.Bet.set({ ...bet, status: bettorStatus, settledAt: BigInt(event.block.timestamp) });

  const agent = await context.Agent.get(bet.agent_id);
  if (!agent) return;
  // Agent.betsWon/betsLost are from the agent's perspective (see the doc comment on Agent in
  // schema.graphql) -- the inverse of the bettor's own Won/Lost.
  if (bettorStatus === "Won") {
    context.Agent.set({ ...agent, betsLost: agent.betsLost + 1 });
  } else if (bettorStatus === "Lost") {
    context.Agent.set({ ...agent, betsWon: agent.betsWon + 1 });
  } else if (bettorStatus === "Voided") {
    context.Agent.set({ ...agent, betsVoided: agent.betsVoided + 1 });
  }
});

BetRouter.BetVoidedBySniperRule.handler(async ({ event, context }) => {
  const bet = await context.Bet.get(String(event.params.betId));
  if (!bet) return;
  // BetSettled fires for the same bet and already handles the state transition and Agent
  // counters -- this only adds the supplementary flag for "why was this voided".
  context.Bet.set({ ...bet, voidedBySniperRule: true });
});

BetRouter.BetClaimed.handler(async ({ event, context }) => {
  const bet = await context.Bet.get(String(event.params.betId));
  if (!bet) return;
  context.Bet.set({
    ...bet,
    claimedAt: BigInt(event.block.timestamp),
    claimedAmount: event.params.amount,
  });
});
