import { describe, expect } from 'bun:test'
import { getNetwork } from '@chainlink/cre-sdk'
import { EvmMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import type { Address } from 'viem'
import { newMarketManagerMock } from '../contracts/evm/ts/generated/MarketManager_mock'
import { onMarketClosed } from './workflow'

const MARKET_MANAGER = '0x22D999156f35Ba81dC865AF6EA042fC185a13347' as Address
const SETTLEMENT_RECEIVER = '0xE8b13f1A5f37177790864E151A3ccb4B80cAb6D8' as Address

const network = getNetwork({ chainFamily: 'evm', chainSelectorName: 'monad-testnet' })
if (!network) throw new Error('monad-testnet not found in chain-selectors registry')

const makeRuntime = () => {
  const runtime = newTestRuntime()
  ;(runtime as any).config = {
    evms: [
      {
        chainSelectorName: 'monad-testnet',
        marketManagerAddress: MARKET_MANAGER,
        settlementReceiverAddress: SETTLEMENT_RECEIVER,
        gasLimit: '800000',
      },
    ],
    matchDataBaseUrl: 'http://localhost:8080',
    matchDatasetIds: { '2': '1694390' },
  }
  return runtime
}

const baseMarket = {
  matchId: 2n,
  templateId: '0x54681f6f35a566cddc43813291c434f0a3ed5f9149095d5cbbde4e85cc62febe' as const,
  windowStart: 0,
  windowEnd: 120,
  openedAt: 1790214345n,
  closesAt: 1790214361n,
  qualifyingEventTs: 0n,
  teamFilter: 0,
}

describe('onMarketClosed', () => {
  test('skips resolution when the market is already Resolved on-chain', () => {
    const evmMock = EvmMock.testInstance(network.chainSelector.selector)
    const marketManagerMock = newMarketManagerMock(MARKET_MANAGER, evmMock)
    // MarketState: None=0, Open=1, Suspended=2, Closed=3, Resolved=4, Voided=5.
    marketManagerMock.getMarket = () => ({ ...baseMarket, state: 4, outcome: 1 })

    const result = JSON.parse(
      onMarketClosed(makeRuntime() as any, { data: { marketId: 3n } } as any),
    )

    expect(result).toEqual({ marketId: '3', status: 'skipped_not_closed', state: 4 })
  })

  test('skips resolution when the market is still Open on-chain', () => {
    const evmMock = EvmMock.testInstance(network.chainSelector.selector)
    const marketManagerMock = newMarketManagerMock(MARKET_MANAGER, evmMock)
    marketManagerMock.getMarket = () => ({ ...baseMarket, state: 1, outcome: 0 })

    const result = JSON.parse(
      onMarketClosed(makeRuntime() as any, { data: { marketId: 3n } } as any),
    )

    expect(result).toEqual({ marketId: '3', status: 'skipped_not_closed', state: 1 })
  })
})
