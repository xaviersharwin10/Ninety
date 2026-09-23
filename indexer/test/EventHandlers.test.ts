import { expect } from "chai";
import { TestHelpers } from "generated";

const { MockDb, AgentRegistry, AgentVault, MarketManager, BetRouter, Addresses } = TestHelpers;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const VAULT = Addresses.mockAddresses[0]!;
const OPERATOR = Addresses.mockAddresses[1]!;
const SIGNER = Addresses.mockAddresses[2]!;
const BACKER_A = Addresses.mockAddresses[3]!;
const BACKER_B = Addresses.mockAddresses[4]!;
const BETTOR = Addresses.mockAddresses[5]!;

describe("AgentRegistry.AgentRegistered", () => {
  it("creates both the Agent and its Vault, linked to each other", async () => {
    let mockDb = MockDb.createMockDb();
    const event = AgentRegistry.AgentRegistered.createMockEvent({
      agentId: 1n,
      operator: OPERATOR,
      vault: VAULT,
      quoteSigner: SIGNER,
      strategyCommit: "0xabc",
      metadataURI: "ipfs://agent-1",
    });
    mockDb = await AgentRegistry.AgentRegistered.processEvent({ event, mockDb });

    const agent = mockDb.entities.Agent.get("1");
    expect(agent).to.deep.include({
      operator: OPERATOR.toLowerCase(),
      quoteSigner: SIGNER.toLowerCase(),
      vault_id: VAULT.toLowerCase(),
      enabled: true,
      volume: 0n,
      betsWon: 0,
      betsLost: 0,
      betsVoided: 0,
    });

    const vault = mockDb.entities.Vault.get(VAULT.toLowerCase());
    expect(vault).to.deep.include({
      agent_id: "1",
      totalAssets: 0n,
      totalSupply: 0n,
      lockedLiability: 0n,
      realizedPnl: 0n,
    });
  });
});

describe("AgentRegistry: enable/signer/strategy updates", () => {
  async function registeredMockDb() {
    let mockDb = MockDb.createMockDb();
    const event = AgentRegistry.AgentRegistered.createMockEvent({ agentId: 1n, vault: VAULT });
    mockDb = await AgentRegistry.AgentRegistered.processEvent({ event, mockDb });
    return mockDb;
  }

  it("AgentEnabledSet flips Agent.enabled", async () => {
    let mockDb = await registeredMockDb();
    const event = AgentRegistry.AgentEnabledSet.createMockEvent({ agentId: 1n, enabled: false });
    mockDb = await AgentRegistry.AgentEnabledSet.processEvent({ event, mockDb });
    expect(mockDb.entities.Agent.get("1")?.enabled).to.equal(false);
  });

  it("QuoteSignerUpdated updates Agent.quoteSigner", async () => {
    let mockDb = await registeredMockDb();
    const event = AgentRegistry.QuoteSignerUpdated.createMockEvent({
      agentId: 1n,
      newSigner: BACKER_A,
    });
    mockDb = await AgentRegistry.QuoteSignerUpdated.processEvent({ event, mockDb });
    expect(mockDb.entities.Agent.get("1")?.quoteSigner).to.equal(BACKER_A.toLowerCase());
  });

  it("an update for an unknown agentId is a no-op, not a crash", async () => {
    let mockDb = await registeredMockDb();
    const event = AgentRegistry.AgentEnabledSet.createMockEvent({ agentId: 999n, enabled: false });
    mockDb = await AgentRegistry.AgentEnabledSet.processEvent({ event, mockDb });
    expect(mockDb.entities.Agent.get("999")).to.be.undefined;
  });
});

