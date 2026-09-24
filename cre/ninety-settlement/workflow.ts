import { secp256k1 } from '@noble/curves/secp256k1'
import {
  bytesToHex,
  ConsensusAggregationByFields,
  cre,
  getNetwork,
  identical,
  TxStatus,
  type HTTPSendRequester,
  type Runtime,
} from '@chainlink/cre-sdk'
import {
  type Address,
  concatHex,
  encodeAbiParameters,
  type Hex,
  hexToBytes,
  keccak256,
  numberToHex,
  parseAbiParameters,
  toBytes,
} from 'viem'
import { z } from 'zod'
import { MarketManager, type DecodedLog, type MarketClosedDecoded } from '../contracts/evm/ts/generated/MarketManager'
import { SettlementReceiver } from '../contracts/evm/ts/generated/SettlementReceiver'

// ─── Config Schema ──────────────────────────────────────────
export const configSchema = z.object({
  evms: z.array(
    z.object({
      chainSelectorName: z.string(),
      marketManagerAddress: z.string(),
      settlementReceiverAddress: z.string(),
      gasLimit: z.string().optional(),
    }),
  ).min(1),
  // Base URL of the match-data replay service (see packages/match-data). This is our own
  // service, not a third-party API -- CRE's HTTP consensus still protects against a single
  // tampered DON response, but not against the service itself being wrong. That limitation is
  // deliberate and documented (see resolveMarket's doc comment in packages/core/src/resolution.ts)
  // and applies equally to a licensed data provider standing in for it later.
  matchDataBaseUrl: z.string(),
  // On-chain matchId (as a JSON string key) -> the match-data service's own match id. The two are
  // deliberately decoupled (see the match-data server's /settlement route comment), so this
  // mapping is the one place that ties a running match back to its on-chain identity. Kept as
  // static config rather than derived from an on-chain read or a historical log query, which
  // keeps the workflow simple and reliable to demo -- see CLAUDE.md's own stated preference for
  // designs that are simplest to demo reliably.
  matchDatasetIds: z.record(z.string(), z.string()),
})
export type Config = z.infer<typeof configSchema>

// Outcome byte values, matching MarketReport.outcome in ISettlementReceiver.sol.
const OUTCOME_YES = 1
const OUTCOME_NO = 2

// Protocol-fixed template ids: keccak256(name), computed identically to MarketManager.setTemplate
// and packages/core/src/templates.ts. Reproduced here rather than imported: this workflow builds
// with its own Bun toolchain outside the pnpm workspace (CRE requires Bun; mixing it into the
// pnpm workspace causes lockfile conflicts -- see the repo's architecture notes), so it can't
// resolve a workspace package the way the web app or agent runner do.
const TEMPLATE_NAMES = ['SHOT_ON_TARGET_NEXT_N', 'CORNER_NEXT_N', 'CARD_NEXT_N', 'GOAL_NEXT_N'] as const
type TemplateName = (typeof TEMPLATE_NAMES)[number]
const TEMPLATE_NAME_BY_ID: Record<string, TemplateName> = Object.fromEntries(
  TEMPLATE_NAMES.map((name) => [keccak256(toBytes(name)), name]),
)

// MarketState enum ordinal, matching IMarketManager.sol: None, Open, Suspended, Closed, Resolved, Voided.
const MARKET_STATE_CLOSED = 3

// ─── Types ───────────────────────────────────────────────────

interface SettlementFetch {
  outcome: 'Yes' | 'No'
  qualifyingEventTsWallClock: number
  evidenceEventIds: number[]
}

interface FetchConfig {
  url: string
}

// ─── Helpers ─────────────────────────────────────────────────

const safeJsonStringify = (obj: unknown): string =>
  JSON.stringify(obj, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2)

/**
 * Signs `digest` with a plain secp256k1 private key and packs the result as `r || s || v`
 * (65 bytes, v = 27/28) -- the format OpenZeppelin's `ECDSA.recover` expects, and the same format
 * `contracts/script/smoke/SettleViaSim.s.sol`'s `vm.sign` produces. Uses `@noble/curves` directly
 * rather than viem's `sign()`, which wraps the same underlying (synchronous) primitive in a
 * `Promise` -- this workflow's capability calls block synchronously via `.result()`, so a plain
 * synchronous signature avoids introducing the only async code path in the whole callback.
 */
