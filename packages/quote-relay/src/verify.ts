import { QUOTE_TYPES, type Quote, quoteDomain } from "@ninety/core";
import { type Address, recoverTypedDataAddress } from "viem";

/**
 * Structural, domain-bound signature verification only — recovers whether *some* signer produced
 * this signature over this quote under this chain's `BetRouter` domain. Deliberately does not
 * check whether that signer is a registered, enabled agent's quote signer: the relay is
 * stateless and untrusted by design (see the architecture notes), and checking `isQuotable`
 * would mean an RPC dependency here purely to reject early what `BetRouter.placeBet` already
 * rejects for free on chain. A relay that served an unregistered agent's quote could only ever
 * hand the fan a worse deal, never a dangerous one — the contract is the actual backstop.
 */
export async function isStructurallyValid(
  quote: Quote,
  signature: `0x${string}`,
  chainId: number,
  betRouter: Address,
): Promise<{ valid: true; signer: Address } | { valid: false; reason: string }> {
  if (quote.expiry <= BigInt(Math.floor(Date.now() / 1000))) {
    return { valid: false, reason: "quote already expired" };
  }

  try {
    const signer = await recoverTypedDataAddress({
      domain: quoteDomain(chainId, betRouter),
      types: QUOTE_TYPES,
      primaryType: "Quote",
      message: quote,
      signature,
    });
    return { valid: true, signer };
  } catch (err) {
    return { valid: false, reason: `malformed signature: ${(err as Error).message}` };
  }
}
