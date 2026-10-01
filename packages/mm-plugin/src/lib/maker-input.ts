import { CommandError, InputFieldType } from "@metamask/agent-wallet/plugin";
import { findMarketMaker, type MarketMaker } from "./chain.js";

export const makerField = {
  type: InputFieldType.Text,
  flag: "agent",
  message: "Market maker, by name or id (see `mm ninety agents`)",
  required: true,
  index: 0,
} as const;

export function resolveMaker(all: MarketMaker[], query: string): MarketMaker {
  const m = findMarketMaker(all, query);
  if (!m || !m.enabled) {
    throw new CommandError(
      "NINETY_UNKNOWN_AGENT",
      `There's no active market maker called "${query}".`,
      "See them with `mm ninety agents`.",
    );
  }
  return m;
}
