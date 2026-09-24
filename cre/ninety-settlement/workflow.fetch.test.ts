import { describe, expect, test } from 'bun:test'
import { fetchSettlement } from './workflow'

const makeSendRequester = (body: unknown, statusCode = 200) =>
  ({
    sendRequest: () => ({
      result: () => ({
        statusCode,
        body: Buffer.from(JSON.stringify(body)),
      }),
    }),
  }) as any

const yesBody = () => ({
  matchId: '1694390',
  template: 'SHOT_ON_TARGET_NEXT_N',
  windowStart: 0,
  windowEnd: 120,
  outcome: 'Yes',
  qualifyingEventTs: 31.226217,
  evidenceEventIds: [88178642, 88178643],
  qualifyingEventTsWallClock: 1790214333,
})

describe('fetchSettlement', () => {
  test('parses a Yes settlement response', () => {
    const result = fetchSettlement(makeSendRequester(yesBody()), {
      url: 'http://localhost:8080/matches/1694390/settlement?template=SHOT_ON_TARGET_NEXT_N&windowStart=0&windowEnd=120',
    })

    expect(result).toEqual({
      outcome: 'Yes',
      qualifyingEventTsWallClock: 1790214333,
      evidenceEventIds: [88178642, 88178643],
    })
  })

  test('parses a No settlement response', () => {
    const body = { ...yesBody(), outcome: 'No', evidenceEventIds: [], qualifyingEventTsWallClock: 0 }
    const result = fetchSettlement(makeSendRequester(body), { url: 'http://localhost:8080/x' })

    expect(result).toEqual({ outcome: 'No', qualifyingEventTsWallClock: 0, evidenceEventIds: [] })
  })

  test('throws when the match-data service returns a non-200 response', () => {
    expect(() =>
      fetchSettlement(makeSendRequester({ error: 'not found' }, 404), {
        url: 'http://localhost:8080/matches/unknown/settlement',
      }),
    ).toThrow('match-data settlement endpoint returned HTTP 404')
  })

  test('throws when outcome is missing or invalid', () => {
    const body = { ...yesBody(), outcome: 'Draw' }
    expect(() => fetchSettlement(makeSendRequester(body), { url: 'http://localhost:8080/x' })).toThrow(
      'unexpected outcome value',
    )
  })

  test('throws when evidenceEventIds is missing', () => {
    const { evidenceEventIds: _drop, ...body } = yesBody()
    expect(() => fetchSettlement(makeSendRequester(body), { url: 'http://localhost:8080/x' })).toThrow(
      'missing evidenceEventIds',
    )
  })
})
