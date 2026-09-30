import { type SettledBet, TEMPLATE_NAME_BY_ID } from "@ninety/core";

interface IndexedAgentBet {
  id: string;
  status: string;
  stake: string;
  payout: string;
  market: { templateId: string };
}

/**
 * Every settled bet an agent has priced, from the indexer, from the agent's own side of the table
 * -- what `learn` (in @ninety/core) folds into its memory. The same query the web app runs for an
 * operator's own agent (web/lib/agent-memory.ts).
 */
export async function fetchSettledBets(indexerUrl: string, agentId: number): Promise<SettledBet[]> {
  const res = await fetch(indexerUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: `query($a: String!) {
        Bet(where: { agent_id: { _eq: $a }, status: { _in: ["Won", "Lost", "Voided"] } }) {
          id status stake payout market { templateId }
        }
      }`,
      variables: { a: String(agentId) },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as { data?: { Bet: IndexedAgentBet[] } };
  if (!body.data) throw new Error(`indexer query failed: HTTP ${res.status}`);
  return body.data.Bet.flatMap((b) => {
    const template = TEMPLATE_NAME_BY_ID[b.market.templateId];
    if (!template) return [];
    // Bet.status is the bettor's result: a bet the bettor Won is one the agent paid out on.
    const agentPnl =
      b.status === "Lost"
        ? BigInt(b.stake)
        : b.status === "Won"
          ? BigInt(b.stake) - BigInt(b.payout)
          : 0n;
    return [{ id: Number(b.id), template, agentPnl }];
  });
}