function signDigest(digest: Hex, privateKey: Hex): Hex {
  const sig = secp256k1.sign(hexToBytes(digest), hexToBytes(privateKey))
  const r = numberToHex(sig.r, { size: 32 })
  const s = numberToHex(sig.s, { size: 32 })
  const v = numberToHex(sig.recovery + 27, { size: 1 })
  return concatHex([r, s, v])
}

const SETTLEMENT_REPORT_PARAMS = parseAbiParameters(
  '(uint64 matchId, uint64 asOfMatchClock, uint64 producedAt, (uint256 marketId, uint8 outcome, uint64 qualifyingEventTs, bytes32 evidenceHash)[] markets) report',
)

const REPORT_PAYLOAD_PARAMS = parseAbiParameters(
  '(uint64 matchId, uint64 asOfMatchClock, uint64 producedAt, (uint256 marketId, uint8 outcome, uint64 qualifyingEventTs, bytes32 evidenceHash)[] markets) report, bytes simSig',
)

interface SettlementReportTuple {
  matchId: bigint
  asOfMatchClock: bigint
  producedAt: bigint
  markets: readonly {
    marketId: bigint
    outcome: number
    qualifyingEventTs: bigint
    evidenceHash: Hex
  }[]
}

/**
 * `keccak256(abi.encode(chainid, receiver, simNonce[matchId], keccak256(abi.encode(rpt))))` --
 * the exact digest `SettlementReceiver._requireValidSimSignature` recovers against. Must stay
 * byte-for-byte identical to that Solidity computation; see SettlementReceiver.sol for the
 * canonical version this is derived from.
 */
function simAttestationDigest(
  chainId: bigint,
  receiver: Address,
  nonce: bigint,
  report: SettlementReportTuple,
): Hex {
  const reportHash = keccak256(encodeAbiParameters(SETTLEMENT_REPORT_PARAMS, [report]))
  return keccak256(
    encodeAbiParameters(
      parseAbiParameters('uint256 chainId, address receiver, uint256 nonce, bytes32 reportHash'),
      [chainId, receiver, nonce, reportHash],
    ),
  )
}

/**
 * Fetches a market's settlement from our own match-data replay service. Runs inside the DON's
 * BFT consensus layer: each node calls the same URL, and `ConsensusAggregationByFields` verifies
 * every node saw the identical response before the value is returned to the callback.
 */
export const fetchSettlement = (
  sendRequester: HTTPSendRequester,
  config: FetchConfig,
): SettlementFetch => {
  const response = sendRequester.sendRequest({ url: config.url, method: 'GET' }).result()

  if (response.statusCode !== 200) {
    throw new Error(`match-data settlement endpoint returned HTTP ${response.statusCode}`)
  }

  const body = JSON.parse(Buffer.from(response.body).toString('utf-8'))

  if (body.outcome !== 'Yes' && body.outcome !== 'No') {
    throw new Error(`unexpected outcome value: ${JSON.stringify(body.outcome)}`)
  }
  if (!Array.isArray(body.evidenceEventIds)) {
    throw new Error('missing evidenceEventIds in settlement response')
  }

  return {
    outcome: body.outcome,
    qualifyingEventTsWallClock: Number(body.qualifyingEventTsWallClock ?? 0),
    evidenceEventIds: body.evidenceEventIds,
  }
}

// ─── Callback ────────────────────────────────────────────────

