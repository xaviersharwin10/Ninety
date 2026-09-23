# Wyscout fixture matches

Three UEFA Euro 2016 Group A matches, vendored in `packages/match-data/fixtures/` (see
`ATTRIBUTION.md` there for licensing). Selected from a scan of the first eight matches in the
Pappalardo/Massucco dataset's `processed-v2` mirror for a spread across the four CORE market
templates. Counts below only include *qualifying* events (shots on target and goals for
`SHOT_ON_TARGET_NEXT_N`; goals for `GOAL_NEXT_N`; corners; cards), measured directly against each
file with the same logic `resolveMarket` uses.

| Fixture | Events | Shots | On target | Goals | Corners | Cards | Notes |
|---|---|---|---|---|---|---|---|
| `1694390.json` — France v Romania | 1,641 | 22 | 7 | 2 | 9 | 4 | Balanced opener; good default demo match |
| `1694391.json` — Albania v Switzerland | 1,523 | 21 | 8 | 1 | 8 | 7 | Most cards of the eight scanned — best `CARD_NEXT_N` stress test |
| `1694392.json` — Romania v Switzerland | 1,519 | 26 | 6 | 1 | 11 | 6 | Most corners — best `CORNER_NEXT_N` stress test |

## Schema notes (Wyscout `processed-v2`)

- Top-level keys: `events`, `teams` (keyed by team id), `players`.
- Each event: `eventName`/`subEventName`, `tags: [{id}]`, `teamId`, `playerId`, `matchPeriod`
  (`"1H"` / `"2H"`), `eventSec` (float, seconds into that period, resets each period), `id`.
- **Shot on target**: `eventName === "Shot"` and tag `1801` ("accurate") or `101` ("goal") present.
- **Goal**: `eventName === "Shot"` and tag `101` present. No dedicated own-goal event type was
  observed in this dataset slice — own goals are not specially handled in v1; see
  `README.md#known-limitations`.
- **Corner**: `eventName === "Free Kick"` and `subEventName === "Corner"`.
- **Card**: `eventName === "Foul"` and tags intersect `{1701, 1702, 1703}` (yellow / second yellow /
  red). The three are not distinguished for `CARD_NEXT_N` resolution — any of them qualifies.

## Match clock

`matchPeriod` + `eventSec` gives a clock that resets at half-time. `toMatchClockSec` in
`@ninety/core` maps this onto one monotonic clock using **nominal** period boundaries (45:00 for
2H, 90:00 for E1, ...), not each match's actual stoppage-time length. See the doc comment on
`PERIOD_OFFSET_SEC` for the one edge case this simplifies away (an event very late in first-half
stoppage time can carry a `matchClockSec` that overlaps the first seconds of the second half).
