import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { initWorkflow, onMarketClosed } from './workflow'

const makeConfig = () => ({
  evms: [
    {
      chainSelectorName: 'monad-testnet',
      marketManagerAddress: '0x22D999156f35Ba81dC865AF6EA042fC185a13347' as Address,
      settlementReceiverAddress: '0xE8b13f1A5f37177790864E151A3ccb4B80cAb6D8' as Address,
      gasLimit: '800000',
    },
  ],
  matchDataBaseUrl: 'http://localhost:8080',
  matchDatasetIds: { '2': '1694390' },
})

describe('initWorkflow', () => {
  test('returns exactly one log trigger handler bound to onMarketClosed', () => {
    const handlers = initWorkflow(makeConfig())

    expect(handlers).toHaveLength(1)
    expect(handlers[0].fn).toBe(onMarketClosed)

    const trigger = handlers[0].trigger as {
      adapt: (raw: any) => any
      configAsAny: () => any
    }
    expect(typeof trigger.adapt).toBe('function')
    expect(typeof trigger.configAsAny).toBe('function')
  })

  test('throws for an unknown chain selector name', () => {
    const config = makeConfig()
    config.evms[0].chainSelectorName = 'not-a-real-chain'

    expect(() => initWorkflow(config)).toThrow('Network not found: not-a-real-chain')
  })
})
