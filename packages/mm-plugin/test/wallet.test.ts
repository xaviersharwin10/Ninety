import { describe, expect, it, vi } from "vitest";

vi.mock("@metamask/agent-wallet/plugin", () => import("./sdk-mock.js"));
const estimateGas = vi.fn(async () => 100_000n);
const waitForTransactionReceipt = vi.fn(async () => ({ status: "success" }));
vi.mock("../src/lib/chain.js", () => ({
  monad: () => ({
    estimateGas,
    waitForTransactionReceipt,
    estimateFeesPerGas: async () => ({
      maxFeePerGas: 102n * 10n ** 9n,
      maxPriorityFeePerGas: 2n * 10n ** 9n,
    }),
  }),
}));

const { send, walletAddress } = await import("../src/lib/wallet.js");

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";

function ctx(state: unknown, result?: unknown) {
  const requests: unknown[] = [];
  return {
    requests,
    ctx: {
      walletStateManager: { read: () => state },
      walletExecutor: async () => async (req: unknown) => {
        requests.push(req);
        return result;
      },
    } as never,
  };
}

describe("walletAddress", () => {
  it("is the wallet the Agent Wallet has selected", () => {
    const state = {
      selectedWallet: { ref: { id: "w2" } },
      remoteWallets: [{ id: "w1", address: A }],
      byokWallets: [{ id: "w2", address: B }],
    };
    expect(walletAddress(ctx(state).ctx)).toBe(B);
  });

  it("asks for `mm init` when there's no wallet", () => {
    expect(() => walletAddress(ctx({ remoteWallets: [], byokWallets: [] }).ctx)).toThrow(
      expect.objectContaining({ code: "NINETY_NO_WALLET", hint: expect.stringMatching(/mm init/) }),
    );
  });
});

describe("send", () => {
  const io = { signal: new AbortController().signal } as never;
  const tx = { to: A as `0x${string}`, data: "0xabcd" as `0x${string}` };
  const wallet = { remoteWallets: [{ id: "w1", address: A }], byokWallets: [] };

  it("hands the transaction to the Agent Wallet's executor on Monad testnet, with a plain summary", async () => {
    const { ctx: c, requests } = ctx(wallet, {
      kind: "transaction",
      status: "CONFIRMED",
      hash: "0xfeed",
    });
    const sent = await send(c, io, "ninety:bet", tx, "Bet 5 nUSD on YES");
    expect(requests).toEqual([
      {
        kind: "transaction",
        chainId: 10143,
        transaction: {
          to: A,
          data: "0xabcd",
          value: 0n,
          gas: 120_000n, // the estimate plus 20%
          maxFeePerGas: 102n * 10n ** 9n,
          maxPriorityFeePerGas: 2n * 10n ** 9n,
        },
        intent: { action: "custom", summary: "Bet 5 nUSD on YES" },
      },
    ]);
    expect(sent.explorerUrl).toBe("https://testnet.monadexplorer.com/tx/0xfeed");
  });

  it("reports a transaction waiting on the owner's approval, without failing", async () => {
    const { ctx: c } = ctx(wallet, {
      kind: "transaction",
      status: "AWAITING_MFA",
      pendingJob: { pollingId: "p1" },
    });
    expect(await send(c, io, "ninety:bet", tx, "x")).toEqual({
      status: "AWAITING_MFA",
      pollingId: "p1",
    });
  });

  it("fails loudly when the wallet refused or the transaction failed", async () => {
    const { ctx: c } = ctx(wallet, {
      kind: "transaction",
      status: "DENIED",
      failureDescription: "blocked",
    });
    await expect(send(c, io, "ninety:bet", tx, "Bet")).rejects.toThrow(/DENIED: blocked/);
  });

  it("confirms a broadcast transaction from its receipt, where the wallet doesn't track it", async () => {
    const { ctx: c } = ctx(wallet, { kind: "transaction", status: "BROADCASTED", hash: "0xbeef" });
    expect(await send(c, io, "ninety:bet", tx, "x")).toMatchObject({
      status: "CONFIRMED",
      hash: "0xbeef",
    });
    waitForTransactionReceipt.mockResolvedValueOnce({ status: "reverted" });
    await expect(send(c, io, "ninety:bet", tx, "Bet")).rejects.toThrow(/reverted onchain/);
  });

  it("never sends a transaction that would revert", async () => {
    estimateGas.mockRejectedValueOnce(
      Object.assign(new Error("x"), { shortMessage: "QuoteExpired()" }),
    );
    const { ctx: c, requests } = ctx(wallet, { kind: "transaction", status: "CONFIRMED" });
    await expect(send(c, io, "ninety:bet", tx, "Bet")).rejects.toThrow(/QuoteExpired/);
    expect(requests).toEqual([]);
  });
});
