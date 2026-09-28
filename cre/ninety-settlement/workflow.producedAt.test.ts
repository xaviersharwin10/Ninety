import { describe, expect, test } from 'bun:test'
import { numberToBytes } from 'viem'
import { reportProducedAt } from './workflow'

// The shape a real trigger log carries: a protobuf BigInt message, big-endian magnitude bytes.
const logAt = (blockNumber: bigint, txIndex: number) => ({
  blockNumber: { absVal: numberToBytes(blockNumber), sign: 1n } as any,
  txIndex,
})

describe('reportProducedAt', () => {
  test('increases with block number', () => {
    expect(reportProducedAt(logAt(66_450_001n, 0))).toBeGreaterThan(
      reportProducedAt(logAt(66_450_000n, 9_999)),
    )
  })

  test('orders two closes in the same block by transaction index', () => {
    expect(reportProducedAt(logAt(66_450_000n, 3))).toBeGreaterThan(
      reportProducedAt(logAt(66_450_000n, 2)),
    )
  })

  test('sits above the closesAt-based values earlier reports used, so switching never goes stale', () => {
    // The largest producedAt accepted under the old scheme was a unix timestamp (~1.79e9).
    expect(reportProducedAt(logAt(66_448_317n, 0))).toBeGreaterThan(1_790_611_995n)
  })

  test('throws when the log has no block number', () => {
    expect(() => reportProducedAt({ txIndex: 0 })).toThrow('no blockNumber')
  })
})