describe("AgentVault: liability lifecycle", () => {
  async function registeredMockDb() {
    let mockDb = MockDb.createMockDb();
    const event = AgentRegistry.AgentRegistered.createMockEvent({ agentId: 1n, vault: VAULT });
    mockDb = await AgentRegistry.AgentRegistered.processEvent({ event, mockDb });
    return mockDb;
  }

  it("LiabilityLocked sets lockedLiability to the event's own running total", async () => {
    let mockDb = await registeredMockDb();
    const event = AgentVault.LiabilityLocked.createMockEvent({
      marketId: 1n,
      betId: 1n,
      liability: 50n,
      lockedTotal: 50n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.LiabilityLocked.processEvent({ event, mockDb });
    expect(mockDb.entities.Vault.get(VAULT.toLowerCase())?.lockedLiability).to.equal(50n);
  });

  it("LiabilitySettled with a positive pnl (agent won) credits totalAssets and realizedPnl", async () => {
    let mockDb = await registeredMockDb();
    const locked = AgentVault.LiabilityLocked.createMockEvent({
      marketId: 1n,
      betId: 1n,
      liability: 50n,
      lockedTotal: 50n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.LiabilityLocked.processEvent({ event: locked, mockDb });

    const settled = AgentVault.LiabilitySettled.createMockEvent({
      marketId: 1n,
      betId: 1n,
      liability: 50n,
      pnl: 20n,
      lockedTotal: 0n,
      mockEventData: { srcAddress: VAULT, block: { number: 100 }, logIndex: 3 },
    });
    mockDb = await AgentVault.LiabilitySettled.processEvent({ event: settled, mockDb });

    const vault = mockDb.entities.Vault.get(VAULT.toLowerCase());
    expect(vault?.totalAssets).to.equal(20n);
    expect(vault?.realizedPnl).to.equal(20n);
    expect(vault?.lockedLiability).to.equal(0n);

    const snapshot = mockDb.entities.VaultSnapshot.get(`${VAULT.toLowerCase()}-100-3`);
    expect(snapshot).to.deep.include({ totalAssets: 20n, pnlDelta: 20n });
  });

  it("LiabilitySettled with a negative pnl (agent lost) debits totalAssets", async () => {
    let mockDb = await registeredMockDb();
    const settled = AgentVault.LiabilitySettled.createMockEvent({
      marketId: 1n,
      betId: 1n,
      liability: 50n,
      pnl: -50n,
      lockedTotal: 0n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.LiabilitySettled.processEvent({ event: settled, mockDb });

    const vault = mockDb.entities.Vault.get(VAULT.toLowerCase());
    expect(vault?.totalAssets).to.equal(-50n);
    expect(vault?.realizedPnl).to.equal(-50n);
  });

  it("realizedPnl accumulates across several settlements", async () => {
    let mockDb = await registeredMockDb();
    for (const pnl of [20n, -5n, 8n]) {
      const event = AgentVault.LiabilitySettled.createMockEvent({
        marketId: 1n,
        betId: 1n,
        liability: 50n,
        pnl,
        lockedTotal: 0n,
        mockEventData: { srcAddress: VAULT },
      });
      mockDb = await AgentVault.LiabilitySettled.processEvent({ event, mockDb });
    }
    expect(mockDb.entities.Vault.get(VAULT.toLowerCase())?.realizedPnl).to.equal(23n);
  });
});

describe("AgentVault: deposits, withdrawals, and share transfers", () => {
  async function registeredMockDb() {
    let mockDb = MockDb.createMockDb();
    const event = AgentRegistry.AgentRegistered.createMockEvent({ agentId: 1n, vault: VAULT });
    mockDb = await AgentRegistry.AgentRegistered.processEvent({ event, mockDb });
    return mockDb;
  }

  it("a deposit's Deposit + Transfer(mint) pair updates totalAssets, totalDeposited, totalSupply and the backer's position", async () => {
    let mockDb = await registeredMockDb();

    const deposit = AgentVault.Deposit.createMockEvent({
      sender: BACKER_A,
      owner: BACKER_A,
      assets: 1000n,
      shares: 1000n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Deposit.processEvent({ event: deposit, mockDb });

    const mint = AgentVault.Transfer.createMockEvent({
      from: ZERO_ADDRESS,
      to: BACKER_A,
      value: 1000n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Transfer.processEvent({ event: mint, mockDb });

    const vault = mockDb.entities.Vault.get(VAULT.toLowerCase());
    expect(vault).to.deep.include({
      totalDeposited: 1000n,
      totalAssets: 1000n,
      totalSupply: 1000n,
    });

    const position = mockDb.entities.VaultPosition.get(
      `${VAULT.toLowerCase()}-${BACKER_A.toLowerCase()}`,
    );
    expect(position?.shares).to.equal(1000n);
  });

  it("a withdrawal's Withdraw + Transfer(burn) pair reduces totalAssets, totalSupply and the position", async () => {
    let mockDb = await registeredMockDb();

    // Seed a prior deposit so the withdrawal has something to draw down.
    const deposit = AgentVault.Deposit.createMockEvent({
      owner: BACKER_A,
      assets: 1000n,
      shares: 1000n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Deposit.processEvent({ event: deposit, mockDb });
    const mint = AgentVault.Transfer.createMockEvent({
      from: ZERO_ADDRESS,
      to: BACKER_A,
      value: 1000n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Transfer.processEvent({ event: mint, mockDb });

    const withdraw = AgentVault.Withdraw.createMockEvent({
      owner: BACKER_A,
      assets: 400n,
      shares: 400n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Withdraw.processEvent({ event: withdraw, mockDb });
    const burn = AgentVault.Transfer.createMockEvent({
      from: BACKER_A,
      to: ZERO_ADDRESS,
      value: 400n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Transfer.processEvent({ event: burn, mockDb });

    const vault = mockDb.entities.Vault.get(VAULT.toLowerCase());
    expect(vault).to.deep.include({ totalWithdrawn: 400n, totalAssets: 600n, totalSupply: 600n });

    const position = mockDb.entities.VaultPosition.get(
      `${VAULT.toLowerCase()}-${BACKER_A.toLowerCase()}`,
    );
    expect(position?.shares).to.equal(600n);
  });

  it("a plain share transfer between two backers moves shares without touching totalSupply", async () => {
    let mockDb = await registeredMockDb();
    const mint = AgentVault.Transfer.createMockEvent({
      from: ZERO_ADDRESS,
      to: BACKER_A,
      value: 1000n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Transfer.processEvent({ event: mint, mockDb });

    const transfer = AgentVault.Transfer.createMockEvent({
      from: BACKER_A,
      to: BACKER_B,
      value: 300n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.Transfer.processEvent({ event: transfer, mockDb });

    expect(mockDb.entities.Vault.get(VAULT.toLowerCase())?.totalSupply).to.equal(1000n);
    expect(
      mockDb.entities.VaultPosition.get(`${VAULT.toLowerCase()}-${BACKER_A.toLowerCase()}`)?.shares,
    ).to.equal(700n);
    expect(
      mockDb.entities.VaultPosition.get(`${VAULT.toLowerCase()}-${BACKER_B.toLowerCase()}`)?.shares,
    ).to.equal(300n);
  });

  it("PerformanceFeeAccrued updates performanceFeeAssets and highWaterMark, not totalAssets", async () => {
    let mockDb = await registeredMockDb();
    const event = AgentVault.PerformanceFeeAccrued.createMockEvent({
      operator: OPERATOR,
      feeShares: 10n,
      feeAssets: 15n,
      newHighWaterMark: 12345n,
      mockEventData: { srcAddress: VAULT },
    });
    mockDb = await AgentVault.PerformanceFeeAccrued.processEvent({ event, mockDb });
    const vault = mockDb.entities.Vault.get(VAULT.toLowerCase());
    expect(vault?.performanceFeeAssets).to.equal(15n);
    expect(vault?.highWaterMark).to.equal(12345n);
    expect(vault?.totalAssets).to.equal(0n); // fee is dilutive via shares, not a totalAssets move
  });
});

describe("MarketManager", () => {
  it("MarketOpened creates a Market in the Open/Unresolved state", async () => {
    let mockDb = MockDb.createMockDb();
    const event = MarketManager.MarketOpened.createMockEvent({
      marketId: 1n,
      matchId: 1n,
      templateId: "0xtemplate",
      windowStart: 600n,
      windowEnd: 720n,
      closesAt: 3600n,
      teamFilter: 0n,
    });
    mockDb = await MarketManager.MarketOpened.processEvent({ event, mockDb });

    const market = mockDb.entities.Market.get("1");
    expect(market).to.deep.include({
      match_id: "1",
      state: "Open",
      outcome: "Unresolved",
      qualifyingEventTs: 0n,
    });
  });

  it("MarketResolved decodes the Outcome enum and records qualifyingEventTs", async () => {
    let mockDb = MockDb.createMockDb();
    const opened = MarketManager.MarketOpened.createMockEvent({ marketId: 1n, matchId: 1n });
    mockDb = await MarketManager.MarketOpened.processEvent({ event: opened, mockDb });

    const resolved = MarketManager.MarketResolved.createMockEvent({
      marketId: 1n,
      outcome: 1n, // Yes
      qualifyingEventTs: 555n,
    });
    mockDb = await MarketManager.MarketResolved.processEvent({ event: resolved, mockDb });

    const market = mockDb.entities.Market.get("1");
    expect(market).to.deep.include({ state: "Resolved", outcome: "Yes", qualifyingEventTs: 555n });
  });

  it("MarketVoided sets state Voided and outcome Void", async () => {
    let mockDb = MockDb.createMockDb();
    const opened = MarketManager.MarketOpened.createMockEvent({ marketId: 1n, matchId: 1n });
    mockDb = await MarketManager.MarketOpened.processEvent({ event: opened, mockDb });

    const voided = MarketManager.MarketVoided.createMockEvent({ marketId: 1n, reason: "0xdead" });
    mockDb = await MarketManager.MarketVoided.processEvent({ event: voided, mockDb });

    expect(mockDb.entities.Market.get("1")).to.deep.include({ state: "Voided", outcome: "Void" });
  });
});

describe("BetRouter", () => {
  async function withAgentMockDb() {
    let mockDb = MockDb.createMockDb();
    const event = AgentRegistry.AgentRegistered.createMockEvent({ agentId: 1n, vault: VAULT });
    mockDb = await AgentRegistry.AgentRegistered.processEvent({ event, mockDb });
    return mockDb;
  }

  it("BetPlaced creates a Bet and adds its stake to the agent's volume", async () => {
    let mockDb = await withAgentMockDb();
    const event = BetRouter.BetPlaced.createMockEvent({
      betId: 1n,
      marketId: 1n,
      bettor: BETTOR,
      groupId: 1n,
      agentId: 1n,
      side: 0n, // Yes
      probBps: 4500n,
      stake: 15_000_000n,
      payout: 33_000_000n,
    });
    mockDb = await BetRouter.BetPlaced.processEvent({ event, mockDb });

    const bet = mockDb.entities.Bet.get("1");
    expect(bet).to.deep.include({
      bettor: BETTOR.toLowerCase(),
      agent_id: "1",
      side: "Yes",
      probBps: 4500,
      stake: 15_000_000n,
      status: "Open",
    });
    expect(mockDb.entities.Agent.get("1")?.volume).to.equal(15_000_000n);
  });

  it("volume accumulates across several bets against the same agent", async () => {
    let mockDb = await withAgentMockDb();
    for (const [betId, stake] of [
      [1n, 10_000_000n],
      [2n, 25_000_000n],
    ] as const) {
      const event = BetRouter.BetPlaced.createMockEvent({
        betId,
        marketId: 1n,
        agentId: 1n,
        stake,
      });
      mockDb = await BetRouter.BetPlaced.processEvent({ event, mockDb });
    }
    expect(mockDb.entities.Agent.get("1")?.volume).to.equal(35_000_000n);
  });

  it("BetSettled Won (bettor won) increments the agent's betsLost, not betsWon", async () => {
    let mockDb = await withAgentMockDb();
    const placed = BetRouter.BetPlaced.createMockEvent({ betId: 1n, marketId: 1n, agentId: 1n });
    mockDb = await BetRouter.BetPlaced.processEvent({ event: placed, mockDb });

    const settled = BetRouter.BetSettled.createMockEvent({
      betId: 1n,
      marketId: 1n,
      status: 2n, // BetStatus.Won, bettor's perspective
      amountOwed: 100n,
    });
    mockDb = await BetRouter.BetSettled.processEvent({ event: settled, mockDb });

    expect(mockDb.entities.Bet.get("1")?.status).to.equal("Won");
    const agent = mockDb.entities.Agent.get("1");
    expect(agent?.betsLost).to.equal(1);
    expect(agent?.betsWon).to.equal(0);
  });

  it("BetSettled Lost (bettor lost) increments the agent's betsWon, not betsLost", async () => {
    let mockDb = await withAgentMockDb();
    const placed = BetRouter.BetPlaced.createMockEvent({ betId: 1n, marketId: 1n, agentId: 1n });
    mockDb = await BetRouter.BetPlaced.processEvent({ event: placed, mockDb });

    const settled = BetRouter.BetSettled.createMockEvent({
      betId: 1n,
      marketId: 1n,
      status: 3n, // BetStatus.Lost
      amountOwed: 0n,
    });
    mockDb = await BetRouter.BetSettled.processEvent({ event: settled, mockDb });

    const agent = mockDb.entities.Agent.get("1");
    expect(agent?.betsWon).to.equal(1);
    expect(agent?.betsLost).to.equal(0);
  });

  it("BetSettled Voided increments the agent's betsVoided", async () => {
    let mockDb = await withAgentMockDb();
    const placed = BetRouter.BetPlaced.createMockEvent({ betId: 1n, marketId: 1n, agentId: 1n });
    mockDb = await BetRouter.BetPlaced.processEvent({ event: placed, mockDb });

    const settled = BetRouter.BetSettled.createMockEvent({
      betId: 1n,
      marketId: 1n,
      status: 4n, // BetStatus.Voided
      amountOwed: 0n,
    });
    mockDb = await BetRouter.BetSettled.processEvent({ event: settled, mockDb });

    expect(mockDb.entities.Agent.get("1")?.betsVoided).to.equal(1);
  });

  it("BetVoidedBySniperRule only sets the flag -- it doesn't touch status itself", async () => {
    let mockDb = await withAgentMockDb();
    const placed = BetRouter.BetPlaced.createMockEvent({ betId: 1n, marketId: 1n, agentId: 1n });
    mockDb = await BetRouter.BetPlaced.processEvent({ event: placed, mockDb });

    const sniperFlag = BetRouter.BetVoidedBySniperRule.createMockEvent({
      betId: 1n,
      marketId: 1n,
      placedAt: 100n,
      qualifyingEventTs: 105n,
    });
    mockDb = await BetRouter.BetVoidedBySniperRule.processEvent({ event: sniperFlag, mockDb });

    const bet = mockDb.entities.Bet.get("1");
    expect(bet?.voidedBySniperRule).to.equal(true);
    expect(bet?.status).to.equal("Open"); // unchanged -- BetSettled owns this transition
  });

  it("BetClaimed records claimedAt and claimedAmount", async () => {
    let mockDb = await withAgentMockDb();
    const placed = BetRouter.BetPlaced.createMockEvent({ betId: 1n, marketId: 1n, agentId: 1n });
    mockDb = await BetRouter.BetPlaced.processEvent({ event: placed, mockDb });

    const claimed = BetRouter.BetClaimed.createMockEvent({
      betId: 1n,
      bettor: BETTOR,
      amount: 42_000_000n,
    });
    mockDb = await BetRouter.BetClaimed.processEvent({ event: claimed, mockDb });

    const bet = mockDb.entities.Bet.get("1");
    expect(bet?.claimedAmount).to.equal(42_000_000n);
    expect(bet?.claimedAt).to.not.be.undefined;
  });
});
