import { describe, expect, test } from 'bun:test'
import type { Address } from 'viem'
import { initWorkflow, onMarketClosed } from './workflow'

const makeConfig = () => ({
  evms: [
    {
      chainSelectorName: 'monad-testnet',
      marketManagerAddress: '0x7CB80d9De72273db78e013Fdb2180023A9152b88' as Address,
      settlementReceiverAddress: '0xc00496c616EaA9f4B7fC59F68D0B461AFF16D5d9' as Address,
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
