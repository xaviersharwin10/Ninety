import { describe, expect, test } from 'bun:test'
import { configSchema } from './workflow'

const validEvm = {
  chainSelectorName: 'monad-testnet',
  marketManagerAddress: '0x22D999156f35Ba81dC865AF6EA042fC185a13347',
  settlementReceiverAddress: '0xE8b13f1A5f37177790864E151A3ccb4B80cAb6D8',
}

describe('configSchema', () => {
  test('requires at least one EVM configuration', () => {
    const result = configSchema.safeParse({
      evms: [],
      matchDataBaseUrl: 'http://localhost:8080',
      matchDatasetIds: {},
    })

    expect(result.success).toBe(false)
  })

  test('accepts a well-formed config', () => {
    const result = configSchema.safeParse({
      evms: [validEvm],
      matchDataBaseUrl: 'http://localhost:8080',
      matchDatasetIds: { '2': '1694390' },
    })

    expect(result.success).toBe(true)
  })

  test('rejects a config missing matchDatasetIds', () => {
    const result = configSchema.safeParse({
      evms: [validEvm],
      matchDataBaseUrl: 'http://localhost:8080',
    })

    expect(result.success).toBe(false)
  })
})
