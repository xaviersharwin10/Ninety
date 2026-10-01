import { describe, expect, it, vi } from "vitest";

vi.mock("@metamask/agent-wallet/plugin", () => import("./sdk-mock.js"));

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

  it("hands the transaction to the Agent Wallet's executor on Monad testnet, with a plain summary", async () => {
    const { ctx: c, requests } = ctx(
      {},
      { kind: "transaction", status: "CONFIRMED", hash: "0xfeed" },
    );
    const sent = await send(c, io, "ninety:bet", tx, "Bet 5 nUSD on YES");
    expect(requests).toEqual([
      {
        kind: "transaction",
        chainId: 10143,
        transaction: { to: A, data: "0xabcd", value: "0x0" },
        intent: { action: "custom", summary: "Bet 5 nUSD on YES" },
      },
    ]);
    expect(sent.explorerUrl).toBe("https://testnet.monadexplorer.com/tx/0xfeed");
  });

  it("reports a transaction waiting on the owner's approval, without failing", async () => {
    const { ctx: c } = ctx(
      {},
      { kind: "transaction", status: "AWAITING_MFA", pendingJob: { pollingId: "p1" } },
    );
    expect(await send(c, io, "ninety:bet", tx, "x")).toEqual({
      status: "AWAITING_MFA",
      pollingId: "p1",
    });
  });

  it("fails loudly when the wallet refused or the transaction failed", async () => {
    const { ctx: c } = ctx(
      {},
      { kind: "transaction", status: "DENIED", failureDescription: "blocked" },
    );
    await expect(send(c, io, "ninety:bet", tx, "Bet")).rejects.toThrow(/DENIED: blocked/);
  });
});
