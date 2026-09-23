import { fileURLToPath } from "node:url";
import { QuoteRelay } from "./server.js";

export { QuoteBook, type StoredQuote } from "./book.js";
export { QuoteRelay } from "./server.js";
export { isStructurallyValid } from "./verify.js";

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.QUOTE_RELAY_PORT ?? 8081);
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 10143);
  const betRouter = process.env.NEXT_PUBLIC_BET_ROUTER as `0x${string}` | undefined;
  if (!betRouter) {
    throw new Error("NEXT_PUBLIC_BET_ROUTER must be set to the deployed BetRouter address");
  }

  const relay = new QuoteRelay({ chainId, betRouter });
  relay.listen(port).then((boundPort) => {
    console.log(`quote-relay listening on :${boundPort}`);
  });
}