export const onMarketClosed = (
  runtime: Runtime<Config>,
  log: DecodedLog<MarketClosedDecoded>,
): string => {
  const evmConfig = runtime.config.evms[0]
  const { marketId } = log.data

  runtime.log(`MarketClosed: marketId=${marketId}`)

  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: evmConfig.chainSelectorName })
  if (!network) throw new Error(`Network not found: ${evmConfig.chainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const marketManager = new MarketManager(evmClient, evmConfig.marketManagerAddress as Address)
  const settlementReceiver = new SettlementReceiver(evmClient, evmConfig.settlementReceiverAddress as Address)

  // 1. Guard read -- skip if this market isn't actually waiting on us (already resolved/voided,
  // or the log fired for some other reason).
  const market = marketManager.getMarket(runtime, marketId)
  if (market.state !== MARKET_STATE_CLOSED) {
    runtime.log(`Market ${marketId} is not Closed (state=${market.state}); skipping`)
    return safeJsonStringify({ marketId: marketId.toString(), status: 'skipped_not_closed', state: market.state })
  }

  const templateName = TEMPLATE_NAME_BY_ID[market.templateId]
  if (!templateName) throw new Error(`Unknown templateId: ${market.templateId}`)

  const datasetId = runtime.config.matchDatasetIds[market.matchId.toString()]
  if (!datasetId) {
    throw new Error(`No matchDatasetIds entry for on-chain matchId ${market.matchId}`)
  }

  // 2. Fetch the outcome from our match-data service (BFT-verified via DON consensus).
  const url =
    `${runtime.config.matchDataBaseUrl}/matches/${datasetId}/settlement` +
    `?template=${templateName}&windowStart=${market.windowStart}&windowEnd=${market.windowEnd}`
  runtime.log(`Fetching: ${url}`)

  const httpClient = new cre.capabilities.HTTPClient()
  const result = httpClient
    .sendRequest(
      runtime,
      fetchSettlement,
      ConsensusAggregationByFields<SettlementFetch>({
        outcome: identical,
        qualifyingEventTsWallClock: identical,
        evidenceEventIds: identical,
      }),
    )({ url })
    .result()

  runtime.log(`Settlement result: ${safeJsonStringify(result)}`)

  // 3. Build the report. `producedAt` uses the market's own `closesAt` rather than wall-clock
  // "now": it's a deterministic on-chain read (identical on every DON node), and it strictly
  // increases across a match's successive windows, which is exactly what
  // SettlementReceiver's staleness check on `lastProducedAt[matchId]` needs.
  const outcomeByte = result.outcome === 'Yes' ? OUTCOME_YES : OUTCOME_NO
  const qualifyingEventTs = result.outcome === 'Yes' ? BigInt(result.qualifyingEventTsWallClock) : 0n
  const evidenceHash = keccak256(
    encodeAbiParameters(parseAbiParameters('uint256[]'), [result.evidenceEventIds.map(BigInt)]),
  )

  const report: SettlementReportTuple = {
    matchId: market.matchId,
    asOfMatchClock: BigInt(market.windowEnd),
    producedAt: market.closesAt,
    markets: [{ marketId, outcome: outcomeByte, qualifyingEventTs, evidenceHash }],
  }

  // 4. The simulation forwarder (used while real CRE deploy access is pending) performs no
  // signature verification of its own, so SettlementReceiver requires an independent signature
  // over the report from a key it trusts (`simAttestor`) whenever a report arrives through that
  // forwarder specifically -- the production forwarder path ignores this signature entirely. See
  // docs/cre-forwarder-trust-model.md for the full reasoning.
  const simAttestorKey = runtime.getSecret({ id: 'SIM_ATTESTOR_PRIVATE_KEY' }).result().value as Hex
  const simNonce = settlementReceiver.simNonce(runtime, market.matchId)
  const digest = simAttestationDigest(BigInt(network.chainId), settlementReceiver.address, simNonce, report)
  const simSig = signDigest(digest, simAttestorKey)

  const payload = encodeAbiParameters(REPORT_PAYLOAD_PARAMS, [report, simSig])

  // 5. Submit. `runtime.report()` wraps `payload` in a DON-signed report envelope; the forwarder
  // verifies that envelope before ever calling `onReport`, and `simSig` above is the second,
  // independent check our own contract adds for the unauthenticated simulation forwarder.
  const resp = settlementReceiver.writeReport(runtime, payload, {
    gasLimit: evmConfig.gasLimit ?? '800000',
  })

  if (resp.txStatus !== TxStatus.SUCCESS) {
    throw new Error(`Settlement TX failed: ${resp.errorMessage ?? resp.txStatus}`)
  }

  const txHash = bytesToHex(resp.txHash ?? new Uint8Array(32))
  runtime.log(`Market ${marketId} settled! Outcome: ${outcomeByte}, TX: ${txHash}`)

  return safeJsonStringify({
    marketId: marketId.toString(),
    matchId: market.matchId.toString(),
    outcome: outcomeByte,
    qualifyingEventTs: qualifyingEventTs.toString(),
    txHash,
  })
}

// ─── Workflow Init ────────────────────────────────────────────

export function initWorkflow(config: Config) {
  const evmConfig = config.evms[0]

  const network = getNetwork({ chainFamily: 'evm', chainSelectorName: evmConfig.chainSelectorName })
  if (!network) throw new Error(`Network not found: ${evmConfig.chainSelectorName}`)

  const evmClient = new cre.capabilities.EVMClient(network.chainSelector.selector)
  const marketManager = new MarketManager(evmClient, evmConfig.marketManagerAddress as Address)

  return [cre.handler(marketManager.logTriggerMarketClosed(), onMarketClosed)]
}
