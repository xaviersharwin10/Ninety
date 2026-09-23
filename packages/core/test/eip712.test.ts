import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { type Quote, signQuote } from "../src/eip712.js";

/**
 * Cross-language pin. Every value below (including `verifyingContract`, a deterministic CREATE
 * address from a specific forge-script run) matches
 * `contracts/script/smoke/PrintQuoteSignature.s.sol` exactly. Re-run that script to regenerate
 * this if the domain (name/version) or the `Quote` struct's field order or types ever change --
 * the point of this test is that it would then fail, rather than the two sides silently drifting.
 */
const CHAIN_ID = 31337;
const VERIFYING_CONTRACT = "0x5aAdFB43eF8dAF45DD80F4676345b7676f1D70e3" as const;
const SIGNER_PRIVATE_KEY = "0x00000000000000000000000000000000000000000000000000000000000a11ce";

const QUOTE: Quote = {
  marketId: 42n,
  agentId: 7,
  probYesBps: 4635,
  probNoBps: 5665,
  maxStake: 25_000_000n,
  expiry: 1_700_000_100n,
  salt: 1234567890n,
};

const EXPECTED_SIGNER = "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
const EXPECTED_SIGNATURE =
  "0xdf698aaa26652b11de42c1baf412d237e56cfa70932d76cf1448956b6166999b2f74c5417c99a845a0bed86e79c1c8b94faf3dbabb6ac09cd8fe9d057f943e3a1c";

describe("signQuote (cross-language pin against Solidity)", () => {
  it("produces byte-identical output to BetRouter's own EIP-712 hashing", async () => {
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    expect(account.address).toBe(EXPECTED_SIGNER); // sanity: same private key, same address

    const signature = await signQuote(account, CHAIN_ID, VERIFYING_CONTRACT, QUOTE);
    expect(signature).toBe(EXPECTED_SIGNATURE);
  });

  it("changing any single field changes the signature", async () => {
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    const mutated: Quote = { ...QUOTE, salt: QUOTE.salt + 1n };
    const signature = await signQuote(account, CHAIN_ID, VERIFYING_CONTRACT, mutated);
    expect(signature).not.toBe(EXPECTED_SIGNATURE);
  });

  it("changing the verifying contract changes the signature (domain separation)", async () => {
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    const otherContract = getAddress("0x000000000000000000000000000000000000dead");
    const signature = await signQuote(account, CHAIN_ID, otherContract, QUOTE);
    expect(signature).not.toBe(EXPECTED_SIGNATURE);
  });

  it("changing the chain id changes the signature (no cross-chain replay)", async () => {
    const account = privateKeyToAccount(SIGNER_PRIVATE_KEY);
    const signature = await signQuote(account, 10143, VERIFYING_CONTRACT, QUOTE);
    expect(signature).not.toBe(EXPECTED_SIGNATURE);
  });
});
