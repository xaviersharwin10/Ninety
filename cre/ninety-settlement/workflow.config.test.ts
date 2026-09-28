import { describe, expect, test } from 'bun:test'
import { configSchema } from './workflow'

const validEvm = {
  chainSelectorName: 'monad-testnet',
  marketManagerAddress: '0x7CB80d9De72273db78e013Fdb2180023A9152b88',
  settlementReceiverAddress: '0xc00496c616EaA9f4B7fC59F68D0B461AFF16D5d9',
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
