import {
  type CommandIO,
  InputFieldType,
  type InputSchema,
  PluginCommand,
  schemaToArgs,
  schemaToFlags,
} from "@metamask/agent-wallet/plugin";
import { freshQuotes, type SignedQuote } from "@ninety/core";
import { marketSchedule, quoteBook } from "../../lib/api.js";
import { odds } from "../../lib/format.js";
import { fixtureName, liveFixture, question } from "../../lib/markets.js";

const inputs = {
  match: {
    type: InputFieldType.Text,
    flag: "match",
    message: "Match id (from `mm ninety matches`); defaults to the match being played now",
    required: false,
    prompt: false,
    index: 0,
  },
} satisfies InputSchema;

interface MarketRow {
  marketId: string;
  question: string;
  /**
   * The best single price on each side right now, or null if nobody is pricing it this second. A
   * bet is split across the best three, so it gets a little less: `mm ninety quote` shows exactly.
   */
  yes: string | null;
  no: string | null;
  /** Roughly how long it takes bets for, in real seconds. */
  closesInSec: number;
}

interface MarketsResult {
  match: string;
  matchMinute: number;
  markets: MarketRow[];
}

function best(quotes: SignedQuote[], side: "yes" | "no"): string | null {
  const live = freshQuotes(quotes);
  if (live.length === 0) return null;
  const prob = Math.min(
    ...live.map((q) => (side === "yes" ? q.quote.probYesBps : q.quote.probNoBps)),
  );
  return odds(prob);
}

export default class NinetyMarkets extends PluginCommand<MarketsResult> {
  static override description =
    'Show the live micro-markets ("Corner in the next 3 min?") with the best YES and NO odds right now';
  static override examples = [
    "<%= config.bin %> ninety markets",
    "<%= config.bin %> ninety markets --match 2058017 --json",
  ];
  static override requiresAuth = false;
  static override requiresInit = false;
  static override flags = schemaToFlags(inputs);
  static override args = schemaToArgs(inputs);
  protected readonly pluginCommandId = "ninety:markets";

  async execute(io: CommandIO): Promise<MarketsResult> {
    const { match } = await io.resolveInputs(inputs);
    const fixture = await liveFixture(match || undefined);
    const schedule = await marketSchedule(fixture.matchId);
    const books = await Promise.all(schedule.openMarkets.map((m) => quoteBook(m.marketId)));
    return {
      match: fixtureName(fixture),
      matchMinute: Math.floor(schedule.matchClockSec / 60),
      markets: schedule.openMarkets.map((m, i) => ({
        marketId: m.marketId,
        question: question(m.templateIdx),
        yes: best(books[i]!.yes, "yes"),
        no: best(books[i]!.no, "no"),
        closesInSec: Math.max(
          0,
          Math.round((m.windowEnd - schedule.matchClockSec) / schedule.speed),
        ),
      })),
    };
  }

  override successHint(data: MarketsResult): string {
    if (data.markets.length === 0) {
      return `${data.match}, ${data.matchMinute}'. No market open this moment; a new one opens every couple of match minutes.`;
    }
    const lines = data.markets.map(
      (m) =>
        `#${m.marketId}  ${m.question}  ${m.yes && m.no ? `YES ${m.yes}  NO ${m.no}` : "pricing…"}  (closes in ~${m.closesInSec}s)`,
    );
    const note = data.markets.some((m) => !m.yes || !m.no)
      ? "Prices appear a few seconds after a market opens, and pause around big moments."
      : "Best prices shown; a bet splits across the top three. Preview exactly with `mm ninety quote <marketId> <yes|no> <nUSD>`.";
    return [`${data.match}, ${data.matchMinute}'`, ...lines, note].join("\n");
  }
}
